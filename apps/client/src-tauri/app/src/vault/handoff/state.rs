//! Platform-private pairing identity and transfer registry.

use super::protocol::{
    validate_identifier, BundleMetadata, BundlePurpose, PairingInvitation, PROTOCOL_VERSION,
};
use base64::Engine;
use rcgen::{CertificateParams, KeyPair};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const PAIRING_STATE_FILE: &str = "vault-handoff.json";
const PAIRING_STATE_SCHEMA_VERSION: u32 = 1;
const STAGING_DIRECTORY: &str = "vault-handoff-staging";
const INVITATION_LIFETIME_MS: i64 = 5 * 60 * 1_000;
const MAX_CERTIFICATE_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredIdentity {
    device_id: String,
    certificate: String,
    private_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedPeer {
    pub device_id: String,
    pub device_label: String,
    pub vault_id: String,
    pub certificate: String,
    pub certificate_fingerprint: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoordinatorPin {
    pub device_id: String,
    pub endpoint: String,
    pub vault_id: String,
    #[serde(default)]
    pub generation: u64,
    pub certificate_fingerprint: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingStateFile {
    schema_version: u32,
    identity: StoredIdentity,
    linked_peer: Option<LinkedPeer>,
    coordinator: Option<CoordinatorPin>,
    #[serde(default)]
    replica_ready: bool,
    #[serde(default)]
    pending_acknowledgement: Option<PendingAcknowledgement>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingAcknowledgement {
    pub vault_id: String,
    pub device_id: String,
    pub transfer_id: String,
    pub generation: u64,
    pub purpose: BundlePurpose,
}

pub(crate) struct TlsIdentity {
    pub certificate: CertificateDer<'static>,
    pub private_key: PrivateKeyDer<'static>,
}

impl Clone for TlsIdentity {
    fn clone(&self) -> Self {
        Self {
            certificate: self.certificate.clone(),
            private_key: self.private_key.clone_key(),
        }
    }
}

impl std::fmt::Debug for TlsIdentity {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TlsIdentity")
            .field("certificate_bytes", &self.certificate.as_ref().len())
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug)]
struct PendingInvitation {
    invitation: PairingInvitation,
}

#[derive(Clone, Debug)]
pub(crate) struct RegisteredBundle {
    pub metadata: BundleMetadata,
    pub path: PathBuf,
}

pub(crate) struct Enrollment<'a> {
    pub invitation_id: &'a str,
    pub secret: &'a str,
    pub vault_id: &'a str,
    pub device_id: &'a str,
    pub device_label: &'a str,
    pub certificate_b64: &'a str,
}

#[derive(Default)]
struct PairingManagerInner {
    state_path: Option<PathBuf>,
    staging_root: Option<PathBuf>,
    state: Option<PairingStateFile>,
    invitations: BTreeMap<String, PendingInvitation>,
    outgoing_bundles: BTreeMap<String, RegisteredBundle>,
}

/// Durable device identity with process-local invitation and transfer state.
#[derive(Clone, Default)]
pub(crate) struct PairingManager {
    inner: std::sync::Arc<Mutex<PairingManagerInner>>,
}

impl PairingManager {
    pub(crate) fn initialize(
        &self,
        app_config_dir: PathBuf,
        device_id: String,
    ) -> Result<(), String> {
        validate_identifier("device id", &device_id)?;
        fs::create_dir_all(&app_config_dir)
            .map_err(|error| format!("create app config directory: {error}"))?;
        let state_path = app_config_dir.join(PAIRING_STATE_FILE);
        recover_private_state(&state_path)?;
        let staging_root = app_config_dir.join(STAGING_DIRECTORY);
        fs::create_dir_all(&staging_root)
            .map_err(|error| format!("create handoff staging directory: {error}"))?;

        let state = if state_path.exists() {
            read_state(&state_path)?
        } else {
            let state = PairingStateFile {
                schema_version: PAIRING_STATE_SCHEMA_VERSION,
                identity: create_identity(device_id.clone())?,
                linked_peer: None,
                coordinator: None,
                replica_ready: false,
                pending_acknowledgement: None,
            };
            persist_state(&state_path, &state)?;
            state
        };
        validate_state(&state, &device_id)?;

        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "pairing state lock is unavailable".to_string())?;
        inner.state_path = Some(state_path);
        inner.staging_root = Some(staging_root);
        inner.state = Some(state);
        inner.invitations.clear();
        inner.outgoing_bundles.clear();
        Ok(())
    }

    pub(crate) fn identity(&self) -> Result<(String, TlsIdentity), String> {
        let inner = self.lock()?;
        let state = initialized_state(&inner)?;
        Ok((
            state.identity.device_id.clone(),
            decode_identity(&state.identity)?,
        ))
    }

    pub(crate) fn linked_peer(&self) -> Result<Option<LinkedPeer>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.linked_peer.clone())
    }

    pub(crate) fn coordinator_pin(&self) -> Result<Option<CoordinatorPin>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.coordinator.clone())
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub(crate) fn replica_ready(&self) -> Result<bool, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.replica_ready)
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub(crate) fn pending_acknowledgement(&self) -> Result<Option<PendingAcknowledgement>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.pending_acknowledgement.clone())
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub(crate) fn record_activation(
        &self,
        acknowledgement: PendingAcknowledgement,
    ) -> Result<(), String> {
        validate_identifier("vault id", &acknowledgement.vault_id)?;
        validate_identifier("device id", &acknowledgement.device_id)?;
        validate_identifier("transfer id", &acknowledgement.transfer_id)?;
        if acknowledgement.purpose == BundlePurpose::Ownership && acknowledgement.generation == 0 {
            return Err("activation generation must be positive".to_string());
        }
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        state.replica_ready = true;
        state.pending_acknowledgement = Some(acknowledgement);
        persist_initialized_state(&inner)
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub(crate) fn clear_pending_acknowledgement(&self, transfer_id: &str) -> Result<(), String> {
        validate_identifier("transfer id", transfer_id)?;
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        match state.pending_acknowledgement.as_ref() {
            Some(pending) if pending.transfer_id == transfer_id => {
                state.pending_acknowledgement = None;
                persist_initialized_state(&inner)
            }
            None => Ok(()),
            Some(_) => Err("pending activation acknowledgement does not match".to_string()),
        }
    }

    pub(crate) fn create_invitation(
        &self,
        endpoint: std::net::SocketAddr,
        vault_id: String,
        generation: u64,
        now_unix_ms: i64,
    ) -> Result<PairingInvitation, String> {
        validate_identifier("vault id", &vault_id)?;
        let mut inner = self.lock()?;
        let state = initialized_state(&inner)?;
        let invitation = PairingInvitation {
            protocol_version: PROTOCOL_VERSION,
            invitation_id: random_token("invite")?,
            secret: random_secret()?,
            endpoint: endpoint.to_string(),
            coordinator_fingerprint: certificate_fingerprint(
                decode_certificate(&state.identity.certificate)?.as_ref(),
            ),
            coordinator_device_id: state.identity.device_id.clone(),
            vault_id,
            generation,
            expires_at_unix_ms: now_unix_ms.saturating_add(INVITATION_LIFETIME_MS),
        };
        inner.invitations.clear();
        inner.invitations.insert(
            invitation.invitation_id.clone(),
            PendingInvitation {
                invitation: invitation.clone(),
            },
        );
        Ok(invitation)
    }

    pub(crate) fn enroll_peer(
        &self,
        enrollment: Enrollment<'_>,
        now_unix_ms: i64,
    ) -> Result<LinkedPeer, String> {
        validate_identifier("device id", enrollment.device_id)?;
        let certificate = decode_certificate(enrollment.certificate_b64)?;
        let mut inner = self.lock()?;
        let pending = inner
            .invitations
            .get(enrollment.invitation_id)
            .ok_or_else(|| "pairing invitation is unknown or already used".to_string())?;
        pending.invitation.validate(now_unix_ms)?;
        if pending.invitation.vault_id != enrollment.vault_id
            || !constant_time_equal(
                pending.invitation.secret.as_bytes(),
                enrollment.secret.as_bytes(),
            )
        {
            return Err("pairing invitation credentials are invalid".to_string());
        }
        let peer = LinkedPeer {
            device_id: enrollment.device_id.to_string(),
            device_label: enrollment.device_label.to_string(),
            vault_id: enrollment.vault_id.to_string(),
            certificate: enrollment.certificate_b64.to_string(),
            certificate_fingerprint: certificate_fingerprint(certificate.as_ref()),
        };
        let state = initialized_state_mut(&mut inner)?;
        if let Some(existing) = state.linked_peer.as_ref() {
            if existing.device_id != peer.device_id
                || existing.certificate_fingerprint != peer.certificate_fingerprint
                || existing.vault_id != peer.vault_id
            {
                return Err("a different phone is already linked".to_string());
            }
        }
        state.linked_peer = Some(peer.clone());
        persist_initialized_state(&inner)?;
        inner.invitations.remove(enrollment.invitation_id);
        Ok(peer)
    }

    pub(crate) fn record_coordinator(
        &self,
        invitation: &PairingInvitation,
        coordinator_certificate: &[u8],
    ) -> Result<(), String> {
        let fingerprint = certificate_fingerprint(coordinator_certificate);
        if fingerprint != invitation.coordinator_fingerprint {
            return Err("coordinator certificate does not match the QR invitation".to_string());
        }
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        state.coordinator = Some(CoordinatorPin {
            device_id: invitation.coordinator_device_id.clone(),
            endpoint: invitation.endpoint.clone(),
            vault_id: invitation.vault_id.clone(),
            generation: invitation.generation,
            certificate_fingerprint: fingerprint,
        });
        persist_initialized_state(&inner)
    }

    pub(crate) fn verify_authenticated_peer(
        &self,
        device_id: &str,
        certificate: Option<&CertificateDer<'_>>,
        vault_id: &str,
    ) -> Result<(), String> {
        let certificate = certificate
            .ok_or_else(|| "authenticated client certificate is required".to_string())?;
        let inner = self.lock()?;
        let peer = initialized_state(&inner)?
            .linked_peer
            .as_ref()
            .ok_or_else(|| "no phone is linked".to_string())?;
        if peer.device_id != device_id
            || peer.vault_id != vault_id
            || peer.certificate_fingerprint != certificate_fingerprint(certificate.as_ref())
        {
            return Err("authenticated device identity does not match the request".to_string());
        }
        Ok(())
    }

    #[allow(dead_code)] // H04 registers consistent snapshots for transport.
    pub(crate) fn register_outgoing_bundle(
        &self,
        metadata: BundleMetadata,
        path: PathBuf,
    ) -> Result<(), String> {
        metadata.validate()?;
        super::protocol::validate_staging_file(&path, &metadata)?;
        let mut inner = self.lock()?;
        initialized_state(&inner)?;
        inner.outgoing_bundles.insert(
            metadata.transfer_id.clone(),
            RegisteredBundle { metadata, path },
        );
        Ok(())
    }

    pub(crate) fn outgoing_bundle(&self, transfer_id: &str) -> Result<RegisteredBundle, String> {
        validate_identifier("transfer id", transfer_id)?;
        let inner = self.lock()?;
        inner
            .outgoing_bundles
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| "transfer is not available".to_string())
    }

    pub(crate) fn unregister_outgoing_bundle(&self, transfer_id: &str) -> Result<(), String> {
        validate_identifier("transfer id", transfer_id)?;
        let mut inner = self.lock()?;
        inner.outgoing_bundles.remove(transfer_id);
        Ok(())
    }

    pub(crate) fn outgoing_snapshot_paths(
        &self,
        transfer_id: &str,
    ) -> Result<(PathBuf, PathBuf), String> {
        validate_identifier("transfer id", transfer_id)?;
        let inner = self.lock()?;
        let root = inner
            .staging_root
            .as_ref()
            .ok_or_else(|| "pairing state is not initialized".to_string())?;
        Ok((
            root.join(format!("{transfer_id}.source.sqlite")),
            root.join(format!("{transfer_id}.source.zip")),
        ))
    }

    pub(crate) fn staging_paths(
        &self,
        transfer_id: &str,
    ) -> Result<(PathBuf, PathBuf, PathBuf), String> {
        validate_identifier("transfer id", transfer_id)?;
        let inner = self.lock()?;
        let root = inner
            .staging_root
            .as_ref()
            .ok_or_else(|| "pairing state is not initialized".to_string())?;
        Ok((
            root.join(format!("{transfer_id}.part")),
            root.join(format!("{transfer_id}.json")),
            root.join(format!("{transfer_id}.zip")),
        ))
    }

    pub(crate) fn remove_staging(&self, transfer_id: &str) -> Result<(), String> {
        let (partial, metadata, complete) = self.staging_paths(transfer_id)?;
        for path in [partial, metadata, complete] {
            let result = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            match result {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("remove staged transfer: {error}")),
            }
        }
        Ok(())
    }

    #[allow(dead_code)] // H04 consumes the resumable receiver API.
    pub(crate) fn write_staging_metadata(
        &self,
        path: &Path,
        metadata: &BundleMetadata,
    ) -> Result<(), String> {
        metadata.validate()?;
        let json = serde_json::to_vec(metadata)
            .map_err(|error| format!("encode transfer metadata: {error}"))?;
        write_private_file_atomically(path, &json)
    }

    #[allow(dead_code)] // H04 consumes the resumable receiver API.
    pub(crate) fn read_staging_metadata(
        &self,
        path: &Path,
    ) -> Result<Option<BundleMetadata>, String> {
        match fs::read(path) {
            Ok(json) => {
                let metadata: BundleMetadata = serde_json::from_slice(&json)
                    .map_err(|error| format!("decode transfer metadata: {error}"))?;
                metadata.validate()?;
                Ok(Some(metadata))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("read transfer metadata: {error}")),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, PairingManagerInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "pairing state lock is unavailable".to_string())
    }
}

fn initialized_state(inner: &PairingManagerInner) -> Result<&PairingStateFile, String> {
    inner
        .state
        .as_ref()
        .ok_or_else(|| "pairing state is not initialized".to_string())
}

fn initialized_state_mut(inner: &mut PairingManagerInner) -> Result<&mut PairingStateFile, String> {
    inner
        .state
        .as_mut()
        .ok_or_else(|| "pairing state is not initialized".to_string())
}

fn persist_initialized_state(inner: &PairingManagerInner) -> Result<(), String> {
    let path = inner
        .state_path
        .as_ref()
        .ok_or_else(|| "pairing state path is not initialized".to_string())?;
    persist_state(path, initialized_state(inner)?)
}

fn create_identity(device_id: String) -> Result<StoredIdentity, String> {
    let signing_key =
        KeyPair::generate().map_err(|error| format!("generate device key: {error}"))?;
    let certificate = CertificateParams::new(vec!["ganbaru-device.local".to_string()])
        .map_err(|error| format!("configure device certificate: {error}"))?
        .self_signed(&signing_key)
        .map_err(|error| format!("generate device certificate: {error}"))?;
    Ok(StoredIdentity {
        device_id,
        certificate: base64::engine::general_purpose::STANDARD.encode(certificate.der().as_ref()),
        private_key: base64::engine::general_purpose::STANDARD.encode(signing_key.serialize_der()),
    })
}

fn decode_identity(identity: &StoredIdentity) -> Result<TlsIdentity, String> {
    let certificate = decode_certificate(&identity.certificate)?;
    let private_key = base64::engine::general_purpose::STANDARD
        .decode(&identity.private_key)
        .map_err(|error| format!("decode device private key: {error}"))?;
    if private_key.is_empty() || private_key.len() > MAX_CERTIFICATE_BYTES {
        return Err("device private key has an invalid size".to_string());
    }
    Ok(TlsIdentity {
        certificate,
        private_key: PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(private_key)),
    })
}

pub(crate) fn decode_certificate(encoded: &str) -> Result<CertificateDer<'static>, String> {
    let certificate = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("decode device certificate: {error}"))?;
    if certificate.is_empty() || certificate.len() > MAX_CERTIFICATE_BYTES {
        return Err("device certificate has an invalid size".to_string());
    }
    Ok(CertificateDer::from(certificate))
}

pub(crate) fn encode_certificate(certificate: &CertificateDer<'_>) -> String {
    base64::engine::general_purpose::STANDARD.encode(certificate.as_ref())
}

pub(crate) fn certificate_fingerprint(certificate: &[u8]) -> String {
    let digest = Sha256::digest(certificate);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn random_secret() -> Result<String, String> {
    let mut random = [0_u8; 32];
    rustls::crypto::ring::default_provider()
        .secure_random
        .fill(&mut random)
        .map_err(|_| "secure random generator is unavailable".to_string())?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random))
}

pub(crate) fn random_token(prefix: &str) -> Result<String, String> {
    let mut random = [0_u8; 16];
    rustls::crypto::ring::default_provider()
        .secure_random
        .fill(&mut random)
        .map_err(|_| "secure random generator is unavailable".to_string())?;
    Ok(format!(
        "{prefix}-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random)
    ))
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    let max_len = left.len().max(right.len());
    for index in 0..max_len {
        difference |= usize::from(
            left.get(index).copied().unwrap_or(0) ^ right.get(index).copied().unwrap_or(0),
        );
    }
    difference == 0
}

fn validate_state(state: &PairingStateFile, expected_device_id: &str) -> Result<(), String> {
    if state.schema_version != PAIRING_STATE_SCHEMA_VERSION {
        return Err("pairing state schema version is unsupported".to_string());
    }
    if state.identity.device_id != expected_device_id {
        return Err("pairing identity belongs to a different device".to_string());
    }
    validate_identifier("device id", &state.identity.device_id)?;
    decode_identity(&state.identity)?;
    if let Some(peer) = state.linked_peer.as_ref() {
        validate_identifier("peer device id", &peer.device_id)?;
        validate_identifier("peer vault id", &peer.vault_id)?;
        let certificate = decode_certificate(&peer.certificate)?;
        if certificate_fingerprint(certificate.as_ref()) != peer.certificate_fingerprint {
            return Err("linked peer certificate fingerprint is inconsistent".to_string());
        }
    }
    if let Some(coordinator) = state.coordinator.as_ref() {
        validate_identifier("coordinator device id", &coordinator.device_id)?;
        validate_identifier("coordinator vault id", &coordinator.vault_id)?;
        coordinator
            .endpoint
            .parse::<std::net::SocketAddr>()
            .map_err(|_| "coordinator endpoint is invalid".to_string())?;
        if coordinator.certificate_fingerprint.len() != 64 {
            return Err("coordinator certificate fingerprint is invalid".to_string());
        }
    }
    if let Some(pending) = state.pending_acknowledgement.as_ref() {
        validate_identifier("pending vault id", &pending.vault_id)?;
        validate_identifier("pending device id", &pending.device_id)?;
        validate_identifier("pending transfer id", &pending.transfer_id)?;
        if pending.device_id != expected_device_id
            || (pending.purpose == BundlePurpose::Ownership && pending.generation == 0)
            || !state.replica_ready
        {
            return Err("pending activation acknowledgement is inconsistent".to_string());
        }
    }
    Ok(())
}

fn read_state(path: &Path) -> Result<PairingStateFile, String> {
    let bytes = fs::read(path).map_err(|error| format!("read pairing state: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("decode pairing state: {error}"))
}

fn persist_state(path: &Path, state: &PairingStateFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("encode pairing state: {error}"))?;
    write_private_file_atomically(path, &bytes)
}

fn write_private_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "private state path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create private state directory: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "private state filename is invalid".to_string())?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", random_token("write")?));
    let rollback = path.with_extension("rollback");
    if rollback.exists() {
        fs::remove_file(&rollback)
            .map_err(|error| format!("remove stale private state rollback: {error}"))?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("open temporary private state: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("write private state: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("sync private state: {error}"))?;
    let had_current = path.exists();
    if had_current {
        fs::rename(path, &rollback)
            .map_err(|error| format!("prepare private state replacement: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if had_current {
            let _ = fs::rename(&rollback, path);
        }
        return Err(format!("replace private state: {error}"));
    }
    if had_current {
        let _ = fs::remove_file(&rollback);
    }
    sync_parent_directory(path)?;
    Ok(())
}

fn recover_private_state(path: &Path) -> Result<(), String> {
    let rollback = path.with_extension("rollback");
    if path.exists() {
        if rollback.exists() {
            fs::remove_file(&rollback)
                .map_err(|error| format!("remove private state rollback: {error}"))?;
        }
        return Ok(());
    }
    if rollback.exists() {
        fs::rename(&rollback, path)
            .map_err(|error| format!("recover private pairing state: {error}"))?;
    }
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "private state path has no parent".to_string())?;
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync private state directory: {error}"))
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ganbaru-handoff-{label}-{}",
                random_token("test").expect("random test directory")
            ));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn enrollment<'a>(
        invitation: &'a PairingInvitation,
        phone: &'a StoredIdentity,
    ) -> Enrollment<'a> {
        Enrollment {
            invitation_id: &invitation.invitation_id,
            secret: &invitation.secret,
            vault_id: &invitation.vault_id,
            device_id: "device-phone",
            device_label: "Phone",
            certificate_b64: &phone.certificate,
        }
    }

    #[test]
    fn invitation_is_single_use_and_not_restored_after_restart() {
        let temp = TestDirectory::new("single-use");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        let invitation = manager
            .create_invitation(
                "127.0.0.1:41000".parse().expect("endpoint"),
                "vault-1".to_string(),
                0,
                100,
            )
            .expect("invitation");
        let phone = create_identity("device-phone".to_string()).expect("phone identity");
        manager
            .enroll_peer(enrollment(&invitation, &phone), 101)
            .expect("enroll");
        assert!(manager
            .enroll_peer(enrollment(&invitation, &phone), 102)
            .unwrap_err()
            .contains("already used"));

        let restarted = PairingManager::default();
        restarted
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("restart");
        assert!(restarted
            .enroll_peer(enrollment(&invitation, &phone), 103)
            .unwrap_err()
            .contains("unknown"));
    }

    #[test]
    fn expired_invitation_is_rejected() {
        let temp = TestDirectory::new("expired");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        let invitation = manager
            .create_invitation(
                "127.0.0.1:41000".parse().expect("endpoint"),
                "vault-1".to_string(),
                0,
                100,
            )
            .expect("invitation");
        let phone = create_identity("device-phone".to_string()).expect("phone identity");
        assert!(manager
            .enroll_peer(
                enrollment(&invitation, &phone),
                invitation.expires_at_unix_ms,
            )
            .unwrap_err()
            .contains("expired"));
    }

    #[test]
    fn activation_acknowledgement_survives_restart() {
        let temp = TestDirectory::new("pending-ack");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-phone".to_string())
            .expect("initialize");
        let pending = PendingAcknowledgement {
            vault_id: "vault-1".to_string(),
            device_id: "device-phone".to_string(),
            transfer_id: "transfer-1".to_string(),
            generation: 1,
            purpose: BundlePurpose::Ownership,
        };
        manager
            .record_activation(pending.clone())
            .expect("record activation");
        drop(manager);

        let restarted = PairingManager::default();
        restarted
            .initialize(temp.path().to_path_buf(), "device-phone".to_string())
            .expect("restart");
        assert!(restarted.replica_ready().expect("replica state"));
        assert_eq!(
            restarted
                .pending_acknowledgement()
                .expect("pending acknowledgement"),
            Some(pending)
        );
        restarted
            .clear_pending_acknowledgement("transfer-1")
            .expect("clear acknowledgement");
        assert_eq!(
            restarted
                .pending_acknowledgement()
                .expect("cleared acknowledgement"),
            None
        );
    }
}

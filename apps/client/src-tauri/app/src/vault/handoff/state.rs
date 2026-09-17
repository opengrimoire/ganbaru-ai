//! Platform-private pairing identity and transfer registry.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use super::protocol::HandoffCompatibility;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use super::protocol::PROTOCOL_VERSION;
use super::protocol::{
    validate_identifier, BundleMetadata, BundlePurpose, DeviceKind, PairingInvitation,
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
const PAIRING_STATE_SCHEMA_VERSION: u32 = 2;
const STAGING_DIRECTORY: &str = "vault-handoff-staging";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const INVITATION_LIFETIME_MS: i64 = 3 * 60 * 1_000;
const MAX_CERTIFICATE_BYTES: usize = 16 * 1024;
const MAX_LINKED_PEERS: usize = 32;
const MAX_REVOKED_PEERS: usize = 64;

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
    #[serde(default)]
    pub device_kind: DeviceKind,
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
struct RevokedPeer {
    device_id: String,
    vault_id: String,
    certificate: String,
    certificate_fingerprint: String,
    revoked_at_unix_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingStateFile {
    schema_version: u32,
    identity: StoredIdentity,
    #[serde(default)]
    linked_peers: BTreeMap<String, LinkedPeer>,
    #[serde(default)]
    revoked_peers: BTreeMap<String, RevokedPeer>,
    #[serde(
        default,
        rename = "linkedPeer",
        skip_serializing_if = "Option::is_none"
    )]
    legacy_linked_peer: Option<LinkedPeer>,
    coordinator: Option<CoordinatorPin>,
    #[serde(default)]
    revoked_by_coordinator: bool,
    #[serde(default)]
    replica_ready: bool,
    #[serde(default)]
    pending_acknowledgement: Option<PendingAcknowledgement>,
    #[serde(default)]
    outgoing_transfer: Option<StoredOutgoingTransfer>,
    #[serde(default)]
    incoming_transfer: Option<StoredIncomingTransfer>,
    #[serde(default)]
    completed_activation: Option<PendingAcknowledgement>,
    #[serde(default)]
    requested_upload: Option<BundlePurpose>,
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredOutgoingTransfer {
    pub metadata: BundleMetadata,
    pub purpose: BundlePurpose,
    pub committed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredIncomingTransfer {
    pub metadata: BundleMetadata,
    pub source_device_id: String,
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
#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct PendingInvitation {
    invitation: PairingInvitation,
}

#[derive(Clone, Debug)]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) struct RegisteredBundle {
    pub metadata: BundleMetadata,
    pub path: PathBuf,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) struct Enrollment<'a> {
    pub invitation_id: &'a str,
    pub secret: &'a str,
    pub vault_id: &'a str,
    pub device_id: &'a str,
    pub device_label: &'a str,
    pub device_kind: DeviceKind,
    pub certificate_b64: &'a str,
}

#[derive(Default)]
struct PairingManagerInner {
    state_path: Option<PathBuf>,
    staging_root: Option<PathBuf>,
    state: Option<PairingStateFile>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    invitations: BTreeMap<String, PendingInvitation>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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
            let mut state = read_state(&state_path)?;
            if state.schema_version == 1 {
                if let Some(peer) = state.legacy_linked_peer.take() {
                    state.linked_peers.insert(peer.device_id.clone(), peer);
                }
                state.schema_version = PAIRING_STATE_SCHEMA_VERSION;
                persist_state(&state_path, &state)?;
            }
            state
        } else {
            let state = PairingStateFile {
                schema_version: PAIRING_STATE_SCHEMA_VERSION,
                identity: create_identity(device_id.clone())?,
                linked_peers: BTreeMap::new(),
                revoked_peers: BTreeMap::new(),
                legacy_linked_peer: None,
                coordinator: None,
                revoked_by_coordinator: false,
                replica_ready: false,
                pending_acknowledgement: None,
                outgoing_transfer: None,
                incoming_transfer: None,
                completed_activation: None,
                requested_upload: None,
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
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            inner.invitations.clear();
            inner.outgoing_bundles.clear();
        }
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

    pub(crate) fn linked_peers(&self) -> Result<Vec<LinkedPeer>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?
            .linked_peers
            .values()
            .cloned()
            .collect())
    }

    pub(crate) fn linked_peer(&self, device_id: &str) -> Result<Option<LinkedPeer>, String> {
        validate_identifier("peer device id", device_id)?;
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?
            .linked_peers
            .get(device_id)
            .cloned())
    }

    pub(crate) fn coordinator_pin(&self) -> Result<Option<CoordinatorPin>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.coordinator.clone())
    }

    pub(crate) fn revoked_by_coordinator(&self) -> Result<bool, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.revoked_by_coordinator)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn client_auth_certificates(&self) -> Result<Vec<CertificateDer<'static>>, String> {
        let inner = self.lock()?;
        let state = initialized_state(&inner)?;
        state
            .linked_peers
            .values()
            .map(|peer| decode_certificate(&peer.certificate))
            .chain(
                state
                    .revoked_peers
                    .values()
                    .map(|peer| decode_certificate(&peer.certificate)),
            )
            .collect()
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn is_revoked_certificate(
        &self,
        certificate: Option<&CertificateDer<'_>>,
    ) -> Result<bool, String> {
        let Some(certificate) = certificate else {
            return Ok(false);
        };
        let fingerprint = certificate_fingerprint(certificate.as_ref());
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?
            .revoked_peers
            .values()
            .any(|peer| peer.certificate_fingerprint == fingerprint))
    }

    pub(crate) fn ensure_enrollment_target(
        &self,
        invitation: &PairingInvitation,
    ) -> Result<(), String> {
        let inner = self.lock()?;
        ensure_enrollment_target(initialized_state(&inner)?, invitation)
    }

    pub(crate) fn has_pending_transfer(&self) -> Result<bool, String> {
        let inner = self.lock()?;
        let state = initialized_state(&inner)?;
        Ok(state.pending_acknowledgement.is_some()
            || state.outgoing_transfer.is_some()
            || state.incoming_transfer.is_some()
            || state.requested_upload.is_some())
    }

    pub(crate) fn ensure_can_unlink(&self) -> Result<(), String> {
        if self.has_pending_transfer()? {
            return Err("finish or retry the active handoff before unlinking".to_string());
        }
        Ok(())
    }

    pub(crate) fn unlink(&self) -> Result<(), String> {
        let mut inner = self.lock()?;
        let previous = initialized_state(&inner)?.clone();
        if previous.pending_acknowledgement.is_some()
            || previous.outgoing_transfer.is_some()
            || previous.incoming_transfer.is_some()
            || previous.requested_upload.is_some()
        {
            return Err("finish or retry the active handoff before unlinking".to_string());
        }
        let state = initialized_state_mut(&mut inner)?;
        let removed_peers = std::mem::take(&mut state.linked_peers);
        for peer in removed_peers.into_values() {
            remember_revoked_peer(state, peer, super::protocol::unix_time_ms());
        }
        state.coordinator = None;
        state.revoked_by_coordinator = false;
        state.replica_ready = false;
        state.completed_activation = None;
        if let Err(error) = persist_initialized_state(&inner) {
            inner.state = Some(previous);
            return Err(error);
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            inner.invitations.clear();
            inner.outgoing_bundles.clear();
        }
        Ok(())
    }

    pub(crate) fn unlink_device(&self, device_id: &str) -> Result<(), String> {
        validate_identifier("peer device id", device_id)?;
        let mut inner = self.lock()?;
        let previous = initialized_state(&inner)?.clone();
        if previous.pending_acknowledgement.is_some()
            || previous.outgoing_transfer.is_some()
            || previous.incoming_transfer.is_some()
            || previous.requested_upload.is_some()
        {
            return Err("finish or retry the active handoff before unlinking".to_string());
        }
        let state = initialized_state_mut(&mut inner)?;
        let removed_peer = state.linked_peers.remove(device_id);
        let removed_peer_exists = removed_peer.is_some();
        if let Some(peer) = removed_peer {
            remember_revoked_peer(state, peer, super::protocol::unix_time_ms());
        }
        let removed_coordinator = state
            .coordinator
            .as_ref()
            .is_some_and(|coordinator| coordinator.device_id == device_id);
        if removed_coordinator {
            state.coordinator = None;
            state.revoked_by_coordinator = false;
            state.replica_ready = false;
            state.completed_activation = None;
        }
        if !removed_peer_exists && !removed_coordinator {
            return Err("linked device was not found".to_string());
        }
        if let Err(error) = persist_initialized_state(&inner) {
            inner.state = Some(previous);
            return Err(error);
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if removed_peer_exists {
            inner.invitations.clear();
        }
        Ok(())
    }

    pub(crate) fn accept_coordinator_revocation(
        &self,
        expected: &CoordinatorPin,
    ) -> Result<(), String> {
        let mut inner = self.lock()?;
        let previous = initialized_state(&inner)?.clone();
        let state = initialized_state_mut(&mut inner)?;
        let matches = state.coordinator.as_ref().is_some_and(|coordinator| {
            coordinator.device_id == expected.device_id
                && coordinator.vault_id == expected.vault_id
                && coordinator.certificate_fingerprint == expected.certificate_fingerprint
        });
        if !matches {
            return Err("coordinator changed before revocation could be applied".to_string());
        }
        state.coordinator = None;
        state.revoked_by_coordinator = true;
        state.pending_acknowledgement = None;
        state.outgoing_transfer = None;
        state.incoming_transfer = None;
        state.completed_activation = None;
        state.requested_upload = None;
        if let Err(error) = persist_initialized_state(&inner) {
            inner.state = Some(previous);
            return Err(error);
        }
        Ok(())
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

    pub(crate) fn store_outgoing_transfer(
        &self,
        transfer: StoredOutgoingTransfer,
    ) -> Result<(), String> {
        validate_stored_outgoing(&transfer)?;
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        state.outgoing_transfer = Some(transfer);
        persist_initialized_state(&inner)
    }

    pub(crate) fn outgoing_transfer(&self) -> Result<Option<StoredOutgoingTransfer>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.outgoing_transfer.clone())
    }

    pub(crate) fn mark_outgoing_committed(&self, transfer_id: &str) -> Result<(), String> {
        validate_identifier("transfer id", transfer_id)?;
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        let transfer = state
            .outgoing_transfer
            .as_mut()
            .ok_or_else(|| "outgoing transfer is not persisted".to_string())?;
        if transfer.metadata.transfer_id != transfer_id {
            return Err("outgoing transfer identity does not match".to_string());
        }
        transfer.committed = true;
        persist_initialized_state(&inner)
    }

    pub(crate) fn clear_outgoing_transfer(&self, transfer_id: &str) -> Result<(), String> {
        validate_identifier("transfer id", transfer_id)?;
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        match state.outgoing_transfer.as_ref() {
            Some(transfer) if transfer.metadata.transfer_id == transfer_id => {
                state.outgoing_transfer = None;
                persist_initialized_state(&inner)
            }
            None => Ok(()),
            Some(_) => Err("outgoing transfer identity does not match".to_string()),
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn store_incoming_transfer(
        &self,
        transfer: StoredIncomingTransfer,
    ) -> Result<(), String> {
        validate_stored_incoming(&transfer)?;
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        state.incoming_transfer = Some(transfer);
        persist_initialized_state(&inner)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn incoming_transfer(&self) -> Result<Option<StoredIncomingTransfer>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.incoming_transfer.clone())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn complete_incoming_activation(
        &self,
        completed: PendingAcknowledgement,
    ) -> Result<(), String> {
        validate_activation_record(&completed)?;
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        if state
            .incoming_transfer
            .as_ref()
            .is_some_and(|transfer| transfer.metadata.transfer_id != completed.transfer_id)
        {
            return Err("completed activation does not match incoming transfer".to_string());
        }
        state.incoming_transfer = None;
        state.completed_activation = Some(completed);
        state.requested_upload = None;
        persist_initialized_state(&inner)
    }

    pub(crate) fn complete_outgoing_activation(
        &self,
        completed: PendingAcknowledgement,
    ) -> Result<(), String> {
        validate_activation_record(&completed)?;
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        if state
            .outgoing_transfer
            .as_ref()
            .is_some_and(|transfer| transfer.metadata.transfer_id != completed.transfer_id)
        {
            return Err("completed activation does not match outgoing transfer".to_string());
        }
        state.outgoing_transfer = None;
        state.completed_activation = Some(completed);
        persist_initialized_state(&inner)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn completed_activation(&self) -> Result<Option<PendingAcknowledgement>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.completed_activation.clone())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn request_upload(&self, purpose: BundlePurpose) -> Result<(), String> {
        let mut inner = self.lock()?;
        let state = initialized_state_mut(&mut inner)?;
        if state.requested_upload != Some(BundlePurpose::Ownership) {
            state.requested_upload = Some(purpose);
        }
        persist_initialized_state(&inner)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn cancel_requested_upload(&self, purpose: BundlePurpose) -> Result<(), String> {
        let mut inner = self.lock()?;
        let previous = initialized_state(&inner)?.clone();
        let state = initialized_state_mut(&mut inner)?;
        if state.requested_upload != Some(purpose) {
            return Ok(());
        }
        state.requested_upload = None;
        if let Err(error) = persist_initialized_state(&inner) {
            inner.state = Some(previous);
            return Err(error);
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn requested_upload(&self) -> Result<Option<BundlePurpose>, String> {
        let inner = self.lock()?;
        Ok(initialized_state(&inner)?.requested_upload)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn create_invitation(
        &self,
        endpoint: std::net::SocketAddr,
        vault_id: String,
        generation: u64,
        compatibility: HandoffCompatibility,
        now_unix_ms: i64,
    ) -> Result<PairingInvitation, String> {
        validate_identifier("vault id", &vault_id)?;
        compatibility.validate()?;
        let mut inner = self.lock()?;
        let state = initialized_state(&inner)?;
        let invitation = PairingInvitation {
            protocol_version: PROTOCOL_VERSION,
            compatibility,
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

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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
            device_kind: enrollment.device_kind,
            vault_id: enrollment.vault_id.to_string(),
            certificate: enrollment.certificate_b64.to_string(),
            certificate_fingerprint: certificate_fingerprint(certificate.as_ref()),
        };
        let previous = initialized_state(&inner)?.clone();
        let state = initialized_state_mut(&mut inner)?;
        if peer.device_id == state.identity.device_id {
            return Err("a device cannot enroll its coordinator identity".to_string());
        }
        if let Some(existing) = state.linked_peers.get(&peer.device_id) {
            if existing.certificate_fingerprint != peer.certificate_fingerprint
                || existing.vault_id != peer.vault_id
            {
                return Err(
                    "this device identity conflicts with an existing linked device".to_string(),
                );
            }
        } else {
            if state
                .linked_peers
                .values()
                .any(|existing| existing.certificate_fingerprint == peer.certificate_fingerprint)
            {
                return Err("this certificate already belongs to another linked device".to_string());
            }
            if state.linked_peers.len() >= MAX_LINKED_PEERS {
                return Err(format!("at most {MAX_LINKED_PEERS} devices can be linked"));
            }
        }
        if state.revoked_peers.values().any(|revoked| {
            revoked.device_id != peer.device_id
                && revoked.certificate_fingerprint == peer.certificate_fingerprint
        }) {
            return Err("this certificate belonged to another revoked device".to_string());
        }
        state
            .linked_peers
            .insert(peer.device_id.clone(), peer.clone());
        state.revoked_peers.remove(&peer.device_id);
        state
            .revoked_peers
            .retain(|_, revoked| revoked.certificate_fingerprint != peer.certificate_fingerprint);
        if let Err(error) = persist_initialized_state(&inner) {
            inner.state = Some(previous);
            return Err(error);
        }
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
        ensure_enrollment_target(state, invitation)?;
        state.coordinator = Some(CoordinatorPin {
            device_id: invitation.coordinator_device_id.clone(),
            endpoint: invitation.endpoint.clone(),
            vault_id: invitation.vault_id.clone(),
            generation: invitation.generation,
            certificate_fingerprint: fingerprint,
        });
        state.revoked_by_coordinator = false;
        persist_initialized_state(&inner)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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
            .linked_peers
            .get(device_id)
            .ok_or_else(|| "this device is not linked".to_string())?;
        if peer.device_id != device_id
            || peer.vault_id != vault_id
            || peer.certificate_fingerprint != certificate_fingerprint(certificate.as_ref())
        {
            return Err("authenticated device identity does not match the request".to_string());
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn authenticated_peer(
        &self,
        certificate: Option<&CertificateDer<'_>>,
    ) -> Result<LinkedPeer, String> {
        let certificate = certificate
            .ok_or_else(|| "authenticated client certificate is required".to_string())?;
        let fingerprint = certificate_fingerprint(certificate.as_ref());
        let inner = self.lock()?;
        initialized_state(&inner)?
            .linked_peers
            .values()
            .find(|peer| peer.certificate_fingerprint == fingerprint)
            .cloned()
            .ok_or_else(|| "authenticated device is not linked".to_string())
    }

    #[allow(dead_code)] // H04 registers consistent snapshots for transport.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(crate) fn outgoing_bundle(&self, transfer_id: &str) -> Result<RegisteredBundle, String> {
        validate_identifier("transfer id", transfer_id)?;
        let inner = self.lock()?;
        inner
            .outgoing_bundles
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| "transfer is not available".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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

fn ensure_enrollment_target(
    state: &PairingStateFile,
    invitation: &PairingInvitation,
) -> Result<(), String> {
    match &state.coordinator {
        Some(coordinator)
            if coordinator.device_id == invitation.coordinator_device_id
                && coordinator.vault_id == invitation.vault_id
                && coordinator
                    .certificate_fingerprint
                    .eq_ignore_ascii_case(&invitation.coordinator_fingerprint) =>
        {
            Ok(())
        }
        Some(_) => Err(
            "this device is already linked to another coordinator; unlink it before linking to a different coordinator"
                .to_string(),
        ),
        None if !state.linked_peers.is_empty() => Err(
            "unlink coordinated devices before linking this device to another coordinator"
                .to_string(),
        ),
        None => Ok(()),
    }
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

fn validate_stored_outgoing(transfer: &StoredOutgoingTransfer) -> Result<(), String> {
    transfer.metadata.validate()?;
    if transfer.purpose == BundlePurpose::Ownership && transfer.metadata.generation == 0 {
        return Err("outgoing ownership generation must be positive".to_string());
    }
    Ok(())
}

fn validate_stored_incoming(transfer: &StoredIncomingTransfer) -> Result<(), String> {
    transfer.metadata.validate()?;
    validate_identifier("incoming source device id", &transfer.source_device_id)?;
    if transfer.source_device_id == transfer.metadata.device_id {
        return Err("incoming transfer source and receiver must differ".to_string());
    }
    if transfer.purpose == BundlePurpose::Ownership && transfer.metadata.generation == 0 {
        return Err("incoming ownership generation must be positive".to_string());
    }
    Ok(())
}

fn validate_pending_acknowledgement(
    pending: &PendingAcknowledgement,
    expected_device_id: &str,
) -> Result<(), String> {
    validate_activation_record(pending)?;
    if pending.device_id != expected_device_id {
        return Err("pending activation acknowledgement is inconsistent".to_string());
    }
    Ok(())
}

fn validate_activation_record(record: &PendingAcknowledgement) -> Result<(), String> {
    validate_identifier("activation vault id", &record.vault_id)?;
    validate_identifier("activation device id", &record.device_id)?;
    validate_identifier("activation transfer id", &record.transfer_id)?;
    if record.purpose == BundlePurpose::Ownership && record.generation == 0 {
        return Err("activation acknowledgement is inconsistent".to_string());
    }
    Ok(())
}

fn remember_revoked_peer(state: &mut PairingStateFile, peer: LinkedPeer, revoked_at_unix_ms: i64) {
    state.revoked_peers.insert(
        peer.device_id.clone(),
        RevokedPeer {
            device_id: peer.device_id,
            vault_id: peer.vault_id,
            certificate: peer.certificate,
            certificate_fingerprint: peer.certificate_fingerprint,
            revoked_at_unix_ms,
        },
    );
    while state.revoked_peers.len() > MAX_REVOKED_PEERS {
        let Some(oldest_device_id) = state
            .revoked_peers
            .values()
            .min_by_key(|peer| (peer.revoked_at_unix_ms, peer.device_id.as_str()))
            .map(|peer| peer.device_id.clone())
        else {
            break;
        };
        state.revoked_peers.remove(&oldest_device_id);
    }
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
    if state.linked_peers.len() > MAX_LINKED_PEERS {
        return Err("too many linked devices are stored".to_string());
    }
    if state.revoked_peers.len() > MAX_REVOKED_PEERS {
        return Err("too many revoked devices are stored".to_string());
    }
    if state.coordinator.is_some() && !state.linked_peers.is_empty() {
        return Err("a coordinator client cannot store its own linked devices".to_string());
    }
    if state.coordinator.is_some() && state.revoked_by_coordinator {
        return Err("a linked coordinator cannot also be recorded as revoked".to_string());
    }
    let mut peer_vault_id: Option<&str> = None;
    let mut certificate_fingerprints = std::collections::BTreeSet::new();
    for (device_id, peer) in &state.linked_peers {
        if device_id != &peer.device_id {
            return Err("linked device index is inconsistent".to_string());
        }
        if peer.device_id == state.identity.device_id {
            return Err("linked device identity duplicates the local device".to_string());
        }
        validate_identifier("peer device id", &peer.device_id)?;
        validate_identifier("peer vault id", &peer.vault_id)?;
        if peer.device_label.trim().is_empty()
            || peer.device_label.len() > super::protocol::MAX_DEVICE_LABEL_BYTES
            || peer.device_label.chars().any(char::is_control)
        {
            return Err("linked device label is invalid".to_string());
        }
        if peer_vault_id.is_some_and(|vault_id| vault_id != peer.vault_id) {
            return Err("linked devices belong to different vaults".to_string());
        }
        peer_vault_id = Some(&peer.vault_id);
        let certificate = decode_certificate(&peer.certificate)?;
        if certificate_fingerprint(certificate.as_ref()) != peer.certificate_fingerprint {
            return Err("linked peer certificate fingerprint is inconsistent".to_string());
        }
        if !certificate_fingerprints.insert(&peer.certificate_fingerprint) {
            return Err("linked devices reuse a certificate identity".to_string());
        }
    }
    for (device_id, peer) in &state.revoked_peers {
        if device_id != &peer.device_id {
            return Err("revoked device index is inconsistent".to_string());
        }
        if state.linked_peers.contains_key(device_id) {
            return Err("a device cannot be linked and revoked".to_string());
        }
        validate_identifier("revoked device id", &peer.device_id)?;
        validate_identifier("revoked vault id", &peer.vault_id)?;
        let certificate = decode_certificate(&peer.certificate)?;
        if certificate_fingerprint(certificate.as_ref()) != peer.certificate_fingerprint {
            return Err("revoked peer certificate fingerprint is inconsistent".to_string());
        }
        if !certificate_fingerprints.insert(&peer.certificate_fingerprint) {
            return Err("linked and revoked devices reuse a certificate identity".to_string());
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
        validate_pending_acknowledgement(pending, expected_device_id)?;
        if !state.replica_ready {
            return Err("pending activation acknowledgement is inconsistent".to_string());
        }
    }
    if let Some(transfer) = state.outgoing_transfer.as_ref() {
        validate_stored_outgoing(transfer)?;
    }
    if let Some(transfer) = state.incoming_transfer.as_ref() {
        validate_stored_incoming(transfer)?;
    }
    if let Some(completed) = state.completed_activation.as_ref() {
        validate_activation_record(completed)?;
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

pub(super) fn write_private_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
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

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
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
            device_kind: DeviceKind::Phone,
            certificate_b64: &phone.certificate,
        }
    }

    fn enroll_device(
        manager: &PairingManager,
        device_id: &str,
        device_label: &str,
        now_unix_ms: i64,
    ) {
        let invitation = manager
            .create_invitation(
                "127.0.0.1:41000".parse().expect("endpoint"),
                "vault-1".to_string(),
                0,
                crate::vault::handoff::protocol::test_compatibility(),
                now_unix_ms,
            )
            .expect("invitation");
        let identity = create_identity(device_id.to_string()).expect("peer identity");
        manager
            .enroll_peer(
                Enrollment {
                    invitation_id: &invitation.invitation_id,
                    secret: &invitation.secret,
                    vault_id: &invitation.vault_id,
                    device_id,
                    device_label,
                    device_kind: if device_label == "Phone" {
                        DeviceKind::Phone
                    } else {
                        DeviceKind::Computer
                    },
                    certificate_b64: &identity.certificate,
                },
                now_unix_ms + 1,
            )
            .expect("enroll device");
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
                crate::vault::handoff::protocol::test_compatibility(),
                100,
            )
            .expect("invitation");
        assert_eq!(invitation.expires_at_unix_ms, 180_100);
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
    fn repeated_enrollment_updates_one_existing_membership() {
        let temp = TestDirectory::new("repeat-enrollment");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        let phone = create_identity("device-phone".to_string()).expect("phone identity");

        for now_unix_ms in [100, 200] {
            let invitation = manager
                .create_invitation(
                    "127.0.0.1:41000".parse().expect("endpoint"),
                    "vault-1".to_string(),
                    0,
                    crate::vault::handoff::protocol::test_compatibility(),
                    now_unix_ms,
                )
                .expect("invitation");
            manager
                .enroll_peer(enrollment(&invitation, &phone), now_unix_ms + 1)
                .expect("enroll same phone");
        }

        let peers = manager.linked_peers().expect("linked peers");
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].device_id, "device-phone");
    }

    #[test]
    fn revoked_peer_is_remembered_across_restart_and_removed_by_reenrollment() {
        let temp = TestDirectory::new("revoked-peer");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        let phone = create_identity("device-phone".to_string()).expect("phone identity");
        let invitation = manager
            .create_invitation(
                "127.0.0.1:41000".parse().expect("endpoint"),
                "vault-1".to_string(),
                0,
                crate::vault::handoff::protocol::test_compatibility(),
                100,
            )
            .expect("invitation");
        manager
            .enroll_peer(enrollment(&invitation, &phone), 101)
            .expect("enroll phone");
        let phone_certificate = decode_certificate(&phone.certificate).expect("phone certificate");

        manager.unlink_device("device-phone").expect("unlink phone");
        assert!(manager.linked_peers().expect("linked peers").is_empty());
        assert!(manager
            .is_revoked_certificate(Some(&phone_certificate))
            .expect("revoked certificate"));

        let restarted = PairingManager::default();
        restarted
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("restart");
        assert!(restarted
            .is_revoked_certificate(Some(&phone_certificate))
            .expect("persisted revoked certificate"));

        let invitation = restarted
            .create_invitation(
                "127.0.0.1:41000".parse().expect("endpoint"),
                "vault-1".to_string(),
                0,
                crate::vault::handoff::protocol::test_compatibility(),
                200,
            )
            .expect("new invitation");
        restarted
            .enroll_peer(enrollment(&invitation, &phone), 201)
            .expect("reenroll phone");
        assert!(!restarted
            .is_revoked_certificate(Some(&phone_certificate))
            .expect("active certificate"));
        assert_eq!(restarted.linked_peers().expect("linked peers").len(), 1);
    }

    #[test]
    fn linked_client_accepts_only_its_existing_coordinator() {
        let phone_root = TestDirectory::new("coordinator-target-phone");
        let phone = PairingManager::default();
        phone
            .initialize(phone_root.path().to_path_buf(), "device-phone".to_string())
            .expect("initialize phone");

        let first_root = TestDirectory::new("coordinator-target-first");
        let first = PairingManager::default();
        first
            .initialize(first_root.path().to_path_buf(), "device-first".to_string())
            .expect("initialize first coordinator");
        let first_invitation = first
            .create_invitation(
                "127.0.0.1:41000".parse().expect("endpoint"),
                "vault-1".to_string(),
                3,
                crate::vault::handoff::protocol::test_compatibility(),
                100,
            )
            .expect("first invitation");
        let (_, first_identity) = first.identity().expect("first identity");
        phone
            .record_coordinator(&first_invitation, first_identity.certificate.as_ref())
            .expect("record first coordinator");

        let mut refreshed = first_invitation.clone();
        refreshed.endpoint = "127.0.0.1:42000".to_string();
        refreshed.generation = 4;
        phone
            .ensure_enrollment_target(&refreshed)
            .expect("same coordinator remains valid");
        phone
            .record_coordinator(&refreshed, first_identity.certificate.as_ref())
            .expect("refresh coordinator endpoint");
        assert_eq!(
            phone
                .coordinator_pin()
                .expect("coordinator pin")
                .expect("coordinator")
                .endpoint,
            "127.0.0.1:42000"
        );

        let second_root = TestDirectory::new("coordinator-target-second");
        let second = PairingManager::default();
        second
            .initialize(
                second_root.path().to_path_buf(),
                "device-second".to_string(),
            )
            .expect("initialize second coordinator");
        let second_invitation = second
            .create_invitation(
                "127.0.0.1:43000".parse().expect("endpoint"),
                "vault-1".to_string(),
                4,
                crate::vault::handoff::protocol::test_compatibility(),
                200,
            )
            .expect("second invitation");
        let (_, second_identity) = second.identity().expect("second identity");

        assert!(phone
            .ensure_enrollment_target(&second_invitation)
            .unwrap_err()
            .contains("already linked to another coordinator"));
        assert!(phone
            .record_coordinator(&second_invitation, second_identity.certificate.as_ref())
            .unwrap_err()
            .contains("already linked to another coordinator"));
        let mut different_vault = refreshed.clone();
        different_vault.vault_id = "vault-2".to_string();
        assert!(phone
            .ensure_enrollment_target(&different_vault)
            .unwrap_err()
            .contains("already linked to another coordinator"));
        let mut different_certificate = refreshed.clone();
        different_certificate.coordinator_fingerprint =
            second_invitation.coordinator_fingerprint.clone();
        assert!(phone
            .ensure_enrollment_target(&different_certificate)
            .unwrap_err()
            .contains("already linked to another coordinator"));
        assert_eq!(
            phone
                .coordinator_pin()
                .expect("coordinator pin")
                .expect("coordinator")
                .device_id,
            "device-first"
        );
    }

    #[test]
    fn several_peers_survive_restart_and_can_be_unlinked_individually() {
        let temp = TestDirectory::new("several-peers");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        enroll_device(&manager, "device-phone", "Phone", 100);
        enroll_device(&manager, "device-laptop", "Laptop", 200);

        let restarted = PairingManager::default();
        restarted
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("restart");
        let peers = restarted.linked_peers().expect("linked peers");
        assert_eq!(peers.len(), 2);
        assert_eq!(peers[0].device_id, "device-laptop");
        assert_eq!(peers[1].device_id, "device-phone");

        restarted
            .unlink_device("device-phone")
            .expect("unlink one peer");
        assert!(restarted
            .linked_peer("device-phone")
            .expect("removed peer")
            .is_none());
        assert!(restarted
            .linked_peer("device-laptop")
            .expect("remaining peer")
            .is_some());
    }

    #[test]
    fn schema_one_peer_migrates_to_membership() {
        let temp = TestDirectory::new("schema-one-migration");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        enroll_device(&manager, "device-phone", "Phone", 100);

        let state_path = temp.path().join(PAIRING_STATE_FILE);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&state_path).expect("read current pairing state"))
                .expect("decode current pairing state");
        let object = value.as_object_mut().expect("pairing state object");
        object.insert("schemaVersion".to_string(), serde_json::json!(1));
        let peers = object
            .remove("linkedPeers")
            .expect("current linked peers")
            .as_object()
            .expect("linked peer map")
            .clone();
        object.insert(
            "linkedPeer".to_string(),
            peers.get("device-phone").expect("phone peer").clone(),
        );
        fs::write(
            &state_path,
            serde_json::to_vec_pretty(&value).expect("encode legacy state"),
        )
        .expect("write legacy state");

        let migrated = PairingManager::default();
        migrated
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("migrate legacy state");
        assert_eq!(
            migrated
                .linked_peers()
                .expect("migrated peers")
                .into_iter()
                .map(|peer| peer.device_id)
                .collect::<Vec<_>>(),
            vec!["device-phone"]
        );
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(state_path).expect("read migrated state"))
                .expect("decode migrated state");
        assert_eq!(persisted["schemaVersion"], PAIRING_STATE_SCHEMA_VERSION);
        assert!(persisted.get("linkedPeer").is_none());
    }

    #[test]
    fn ownership_upload_request_cannot_be_downgraded_to_refresh() {
        let temp = TestDirectory::new("upload-priority");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");

        manager
            .request_upload(BundlePurpose::Ownership)
            .expect("request ownership upload");
        manager
            .request_upload(BundlePurpose::Refresh)
            .expect("request refresh upload");

        assert_eq!(
            manager.requested_upload().expect("requested upload"),
            Some(BundlePurpose::Ownership)
        );
        manager
            .cancel_requested_upload(BundlePurpose::Refresh)
            .expect("ignore lower-priority cancellation");
        assert_eq!(
            manager.requested_upload().expect("requested upload"),
            Some(BundlePurpose::Ownership)
        );
        manager
            .cancel_requested_upload(BundlePurpose::Ownership)
            .expect("cancel ownership upload");
        assert_eq!(manager.requested_upload().expect("requested upload"), None);
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
                crate::vault::handoff::protocol::test_compatibility(),
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
    fn unlink_clears_the_peer_but_refuses_active_transfer_state() {
        let temp = TestDirectory::new("unlink");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        let invitation = manager
            .create_invitation(
                "127.0.0.1:41000".parse().expect("endpoint"),
                "vault-1".to_string(),
                0,
                crate::vault::handoff::protocol::test_compatibility(),
                100,
            )
            .expect("invitation");
        let phone = create_identity("device-phone".to_string()).expect("phone identity");
        manager
            .enroll_peer(enrollment(&invitation, &phone), 101)
            .expect("enroll");
        manager
            .request_upload(BundlePurpose::Refresh)
            .expect("request upload");

        assert!(manager.unlink().is_err());
        {
            let mut inner = manager.lock().expect("pairing lock");
            initialized_state_mut(&mut inner)
                .expect("pairing state")
                .requested_upload = None;
            persist_initialized_state(&inner).expect("clear request");
        }
        manager.unlink().expect("unlink stable pairing");
        assert!(manager.linked_peers().expect("peer status").is_empty());
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

    #[test]
    fn bidirectional_transfer_state_survives_restart() {
        let temp = TestDirectory::new("bidirectional-restart");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-phone".to_string())
            .expect("initialize");
        let metadata = BundleMetadata {
            protocol_version: PROTOCOL_VERSION,
            compatibility: crate::vault::handoff::protocol::test_compatibility(),
            vault_id: "vault-1".to_string(),
            device_id: "device-desktop".to_string(),
            transfer_id: "transfer-return".to_string(),
            generation: 2,
            archive_bytes: 42,
            archive_sha256: "a".repeat(64),
        };
        let outgoing = StoredOutgoingTransfer {
            metadata: metadata.clone(),
            purpose: BundlePurpose::Ownership,
            committed: false,
        };
        manager
            .store_outgoing_transfer(outgoing.clone())
            .expect("store outgoing transfer");
        drop(manager);

        let restarted = PairingManager::default();
        restarted
            .initialize(temp.path().to_path_buf(), "device-phone".to_string())
            .expect("restart");
        assert_eq!(
            restarted.outgoing_transfer().expect("outgoing transfer"),
            Some(outgoing)
        );
        restarted
            .mark_outgoing_committed("transfer-return")
            .expect("commit outgoing transfer");
        drop(restarted);

        let committed = PairingManager::default();
        committed
            .initialize(temp.path().to_path_buf(), "device-phone".to_string())
            .expect("restart committed state");
        assert!(
            committed
                .outgoing_transfer()
                .expect("committed outgoing transfer")
                .expect("stored transfer")
                .committed
        );
        let completed = PendingAcknowledgement {
            vault_id: metadata.vault_id,
            device_id: metadata.device_id,
            transfer_id: metadata.transfer_id,
            generation: metadata.generation,
            purpose: BundlePurpose::Ownership,
        };
        committed
            .complete_outgoing_activation(completed.clone())
            .expect("complete outgoing activation");
        drop(committed);

        let acknowledged = PairingManager::default();
        acknowledged
            .initialize(temp.path().to_path_buf(), "device-phone".to_string())
            .expect("restart completed transfer");
        assert_eq!(
            acknowledged.outgoing_transfer().expect("cleared outgoing"),
            None
        );
        assert_eq!(
            acknowledged
                .completed_activation()
                .expect("completed outgoing activation"),
            Some(completed)
        );
    }

    #[test]
    fn incoming_transfer_and_completion_survive_restart() {
        let temp = TestDirectory::new("incoming-restart");
        let manager = PairingManager::default();
        manager
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("initialize");
        let metadata = BundleMetadata {
            protocol_version: PROTOCOL_VERSION,
            compatibility: crate::vault::handoff::protocol::test_compatibility(),
            vault_id: "vault-1".to_string(),
            device_id: "device-desktop".to_string(),
            transfer_id: "incoming-return".to_string(),
            generation: 3,
            archive_bytes: 84,
            archive_sha256: "b".repeat(64),
        };
        let incoming = StoredIncomingTransfer {
            metadata: metadata.clone(),
            source_device_id: "device-phone".to_string(),
            purpose: BundlePurpose::Ownership,
        };
        manager
            .store_incoming_transfer(incoming.clone())
            .expect("store incoming transfer");
        manager
            .request_upload(BundlePurpose::Ownership)
            .expect("store upload request");
        drop(manager);

        let restarted = PairingManager::default();
        restarted
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("restart incoming state");
        assert_eq!(
            restarted.incoming_transfer().expect("incoming transfer"),
            Some(incoming)
        );
        let completed = PendingAcknowledgement {
            vault_id: metadata.vault_id,
            device_id: metadata.device_id,
            transfer_id: metadata.transfer_id,
            generation: metadata.generation,
            purpose: BundlePurpose::Ownership,
        };
        restarted
            .complete_incoming_activation(completed.clone())
            .expect("complete incoming activation");
        drop(restarted);

        let acknowledged = PairingManager::default();
        acknowledged
            .initialize(temp.path().to_path_buf(), "device-desktop".to_string())
            .expect("restart completed state");
        assert_eq!(
            acknowledged
                .completed_activation()
                .expect("completed activation"),
            Some(completed)
        );
        assert_eq!(
            acknowledged.incoming_transfer().expect("cleared incoming"),
            None
        );
        assert_eq!(
            acknowledged.requested_upload().expect("cleared request"),
            None
        );
    }
}

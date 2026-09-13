//! Mutual-TLS coordinator transport and resumable archive streaming.

use super::protocol::{
    read_control, unix_time_ms, write_control, BundleMetadata, ControlMessage, PairingInvitation,
    PROTOCOL_VERSION, TRANSFER_CHUNK_BYTES,
};
use super::state::{
    certificate_fingerprint, decode_certificate, encode_certificate, Enrollment, PairingManager,
    TlsIdentity,
};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, RootCertStore, SignatureScheme};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::{TlsAcceptor, TlsConnector};

const TLS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const CONTROL_TIMEOUT: Duration = Duration::from_secs(15);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(20);

#[allow(dead_code)] // H04 owns cancellation from the transfer workflow.
#[derive(Clone, Default)]
pub(crate) struct TransferCancellation {
    cancelled: Arc<AtomicBool>,
}

#[allow(dead_code)] // H04 owns cancellation from the transfer workflow.
impl TransferCancellation {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Debug)]
struct PinnedServerVerifier {
    fingerprint: String,
    algorithms: WebPkiSupportedAlgorithms,
}

impl PinnedServerVerifier {
    fn new(fingerprint: String) -> Self {
        let provider = rustls::crypto::ring::default_provider();
        Self {
            fingerprint,
            algorithms: provider.signature_verification_algorithms,
        }
    }
}

impl ServerCertVerifier for PinnedServerVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if !intermediates.is_empty()
            || certificate_fingerprint(end_entity.as_ref()) != self.fingerprint
        {
            return Err(rustls::Error::General(
                "coordinator certificate does not match the pinned identity".to_string(),
            ));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, certificate, signature, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, certificate, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

pub(crate) async fn serve(
    listener: TcpListener,
    manager: PairingManager,
    mut shutdown: tokio::sync::oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                match accepted {
                    Ok((socket, _)) => {
                        let manager = manager.clone();
                        tokio::spawn(async move {
                            if let Err(error) = handle_connection(socket, manager).await {
                                eprintln!("vault handoff connection failed: {error}");
                            }
                        });
                    }
                    Err(error) => {
                        eprintln!("vault handoff coordinator accept failed: {error}");
                        break;
                    }
                }
            }
        }
    }
}

async fn handle_connection(socket: TcpStream, manager: PairingManager) -> Result<(), String> {
    let config = server_config(&manager)?;
    let mut stream = tokio::time::timeout(
        TLS_HANDSHAKE_TIMEOUT,
        TlsAcceptor::from(Arc::new(config)).accept(socket),
    )
    .await
    .map_err(|_| "TLS handshake timed out".to_string())?
    .map_err(|error| format!("accept TLS connection: {error}"))?;
    let peer_certificate = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|certificates| certificates.first())
        .cloned();
    let request = match timeout_control(read_control(&mut stream)).await {
        Ok(request) => request,
        Err(error) => {
            return send_error(&mut stream, "malformed_control", &error, false).await;
        }
    };

    match request {
        ControlMessage::Enroll {
            invitation_id,
            secret,
            vault_id,
            device_id,
            device_label,
            device_certificate,
            ..
        } => {
            if peer_certificate.is_some() {
                return send_error(
                    &mut stream,
                    "enrollment_identity",
                    "enrollment must use the invitation identity",
                    false,
                )
                .await;
            }
            if let Err(error) = manager.enroll_peer(
                Enrollment {
                    invitation_id: &invitation_id,
                    secret: &secret,
                    vault_id: &vault_id,
                    device_id: &device_id,
                    device_label: &device_label,
                    certificate_b64: &device_certificate,
                },
                unix_time_ms(),
            ) {
                return send_error(&mut stream, "enrollment_rejected", &error, false).await;
            }
            let (coordinator_device_id, _) = manager.identity()?;
            timeout_control(write_control(
                &mut stream,
                &ControlMessage::Enrolled {
                    protocol_version: PROTOCOL_VERSION,
                    coordinator_device_id,
                },
            ))
            .await
        }
        ControlMessage::DownloadBundle { metadata } => {
            manager.verify_authenticated_peer(
                &metadata.device_id,
                peer_certificate.as_ref(),
                &metadata.vault_id,
            )?;
            serve_download(&mut stream, &manager, metadata).await
        }
        ControlMessage::CancelTransfer { transfer_id } => {
            let peer = manager
                .linked_peer()?
                .ok_or_else(|| "no phone is linked".to_string())?;
            manager.verify_authenticated_peer(
                &peer.device_id,
                peer_certificate.as_ref(),
                &peer.vault_id,
            )?;
            manager.remove_staging(&transfer_id)?;
            timeout_control(write_control(
                &mut stream,
                &ControlMessage::BundleComplete { transfer_id },
            ))
            .await
        }
        ControlMessage::RefreshRequest {
            vault_id,
            device_id,
            generation,
            ..
        } => {
            manager.verify_authenticated_peer(&device_id, peer_certificate.as_ref(), &vault_id)?;
            timeout_control(write_control(
                &mut stream,
                &ControlMessage::RefreshStatus {
                    available: false,
                    generation,
                    transfer_id: None,
                },
            ))
            .await
        }
        ControlMessage::DoomscrollingExchange {
            vault_id,
            device_id,
            ..
        } => {
            manager.verify_authenticated_peer(&device_id, peer_certificate.as_ref(), &vault_id)?;
            timeout_control(write_control(
                &mut stream,
                &ControlMessage::DoomscrollingAcknowledged {
                    acknowledged_sample_ids: Vec::new(),
                    combined_duration_ms: 0,
                    remaining_allowance_ms: None,
                },
            ))
            .await
        }
        _ => {
            send_error(
                &mut stream,
                "unsupported_message",
                "the coordinator does not accept this message in the current state",
                false,
            )
            .await
        }
    }
}

async fn serve_download(
    stream: &mut tokio_rustls::server::TlsStream<TcpStream>,
    manager: &PairingManager,
    requested: BundleMetadata,
) -> Result<(), String> {
    let registered = manager.outgoing_bundle(&requested.transfer_id)?;
    if registered.metadata != requested {
        return send_error(
            stream,
            "transfer_metadata",
            "requested transfer metadata does not match the registered bundle",
            false,
        )
        .await;
    }
    timeout_control(write_control(
        stream,
        &ControlMessage::BundleMetadata {
            metadata: registered.metadata.clone(),
        },
    ))
    .await?;
    let response = timeout_control(read_control(stream)).await?;
    let offset = match response {
        ControlMessage::ResumeAt { offset } if offset <= registered.metadata.archive_bytes => {
            offset
        }
        _ => {
            return send_error(
                stream,
                "resume_offset",
                "transfer resume offset is invalid",
                false,
            )
            .await
        }
    };
    stream_file(
        stream,
        &registered.path,
        offset,
        registered.metadata.archive_bytes,
    )
    .await?;
    match timeout_control(read_control(stream)).await? {
        ControlMessage::BundleComplete { transfer_id }
            if transfer_id == registered.metadata.transfer_id =>
        {
            Ok(())
        }
        _ => Err("receiver did not acknowledge the completed transfer".to_string()),
    }
}

async fn stream_file<W>(
    writer: &mut W,
    path: &Path,
    offset: u64,
    total_bytes: u64,
) -> Result<(), String>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("open transfer bundle: {error}"))?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|error| format!("seek transfer bundle: {error}"))?;
    let mut remaining = total_bytes.saturating_sub(offset);
    let mut buffer = vec![0_u8; TRANSFER_CHUNK_BYTES];
    while remaining > 0 {
        let chunk_bytes = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| "transfer chunk size overflow".to_string())?;
        tokio::time::timeout(CHUNK_TIMEOUT, file.read_exact(&mut buffer[..chunk_bytes]))
            .await
            .map_err(|_| "reading the transfer bundle timed out".to_string())?
            .map_err(|error| format!("read transfer bundle: {error}"))?;
        tokio::time::timeout(CHUNK_TIMEOUT, writer.write_all(&buffer[..chunk_bytes]))
            .await
            .map_err(|_| "sending the transfer bundle timed out".to_string())?
            .map_err(|error| format!("send transfer bundle: {error}"))?;
        remaining -= chunk_bytes as u64;
    }
    writer
        .flush()
        .await
        .map_err(|error| format!("flush transfer bundle: {error}"))
}

pub(crate) async fn enroll(
    manager: &PairingManager,
    invitation: &PairingInvitation,
    device_label: String,
) -> Result<(), String> {
    invitation.validate(unix_time_ms())?;
    let endpoint = invitation
        .endpoint
        .parse()
        .map_err(|_| "pairing endpoint is invalid".to_string())?;
    let (device_id, identity) = manager.identity()?;
    let mut stream = connect_pinned(endpoint, &invitation.coordinator_fingerprint, None).await?;
    timeout_control(write_control(
        &mut stream,
        &ControlMessage::Enroll {
            protocol_version: PROTOCOL_VERSION,
            invitation_id: invitation.invitation_id.clone(),
            secret: invitation.secret.clone(),
            vault_id: invitation.vault_id.clone(),
            device_id,
            device_label,
            device_certificate: encode_certificate(&identity.certificate),
        },
    ))
    .await?;
    match timeout_control(read_control(&mut stream)).await? {
        ControlMessage::Enrolled {
            coordinator_device_id,
            ..
        } if coordinator_device_id == invitation.coordinator_device_id => {
            let coordinator_certificate = stream
                .get_ref()
                .1
                .peer_certificates()
                .and_then(|certificates| certificates.first())
                .ok_or_else(|| "coordinator did not provide a certificate".to_string())?;
            manager.record_coordinator(invitation, coordinator_certificate.as_ref())
        }
        ControlMessage::Error { message, .. } => Err(message),
        _ => Err("coordinator returned an invalid enrollment response".to_string()),
    }
}

#[allow(dead_code)] // H04 connects the Android transfer workflow.
pub(crate) async fn download_bundle(
    manager: &PairingManager,
    metadata: BundleMetadata,
    cancellation: &TransferCancellation,
) -> Result<PathBuf, String> {
    download_bundle_inner(manager, metadata, cancellation, None).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::handoff::protocol::{MAX_ARCHIVE_BYTES, PROTOCOL_VERSION};
    use crate::vault::handoff::state::random_token;
    use std::fs;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ganbaru-transport-{label}-{}",
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

    struct LocalPair {
        _desktop_root: TestDirectory,
        _phone_root: TestDirectory,
        desktop: PairingManager,
        phone: PairingManager,
        invitation: PairingInvitation,
        shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    }

    impl LocalPair {
        async fn start() -> Self {
            let desktop_root = TestDirectory::new("desktop");
            let phone_root = TestDirectory::new("phone");
            let desktop = PairingManager::default();
            desktop
                .initialize(
                    desktop_root.path().to_path_buf(),
                    "device-desktop".to_string(),
                )
                .expect("initialize desktop");
            let phone = PairingManager::default();
            phone
                .initialize(phone_root.path().to_path_buf(), "device-phone".to_string())
                .expect("initialize phone");
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind coordinator");
            let endpoint = listener.local_addr().expect("coordinator endpoint");
            let invitation = desktop
                .create_invitation(endpoint, "vault-1".to_string(), unix_time_ms())
                .expect("create invitation");
            let (shutdown, receiver) = tokio::sync::oneshot::channel();
            tokio::spawn(serve(listener, desktop.clone(), receiver));
            Self {
                _desktop_root: desktop_root,
                _phone_root: phone_root,
                desktop,
                phone,
                invitation,
                shutdown: Some(shutdown),
            }
        }

        async fn enroll(&self) {
            super::enroll(&self.phone, &self.invitation, "Phone".to_string())
                .await
                .expect("enroll phone");
        }

        fn register_bundle(&self, bytes: &[u8], transfer_id: &str) -> BundleMetadata {
            let path = self._desktop_root.path().join(format!("{transfer_id}.zip"));
            fs::write(&path, bytes).expect("write bundle");
            let metadata = BundleMetadata {
                protocol_version: PROTOCOL_VERSION,
                vault_id: "vault-1".to_string(),
                device_id: "device-phone".to_string(),
                transfer_id: transfer_id.to_string(),
                generation: 1,
                archive_bytes: bytes.len() as u64,
                archive_sha256: sha256_file(&path).expect("bundle digest"),
            };
            self.desktop
                .register_outgoing_bundle(metadata.clone(), path)
                .expect("register bundle");
            metadata
        }
    }

    impl Drop for LocalPair {
        fn drop(&mut self) {
            if let Some(shutdown) = self.shutdown.take() {
                let _ = shutdown.send(());
            }
        }
    }

    #[tokio::test]
    async fn fresh_phone_enrolls_and_stages_authenticated_bundle() {
        let pair = LocalPair::start().await;
        pair.enroll().await;
        let bytes = b"authenticated whole-vault test bundle";
        let metadata = pair.register_bundle(bytes, "transfer-fresh");

        let staged = download_bundle(&pair.phone, metadata, &TransferCancellation::default())
            .await
            .expect("download bundle");

        assert_eq!(fs::read(staged).expect("read staged bundle"), bytes);
    }

    #[tokio::test]
    async fn invalid_device_identity_cannot_download_bundle() {
        let pair = LocalPair::start().await;
        pair.enroll().await;
        let metadata = pair.register_bundle(b"private vault", "transfer-identity");

        let attacker_root = TestDirectory::new("attacker");
        let attacker = PairingManager::default();
        attacker
            .initialize(
                attacker_root.path().to_path_buf(),
                "device-attacker".to_string(),
            )
            .expect("initialize attacker");
        let (_, desktop_identity) = pair.desktop.identity().expect("desktop identity");
        attacker
            .record_coordinator(&pair.invitation, desktop_identity.certificate.as_ref())
            .expect("record coordinator pin");
        let mut forged = metadata;
        forged.device_id = "device-phone".to_string();

        let error = download_bundle(&attacker, forged, &TransferCancellation::default())
            .await
            .unwrap_err();
        assert!(
            error.contains("TLS")
                || error.contains("certificate")
                || error.contains("alert")
                || error.contains("closed connection"),
            "unexpected identity error: {error}"
        );
    }

    #[tokio::test]
    async fn invitation_replay_is_rejected_by_coordinator() {
        let pair = LocalPair::start().await;
        pair.enroll().await;
        let error = super::enroll(&pair.phone, &pair.invitation, "Phone".to_string())
            .await
            .unwrap_err();
        assert!(
            error.contains("already used") || error.contains("unknown"),
            "unexpected replay error: {error}"
        );
    }

    #[tokio::test]
    async fn malformed_and_oversized_metadata_is_rejected_by_endpoint() {
        let pair = LocalPair::start().await;
        pair.enroll().await;
        let coordinator = pair
            .phone
            .coordinator_pin()
            .expect("coordinator state")
            .expect("coordinator pin");
        let (_, phone_identity) = pair.phone.identity().expect("phone identity");

        for (archive_bytes, digest) in [
            (10_u64, "broken".to_string()),
            (MAX_ARCHIVE_BYTES + 1, "a".repeat(64)),
        ] {
            let mut stream = connect_pinned(
                coordinator.endpoint.parse().expect("endpoint"),
                &coordinator.certificate_fingerprint,
                Some(phone_identity.clone()),
            )
            .await
            .expect("connect authenticated phone");
            let invalid = serde_json::json!({
                "kind": "downloadBundle",
                "metadata": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "vaultId": "vault-1",
                    "deviceId": "device-phone",
                    "transferId": "transfer-invalid",
                    "generation": 1,
                    "archiveBytes": archive_bytes,
                    "archiveSha256": digest,
                }
            });
            let encoded = serde_json::to_vec(&invalid).expect("encode invalid request");
            stream
                .write_u32(encoded.len() as u32)
                .await
                .expect("write invalid message length");
            stream
                .write_all(&encoded)
                .await
                .expect("write invalid message");
            match read_control(&mut stream)
                .await
                .expect("bounded error response")
            {
                ControlMessage::Error { code, .. } => assert_eq!(code, "malformed_control"),
                response => panic!("unexpected response: {response:?}"),
            }
        }
    }

    #[tokio::test]
    async fn interrupted_download_retries_same_transfer_from_partial_file() {
        let pair = LocalPair::start().await;
        pair.enroll().await;
        let bytes = vec![42_u8; TRANSFER_CHUNK_BYTES * 3];
        let metadata = pair.register_bundle(&bytes, "transfer-resume");
        let cancellation = TransferCancellation::default();

        let error = download_bundle_inner(
            &pair.phone,
            metadata.clone(),
            &cancellation,
            Some(TRANSFER_CHUNK_BYTES as u64),
        )
        .await
        .unwrap_err();
        assert!(error.contains("interrupted"));
        let (partial, _, _) = pair
            .phone
            .staging_paths(&metadata.transfer_id)
            .expect("staging paths");
        let partial_bytes = partial.metadata().expect("partial bundle").len();
        assert!(partial_bytes > 0 && partial_bytes < metadata.archive_bytes);

        let staged = download_bundle(&pair.phone, metadata, &cancellation)
            .await
            .expect("resume bundle");
        assert_eq!(fs::read(staged).expect("read resumed bundle"), bytes);
    }

    #[tokio::test]
    async fn cancelled_download_keeps_a_retryable_transfer_identity() {
        let pair = LocalPair::start().await;
        pair.enroll().await;
        let bytes = vec![21_u8; TRANSFER_CHUNK_BYTES + 1];
        let metadata = pair.register_bundle(&bytes, "transfer-cancel");
        let cancellation = TransferCancellation::default();
        cancellation.cancel();

        let error = download_bundle(&pair.phone, metadata.clone(), &cancellation)
            .await
            .unwrap_err();
        assert!(error.contains("cancelled"));

        let staged = download_bundle(&pair.phone, metadata, &TransferCancellation::default())
            .await
            .expect("retry cancelled transfer");
        assert_eq!(fs::read(staged).expect("read retried bundle"), bytes);
    }

    #[tokio::test]
    async fn digest_mismatch_removes_corrupt_staging() {
        let pair = LocalPair::start().await;
        pair.enroll().await;
        let original = vec![7_u8; TRANSFER_CHUNK_BYTES + 1];
        let metadata = pair.register_bundle(&original, "transfer-digest");
        let registered = pair
            .desktop
            .outgoing_bundle(&metadata.transfer_id)
            .expect("registered bundle");
        fs::write(&registered.path, vec![8_u8; original.len()]).expect("corrupt source");

        let error = download_bundle(
            &pair.phone,
            metadata.clone(),
            &TransferCancellation::default(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("digest"), "unexpected digest error: {error}");
        let (partial, metadata_path, complete) = pair
            .phone
            .staging_paths(&metadata.transfer_id)
            .expect("staging paths");
        assert!(!partial.exists());
        assert!(!metadata_path.exists());
        assert!(!complete.exists());
    }

    #[test]
    fn oversized_bundle_metadata_is_rejected_before_network_work() {
        let metadata = BundleMetadata {
            protocol_version: PROTOCOL_VERSION,
            vault_id: "vault-1".to_string(),
            device_id: "device-phone".to_string(),
            transfer_id: "transfer-oversize".to_string(),
            generation: 1,
            archive_bytes: MAX_ARCHIVE_BYTES + 1,
            archive_sha256: "a".repeat(64),
        };
        assert!(metadata.validate().unwrap_err().contains("bundle size"));
    }
}

#[allow(dead_code)] // H04 connects the Android transfer workflow.
async fn download_bundle_inner(
    manager: &PairingManager,
    metadata: BundleMetadata,
    cancellation: &TransferCancellation,
    stop_after_bytes: Option<u64>,
) -> Result<PathBuf, String> {
    metadata.validate()?;
    let coordinator = manager
        .coordinator_pin()?
        .ok_or_else(|| "this device is not linked to a coordinator".to_string())?;
    if coordinator.vault_id != metadata.vault_id {
        return Err("transfer belongs to a different vault".to_string());
    }
    let endpoint = coordinator
        .endpoint
        .parse()
        .map_err(|_| "coordinator endpoint is invalid".to_string())?;
    let (_, identity) = manager.identity()?;
    let mut stream = connect_pinned(
        endpoint,
        &coordinator.certificate_fingerprint,
        Some(identity),
    )
    .await?;
    timeout_control(write_control(
        &mut stream,
        &ControlMessage::DownloadBundle {
            metadata: metadata.clone(),
        },
    ))
    .await?;
    match timeout_control(read_control(&mut stream)).await? {
        ControlMessage::BundleMetadata { metadata: offered } if offered == metadata => {}
        ControlMessage::Error { message, .. } => return Err(message),
        _ => return Err("coordinator returned inconsistent transfer metadata".to_string()),
    }

    let (partial_path, metadata_path, complete_path) =
        manager.staging_paths(&metadata.transfer_id)?;
    if complete_path.exists() {
        super::protocol::validate_staging_file(&complete_path, &metadata)?;
        return Ok(complete_path);
    }
    let resume_offset = prepare_partial(manager, &partial_path, &metadata_path, &metadata)?;
    timeout_control(write_control(
        &mut stream,
        &ControlMessage::ResumeAt {
            offset: resume_offset,
        },
    ))
    .await?;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&partial_path)
        .await
        .map_err(|error| format!("open partial transfer: {error}"))?;
    let mut received = resume_offset;
    let mut remaining = metadata.archive_bytes.saturating_sub(resume_offset);
    let mut buffer = vec![0_u8; TRANSFER_CHUNK_BYTES];
    while remaining > 0 {
        if cancellation.is_cancelled() {
            return Err("transfer was cancelled".to_string());
        }
        if stop_after_bytes.is_some_and(|limit| received >= limit) {
            return Err("transfer was interrupted".to_string());
        }
        let chunk_bytes = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| "transfer chunk size overflow".to_string())?;
        let read_bytes =
            tokio::time::timeout(CHUNK_TIMEOUT, stream.read(&mut buffer[..chunk_bytes]))
                .await
                .map_err(|_| "receiving the transfer bundle timed out".to_string())?
                .map_err(|error| format!("receive transfer bundle: {error}"))?;
        if read_bytes == 0 {
            return Err("transfer was interrupted".to_string());
        }
        file.write_all(&buffer[..read_bytes])
            .await
            .map_err(|error| format!("write partial transfer: {error}"))?;
        received += read_bytes as u64;
        remaining -= read_bytes as u64;
    }
    file.sync_all()
        .await
        .map_err(|error| format!("sync partial transfer: {error}"))?;
    drop(file);

    if let Err(error) = super::protocol::validate_staging_file(&partial_path, &metadata) {
        let _ = manager.remove_staging(&metadata.transfer_id);
        return Err(error);
    }
    fs_rename(&partial_path, &complete_path)?;
    let _ = std::fs::remove_file(&metadata_path);
    timeout_control(write_control(
        &mut stream,
        &ControlMessage::BundleComplete {
            transfer_id: metadata.transfer_id.clone(),
        },
    ))
    .await?;
    Ok(complete_path)
}

#[allow(dead_code)] // H04 connects the Android transfer workflow.
fn prepare_partial(
    manager: &PairingManager,
    partial_path: &Path,
    metadata_path: &Path,
    metadata: &BundleMetadata,
) -> Result<u64, String> {
    let stored = manager.read_staging_metadata(metadata_path)?;
    let partial_bytes = partial_path
        .metadata()
        .map(|value| value.len())
        .unwrap_or(0);
    if stored.as_ref().is_some_and(|stored| stored == metadata)
        && partial_bytes <= metadata.archive_bytes
    {
        return Ok(partial_bytes);
    }
    manager.remove_staging(&metadata.transfer_id)?;
    manager.write_staging_metadata(metadata_path, metadata)?;
    Ok(0)
}

async fn connect_pinned(
    endpoint: std::net::SocketAddr,
    fingerprint: &str,
    identity: Option<TlsIdentity>,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, String> {
    let verifier = Arc::new(PinnedServerVerifier::new(fingerprint.to_string()));
    let builder = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(verifier);
    let config = match identity {
        Some(identity) => builder
            .with_client_auth_cert(vec![identity.certificate], identity.private_key.clone_key())
            .map_err(|error| format!("configure device TLS identity: {error}"))?,
        None => builder.with_no_client_auth(),
    };
    let socket = tokio::time::timeout(TLS_HANDSHAKE_TIMEOUT, TcpStream::connect(endpoint))
        .await
        .map_err(|_| "coordinator connection timed out".to_string())?
        .map_err(|error| format!("connect to coordinator: {error}"))?;
    let server_name = ServerName::try_from("ganbaru-coordinator.local")
        .map_err(|_| "coordinator TLS name is invalid".to_string())?;
    tokio::time::timeout(
        TLS_HANDSHAKE_TIMEOUT,
        TlsConnector::from(Arc::new(config)).connect(server_name, socket),
    )
    .await
    .map_err(|_| "coordinator TLS handshake timed out".to_string())?
    .map_err(|error| format!("establish pinned TLS connection: {error}"))
}

fn server_config(manager: &PairingManager) -> Result<rustls::ServerConfig, String> {
    let (_, identity) = manager.identity()?;
    let builder = rustls::ServerConfig::builder();
    let config = if let Some(peer) = manager.linked_peer()? {
        let mut roots = RootCertStore::empty();
        roots
            .add(decode_certificate(&peer.certificate)?)
            .map_err(|error| format!("trust linked device certificate: {error}"))?;
        let verifier = rustls::server::WebPkiClientVerifier::builder(Arc::new(roots))
            .allow_unauthenticated()
            .build()
            .map_err(|error| format!("configure linked device verifier: {error}"))?;
        builder.with_client_cert_verifier(verifier)
    } else {
        builder.with_no_client_auth()
    }
    .with_single_cert(vec![identity.certificate], identity.private_key.clone_key())
    .map_err(|error| format!("configure coordinator TLS identity: {error}"))?;
    Ok(config)
}

async fn timeout_control<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::time::timeout(CONTROL_TIMEOUT, future)
        .await
        .map_err(|_| "handoff control message timed out".to_string())?
}

async fn send_error<W>(
    writer: &mut W,
    code: &str,
    message: &str,
    retryable: bool,
) -> Result<(), String>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    timeout_control(write_control(
        writer,
        &ControlMessage::Error {
            code: code.to_string(),
            message: message.to_string(),
            retryable,
        },
    ))
    .await
}

#[allow(dead_code)] // H04 connects the Android transfer workflow.
fn fs_rename(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::rename(source, target).map_err(|error| format!("finalize staged transfer: {error}"))
}

#[allow(dead_code)] // H04 hashes generated whole-vault snapshots.
pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("open file for SHA-256 digest: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; TRANSFER_CHUNK_BYTES];
    loop {
        let bytes = file
            .read(&mut buffer)
            .map_err(|error| format!("read file for SHA-256 digest: {error}"))?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

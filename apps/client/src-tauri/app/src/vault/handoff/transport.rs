//! Mutual-TLS coordinator transport and resumable archive streaming.

use super::protocol::{
    read_control, unix_time_ms, write_control, BundleMetadata, BundlePurpose, ControlMessage,
    PairingInvitation, PROTOCOL_VERSION, TRANSFER_CHUNK_BYTES,
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
use std::fs;
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

#[cfg(test)]
pub(crate) async fn serve(
    listener: TcpListener,
    manager: PairingManager,
    shutdown: tokio::sync::oneshot::Receiver<()>,
) {
    serve_with_coordinator(listener, manager, None, shutdown).await;
}

pub(crate) async fn serve_with_coordinator(
    listener: TcpListener,
    manager: PairingManager,
    coordinator: Option<super::coordinator::CoordinatorSender>,
    mut shutdown: tokio::sync::oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                match accepted {
                    Ok((socket, _)) => {
                        let manager = manager.clone();
                        let coordinator = coordinator.clone();
                        tokio::spawn(async move {
                            if let Err(error) = handle_connection(socket, manager, coordinator).await {
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

async fn handle_connection(
    socket: TcpStream,
    manager: PairingManager,
    coordinator: Option<super::coordinator::CoordinatorSender>,
) -> Result<(), String> {
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
        ControlMessage::UploadBundle {
            metadata,
            source_device_id,
            purpose,
        } => {
            manager.verify_authenticated_peer(
                &source_device_id,
                peer_certificate.as_ref(),
                &metadata.vault_id,
            )?;
            serve_upload(
                &mut stream,
                &manager,
                coordinator.as_ref(),
                metadata,
                source_device_id,
                purpose,
            )
            .await
        }
        ControlMessage::RequestBundle {
            vault_id,
            device_id,
            generation,
            purpose,
            ..
        } => {
            manager.verify_authenticated_peer(&device_id, peer_certificate.as_ref(), &vault_id)?;
            let operation = super::coordinator::CoordinatorOperation::Prepare {
                vault_id,
                device_id,
                generation,
                purpose,
            };
            send_coordinator_response(&mut stream, coordinator.as_ref(), operation).await
        }
        ControlMessage::CommitStagedOwnership { metadata } => {
            manager.verify_authenticated_peer(
                &metadata.device_id,
                peer_certificate.as_ref(),
                &metadata.vault_id,
            )?;
            send_coordinator_response(
                &mut stream,
                coordinator.as_ref(),
                super::coordinator::CoordinatorOperation::CommitOwnership { metadata },
            )
            .await
        }
        ControlMessage::CommitUploadedOwnership {
            metadata,
            source_device_id,
        } => {
            manager.verify_authenticated_peer(
                &source_device_id,
                peer_certificate.as_ref(),
                &metadata.vault_id,
            )?;
            send_coordinator_response(
                &mut stream,
                coordinator.as_ref(),
                super::coordinator::CoordinatorOperation::CommitUploadedOwnership {
                    metadata,
                    source_device_id,
                },
            )
            .await
        }
        ControlMessage::ActivationComplete {
            vault_id,
            device_id,
            transfer_id,
            generation,
            purpose,
            ..
        } => {
            manager.verify_authenticated_peer(&device_id, peer_certificate.as_ref(), &vault_id)?;
            send_coordinator_response(
                &mut stream,
                coordinator.as_ref(),
                super::coordinator::CoordinatorOperation::Activated {
                    vault_id,
                    device_id,
                    transfer_id,
                    generation,
                    purpose,
                },
            )
            .await
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
            send_coordinator_response(
                &mut stream,
                coordinator.as_ref(),
                super::coordinator::CoordinatorOperation::Cancel { transfer_id },
            )
            .await
        }
        ControlMessage::RefreshRequest {
            vault_id,
            device_id,
            generation,
            ..
        } => {
            manager.verify_authenticated_peer(&device_id, peer_certificate.as_ref(), &vault_id)?;
            send_coordinator_response(
                &mut stream,
                coordinator.as_ref(),
                super::coordinator::CoordinatorOperation::PollUpload {
                    vault_id,
                    device_id,
                    generation,
                },
            )
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

async fn send_coordinator_response(
    stream: &mut tokio_rustls::server::TlsStream<TcpStream>,
    coordinator: Option<&super::coordinator::CoordinatorSender>,
    operation: super::coordinator::CoordinatorOperation,
) -> Result<(), String> {
    let Some(coordinator) = coordinator else {
        return send_error(
            stream,
            "coordinator_unavailable",
            "vault handoff coordinator operations are unavailable",
            true,
        )
        .await;
    };
    let response = match super::coordinator::request(coordinator, operation).await {
        Ok(response) => response,
        Err(error) => return send_error(stream, "handoff_rejected", &error, true).await,
    };
    let message = match response {
        super::coordinator::CoordinatorResponse::Prepared { metadata, purpose } => {
            ControlMessage::BundlePrepared { metadata, purpose }
        }
        super::coordinator::CoordinatorResponse::OwnershipGrant {
            vault_id,
            transfer_id,
            owner_device_id,
            generation,
        } => ControlMessage::OwnershipGrant {
            protocol_version: PROTOCOL_VERSION,
            vault_id,
            transfer_id,
            owner_device_id,
            generation,
        },
        super::coordinator::CoordinatorResponse::ActivationAcknowledged { transfer_id } => {
            ControlMessage::ActivationAcknowledged { transfer_id }
        }
        super::coordinator::CoordinatorResponse::Cancelled { transfer_id } => {
            ControlMessage::TransferCancelled { transfer_id }
        }
        super::coordinator::CoordinatorResponse::UploadStatus {
            generation,
            requested_upload,
        } => ControlMessage::RefreshStatus {
            available: requested_upload.is_some(),
            generation,
            transfer_id: None,
            requested_upload,
        },
        super::coordinator::CoordinatorResponse::IncomingStaged { transfer_id } => {
            ControlMessage::BundleStaged { transfer_id }
        }
        super::coordinator::CoordinatorResponse::UploadRequested { .. } => {
            return Err("local upload request cannot be sent over the transport".to_string())
        }
        super::coordinator::CoordinatorResponse::UploadAuthorized { .. } => {
            return Err("upload authorization cannot be sent as a control response".to_string())
        }
    };
    timeout_control(write_control(stream, &message)).await
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

async fn serve_upload(
    stream: &mut tokio_rustls::server::TlsStream<TcpStream>,
    manager: &PairingManager,
    coordinator: Option<&super::coordinator::CoordinatorSender>,
    metadata: BundleMetadata,
    source_device_id: String,
    purpose: BundlePurpose,
) -> Result<(), String> {
    metadata.validate()?;
    let coordinator = coordinator
        .ok_or_else(|| "vault handoff coordinator operations are unavailable".to_string())?;
    let authorization = super::coordinator::request(
        coordinator,
        super::coordinator::CoordinatorOperation::AuthorizeUpload {
            metadata: metadata.clone(),
            source_device_id: source_device_id.clone(),
            purpose,
        },
    )
    .await;
    match authorization {
        Err(error) => return send_error(stream, "upload_rejected", &error, false).await,
        Ok(super::coordinator::CoordinatorResponse::UploadAuthorized {
            transfer_id,
            already_received,
        }) if transfer_id == metadata.transfer_id => {
            if already_received {
                timeout_control(write_control(
                    stream,
                    &ControlMessage::ResumeAt {
                        offset: metadata.archive_bytes,
                    },
                ))
                .await?;
                match timeout_control(read_control(stream)).await? {
                    ControlMessage::BundleComplete { transfer_id }
                        if transfer_id == metadata.transfer_id => {}
                    _ => return Err("source did not complete the uploaded transfer".to_string()),
                }
                return send_coordinator_response(
                    stream,
                    Some(coordinator),
                    super::coordinator::CoordinatorOperation::Uploaded {
                        metadata,
                        source_device_id,
                        purpose,
                    },
                )
                .await;
            }
        }
        _ => return Err("coordinator returned invalid upload authorization".to_string()),
    }
    let (partial_path, metadata_path, complete_path) =
        manager.staging_paths(&metadata.transfer_id)?;
    let resume_offset = if complete_path.exists() {
        super::protocol::validate_staging_file(&complete_path, &metadata)?;
        metadata.archive_bytes
    } else {
        prepare_partial(manager, &partial_path, &metadata_path, &metadata)?
    };
    timeout_control(write_control(
        stream,
        &ControlMessage::ResumeAt {
            offset: resume_offset,
        },
    ))
    .await?;

    if resume_offset < metadata.archive_bytes {
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&partial_path)
            .await
            .map_err(|error| format!("open incoming transfer: {error}"))?;
        let mut remaining = metadata.archive_bytes - resume_offset;
        let mut buffer = vec![0_u8; TRANSFER_CHUNK_BYTES];
        while remaining > 0 {
            let count = usize::try_from(remaining.min(buffer.len() as u64))
                .map_err(|_| "incoming transfer chunk size overflow".to_string())?;
            tokio::time::timeout(CHUNK_TIMEOUT, stream.read_exact(&mut buffer[..count]))
                .await
                .map_err(|_| "receiving the transfer bundle timed out".to_string())?
                .map_err(|error| format!("receive transfer bundle: {error}"))?;
            file.write_all(&buffer[..count])
                .await
                .map_err(|error| format!("write incoming transfer: {error}"))?;
            remaining -= count as u64;
        }
        file.sync_all()
            .await
            .map_err(|error| format!("sync incoming transfer: {error}"))?;
        drop(file);
    }
    match timeout_control(read_control(stream)).await? {
        ControlMessage::BundleComplete { transfer_id } if transfer_id == metadata.transfer_id => {}
        _ => return Err("source did not complete the uploaded transfer".to_string()),
    }
    if !complete_path.exists() {
        if let Err(error) = super::protocol::validate_staging_file(&partial_path, &metadata) {
            let _ = manager.remove_staging(&metadata.transfer_id);
            return Err(error);
        }
        fs::rename(&partial_path, &complete_path)
            .map_err(|error| format!("complete incoming transfer: {error}"))?;
        match fs::remove_file(&metadata_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("remove incoming transfer metadata: {error}")),
        }
    }
    send_coordinator_response(
        stream,
        Some(coordinator),
        super::coordinator::CoordinatorOperation::Uploaded {
            metadata,
            source_device_id,
            purpose,
        },
    )
    .await
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

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) async fn request_bundle(
    manager: &PairingManager,
    generation: u64,
    purpose: BundlePurpose,
) -> Result<BundleMetadata, String> {
    let coordinator = manager
        .coordinator_pin()?
        .ok_or_else(|| "this device is not linked to a coordinator".to_string())?;
    let (device_id, _) = manager.identity()?;
    match authenticated_exchange(
        manager,
        ControlMessage::RequestBundle {
            protocol_version: PROTOCOL_VERSION,
            vault_id: coordinator.vault_id.clone(),
            device_id: device_id.clone(),
            generation,
            purpose,
        },
    )
    .await?
    {
        ControlMessage::BundlePrepared {
            metadata,
            purpose: offered_purpose,
        } if offered_purpose == purpose
            && metadata.vault_id == coordinator.vault_id
            && metadata.device_id == device_id
            && metadata.generation
                == match purpose {
                    BundlePurpose::Ownership => generation.saturating_add(1),
                    BundlePurpose::Refresh => generation,
                } =>
        {
            Ok(metadata)
        }
        ControlMessage::Error { message, .. } => Err(message),
        _ => Err("coordinator returned an invalid prepared bundle".to_string()),
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) async fn commit_staged_ownership(
    manager: &PairingManager,
    metadata: BundleMetadata,
) -> Result<(String, u64), String> {
    match authenticated_exchange(
        manager,
        ControlMessage::CommitStagedOwnership {
            metadata: metadata.clone(),
        },
    )
    .await?
    {
        ControlMessage::OwnershipGrant {
            vault_id,
            transfer_id,
            owner_device_id,
            generation,
            ..
        } if vault_id == metadata.vault_id
            && transfer_id == metadata.transfer_id
            && owner_device_id == metadata.device_id
            && generation == metadata.generation =>
        {
            Ok((owner_device_id, generation))
        }
        ControlMessage::Error { message, .. } => Err(message),
        _ => Err("coordinator returned an invalid ownership grant".to_string()),
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) async fn acknowledge_activation(
    manager: &PairingManager,
    pending: &super::state::PendingAcknowledgement,
) -> Result<(), String> {
    match authenticated_exchange(
        manager,
        ControlMessage::ActivationComplete {
            protocol_version: PROTOCOL_VERSION,
            vault_id: pending.vault_id.clone(),
            device_id: pending.device_id.clone(),
            transfer_id: pending.transfer_id.clone(),
            generation: pending.generation,
            purpose: pending.purpose,
        },
    )
    .await?
    {
        ControlMessage::ActivationAcknowledged { transfer_id }
            if transfer_id == pending.transfer_id =>
        {
            Ok(())
        }
        ControlMessage::Error { message, .. } => Err(message),
        _ => Err("coordinator returned an invalid activation acknowledgement".to_string()),
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) async fn upload_bundle(
    manager: &PairingManager,
    metadata: BundleMetadata,
    source_device_id: String,
    purpose: BundlePurpose,
) -> Result<(), String> {
    let coordinator = manager
        .coordinator_pin()?
        .ok_or_else(|| "this device is not linked to a coordinator".to_string())?;
    if metadata.device_id != coordinator.device_id || metadata.vault_id != coordinator.vault_id {
        return Err("outgoing bundle does not target the linked coordinator".to_string());
    }
    let (_, archive_path) = manager.outgoing_snapshot_paths(&metadata.transfer_id)?;
    super::protocol::validate_staging_file(&archive_path, &metadata)?;
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
        &ControlMessage::UploadBundle {
            metadata: metadata.clone(),
            source_device_id,
            purpose,
        },
    ))
    .await?;
    let offset = match timeout_control(read_control(&mut stream)).await? {
        ControlMessage::ResumeAt { offset } if offset <= metadata.archive_bytes => offset,
        ControlMessage::Error { message, .. } => return Err(message),
        _ => return Err("coordinator returned an invalid upload offset".to_string()),
    };
    stream_file(&mut stream, &archive_path, offset, metadata.archive_bytes).await?;
    timeout_control(write_control(
        &mut stream,
        &ControlMessage::BundleComplete {
            transfer_id: metadata.transfer_id.clone(),
        },
    ))
    .await?;
    match timeout_control(read_control(&mut stream)).await? {
        ControlMessage::BundleStaged { transfer_id } if transfer_id == metadata.transfer_id => {
            Ok(())
        }
        ControlMessage::Error { message, .. } => Err(message),
        _ => Err("coordinator did not accept the uploaded bundle".to_string()),
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) async fn commit_uploaded_ownership(
    manager: &PairingManager,
    metadata: BundleMetadata,
    source_device_id: String,
) -> Result<(), String> {
    match authenticated_exchange(
        manager,
        ControlMessage::CommitUploadedOwnership {
            metadata: metadata.clone(),
            source_device_id,
        },
    )
    .await?
    {
        ControlMessage::ActivationAcknowledged { transfer_id }
            if transfer_id == metadata.transfer_id =>
        {
            Ok(())
        }
        ControlMessage::Error { message, .. } => Err(message),
        _ => Err("coordinator returned an invalid ownership acknowledgement".to_string()),
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) async fn probe_coordinator(
    manager: &PairingManager,
    generation: u64,
) -> Result<Option<BundlePurpose>, String> {
    let coordinator = manager
        .coordinator_pin()?
        .ok_or_else(|| "this device is not linked to a coordinator".to_string())?;
    let (device_id, _) = manager.identity()?;
    match authenticated_exchange(
        manager,
        ControlMessage::RefreshRequest {
            protocol_version: PROTOCOL_VERSION,
            vault_id: coordinator.vault_id,
            device_id,
            generation,
        },
    )
    .await?
    {
        ControlMessage::RefreshStatus {
            generation: returned,
            requested_upload,
            ..
        } if returned == generation => Ok(requested_upload),
        ControlMessage::Error { message, .. } => Err(message),
        _ => Err("coordinator returned an invalid refresh status".to_string()),
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
async fn authenticated_exchange(
    manager: &PairingManager,
    message: ControlMessage,
) -> Result<ControlMessage, String> {
    let coordinator = manager
        .coordinator_pin()?
        .ok_or_else(|| "this device is not linked to a coordinator".to_string())?;
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
    timeout_control(write_control(&mut stream, &message)).await?;
    timeout_control(read_control(&mut stream)).await
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) async fn download_bundle(
    manager: &PairingManager,
    metadata: BundleMetadata,
    cancellation: &TransferCancellation,
) -> Result<PathBuf, String> {
    download_bundle_inner(manager, metadata, cancellation, None).await
}

#[cfg(test)]
mod tests;

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

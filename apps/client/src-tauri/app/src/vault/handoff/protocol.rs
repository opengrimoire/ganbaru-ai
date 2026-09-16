//! Bounded wire contracts for the local vault handoff service.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::path::Path;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub(crate) const PROTOCOL_VERSION: u16 = 2;
pub(crate) const MAX_CONTROL_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_ARCHIVE_BYTES: u64 = 100 * 1024 * 1024 * 1024;
pub(crate) const MAX_IDENTIFIER_BYTES: usize = 160;
pub(crate) const MAX_DEVICE_LABEL_BYTES: usize = 128;
pub(crate) const MAX_DOOMSCROLLING_SAMPLES: usize = 1_024;
pub(crate) const TRANSFER_CHUNK_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DeviceKind {
    Computer,
    Phone,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingInvitation {
    pub protocol_version: u16,
    pub invitation_id: String,
    pub secret: String,
    pub endpoint: String,
    pub coordinator_fingerprint: String,
    pub coordinator_device_id: String,
    pub vault_id: String,
    pub generation: u64,
    pub expires_at_unix_ms: i64,
}

impl PairingInvitation {
    pub(crate) fn validate(&self, now_unix_ms: i64) -> Result<(), String> {
        validate_protocol(self.protocol_version)?;
        validate_identifier("invitation id", &self.invitation_id)?;
        validate_identifier("invitation secret", &self.secret)?;
        validate_identifier("coordinator fingerprint", &self.coordinator_fingerprint)?;
        validate_identifier("coordinator device id", &self.coordinator_device_id)?;
        validate_identifier("vault id", &self.vault_id)?;
        self.endpoint
            .parse::<std::net::SocketAddr>()
            .map_err(|_| "pairing invitation endpoint is invalid".to_string())?;
        if self.expires_at_unix_ms <= now_unix_ms {
            return Err("pairing invitation has expired".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundleMetadata {
    pub protocol_version: u16,
    pub vault_id: String,
    pub device_id: String,
    pub transfer_id: String,
    pub generation: u64,
    pub archive_bytes: u64,
    pub archive_sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BundlePurpose {
    Ownership,
    Refresh,
}

impl BundleMetadata {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_protocol(self.protocol_version)?;
        validate_identifier("vault id", &self.vault_id)?;
        validate_identifier("device id", &self.device_id)?;
        validate_identifier("transfer id", &self.transfer_id)?;
        validate_sha256(&self.archive_sha256)?;
        if self.archive_bytes == 0 || self.archive_bytes > MAX_ARCHIVE_BYTES {
            return Err(format!(
                "bundle size must be between 1 and {MAX_ARCHIVE_BYTES} bytes"
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DoomscrollingSampleMessage {
    pub sample_id: String,
    pub device_id: String,
    pub source_type: String,
    pub source_key: String,
    pub display_name: Option<String>,
    pub started_at_unix_ms: i64,
    pub elapsed_seconds: i64,
    pub local_date: String,
    pub created_at_unix_ms: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum ControlMessage {
    Enroll {
        protocol_version: u16,
        invitation_id: String,
        secret: String,
        vault_id: String,
        device_id: String,
        device_label: String,
        device_kind: DeviceKind,
        device_certificate: String,
    },
    Enrolled {
        protocol_version: u16,
        coordinator_device_id: String,
    },
    RequestBundle {
        protocol_version: u16,
        vault_id: String,
        device_id: String,
        generation: u64,
        purpose: BundlePurpose,
    },
    BundlePrepared {
        metadata: BundleMetadata,
        purpose: BundlePurpose,
    },
    BundlePending {
        protocol_version: u16,
        owner_device_id: String,
        generation: u64,
    },
    DownloadBundle {
        metadata: BundleMetadata,
    },
    UploadBundle {
        metadata: BundleMetadata,
        source_device_id: String,
        purpose: BundlePurpose,
    },
    BundleMetadata {
        metadata: BundleMetadata,
    },
    ResumeAt {
        offset: u64,
    },
    BundleComplete {
        transfer_id: String,
    },
    BundleStaged {
        transfer_id: String,
    },
    CommitStagedOwnership {
        metadata: BundleMetadata,
    },
    OwnershipGrant {
        protocol_version: u16,
        vault_id: String,
        transfer_id: String,
        owner_device_id: String,
        generation: u64,
    },
    CommitUploadedOwnership {
        metadata: BundleMetadata,
        source_device_id: String,
    },
    ActivationComplete {
        protocol_version: u16,
        vault_id: String,
        device_id: String,
        transfer_id: String,
        generation: u64,
        purpose: BundlePurpose,
    },
    ActivationAcknowledged {
        transfer_id: String,
    },
    CancelTransfer {
        transfer_id: String,
    },
    TransferCancelled {
        transfer_id: String,
    },
    RefreshRequest {
        protocol_version: u16,
        vault_id: String,
        device_id: String,
        generation: u64,
    },
    RefreshStatus {
        available: bool,
        generation: u64,
        transfer_id: Option<String>,
        requested_upload: Option<BundlePurpose>,
    },
    DoomscrollingExchange {
        protocol_version: u16,
        vault_id: String,
        device_id: String,
        samples: Vec<DoomscrollingSampleMessage>,
        acknowledged_peer_sample_ids: Vec<String>,
        owner_snapshot: Vec<DoomscrollingSampleMessage>,
    },
    DoomscrollingAcknowledged {
        acknowledged_sample_ids: Vec<String>,
        peer_samples: Vec<DoomscrollingSampleMessage>,
        combined_samples: Vec<DoomscrollingSampleMessage>,
    },
    Error {
        code: String,
        message: String,
        retryable: bool,
    },
}

impl ControlMessage {
    pub(crate) fn validate(&self) -> Result<(), String> {
        match self {
            Self::Enroll {
                protocol_version,
                invitation_id,
                secret,
                vault_id,
                device_id,
                device_label,
                device_kind: _,
                device_certificate,
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("invitation id", invitation_id)?;
                validate_identifier("invitation secret", secret)?;
                validate_identifier("vault id", vault_id)?;
                validate_identifier("device id", device_id)?;
                if device_label.trim().is_empty() || device_label.len() > MAX_DEVICE_LABEL_BYTES {
                    return Err("device label is invalid".to_string());
                }
                if device_certificate.is_empty() || device_certificate.len() > 8 * 1024 {
                    return Err("device certificate is invalid".to_string());
                }
            }
            Self::Enrolled {
                protocol_version,
                coordinator_device_id,
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("coordinator device id", coordinator_device_id)?;
            }
            Self::RequestBundle {
                protocol_version,
                vault_id,
                device_id,
                ..
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("vault id", vault_id)?;
                validate_identifier("device id", device_id)?;
            }
            Self::BundlePrepared { metadata, .. } | Self::CommitStagedOwnership { metadata } => {
                metadata.validate()?
            }
            Self::BundlePending {
                protocol_version,
                owner_device_id,
                ..
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("owner device id", owner_device_id)?;
            }
            Self::DownloadBundle { metadata } | Self::BundleMetadata { metadata } => {
                metadata.validate()?
            }
            Self::UploadBundle {
                metadata,
                source_device_id,
                ..
            }
            | Self::CommitUploadedOwnership {
                metadata,
                source_device_id,
            } => {
                metadata.validate()?;
                validate_identifier("source device id", source_device_id)?;
                if source_device_id == &metadata.device_id {
                    return Err("bundle source and receiver must be different devices".to_string());
                }
            }
            Self::ResumeAt { offset } => {
                if *offset > MAX_ARCHIVE_BYTES {
                    return Err("resume offset exceeds the archive limit".to_string());
                }
            }
            Self::BundleComplete { transfer_id }
            | Self::BundleStaged { transfer_id }
            | Self::ActivationAcknowledged { transfer_id }
            | Self::CancelTransfer { transfer_id }
            | Self::TransferCancelled { transfer_id } => {
                validate_identifier("transfer id", transfer_id)?;
            }
            Self::OwnershipGrant {
                protocol_version,
                vault_id,
                transfer_id,
                owner_device_id,
                generation,
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("vault id", vault_id)?;
                validate_identifier("transfer id", transfer_id)?;
                validate_identifier("owner device id", owner_device_id)?;
                if *generation == 0 {
                    return Err("ownership grant generation must be positive".to_string());
                }
            }
            Self::ActivationComplete {
                protocol_version,
                vault_id,
                device_id,
                transfer_id,
                generation,
                purpose,
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("vault id", vault_id)?;
                validate_identifier("device id", device_id)?;
                validate_identifier("transfer id", transfer_id)?;
                if *purpose == BundlePurpose::Ownership && *generation == 0 {
                    return Err("activation generation must be positive".to_string());
                }
            }
            Self::RefreshRequest {
                protocol_version,
                vault_id,
                device_id,
                ..
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("vault id", vault_id)?;
                validate_identifier("device id", device_id)?;
            }
            Self::RefreshStatus { transfer_id, .. } => {
                if let Some(transfer_id) = transfer_id {
                    validate_identifier("transfer id", transfer_id)?;
                }
            }
            Self::DoomscrollingExchange {
                protocol_version,
                vault_id,
                device_id,
                samples,
                acknowledged_peer_sample_ids,
                owner_snapshot,
            } => {
                validate_protocol(*protocol_version)?;
                validate_identifier("vault id", vault_id)?;
                validate_identifier("device id", device_id)?;
                if samples.len() > MAX_DOOMSCROLLING_SAMPLES {
                    return Err("too many Doomscrolling samples".to_string());
                }
                for sample in samples {
                    validate_doomscrolling_sample(sample)?;
                    if sample.device_id != *device_id {
                        return Err("Doomscrolling sample metadata is invalid".to_string());
                    }
                }
                validate_doomscrolling_sample_ids(acknowledged_peer_sample_ids)?;
                validate_doomscrolling_samples(owner_snapshot)?;
                if samples.len() + owner_snapshot.len() > MAX_DOOMSCROLLING_SAMPLES {
                    return Err("Doomscrolling exchange exceeds the sample limit".to_string());
                }
            }
            Self::DoomscrollingAcknowledged {
                acknowledged_sample_ids,
                peer_samples,
                combined_samples,
            } => {
                validate_doomscrolling_sample_ids(acknowledged_sample_ids)?;
                validate_doomscrolling_samples(peer_samples)?;
                validate_doomscrolling_samples(combined_samples)?;
                if peer_samples.len() + combined_samples.len() > MAX_DOOMSCROLLING_SAMPLES {
                    return Err("Doomscrolling response exceeds the sample limit".to_string());
                }
            }
            Self::Error { code, message, .. } => {
                validate_identifier("error code", code)?;
                if message.is_empty() || message.len() > 1024 {
                    return Err("protocol error message is invalid".to_string());
                }
            }
        }
        Ok(())
    }
}

fn validate_doomscrolling_sample_ids(sample_ids: &[String]) -> Result<(), String> {
    if sample_ids.len() > MAX_DOOMSCROLLING_SAMPLES {
        return Err("too many acknowledged Doomscrolling samples".to_string());
    }
    for sample_id in sample_ids {
        validate_identifier("sample id", sample_id)?;
    }
    Ok(())
}

fn validate_doomscrolling_samples(samples: &[DoomscrollingSampleMessage]) -> Result<(), String> {
    if samples.len() > MAX_DOOMSCROLLING_SAMPLES {
        return Err("too many Doomscrolling samples".to_string());
    }
    for sample in samples {
        validate_doomscrolling_sample(sample)?;
    }
    Ok(())
}

fn validate_doomscrolling_sample(sample: &DoomscrollingSampleMessage) -> Result<(), String> {
    validate_identifier("sample id", &sample.sample_id)?;
    validate_identifier("sample device id", &sample.device_id)?;
    if !matches!(
        sample.source_type.as_str(),
        "website" | "desktop-app" | "mobile-app"
    ) || sample.source_key.trim().is_empty()
        || sample.source_key.len() > 255
        || sample
            .display_name
            .as_ref()
            .is_some_and(|name| name.len() > 120)
        || sample.started_at_unix_ms < 0
        || !(1..=86_400).contains(&sample.elapsed_seconds)
        || !valid_local_date(&sample.local_date)
        || sample.created_at_unix_ms < 0
    {
        return Err("Doomscrolling sample metadata is invalid".to_string());
    }
    Ok(())
}

fn valid_local_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

pub(crate) async fn write_control<W>(writer: &mut W, message: &ControlMessage) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    message.validate()?;
    let encoded = serde_json::to_vec(message)
        .map_err(|error| format!("encode handoff control message: {error}"))?;
    if encoded.len() > MAX_CONTROL_BYTES {
        return Err("handoff control message exceeds the size limit".to_string());
    }
    writer
        .write_u32(encoded.len() as u32)
        .await
        .map_err(|error| format!("write handoff message length: {error}"))?;
    writer
        .write_all(&encoded)
        .await
        .map_err(|error| format!("write handoff message: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("flush handoff message: {error}"))
}

pub(crate) async fn read_control<R>(reader: &mut R) -> Result<ControlMessage, String>
where
    R: AsyncRead + Unpin,
{
    let length = reader
        .read_u32()
        .await
        .map_err(|error| format!("read handoff message length: {error}"))?
        as usize;
    if length == 0 || length > MAX_CONTROL_BYTES {
        return Err("handoff control message has an invalid size".to_string());
    }
    let mut encoded = vec![0_u8; length];
    reader
        .read_exact(&mut encoded)
        .await
        .map_err(|error| format!("read handoff message: {error}"))?;
    let message: ControlMessage = decode_bounded_json(&encoded, "handoff control message")?;
    message.validate()?;
    Ok(message)
}

fn decode_bounded_json<T: DeserializeOwned>(encoded: &[u8], label: &str) -> Result<T, String> {
    serde_json::from_slice(encoded).map_err(|error| format!("decode {label}: {error}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn encode_invitation(invitation: &PairingInvitation) -> Result<String, String> {
    invitation.validate(unix_time_ms().saturating_sub(1))?;
    let json = serde_json::to_vec(invitation)
        .map_err(|error| format!("encode pairing invitation: {error}"))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        json,
    ))
}

pub(crate) fn decode_invitation(
    encoded: &str,
    now_unix_ms: i64,
) -> Result<PairingInvitation, String> {
    if encoded.is_empty() || encoded.len() > 8 * 1024 {
        return Err("pairing invitation has an invalid size".to_string());
    }
    let json = base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, encoded)
        .map_err(|error| format!("decode pairing invitation: {error}"))?;
    let invitation: PairingInvitation = decode_bounded_json(&json, "pairing invitation")?;
    invitation.validate(now_unix_ms)?;
    Ok(invitation)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) struct QrMatrix {
    pub width: usize,
    pub modules: Vec<bool>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn invitation_qr_matrix(encoded: &str) -> Result<QrMatrix, String> {
    let code = qrcode::QrCode::with_error_correction_level(encoded.as_bytes(), qrcode::EcLevel::M)
        .map_err(|error| format!("create pairing QR code: {error}"))?;
    let width = code.width();
    let modules = (0..width)
        .flat_map(|y| {
            let code = &code;
            (0..width).map(move |x| code[(x, y)] == qrcode::Color::Dark)
        })
        .collect();
    Ok(QrMatrix { width, modules })
}

pub(crate) fn decode_qr_luma(width: usize, height: usize, luma: &[u8]) -> Result<String, String> {
    const MAX_QR_FRAME_PIXELS: usize = 1920 * 1080;
    let pixels = width
        .checked_mul(height)
        .ok_or_else(|| "QR frame dimensions overflow".to_string())?;
    if width == 0 || height == 0 || pixels > MAX_QR_FRAME_PIXELS || luma.len() != pixels {
        return Err("QR frame dimensions are invalid".to_string());
    }
    let mut scanner = quircs::Quirc::default();
    for identified in scanner.identify(width, height, luma) {
        let identified = identified.map_err(|error| format!("identify QR code: {error}"))?;
        if let Ok(decoded) = identified.decode() {
            return String::from_utf8(decoded.payload)
                .map_err(|_| "pairing QR code is not UTF-8".to_string());
        }
    }
    Err("no readable pairing QR code was found".to_string())
}

#[allow(dead_code)] // H04 connects validated staging to vault activation.
pub(crate) fn validate_staging_file(path: &Path, metadata: &BundleMetadata) -> Result<(), String> {
    metadata.validate()?;
    let actual_bytes = path
        .metadata()
        .map_err(|error| format!("inspect staged bundle: {error}"))?
        .len();
    if actual_bytes != metadata.archive_bytes {
        return Err("staged bundle size does not match metadata".to_string());
    }
    let digest = super::sha256_file(path)?;
    if digest != metadata.archive_sha256 {
        return Err("staged bundle digest does not match metadata".to_string());
    }
    Ok(())
}

pub(crate) fn validate_identifier(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(())
}

fn validate_protocol(version: u16) -> Result<(), String> {
    if version != PROTOCOL_VERSION {
        return Err("handoff protocol version is unsupported".to_string());
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("archive SHA-256 digest is invalid".to_string());
    }
    Ok(())
}

pub(crate) fn unix_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod tests {
    use super::*;

    #[test]
    fn invitation_qr_round_trips_through_production_decoder() {
        let encoded = "eyJ0ZXN0IjoicGFpcmluZyJ9";
        let matrix = invitation_qr_matrix(encoded).expect("QR should encode");
        let scale = 8;
        let quiet = 4;
        let image_width = (matrix.width + quiet * 2) * scale;
        let mut image = vec![255_u8; image_width * image_width];
        for y in 0..matrix.width {
            for x in 0..matrix.width {
                if matrix.modules[y * matrix.width + x] {
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let px = (x + quiet) * scale + dx;
                            let py = (y + quiet) * scale + dy;
                            image[py * image_width + px] = 0;
                        }
                    }
                }
            }
        }
        assert_eq!(
            decode_qr_luma(image_width, image_width, &image).expect("QR should decode"),
            encoded
        );
    }

    #[test]
    fn malformed_and_oversized_metadata_is_rejected() {
        let mut metadata = BundleMetadata {
            protocol_version: PROTOCOL_VERSION,
            vault_id: "vault-1".to_string(),
            device_id: "device-1".to_string(),
            transfer_id: "transfer-1".to_string(),
            generation: 1,
            archive_bytes: 10,
            archive_sha256: "a".repeat(64),
        };
        metadata.archive_sha256 = "not-a-digest".to_string();
        assert!(metadata.validate().unwrap_err().contains("SHA-256"));
        metadata.archive_sha256 = "a".repeat(64);
        metadata.archive_bytes = MAX_ARCHIVE_BYTES + 1;
        assert!(metadata.validate().unwrap_err().contains("bundle size"));
    }
}

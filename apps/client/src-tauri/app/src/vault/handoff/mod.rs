//! Secure, LAN-only pairing and whole-vault bundle transport.

pub(crate) mod coordinator;
pub(crate) mod protocol;
pub(crate) mod receiver;
pub(crate) mod source;
pub(crate) mod state;
pub(crate) mod transport;

use protocol::{decode_invitation, QrMatrix};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use protocol::{encode_invitation, invitation_qr_matrix};
use serde::Serialize;
use state::PairingManager;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::Mutex;
use tauri::{Manager, Runtime};
use tokio::net::TcpListener;

const COORDINATOR_PORT: u16 = 43_821;

pub(crate) use transport::sha256_file;

#[derive(Default)]
pub(crate) struct CoordinatorLifecycle {
    runtime: Mutex<Option<CoordinatorRuntime>>,
}

struct CoordinatorRuntime {
    endpoint: SocketAddr,
    shutdown: tokio::sync::oneshot::Sender<()>,
    requests: coordinator::CoordinatorSender,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingInvitationView {
    invitation: String,
    qr: QrMatrix,
    endpoint: String,
    expires_at_unix_ms: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingStatus {
    device_id: String,
    linked: bool,
    peer_device_id: Option<String>,
    peer_label: Option<String>,
    coordinator_endpoint: Option<String>,
    vault_id: Option<String>,
    can_write: Option<bool>,
    recovery_required: bool,
    replica_ready: bool,
    pending_transfer: bool,
}

impl CoordinatorLifecycle {
    async fn start_on<R: Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        manager: PairingManager,
        address: IpAddr,
    ) -> Result<SocketAddr, String> {
        {
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| "coordinator lifecycle lock is unavailable".to_string())?;
            if let Some(runtime) = runtime.as_ref() {
                return Ok(runtime.endpoint);
            }
        }
        if !is_lan_address(address) {
            return Err("vault handoff coordinator requires a private LAN address".to_string());
        }
        let listener = TcpListener::bind(SocketAddr::new(address, COORDINATOR_PORT))
            .await
            .map_err(|error| format!("bind vault handoff coordinator: {error}"))?;
        let endpoint = listener
            .local_addr()
            .map_err(|error| format!("read vault handoff endpoint: {error}"))?;
        let (shutdown, receiver) = tokio::sync::oneshot::channel();
        let (requests, request_receiver) = tokio::sync::mpsc::channel(8);
        tauri::async_runtime::spawn(coordinator::run(app, manager.clone(), request_receiver));
        tauri::async_runtime::spawn(transport::serve_with_coordinator(
            listener,
            manager,
            Some(requests.clone()),
            receiver,
        ));
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "coordinator lifecycle lock is unavailable".to_string())?;
        if runtime.is_some() {
            let _ = shutdown.send(());
            return Ok(runtime.as_ref().expect("checked runtime").endpoint);
        }
        *runtime = Some(CoordinatorRuntime {
            endpoint,
            shutdown,
            requests,
        });
        Ok(endpoint)
    }

    pub(crate) fn stop(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            if let Some(runtime) = runtime.take() {
                let (response, _) = tokio::sync::oneshot::channel();
                let _ = runtime.requests.try_send(coordinator::CoordinatorRequest {
                    operation: coordinator::CoordinatorOperation::Shutdown,
                    response,
                });
                let _ = runtime.shutdown.send(());
            }
        }
    }

    fn endpoint(&self) -> Result<Option<SocketAddr>, String> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "coordinator lifecycle lock is unavailable".to_string())?;
        Ok(runtime.as_ref().map(|runtime| runtime.endpoint))
    }

    fn request_sender(&self) -> Result<coordinator::CoordinatorSender, String> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "coordinator lifecycle lock is unavailable".to_string())?;
        runtime
            .as_ref()
            .map(|runtime| runtime.requests.clone())
            .ok_or_else(|| "vault handoff coordinator is not running".to_string())
    }
}

pub(crate) fn initialize<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("find app config directory: {error}"))?;
    let device_id = super::ensure_device_id(app)?;
    let pairing = app.state::<PairingManager>();
    pairing.initialize(config_dir, device_id)?;
    if let Some(coordinator) = pairing.coordinator_pin()? {
        app.state::<super::ownership::VaultOwnershipManager>()
            .register_remote_owner_if_missing(
                &coordinator.vault_id,
                coordinator.device_id,
                coordinator.generation,
            )?;
    }
    restore_outgoing_ownership(app, &pairing)?;
    Ok(())
}

fn restore_outgoing_ownership<R: Runtime>(
    app: &tauri::AppHandle<R>,
    pairing: &PairingManager,
) -> Result<(), String> {
    let Some(transfer) = pairing.outgoing_transfer()? else {
        return Ok(());
    };
    let (_, archive_path) = pairing.outgoing_snapshot_paths(&transfer.metadata.transfer_id)?;
    if let Err(error) = protocol::validate_staging_file(&archive_path, &transfer.metadata) {
        if transfer.committed {
            return Err(format!(
                "committed handoff snapshot is unavailable: {error}"
            ));
        }
        pairing.clear_outgoing_transfer(&transfer.metadata.transfer_id)?;
        let _ = std::fs::remove_file(archive_path);
        return Ok(());
    }
    if transfer.purpose != protocol::BundlePurpose::Ownership {
        return Ok(());
    }
    let previous_generation = transfer
        .metadata
        .generation
        .checked_sub(1)
        .ok_or_else(|| "persisted ownership transfer generation is invalid".to_string())?;
    let ownership = app.state::<super::ownership::VaultOwnershipManager>();
    let status = ownership.status(&transfer.metadata.vault_id)?;
    if transfer.committed {
        return if status.transfer_phase
            == (super::ownership::TransferPhase::OutgoingCommitted {
                transfer_id: transfer.metadata.transfer_id,
                receiver_device_id: transfer.metadata.device_id,
                committed_generation: transfer.metadata.generation,
            }) {
            Ok(())
        } else {
            Err("committed handoff conflicts with durable ownership state".to_string())
        };
    }
    if status.transfer_phase
        == (super::ownership::TransferPhase::PreparingOutgoing {
            transfer_id: transfer.metadata.transfer_id.clone(),
            receiver_device_id: transfer.metadata.device_id.clone(),
            next_generation: transfer.metadata.generation,
        })
    {
        return Ok(());
    }
    if status.transfer_phase
        == (super::ownership::TransferPhase::OutgoingCommitted {
            transfer_id: transfer.metadata.transfer_id.clone(),
            receiver_device_id: transfer.metadata.device_id.clone(),
            committed_generation: transfer.metadata.generation,
        })
    {
        return pairing.mark_outgoing_committed(&transfer.metadata.transfer_id);
    }
    ownership.begin_outgoing(
        &transfer.metadata.vault_id,
        previous_generation,
        transfer.metadata.transfer_id,
        transfer.metadata.device_id,
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn start_desktop<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let address = discover_private_lan_address()?;
    let manager = app.state::<PairingManager>().inner().clone();
    let lifecycle = app.state::<CoordinatorLifecycle>();
    tauri::async_runtime::block_on(lifecycle.start_on(app.clone(), manager, address))?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub(crate) async fn handoff_create_pairing_invitation<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PairingInvitationView, String> {
    let manager = app.state::<PairingManager>().inner().clone();
    let lifecycle = app.state::<CoordinatorLifecycle>();
    let endpoint = match lifecycle.endpoint()? {
        Some(endpoint) => endpoint,
        None => {
            let address = discover_private_lan_address()?;
            lifecycle
                .start_on(app.clone(), manager.clone(), address)
                .await?
        }
    };
    let ownership = super::ownership::active_status(&app)?;
    let invitation = manager.create_invitation(
        endpoint,
        ownership.vault_id,
        ownership.generation,
        protocol::unix_time_ms(),
    )?;
    let encoded = encode_invitation(&invitation)?;
    Ok(PairingInvitationView {
        qr: invitation_qr_matrix(&encoded)?,
        invitation: encoded,
        endpoint: endpoint.to_string(),
        expires_at_unix_ms: invitation.expires_at_unix_ms,
    })
}

#[tauri::command]
pub(crate) fn handoff_decode_pairing_qr(
    width: usize,
    height: usize,
    luma: Vec<u8>,
) -> Result<String, String> {
    let encoded = protocol::decode_qr_luma(width, height, &luma)?;
    decode_invitation(&encoded, protocol::unix_time_ms())?;
    Ok(encoded)
}

#[tauri::command]
pub(crate) async fn handoff_enroll<R: Runtime>(
    app: tauri::AppHandle<R>,
    invitation: String,
    device_label: String,
) -> Result<(), String> {
    let invitation = decode_invitation(&invitation, protocol::unix_time_ms())?;
    let manager = app.state::<PairingManager>().inner().clone();
    transport::enroll(&manager, &invitation, device_label).await?;
    app.state::<super::ownership::VaultOwnershipManager>()
        .register_remote_owner(
            &invitation.vault_id,
            invitation.coordinator_device_id,
            invitation.generation,
        )
}

#[tauri::command]
pub(crate) fn handoff_pairing_status<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PairingStatus, String> {
    let manager = app.state::<PairingManager>();
    let (device_id, _) = manager.identity()?;
    let peer = manager.linked_peer()?;
    let coordinator = manager.coordinator_pin()?;
    let vault_id = peer
        .as_ref()
        .map(|peer| peer.vault_id.clone())
        .or_else(|| {
            coordinator
                .as_ref()
                .map(|coordinator| coordinator.vault_id.clone())
        })
        .or_else(|| super::active_vault_id(&app).ok());
    let ownership = vault_id
        .as_deref()
        .map(|vault_id| {
            app.state::<super::ownership::VaultOwnershipManager>()
                .status(vault_id)
        })
        .transpose()?;
    Ok(PairingStatus {
        device_id,
        linked: peer.is_some() || coordinator.is_some(),
        peer_device_id: peer.as_ref().map(|peer| peer.device_id.clone()),
        peer_label: peer.as_ref().map(|peer| peer.device_label.clone()),
        coordinator_endpoint: coordinator.map(|coordinator| coordinator.endpoint),
        vault_id,
        can_write: ownership.as_ref().map(|status| status.can_write),
        recovery_required: ownership
            .as_ref()
            .is_some_and(|status| status.role == "recovery"),
        replica_ready: manager.replica_ready()? || peer.is_some(),
        pending_transfer: manager.has_pending_transfer()?,
    })
}

#[tauri::command]
pub(crate) fn handoff_unlink<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let manager = app.state::<PairingManager>();
    manager.ensure_can_unlink()?;
    let ownership = super::ownership::active_status(&app)?;
    if !matches!(
        ownership.transfer_phase,
        super::ownership::TransferPhase::Stable
    ) {
        return Err("finish or retry the active handoff before unlinking".to_string());
    }
    manager.unlink()
}

#[tauri::command]
pub(crate) fn handoff_recover_local_copy<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<u64, String> {
    let manager = app.state::<PairingManager>();
    manager.ensure_can_unlink()?;
    let vault_id = super::active_vault_id(&app)?;
    let ownership = app.state::<super::ownership::VaultOwnershipManager>();
    ownership.ensure_can_recover_local_copy(&vault_id)?;
    manager.unlink()?;
    ownership.recover_local_copy(&vault_id)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub(crate) async fn handoff_request_android_bundle<R: Runtime>(
    app: tauri::AppHandle<R>,
    purpose: protocol::BundlePurpose,
) -> Result<(), String> {
    let response = coordinator::request(
        &app.state::<CoordinatorLifecycle>().request_sender()?,
        coordinator::CoordinatorOperation::RequestUpload { purpose },
    )
    .await?;
    match response {
        coordinator::CoordinatorResponse::UploadRequested { purpose: requested }
            if requested == purpose =>
        {
            Ok(())
        }
        _ => Err("coordinator returned an invalid upload request result".to_string()),
    }
}

fn discover_private_lan_address() -> Result<IpAddr, String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|error| format!("inspect LAN address: {error}"))?;
    socket
        .connect((Ipv4Addr::new(192, 0, 2, 1), 9))
        .map_err(|error| format!("select LAN route: {error}"))?;
    let address = socket
        .local_addr()
        .map_err(|error| format!("read LAN address: {error}"))?
        .ip();
    if !is_lan_address(address) || address.is_loopback() {
        return Err("no private LAN address is currently available".to_string());
    }
    Ok(address)
}

fn is_lan_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private() || address.is_link_local() || address.is_loopback()
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unicast_link_local()
                || (address.segments()[0] & 0xfe00) == 0xfc00
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinator_rejects_public_bind_addresses() {
        assert!(!is_lan_address("8.8.8.8".parse().expect("address")));
        assert!(is_lan_address("192.168.10.4".parse().expect("address")));
        assert!(is_lan_address("fd00::1".parse().expect("address")));
    }
}

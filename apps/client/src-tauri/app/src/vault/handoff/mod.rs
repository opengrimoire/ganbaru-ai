//! Secure, LAN-only pairing and whole-vault bundle transport.

pub(crate) mod protocol;
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
}

impl CoordinatorLifecycle {
    async fn start_on(
        &self,
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
        tauri::async_runtime::spawn(transport::serve(listener, manager, receiver));
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "coordinator lifecycle lock is unavailable".to_string())?;
        if runtime.is_some() {
            let _ = shutdown.send(());
            return Ok(runtime.as_ref().expect("checked runtime").endpoint);
        }
        *runtime = Some(CoordinatorRuntime { endpoint, shutdown });
        Ok(endpoint)
    }

    pub(crate) fn stop(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            if let Some(runtime) = runtime.take() {
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
}

pub(crate) fn initialize<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("find app config directory: {error}"))?;
    let device_id = super::ensure_device_id(app)?;
    app.state::<PairingManager>()
        .initialize(config_dir, device_id)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn start_desktop<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let address = discover_private_lan_address()?;
    let manager = app.state::<PairingManager>().inner().clone();
    let lifecycle = app.state::<CoordinatorLifecycle>();
    tauri::async_runtime::block_on(lifecycle.start_on(manager, address))?;
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
            lifecycle.start_on(manager.clone(), address).await?
        }
    };
    let invitation = manager.create_invitation(
        endpoint,
        super::active_vault_id(&app)?,
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
    transport::enroll(&manager, &invitation, device_label).await
}

#[tauri::command]
pub(crate) fn handoff_pairing_status<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PairingStatus, String> {
    let manager = app.state::<PairingManager>();
    let (device_id, _) = manager.identity()?;
    let peer = manager.linked_peer()?;
    let coordinator = manager.coordinator_pin()?;
    Ok(PairingStatus {
        device_id,
        linked: peer.is_some() || coordinator.is_some(),
        peer_device_id: peer.as_ref().map(|peer| peer.device_id.clone()),
        peer_label: peer.map(|peer| peer.device_label),
        coordinator_endpoint: coordinator.map(|coordinator| coordinator.endpoint),
    })
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

//! LAN handoff contracts and device state independent of Tauri: the bounded control protocol
//! that linked devices and the desktop coordinator exchange, invitation and contact QR encoding,
//! staged bundle validation, and the device-private pairing identity, membership, and transfer
//! progress.

pub mod pairing;
pub mod protocol;

//! Concurrent sync of the active vault: replica access, the local writer, carry-forward across
//! database replacements, the service that seals local changes, the exchange with the hub, and
//! the recovery offers and device names the frontend shows.

mod access;
mod carry_forward;
mod client;
pub(crate) mod commands;
mod devices;
#[cfg(desktop)]
pub(crate) mod hub;
mod recovery;
mod service;
mod status;
mod wire;
mod writer;

#[cfg(test)]
mod tests;

pub(crate) use devices::{DeviceNames, DeviceRef};
#[cfg(desktop)]
pub(crate) use service::sync_hub;
pub(crate) use service::{
    SyncRuntime, export_for_replacement, now_ms, quiesced_sync, resume_after_vault_handoff,
    seal_quiesced, setup, stop_for_vault_handoff, sync_files,
};
pub(crate) use status::SyncSubscribers;

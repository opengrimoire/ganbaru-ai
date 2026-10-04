//! One application-owned music session above desktop, Android, and browser adapters.

mod backend;
mod models;
mod persistence;
mod policy;
mod queue;
pub(crate) mod runtime;
mod subscriptions;

pub(crate) use runtime::{
    reconcile_committed_focus, resume_after_vault_handoff, setup, stop_for_vault_handoff,
};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) use runtime::dispatch_control;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) use models::{
    PlaybackOrder, SessionEffect, SessionIntent, SessionProjection, SourceKind,
};

#[cfg(test)]
mod tests;

#[cfg(test)]
mod persistence_tests;

#[cfg(test)]
pub(crate) use models::{SessionBackend, SessionSource};

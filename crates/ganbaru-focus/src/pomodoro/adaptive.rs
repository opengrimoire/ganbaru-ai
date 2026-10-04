//! Deterministic adaptive policy. Local time facts and canonical evidence are
//! explicit inputs; presentation processes do not choose accepted durations.

pub mod decision;
pub mod experiment_analysis;
pub mod experiment_models;
pub mod experiment_outcomes;
pub mod experiment_selection;
pub mod features;
mod history;
pub mod models;
pub mod policy;
pub mod replay;
mod replay_candidates;
pub(crate) mod replay_dataset;
mod replay_gates;
pub mod replay_models;
pub mod replay_scoring;
pub(crate) mod snapshots;
pub mod state;
pub mod statistics;

#[cfg(test)]
mod decision_parity_tests;
#[cfg(test)]
mod experiment_parity_tests;
#[cfg(test)]
mod parity_tests;
#[cfg(test)]
mod replay_parity_tests;

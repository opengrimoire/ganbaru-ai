use super::*;
use chrono::{DateTime, Utc};
use sqlx::Row;
#[cfg(target_os = "linux")]
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

fn state(phase: &str) -> DistractionsRuntimeState {
    DistractionsRuntimeState {
        active: phase != "inactive",
        paused: false,
        pause_reason: None,
        phase: phase.to_string(),
        active_run_id: None,
        active_block_id: None,
        remaining_seconds: Some(30),
        updated_at: "2026-05-26T00:00:00.000Z".to_string(),
        valid_until_ms: None,
    }
}

mod catalog_tests;
mod close_authorization_tests;
mod contract_tests;
mod rules_tests;
mod state_tests;
mod usage_tests;

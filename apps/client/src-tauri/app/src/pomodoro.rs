//! Native Focus commands and canonical history reads. WebViews cannot write execution.

use crate::db_path::connect_sqlite;
pub use ganbaru_focus::*;
use tauri::{AppHandle, Runtime};

pub(crate) mod native_runtime;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) use native_runtime::{
    FocusNativeContext, capture_native_context, native_control_in_context,
};
pub(crate) use native_runtime::{
    invalidate_calendar, resume_after_vault_handoff, setup, stop_for_vault_handoff,
};

/// Read canonical accepted and legacy history for the Calendar rail.
#[tauri::command]
pub async fn pomodoro_load_segments_for_events<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event_ids: Vec<String>,
) -> Result<Vec<PomodoroSegmentRead>, String> {
    ganbaru_focus::pomodoro_load_segments_for_events(connect_sqlite(app, db_url).await?, event_ids)
        .await
}

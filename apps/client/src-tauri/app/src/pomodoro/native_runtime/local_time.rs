//! Historical native time facts for accepted adaptive decisions.

use std::collections::BTreeSet;
use std::future::Future;
use std::pin::Pin;

use ganbaru_focus::adaptive::models::LocalTimeFacts;
use ganbaru_focus::{
    FocusExecutionError, FocusLocalTimeResolver, PomodoroAdaptivePlannedBlockWrite,
};

pub(super) struct NativeLocalTime(pub tauri::AppHandle);

impl FocusLocalTimeResolver for NativeLocalTime {
    fn resolve(
        &self,
        instants: BTreeSet<i64>,
    ) -> Pin<Box<dyn Future<Output = Result<LocalTimeFacts, FocusExecutionError>> + Send + '_>>
    {
        Box::pin(async move {
            let app = self.0.clone();
            let instants = instants.into_iter().collect::<Vec<_>>();
            tauri::async_runtime::spawn_blocking(move || resolve(&app, &instants))
                .await
                .map_err(|error| format!("Join native adaptive local-time query: {error}"))?
                .map_err(Into::into)
        })
    }
}

#[cfg(not(target_os = "android"))]
fn resolve(_app: &tauri::AppHandle, instants: &[i64]) -> Result<LocalTimeFacts, String> {
    use crate::recurrence::time;
    time::local_time_facts(instants, &time::system_zone()?)
}

#[cfg(target_os = "android")]
fn resolve(app: &tauri::AppHandle, instants: &[i64]) -> Result<LocalTimeFacts, String> {
    use ganbaru_focus::adaptive::models::LocalTimeFact;
    use ganbaru_mobile_notifications::MobileNotificationsExt;
    let values = app
        .mobile_notifications()
        .device_local_time_facts(instants)?;
    if values.len() != instants.len() {
        return Err("Android returned incomplete adaptive local-time facts".to_owned());
    }
    let mut facts = LocalTimeFacts::new();
    for value in values {
        let fact = LocalTimeFact {
            epoch_ms: value.epoch_ms,
            date_key: value.date_key,
            date_string: value.date_string,
            hour: value.hour,
        };
        if facts.insert(fact.epoch_ms, fact).is_some() {
            return Err("Android returned duplicate adaptive local-time facts".to_owned());
        }
    }
    Ok(facts)
}

pub(super) fn planned_block(
    value: crate::calendar_reads::focus_context::FocusPlannedBlock,
) -> PomodoroAdaptivePlannedBlockWrite {
    PomodoroAdaptivePlannedBlockWrite {
        event_date: value.event_date,
        event_id: Some(value.event_id),
        original_event_id: value.original_event_id,
        planned_start: value.planned_start,
        planned_end: value.planned_end,
        source_kind: value.source_kind.to_owned(),
    }
}

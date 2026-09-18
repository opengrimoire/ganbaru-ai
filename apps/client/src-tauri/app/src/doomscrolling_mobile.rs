use crate::db_path::connect_sqlite;
#[cfg(target_os = "android")]
use crate::vault::{self, handoff::state::PairingManager, ownership::VaultOwnershipManager};
use chrono::{DateTime, SecondsFormat, Utc};
#[cfg(target_os = "android")]
use ganbaru_mobile_doomscrolling::{MobileDoomscrollingExt, PendingEvent};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::Runtime;

const ACTIVE_DB_URL: &str = "sqlite:ganbaru-ai.sqlite";
const MAX_BATCH: usize = 200;

#[cfg(not(target_os = "android"))]
#[derive(Clone, Debug)]
struct PendingEvent {
    id: String,
    kind: String,
    package_name: String,
    display_name: String,
    started_at: i64,
    elapsed_seconds: i64,
    local_date: String,
    occurred_at: i64,
    reason: Option<String>,
    rule_id: Option<String>,
    run_id: Option<String>,
    phase: Option<String>,
    vault_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDoomscrollingSyncResult {
    imported: usize,
    full_batch: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDoomscrollingUsageSample {
    id: String,
    source_type: String,
    source_key: String,
    display_name: Option<String>,
    started_at: i64,
    elapsed_seconds: i64,
    local_date: String,
    created_at: i64,
}

fn valid_package_name(value: &str) -> bool {
    if value.len() < 3 || value.len() > 255 {
        return false;
    }
    let mut segments = value.split('.');
    let mut count = 0;
    for segment in &mut segments {
        count += 1;
        let mut chars = segment.chars();
        if !chars
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic())
        {
            return false;
        }
        if !chars.all(|character| character.is_ascii_alphanumeric() || character == '_') {
            return false;
        }
    }
    count >= 2
}

fn normalize_event(mut event: PendingEvent) -> Result<PendingEvent, String> {
    event.id = event.id.trim().chars().take(120).collect();
    if event.id.is_empty() {
        return Err("mobile Doomscrolling event ID is required".to_string());
    }
    if event.kind != "usage" && event.kind != "block" {
        return Err("mobile Doomscrolling event kind is invalid".to_string());
    }
    event.package_name = event.package_name.trim().to_ascii_lowercase();
    if !valid_package_name(&event.package_name) {
        return Err("mobile Doomscrolling package name is invalid".to_string());
    }
    event.display_name = event
        .display_name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect();
    if event.display_name.is_empty() {
        return Err("mobile Doomscrolling display name is required".to_string());
    }
    if chrono::NaiveDate::parse_from_str(&event.local_date, "%Y-%m-%d").is_err() {
        return Err("mobile Doomscrolling local date is invalid".to_string());
    }
    if event.started_at < 0 || event.occurred_at < 0 {
        return Err("mobile Doomscrolling timestamp is invalid".to_string());
    }
    if event.kind == "usage" && !(1..=86_400).contains(&event.elapsed_seconds) {
        return Err("mobile Doomscrolling elapsed time is invalid".to_string());
    }
    if event.kind == "block" && event.elapsed_seconds != 0 {
        return Err("mobile Doomscrolling block duration must be zero".to_string());
    }
    if !matches!(
        event.phase.as_deref(),
        None | Some("focus") | Some("short_break") | Some("long_break")
    ) {
        return Err("mobile Doomscrolling phase is invalid".to_string());
    }
    event.reason = event
        .reason
        .map(|value| value.trim().chars().take(80).collect())
        .filter(|value: &String| !value.is_empty());
    event.rule_id = event
        .rule_id
        .map(|value| value.trim().chars().take(80).collect())
        .filter(|value: &String| !value.is_empty());
    event.run_id = event
        .run_id
        .map(|value| value.trim().chars().take(128).collect())
        .filter(|value: &String| !value.is_empty());
    event.vault_id = event.vault_id.trim().chars().take(128).collect();
    if event.vault_id.is_empty() {
        return Err("mobile Doomscrolling vault ID is required".to_string());
    }
    Ok(event)
}

async fn import_events(pool: &SqlitePool, events: &[PendingEvent]) -> Result<(), String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("begin mobile Doomscrolling import: {error}"))?;
    for event in events {
        if event.kind == "usage" {
            sqlx::query(
                "INSERT OR IGNORE INTO doomscrolling_usage_samples
                    (id, source_type, source_key, display_name, started_at,
                     elapsed_seconds, local_date, created_at)
                 VALUES (?, 'mobile-app', ?, ?, ?, ?, ?, ?)",
            )
            .bind(&event.id)
            .bind(&event.package_name)
            .bind(&event.display_name)
            .bind(event.started_at)
            .bind(event.elapsed_seconds)
            .bind(&event.local_date)
            .bind(event.occurred_at)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("import mobile Doomscrolling usage: {error}"))?;
            continue;
        }

        let run_id = if let Some(run_id) = &event.run_id {
            let exists =
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pomodoro_runs WHERE id = ?")
                    .bind(run_id)
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(|error| format!("validate mobile Doomscrolling run: {error}"))?
                    > 0;
            exists.then_some(run_id.clone())
        } else {
            None
        };
        let occurred_at = DateTime::<Utc>::from_timestamp_millis(event.occurred_at)
            .ok_or_else(|| "mobile Doomscrolling block timestamp is invalid".to_string())?
            .to_rfc3339_opts(SecondsFormat::Millis, true);
        let decision = if event.reason.as_deref() == Some("usage_limit") {
            "limit_exhausted"
        } else {
            "blocked"
        };
        sqlx::query(
            "INSERT OR IGNORE INTO doomscrolling_block_events
                (id, run_id, segment_id, occurred_at, source_type, source_key,
                 display_name, phase, decision, rule_id, category_id)
             VALUES (?, ?, NULL, ?, 'mobile_app', ?, ?, ?, ?, ?, NULL)",
        )
        .bind(&event.id)
        .bind(run_id)
        .bind(occurred_at)
        .bind(&event.package_name)
        .bind(&event.display_name)
        .bind(&event.phase)
        .bind(decision)
        .bind(&event.rule_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("import mobile Doomscrolling block: {error}"))?;

        let rule_kind = if event.reason.as_deref() == Some("usage_limit") {
            "usage_limit"
        } else {
            "mobile_app"
        };
        let blocker_mode = if rule_kind == "usage_limit" {
            "limit"
        } else {
            "blacklist"
        };
        sqlx::query(
            "INSERT OR IGNORE INTO doomscrolling_block_event_rule_snapshots
                (block_event_id, rule_id, rule_kind, rule_label, environment_id, blocker_mode)
             VALUES (?, ?, ?, ?, NULL, ?)",
        )
        .bind(&event.id)
        .bind(&event.rule_id)
        .bind(rule_kind)
        .bind(&event.display_name)
        .bind(blocker_mode)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("import mobile Doomscrolling rule snapshot: {error}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit mobile Doomscrolling import: {error}"))
}

#[tauri::command]
#[cfg(target_os = "android")]
pub async fn doomscrolling_mobile_sync_events<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<MobileDoomscrollingSyncResult, String> {
    let events = app.mobile_doomscrolling().pending_events()?;
    if events.len() > MAX_BATCH {
        return Err("mobile Doomscrolling journal batch is too large".to_string());
    }
    let active_vault_id = vault::active_vault_id(&app)?;
    let normalized_events = events
        .into_iter()
        .map(normalize_event)
        .collect::<Result<Vec<_>, _>>()?;
    let stale_ids = normalized_events
        .iter()
        .filter(|event| event.vault_id != active_vault_id)
        .map(|event| event.id.clone())
        .collect::<Vec<_>>();
    if !stale_ids.is_empty() {
        app.mobile_doomscrolling().acknowledge_events(&stale_ids)?;
    }
    let normalized = normalized_events
        .into_iter()
        .filter(|event| event.vault_id == active_vault_id)
        .collect::<Vec<_>>();
    let ownership = app
        .state::<VaultOwnershipManager>()
        .status(&active_vault_id)?;
    let pairing = app.state::<PairingManager>().inner().clone();
    let linked = pairing.coordinator_pin()?.is_some();
    let mut imported = 0;
    let mut full_batch = false;

    if ownership.can_write {
        full_batch = normalized.len() == MAX_BATCH;
        if !normalized.is_empty() {
            let pool = connect_sqlite(app.clone(), ACTIVE_DB_URL.to_string()).await?;
            import_events(&pool, &normalized).await?;
            let processed_ids = normalized
                .iter()
                .map(|event| event.id.clone())
                .collect::<Vec<_>>();
            app.mobile_doomscrolling()
                .acknowledge_events(&processed_ids)?;
            imported += normalized.len();
        }
        if linked {
            if let Err(error) = exchange_as_owner(&app, &pairing, &active_vault_id).await {
                eprintln!("linked Doomscrolling exchange deferred: {error}");
            }
        }
    } else if linked {
        let usage_events = normalized
            .iter()
            .filter(|event| event.kind == "usage")
            .cloned()
            .collect::<Vec<_>>();
        let samples = usage_events
            .iter()
            .map(|event| pending_event_message(event, &ownership.device_id))
            .collect();
        match crate::vault::handoff::transport::exchange_doomscrolling(
            &pairing,
            samples,
            Vec::new(),
            Vec::new(),
        )
        .await
        {
            Ok((acknowledged, _, combined)) => {
                app.mobile_doomscrolling()
                    .acknowledge_events(&acknowledged)?;
                crate::doomscrolling_linked::replace_accepted(&app, &active_vault_id, &combined)
                    .await?;
                imported += acknowledged.len();
                full_batch = acknowledged.len() == MAX_BATCH;
            }
            Err(error) => eprintln!("linked Doomscrolling exchange deferred: {error}"),
        }
    }
    Ok(MobileDoomscrollingSyncResult {
        imported,
        full_batch,
    })
}

#[cfg(target_os = "android")]
async fn exchange_as_owner<R: Runtime>(
    app: &tauri::AppHandle<R>,
    pairing: &PairingManager,
    vault_id: &str,
) -> Result<(), String> {
    let pool = connect_sqlite(app.clone(), ACTIVE_DB_URL.to_string()).await?;
    let snapshot = owner_snapshot(&pool).await?;
    let (_, peer_samples, combined) = crate::vault::handoff::transport::exchange_doomscrolling(
        pairing,
        Vec::new(),
        Vec::new(),
        snapshot,
    )
    .await?;
    if peer_samples.is_empty() {
        return crate::doomscrolling_linked::replace_accepted(app, vault_id, &combined).await;
    }
    let acknowledged =
        crate::doomscrolling_linked::import_linked_samples(&pool, &peer_samples).await?;
    let refreshed = owner_snapshot(&pool).await?;
    let (_, _, combined) = crate::vault::handoff::transport::exchange_doomscrolling(
        pairing,
        Vec::new(),
        acknowledged,
        refreshed,
    )
    .await?;
    crate::doomscrolling_linked::replace_accepted(app, vault_id, &combined).await
}

#[cfg(target_os = "android")]
async fn owner_snapshot(
    pool: &SqlitePool,
) -> Result<Vec<crate::vault::handoff::protocol::DoomscrollingSampleMessage>, String> {
    crate::doomscrolling_linked::aggregate_owner_samples(pool).await
}

#[cfg(target_os = "android")]
fn pending_event_message(
    event: &PendingEvent,
    device_id: &str,
) -> crate::vault::handoff::protocol::DoomscrollingSampleMessage {
    crate::vault::handoff::protocol::DoomscrollingSampleMessage {
        sample_id: event.id.clone(),
        device_id: device_id.to_string(),
        source_type: "mobile-app".to_string(),
        source_key: event.package_name.clone(),
        display_name: Some(event.display_name.clone()),
        started_at_unix_ms: event.started_at,
        elapsed_seconds: event.elapsed_seconds,
        local_date: event.local_date.clone(),
        created_at_unix_ms: event.occurred_at,
    }
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn doomscrolling_mobile_sync_events<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<MobileDoomscrollingSyncResult, String> {
    Err("mobile Doomscrolling is available only on Android".to_string())
}

#[tauri::command]
pub async fn doomscrolling_mobile_list_usage_samples<R: Runtime>(
    app: tauri::AppHandle<R>,
    start_local_date: String,
    end_local_date: String,
) -> Result<Vec<MobileDoomscrollingUsageSample>, String> {
    if chrono::NaiveDate::parse_from_str(&start_local_date, "%Y-%m-%d").is_err()
        || chrono::NaiveDate::parse_from_str(&end_local_date, "%Y-%m-%d").is_err()
        || start_local_date > end_local_date
    {
        return Err("mobile Doomscrolling date window is invalid".to_string());
    }
    #[cfg(target_os = "android")]
    {
        let vault_id = vault::active_vault_id(&app)?;
        let ownership = app.state::<VaultOwnershipManager>().status(&vault_id)?;
        if !ownership.can_write {
            let mut samples = crate::doomscrolling_linked::accepted(&app, &vault_id).await?;
            let pending = app.mobile_doomscrolling().pending_events()?;
            samples.extend(
                pending
                    .into_iter()
                    .map(normalize_event)
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .filter(|event| event.kind == "usage" && event.vault_id == vault_id)
                    .map(|event| pending_event_message(&event, &ownership.device_id)),
            );
            samples.retain(|sample| {
                sample.local_date.as_str() >= start_local_date.as_str()
                    && sample.local_date.as_str() <= end_local_date.as_str()
            });
            samples.sort_by(|left, right| {
                left.started_at_unix_ms
                    .cmp(&right.started_at_unix_ms)
                    .then_with(|| left.sample_id.cmp(&right.sample_id))
            });
            return Ok(samples
                .into_iter()
                .map(crate::doomscrolling_linked::message_to_row)
                .map(|row| MobileDoomscrollingUsageSample {
                    id: row.id,
                    source_type: row.source_type,
                    source_key: row.source_key,
                    display_name: row.display_name,
                    started_at: row.started_at,
                    elapsed_seconds: row.elapsed_seconds,
                    local_date: row.local_date,
                    created_at: row.created_at,
                })
                .collect());
        }
    }
    let pool = connect_sqlite(app, ACTIVE_DB_URL.to_string()).await?;
    let rows = sqlx::query(
        "SELECT id, source_type, source_key, display_name, started_at,
                elapsed_seconds, local_date, created_at
         FROM doomscrolling_usage_samples
         WHERE local_date BETWEEN ? AND ?
         ORDER BY started_at ASC, id ASC",
    )
    .bind(start_local_date)
    .bind(end_local_date)
    .fetch_all(&pool)
    .await
    .map_err(|error| format!("list mobile Doomscrolling usage: {error}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(MobileDoomscrollingUsageSample {
                id: row.try_get("id").map_err(|error| error.to_string())?,
                source_type: row
                    .try_get("source_type")
                    .map_err(|error| error.to_string())?,
                source_key: row
                    .try_get("source_key")
                    .map_err(|error| error.to_string())?,
                display_name: row
                    .try_get("display_name")
                    .map_err(|error| error.to_string())?,
                started_at: row
                    .try_get("started_at")
                    .map_err(|error| error.to_string())?,
                elapsed_seconds: row
                    .try_get("elapsed_seconds")
                    .map_err(|error| error.to_string())?,
                local_date: row
                    .try_get("local_date")
                    .map_err(|error| error.to_string())?,
                created_at: row
                    .try_get("created_at")
                    .map_err(|error| error.to_string())?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::valid_package_name;

    #[test]
    fn package_validation_requires_bounded_java_segments() {
        assert!(valid_package_name("com.example.video"));
        assert!(valid_package_name("app_1.social.feed2"));
        assert!(!valid_package_name("android"));
        assert!(!valid_package_name("1com.example"));
        assert!(!valid_package_name("com.example-app"));
    }
}

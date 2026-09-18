use super::*;
use crate::db_path::connect_sqlite;
use sqlx::{Row, SqlitePool};

fn normalize_usage_host(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = trimmed.strip_prefix("*.").unwrap_or(&trimmed);
    if host.is_empty() || host.contains('*') || host.contains(' ') || host.contains('@') {
        return None;
    }
    Some(host.to_string())
}

fn normalize_usage_source_key(source_type: &str, source_key: &str) -> Option<String> {
    match source_type {
        "website" => normalize_usage_host(source_key),
        "desktop-app" | "mobile-app" => {
            normalize_app_candidate_name(source_key).map(|name| name.to_lowercase())
        }
        _ => None,
    }
}

fn normalize_usage_display_name(value: Option<String>) -> Option<String> {
    value.and_then(|name| {
        let normalized = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            None
        } else {
            Some(normalized.chars().take(120).collect())
        }
    })
}

pub(super) fn normalize_desktop_block_event(
    input: DoomscrollingDesktopBlockEventInput,
) -> Result<NormalizedDesktopBlockEvent, String> {
    let source_name = input.process_name.as_deref().unwrap_or(&input.app_name);
    let source_key = normalize_usage_source_key("desktop-app", source_name)
        .ok_or_else(|| "desktop block event source key is invalid".to_string())?;
    if is_protected_desktop_app_name(&source_key) {
        return Err("protected desktop apps cannot be tracked".to_string());
    }
    Ok(NormalizedDesktopBlockEvent {
        source_key,
        display_name: normalize_usage_display_name(Some(input.app_name)),
        process_id: input.process_id,
    })
}

pub(super) fn validate_local_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

pub(super) fn normalize_usage_sample(
    sample: DoomscrollingUsageSampleInput,
    fallback_id_prefix: &str,
) -> Result<DoomscrollingUsageSampleRow, String> {
    let source_type = match sample.source_type.as_str() {
        "website" | "desktop-app" | "mobile-app" => sample.source_type,
        other => return Err(format!("unsupported usage source type '{other}'")),
    };
    let source_key = normalize_usage_source_key(&source_type, &sample.source_key)
        .ok_or_else(|| "usage sample source key is invalid".to_string())?;
    if source_type == "desktop-app" && is_protected_desktop_app_name(&source_key) {
        return Err("protected desktop apps cannot be tracked".to_string());
    }
    if sample.elapsed_seconds <= 0 || sample.elapsed_seconds > 86_400 {
        return Err("elapsed_seconds must be between 1 and 86400".to_string());
    }
    if sample.started_at < 0 {
        return Err("started_at must be non-negative".to_string());
    }
    if !validate_local_date(&sample.local_date) {
        return Err("local_date must use yyyy-mm-dd".to_string());
    }
    let id = sample.id.unwrap_or_else(|| {
        let identity = format!(
            "{source_type}|{source_key}|{}|{}",
            sample.started_at, sample.local_date
        );
        format!(
            "{fallback_id_prefix}-{:x}",
            Sha256::digest(identity.as_bytes())
        )
    });
    if id.trim().is_empty() {
        return Err("usage sample id is required".to_string());
    }

    Ok(DoomscrollingUsageSampleRow {
        id: id.chars().take(120).collect(),
        source_type,
        source_key,
        display_name: normalize_usage_display_name(sample.display_name),
        started_at: sample.started_at,
        elapsed_seconds: sample.elapsed_seconds,
        local_date: sample.local_date,
        created_at: now_epoch_ms(),
    })
}

#[tauri::command]
pub async fn doomscrolling_record_usage_sample<R: Runtime>(
    app: tauri::AppHandle<R>,
    db_url: String,
    sample: DoomscrollingUsageSampleInput,
) -> Result<(), String> {
    let sample = normalize_usage_sample(sample, "app")?;
    route_usage_samples(&app, db_url, vec![sample]).await
}

#[tauri::command]
pub async fn doomscrolling_record_usage_samples<R: Runtime>(
    app: tauri::AppHandle<R>,
    db_url: String,
    samples: Vec<DoomscrollingUsageSampleInput>,
) -> Result<(), String> {
    if samples.is_empty() {
        return Ok(());
    }
    let samples = samples
        .into_iter()
        .map(|sample| normalize_usage_sample(sample, "app"))
        .collect::<Result<Vec<_>, _>>()?;
    route_usage_samples(&app, db_url, samples).await
}

async fn route_usage_samples<R: Runtime>(
    app: &tauri::AppHandle<R>,
    db_url: String,
    samples: Vec<DoomscrollingUsageSampleRow>,
) -> Result<(), String> {
    if db_url != format!("sqlite:{}", crate::vault::APP_SQLITE_FILE) {
        let pool = connect_sqlite(app.clone(), db_url).await?;
        return insert_usage_samples(&pool, samples).await;
    }
    let vault_id = crate::vault::active_vault_id(app)?;
    let status = app
        .state::<crate::vault::ownership::VaultOwnershipManager>()
        .status(&vault_id)?;
    if status.can_write {
        let pool = connect_sqlite(app.clone(), db_url).await?;
        crate::doomscrolling_linked::drain_local_spool(app, &pool, &vault_id, &status.device_id)
            .await?;
        return insert_usage_samples(&pool, samples).await;
    }
    for sample in &samples {
        crate::doomscrolling_linked::enqueue(
            app,
            &vault_id,
            &status.device_id,
            &linked_row(sample),
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn insert_usage_samples(
    pool: &SqlitePool,
    samples: Vec<DoomscrollingUsageSampleRow>,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    for sample in samples {
        sqlx::query(
            "INSERT OR IGNORE INTO doomscrolling_usage_samples
                (id, source_type, source_key, display_name, started_at, elapsed_seconds, local_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(sample.id)
        .bind(sample.source_type)
        .bind(sample.source_key)
        .bind(sample.display_name)
        .bind(sample.started_at)
        .bind(sample.elapsed_seconds)
        .bind(sample.local_date)
        .bind(sample.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("record doomscrolling usage sample: {e}"))?;
    }
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

pub(super) async fn insert_desktop_block_event(
    pool: &SqlitePool,
    event: NormalizedDesktopBlockEvent,
    runtime: Option<&DoomscrollingRuntimeState>,
    occurred_at: &str,
) -> Result<(), String> {
    let phase = block_event_phase_from_runtime(runtime);
    let run_id = phase
        .as_deref()
        .and(runtime)
        .and_then(|state| state.active_run_id.clone());
    let event_id = format!(
        "desktop-block-{}-{}-{}",
        now_epoch_ms(),
        std::process::id(),
        event.process_id.unwrap_or(0),
    );

    sqlx::query(
        "INSERT OR IGNORE INTO doomscrolling_block_events
            (id, run_id, segment_id, occurred_at, source_type, source_key,
             display_name, phase, decision, rule_id, category_id)
         VALUES (?, ?, NULL, ?, 'desktop_app', ?, ?, ?, 'blocked', NULL, NULL)",
    )
    .bind(&event_id)
    .bind(&run_id)
    .bind(occurred_at)
    .bind(&event.source_key)
    .bind(&event.display_name)
    .bind(&phase)
    .execute(pool)
    .await
    .map_err(|e| format!("record desktop block event: {e}"))?;

    sqlx::query(
        "INSERT OR REPLACE INTO doomscrolling_block_event_rule_snapshots
            (block_event_id, rule_id, rule_kind, rule_label, environment_id, blocker_mode)
         VALUES (?, NULL, 'desktop_app', ?, NULL, 'blacklist')",
    )
    .bind(&event_id)
    .bind(&event.display_name)
    .execute(pool)
    .await
    .map_err(|e| format!("record desktop block event rule snapshot: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn doomscrolling_record_desktop_block_event<R: Runtime>(
    app: tauri::AppHandle<R>,
    event: DoomscrollingDesktopBlockEventInput,
) -> Result<(), String> {
    let event = normalize_desktop_block_event(event)?;
    let checked_at = now_utc();
    let occurred_at = checked_at.to_rfc3339_opts(SecondsFormat::Millis, true);
    let runtime_state_path = state_path(&app)?;
    let runtime = read_fresh_runtime_state(&runtime_state_path, checked_at);
    let pool = connect_sqlite(app, "sqlite:ganbaru-ai.sqlite".to_string()).await?;
    insert_desktop_block_event(&pool, event, runtime.as_ref(), &occurred_at).await
}

#[tauri::command]
pub async fn doomscrolling_list_usage_samples<R: Runtime>(
    app: tauri::AppHandle<R>,
    db_url: String,
    start_local_date: String,
    end_local_date: String,
) -> Result<Vec<DoomscrollingUsageSampleRow>, String> {
    if !validate_local_date(&start_local_date) || !validate_local_date(&end_local_date) {
        return Err("local dates must use yyyy-mm-dd".to_string());
    }
    if start_local_date > end_local_date {
        return Err("start_local_date must not be after end_local_date".to_string());
    }
    let vault_id = crate::vault::active_vault_id(&app)?;
    let status = app
        .state::<crate::vault::ownership::VaultOwnershipManager>()
        .status(&vault_id)?;
    if !status.can_write {
        let mut samples = crate::doomscrolling_linked::accepted(&app, &vault_id).await?;
        samples.extend(
            crate::doomscrolling_linked::pending(&app, &vault_id, &status.device_id).await?,
        );
        samples.retain(|sample| {
            sample.local_date >= start_local_date && sample.local_date <= end_local_date
        });
        samples.sort_by(|left, right| {
            left.started_at_unix_ms
                .cmp(&right.started_at_unix_ms)
                .then_with(|| left.sample_id.cmp(&right.sample_id))
        });
        return Ok(samples
            .into_iter()
            .map(crate::doomscrolling_linked::message_to_row)
            .map(usage_row)
            .collect());
    }
    let pool = connect_sqlite(app.clone(), db_url).await?;
    crate::doomscrolling_linked::drain_local_spool(&app, &pool, &vault_id, &status.device_id)
        .await?;
    let rows = sqlx::query(
        "SELECT id, source_type, source_key, display_name, started_at,
                elapsed_seconds, local_date, created_at
         FROM doomscrolling_usage_samples
         WHERE local_date >= ? AND local_date <= ?
         ORDER BY started_at ASC, id ASC",
    )
    .bind(start_local_date)
    .bind(end_local_date)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("list doomscrolling usage samples: {e}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(DoomscrollingUsageSampleRow {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                source_type: row.try_get("source_type").map_err(|e| e.to_string())?,
                source_key: row.try_get("source_key").map_err(|e| e.to_string())?,
                display_name: row.try_get("display_name").map_err(|e| e.to_string())?,
                started_at: row.try_get("started_at").map_err(|e| e.to_string())?,
                elapsed_seconds: row.try_get("elapsed_seconds").map_err(|e| e.to_string())?,
                local_date: row.try_get("local_date").map_err(|e| e.to_string())?,
                created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

fn linked_row(sample: &DoomscrollingUsageSampleRow) -> crate::doomscrolling_linked::LinkedUsageRow {
    crate::doomscrolling_linked::LinkedUsageRow {
        id: sample.id.clone(),
        source_type: sample.source_type.clone(),
        source_key: sample.source_key.clone(),
        display_name: sample.display_name.clone(),
        started_at: sample.started_at,
        elapsed_seconds: sample.elapsed_seconds,
        local_date: sample.local_date.clone(),
        created_at: sample.created_at,
    }
}

fn usage_row(sample: crate::doomscrolling_linked::LinkedUsageRow) -> DoomscrollingUsageSampleRow {
    DoomscrollingUsageSampleRow {
        id: sample.id,
        source_type: sample.source_type,
        source_key: sample.source_key,
        display_name: sample.display_name,
        started_at: sample.started_at,
        elapsed_seconds: sample.elapsed_seconds,
        local_date: sample.local_date,
        created_at: sample.created_at,
    }
}

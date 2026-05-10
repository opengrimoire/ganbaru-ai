use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteQueryResult;
use sqlx::{Connection, Row, Sqlite, Transaction};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

const PALETTE_SIZE: usize = 24;
const MAX_DISPLAY_NAME_LENGTH: usize = 60;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserThemeWrite {
    id: String,
    display_name: String,
    icon_label: String,
    seed_icon_label: String,
    blend_canvas: String,
    seed_blend_canvas: String,
    derivation_engine_version: i64,
    calendar_default_mode: String,
    calendar_default_custom: String,
    seed_calendar_default_mode: String,
    seed_calendar_default_custom: String,
    tokens: Vec<ThemeTokenWrite>,
    palette: Vec<ThemePaletteWrite>,
    seed_tokens: Vec<ThemeTokenWrite>,
    seed_palette: Vec<ThemePaletteWrite>,
}

#[derive(Deserialize)]
struct ThemeTokenWrite {
    kind: String,
    key: String,
    value: String,
    isolated: bool,
}

#[derive(Deserialize)]
struct ThemePaletteWrite {
    slot: i64,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSourceCascadeWrite {
    id: String,
    source_key: String,
    value: String,
    derived_app: HashMap<String, String>,
    derived_cal: HashMap<String, String>,
    next_blend_canvas: Option<String>,
}

#[derive(Serialize)]
pub struct DismissalRow {
    theme_id: String,
    engine_version: i64,
    dismissed_at: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ThemeRowRead {
    id: String,
    display_name: String,
    blend_canvas: String,
    seed_blend_canvas: String,
    derivation_engine_version: i64,
    calendar_default_mode: String,
    calendar_default_custom: String,
    seed_calendar_default_mode: String,
    seed_calendar_default_custom: String,
    icon_label: Option<String>,
    seed_icon_label: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TokenRowRead {
    theme_id: String,
    kind: String,
    key: String,
    value: String,
    isolated: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct PaletteRowRead {
    theme_id: String,
    slot: i64,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserThemeRead {
    theme: ThemeRowRead,
    tokens: Vec<TokenRowRead>,
    palette: Vec<PaletteRowRead>,
    seed_tokens: Vec<TokenRowRead>,
    seed_palette: Vec<PaletteRowRead>,
}

trait ThemeScoped {
    fn theme_id(&self) -> &str;
}

impl ThemeScoped for TokenRowRead {
    fn theme_id(&self) -> &str {
        &self.theme_id
    }
}

impl ThemeScoped for PaletteRowRead {
    fn theme_id(&self) -> &str {
        &self.theme_id
    }
}

#[tauri::command]
pub async fn theme_load_all<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<Vec<UserThemeRead>, String> {
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let themes = sqlx::query_as::<_, ThemeRowRead>(
        "SELECT id, display_name, blend_canvas, seed_blend_canvas,
                derivation_engine_version, calendar_default_mode,
                calendar_default_custom, seed_calendar_default_mode,
                seed_calendar_default_custom, icon_label, seed_icon_label,
                created_at, updated_at
         FROM themes
         ORDER BY created_at ASC",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|e| format!("load themes: {e}"))?;
    if themes.is_empty() {
        return Ok(Vec::new());
    }

    let tokens = sqlx::query_as::<_, TokenRowRead>(
        "SELECT theme_id, kind, key, value, isolated
         FROM theme_tokens
         ORDER BY theme_id ASC, kind ASC, key ASC",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|e| format!("load theme tokens: {e}"))?;
    let palette = sqlx::query_as::<_, PaletteRowRead>(
        "SELECT theme_id, slot, value
         FROM theme_event_palette
         ORDER BY theme_id ASC, slot ASC",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|e| format!("load theme palette: {e}"))?;
    let seed_tokens = sqlx::query_as::<_, TokenRowRead>(
        "SELECT theme_id, kind, key, value, isolated
         FROM theme_seed_tokens
         ORDER BY theme_id ASC, kind ASC, key ASC",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|e| format!("load seed theme tokens: {e}"))?;
    let seed_palette = sqlx::query_as::<_, PaletteRowRead>(
        "SELECT theme_id, slot, value
         FROM theme_seed_event_palette
         ORDER BY theme_id ASC, slot ASC",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|e| format!("load seed theme palette: {e}"))?;

    validate_theme_rows(&themes, &tokens, &palette, &seed_tokens, &seed_palette)?;

    let mut tokens_by_theme = group_by_theme(tokens);
    let mut palette_by_theme = group_by_theme(palette);
    let mut seed_tokens_by_theme = group_by_theme(seed_tokens);
    let mut seed_palette_by_theme = group_by_theme(seed_palette);

    Ok(themes
        .into_iter()
        .map(|theme| {
            let id = theme.id.clone();
            UserThemeRead {
                theme,
                tokens: tokens_by_theme.remove(&id).unwrap_or_default(),
                palette: palette_by_theme.remove(&id).unwrap_or_default(),
                seed_tokens: seed_tokens_by_theme.remove(&id).unwrap_or_default(),
                seed_palette: seed_palette_by_theme.remove(&id).unwrap_or_default(),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn theme_insert<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    write: UserThemeWrite,
) -> Result<(), String> {
    validate_theme_write(&write)?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    sqlx::query(
        "INSERT INTO themes
            (id, display_name, icon_label, seed_icon_label, blend_canvas,
             seed_blend_canvas, derivation_engine_version, calendar_default_mode,
             calendar_default_custom, seed_calendar_default_mode,
             seed_calendar_default_custom, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&write.id)
    .bind(&write.display_name)
    .bind(&write.icon_label)
    .bind(&write.seed_icon_label)
    .bind(&write.blend_canvas)
    .bind(&write.seed_blend_canvas)
    .bind(write.derivation_engine_version)
    .bind(&write.calendar_default_mode)
    .bind(&write.calendar_default_custom)
    .bind(&write.seed_calendar_default_mode)
    .bind(&write.seed_calendar_default_custom)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("insert theme: {e}"))?;

    insert_token_rows(
        &mut tx,
        &write.id,
        &write.tokens,
        "INSERT INTO theme_tokens (theme_id, kind, key, value, isolated) VALUES (?, ?, ?, ?, ?)",
    )
    .await?;
    insert_palette_rows(
        &mut tx,
        &write.id,
        &write.palette,
        "INSERT INTO theme_event_palette (theme_id, slot, value) VALUES (?, ?, ?)",
    )
    .await?;
    insert_token_rows(
        &mut tx,
        &write.id,
        &write.seed_tokens,
        "INSERT INTO theme_seed_tokens (theme_id, kind, key, value, isolated) VALUES (?, ?, ?, ?, ?)",
    )
    .await?;
    insert_palette_rows(
        &mut tx,
        &write.id,
        &write.seed_palette,
        "INSERT INTO theme_seed_event_palette (theme_id, slot, value) VALUES (?, ?, ?)",
    )
    .await?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_replace_content<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    write: UserThemeWrite,
) -> Result<(), String> {
    validate_theme_write(&write)?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    let result = sqlx::query(
        "UPDATE themes
            SET display_name = ?,
                icon_label = ?,
                seed_icon_label = ?,
                blend_canvas = ?,
                seed_blend_canvas = ?,
                derivation_engine_version = ?,
                calendar_default_mode = ?,
                calendar_default_custom = ?,
                seed_calendar_default_mode = ?,
                seed_calendar_default_custom = ?,
                updated_at = ?
          WHERE id = ?",
    )
    .bind(&write.display_name)
    .bind(&write.icon_label)
    .bind(&write.seed_icon_label)
    .bind(&write.blend_canvas)
    .bind(&write.seed_blend_canvas)
    .bind(write.derivation_engine_version)
    .bind(&write.calendar_default_mode)
    .bind(&write.calendar_default_custom)
    .bind(&write.seed_calendar_default_mode)
    .bind(&write.seed_calendar_default_custom)
    .bind(now)
    .bind(&write.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update theme: {e}"))?;

    if result.rows_affected() == 0 {
        return Err(format!("theme '{}' not found", write.id));
    }

    delete_theme_children(&mut tx, &write.id).await?;
    insert_token_rows(
        &mut tx,
        &write.id,
        &write.tokens,
        "INSERT INTO theme_tokens (theme_id, kind, key, value, isolated) VALUES (?, ?, ?, ?, ?)",
    )
    .await?;
    insert_palette_rows(
        &mut tx,
        &write.id,
        &write.palette,
        "INSERT INTO theme_event_palette (theme_id, slot, value) VALUES (?, ?, ?)",
    )
    .await?;
    insert_token_rows(
        &mut tx,
        &write.id,
        &write.seed_tokens,
        "INSERT INTO theme_seed_tokens (theme_id, kind, key, value, isolated) VALUES (?, ?, ?, ?, ?)",
    )
    .await?;
    insert_palette_rows(
        &mut tx,
        &write.id,
        &write.seed_palette,
        "INSERT INTO theme_seed_event_palette (theme_id, slot, value) VALUES (?, ?, ?)",
    )
    .await?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_delete<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query("DELETE FROM themes WHERE id = ?")
        .bind(id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("delete theme: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_backfill_icon_label<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    icon_label: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_icon_label(&icon_label, "icon_label")?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query("UPDATE themes SET icon_label = ?, seed_icon_label = ? WHERE id = ?")
        .bind(&icon_label)
        .bind(&icon_label)
        .bind(id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("backfill theme icon label: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_record_dismissal<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    engine_version: i64,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    if engine_version < 0 {
        return Err("engine_version cannot be negative".to_string());
    }
    let dismissed_at = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query(
        "INSERT OR REPLACE INTO theme_upgrade_dismissals
            (theme_id, engine_version, dismissed_at)
         VALUES (?, ?, ?)",
    )
    .bind(id)
    .bind(engine_version)
    .bind(dismissed_at)
    .execute(&mut conn)
    .await
    .map_err(|e| format!("record theme dismissal: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_load_dismissals<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<Vec<DismissalRow>, String> {
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let rows =
        sqlx::query("SELECT theme_id, engine_version, dismissed_at FROM theme_upgrade_dismissals")
            .fetch_all(&mut conn)
            .await
            .map_err(|e| format!("load theme dismissals: {e}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(DismissalRow {
                theme_id: row
                    .try_get("theme_id")
                    .map_err(|e| format!("read dismissal theme_id: {e}"))?,
                engine_version: row
                    .try_get("engine_version")
                    .map_err(|e| format!("read dismissal engine_version: {e}"))?,
                dismissed_at: row
                    .try_get("dismissed_at")
                    .map_err(|e| format!("read dismissal dismissed_at: {e}"))?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn theme_rename<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    display_name: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_display_name(&display_name)?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let result = sqlx::query("UPDATE themes SET display_name = ?, updated_at = ? WHERE id = ?")
        .bind(display_name)
        .bind(now)
        .bind(id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("rename theme: {e}"))?;
    ensure_row_changed(result, "rename theme")
}

#[tauri::command]
pub async fn theme_update_token_value<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    kind: String,
    key: String,
    value: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_token_identity(&kind, &key, "token")?;
    validate_hex_color(&value, "value")?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    let result = sqlx::query(
        "UPDATE theme_tokens SET value = ? WHERE theme_id = ? AND kind = ? AND key = ?",
    )
    .bind(value)
    .bind(&id)
    .bind(kind)
    .bind(key)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update theme token value: {e}"))?;
    ensure_row_changed(result, "update theme token value")?;
    touch_theme(&mut tx, &id, now).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_update_token_isolated<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    kind: String,
    key: String,
    isolated: bool,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_token_identity(&kind, &key, "token")?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    let result = sqlx::query(
        "UPDATE theme_tokens SET isolated = ? WHERE theme_id = ? AND kind = ? AND key = ?",
    )
    .bind(if isolated { 1_i64 } else { 0_i64 })
    .bind(&id)
    .bind(kind)
    .bind(key)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update theme token isolation: {e}"))?;
    ensure_row_changed(result, "update theme token isolation")?;
    touch_theme(&mut tx, &id, now).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_update_token_value_and_isolated<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    kind: String,
    key: String,
    value: String,
    isolated: bool,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_token_identity(&kind, &key, "token")?;
    validate_hex_color(&value, "value")?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    let result = sqlx::query(
        "UPDATE theme_tokens SET value = ?, isolated = ? WHERE theme_id = ? AND kind = ? AND key = ?",
    )
    .bind(value)
    .bind(if isolated { 1_i64 } else { 0_i64 })
    .bind(&id)
    .bind(kind)
    .bind(key)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update theme token value and isolation: {e}"))?;
    ensure_row_changed(result, "update theme token value and isolation")?;
    touch_theme(&mut tx, &id, now).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_update_source_cascade<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    write: ThemeSourceCascadeWrite,
) -> Result<(), String> {
    validate_theme_id(&write.id)?;
    validate_token_identity("source", &write.source_key, "source token")?;
    validate_hex_color(&write.value, "value")?;
    validate_token_value_map(&write.derived_app, "derived_app")?;
    validate_token_value_map(&write.derived_cal, "derived_cal")?;
    if let Some(next) = &write.next_blend_canvas {
        validate_hex_color(next, "next_blend_canvas")?;
    }

    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    let result = sqlx::query(
        "UPDATE theme_tokens SET value = ? WHERE theme_id = ? AND kind = 'source' AND key = ?",
    )
    .bind(write.value)
    .bind(&write.id)
    .bind(write.source_key)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update source token: {e}"))?;
    ensure_row_changed(result, "update source token")?;

    update_non_isolated_token_values(&mut tx, &write.id, "app", &write.derived_app).await?;
    update_non_isolated_token_values(&mut tx, &write.id, "calendar", &write.derived_cal).await?;

    if let Some(next) = write.next_blend_canvas {
        let result = sqlx::query("UPDATE themes SET blend_canvas = ?, updated_at = ? WHERE id = ?")
            .bind(next)
            .bind(now)
            .bind(&write.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("update theme blend canvas: {e}"))?;
        ensure_row_changed(result, "update theme blend canvas")?;
    } else {
        touch_theme(&mut tx, &write.id, now).await?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_update_palette_slot<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    slot: i64,
    value: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_palette_slot(slot, "slot")?;
    validate_hex_color(&value, "value")?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    let result =
        sqlx::query("UPDATE theme_event_palette SET value = ? WHERE theme_id = ? AND slot = ?")
            .bind(value)
            .bind(&id)
            .bind(slot)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("update theme palette slot: {e}"))?;
    ensure_row_changed(result, "update theme palette slot")?;
    touch_theme(&mut tx, &id, now).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_update_blend_canvas<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    value: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_hex_color(&value, "value")?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let result = sqlx::query("UPDATE themes SET blend_canvas = ?, updated_at = ? WHERE id = ?")
        .bind(value)
        .bind(now)
        .bind(id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("update theme blend canvas: {e}"))?;
    ensure_row_changed(result, "update theme blend canvas")
}

#[tauri::command]
pub async fn theme_rebake_non_isolated<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    derived_app: HashMap<String, String>,
    derived_cal: HashMap<String, String>,
    new_engine_version: i64,
    next_blend_canvas: Option<String>,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_token_value_map(&derived_app, "derived_app")?;
    validate_token_value_map(&derived_cal, "derived_cal")?;
    if new_engine_version < 0 {
        return Err("new_engine_version cannot be negative".to_string());
    }
    if let Some(next) = &next_blend_canvas {
        validate_hex_color(next, "next_blend_canvas")?;
    }

    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    update_non_isolated_token_values(&mut tx, &id, "app", &derived_app).await?;
    update_non_isolated_token_values(&mut tx, &id, "calendar", &derived_cal).await?;

    let result = if let Some(next) = next_blend_canvas {
        sqlx::query(
            "UPDATE themes
                SET blend_canvas = ?, derivation_engine_version = ?, updated_at = ?
              WHERE id = ?",
        )
        .bind(next)
        .bind(new_engine_version)
        .bind(now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("rebake theme: {e}"))?
    } else {
        sqlx::query(
            "UPDATE themes
                SET derivation_engine_version = ?, updated_at = ?
              WHERE id = ?",
        )
        .bind(new_engine_version)
        .bind(now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("rebake theme: {e}"))?
    };
    ensure_row_changed(result, "rebake theme")?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_reset_token_to_seed<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    kind: String,
    key: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_token_identity(&kind, &key, "token")?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    let result = sqlx::query(
        "UPDATE theme_tokens AS t
            SET value = (
                    SELECT value FROM theme_seed_tokens AS s
                    WHERE s.theme_id = t.theme_id AND s.kind = t.kind AND s.key = t.key
                ),
                isolated = (
                    SELECT isolated FROM theme_seed_tokens AS s
                    WHERE s.theme_id = t.theme_id AND s.kind = t.kind AND s.key = t.key
                )
          WHERE t.theme_id = ? AND t.kind = ? AND t.key = ?",
    )
    .bind(&id)
    .bind(kind)
    .bind(key)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("reset theme token to seed: {e}"))?;
    ensure_row_changed(result, "reset theme token to seed")?;
    touch_theme(&mut tx, &id, now).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_reset_palette_slot_to_seed<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    slot: i64,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    validate_palette_slot(slot, "slot")?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    let result = sqlx::query(
        "UPDATE theme_event_palette AS p
            SET value = (
                SELECT value FROM theme_seed_event_palette AS s
                WHERE s.theme_id = p.theme_id AND s.slot = p.slot
            )
          WHERE p.theme_id = ? AND p.slot = ?",
    )
    .bind(&id)
    .bind(slot)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("reset theme palette slot to seed: {e}"))?;
    ensure_row_changed(result, "reset theme palette slot to seed")?;
    touch_theme(&mut tx, &id, now).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_reset_to_seed<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<(), String> {
    validate_theme_id(&id)?;
    let now = now_ms()?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    sqlx::query(
        "UPDATE theme_tokens AS t
            SET value = (
                    SELECT value FROM theme_seed_tokens AS s
                    WHERE s.theme_id = t.theme_id AND s.kind = t.kind AND s.key = t.key
                ),
                isolated = (
                    SELECT isolated FROM theme_seed_tokens AS s
                    WHERE s.theme_id = t.theme_id AND s.kind = t.kind AND s.key = t.key
                )
          WHERE t.theme_id = ?",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("reset theme tokens to seed: {e}"))?;

    sqlx::query(
        "UPDATE theme_event_palette AS p
            SET value = (
                SELECT value FROM theme_seed_event_palette AS s
                WHERE s.theme_id = p.theme_id AND s.slot = p.slot
            )
          WHERE p.theme_id = ?",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("reset theme palette to seed: {e}"))?;

    let result = sqlx::query(
        "UPDATE themes
            SET blend_canvas = seed_blend_canvas,
                calendar_default_mode = seed_calendar_default_mode,
                calendar_default_custom = seed_calendar_default_custom,
                updated_at = ?
          WHERE id = ?",
    )
    .bind(now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("reset theme to seed: {e}"))?;
    ensure_row_changed(result, "reset theme to seed")?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

async fn delete_theme_children(
    tx: &mut Transaction<'_, Sqlite>,
    theme_id: &str,
) -> Result<(), String> {
    for query in [
        "DELETE FROM theme_tokens WHERE theme_id = ?",
        "DELETE FROM theme_event_palette WHERE theme_id = ?",
        "DELETE FROM theme_seed_tokens WHERE theme_id = ?",
        "DELETE FROM theme_seed_event_palette WHERE theme_id = ?",
    ] {
        sqlx::query(query)
            .bind(theme_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("delete theme children: {e}"))?;
    }
    Ok(())
}

async fn insert_token_rows(
    tx: &mut Transaction<'_, Sqlite>,
    theme_id: &str,
    rows: &[ThemeTokenWrite],
    query: &'static str,
) -> Result<(), String> {
    for row in rows {
        sqlx::query(query)
            .bind(theme_id)
            .bind(&row.kind)
            .bind(&row.key)
            .bind(&row.value)
            .bind(if row.isolated { 1_i64 } else { 0_i64 })
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert theme token '{}:{}': {e}", row.kind, row.key))?;
    }
    Ok(())
}

async fn insert_palette_rows(
    tx: &mut Transaction<'_, Sqlite>,
    theme_id: &str,
    rows: &[ThemePaletteWrite],
    query: &'static str,
) -> Result<(), String> {
    for row in rows {
        sqlx::query(query)
            .bind(theme_id)
            .bind(row.slot)
            .bind(&row.value)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert theme palette slot {}: {e}", row.slot))?;
    }
    Ok(())
}

async fn touch_theme(
    tx: &mut Transaction<'_, Sqlite>,
    theme_id: &str,
    now: i64,
) -> Result<(), String> {
    let result = sqlx::query("UPDATE themes SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(theme_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("touch theme: {e}"))?;
    ensure_row_changed(result, "touch theme")
}

async fn update_non_isolated_token_values(
    tx: &mut Transaction<'_, Sqlite>,
    theme_id: &str,
    kind: &str,
    values: &HashMap<String, String>,
) -> Result<(), String> {
    for (key, value) in values {
        sqlx::query(
            "UPDATE theme_tokens
                SET value = ?
              WHERE theme_id = ? AND kind = ? AND key = ? AND isolated = 0",
        )
        .bind(value)
        .bind(theme_id)
        .bind(kind)
        .bind(key)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("update non-isolated theme token '{kind}:{key}': {e}"))?;
    }
    Ok(())
}

fn ensure_row_changed(result: SqliteQueryResult, context: &str) -> Result<(), String> {
    if result.rows_affected() == 0 {
        Err(format!("{context}: no matching row"))
    } else {
        Ok(())
    }
}

fn group_by_theme<T: ThemeScoped>(rows: Vec<T>) -> HashMap<String, Vec<T>> {
    let mut grouped = HashMap::new();
    for row in rows {
        grouped
            .entry(row.theme_id().to_string())
            .or_insert_with(Vec::new)
            .push(row);
    }
    grouped
}

fn validate_theme_rows(
    themes: &[ThemeRowRead],
    tokens: &[TokenRowRead],
    palette: &[PaletteRowRead],
    seed_tokens: &[TokenRowRead],
    seed_palette: &[PaletteRowRead],
) -> Result<(), String> {
    for theme in themes {
        validate_theme_read(theme)?;
    }
    validate_token_read_rows(tokens, "theme_tokens")?;
    validate_palette_read_rows(palette, "theme_event_palette")?;
    validate_token_read_rows(seed_tokens, "theme_seed_tokens")?;
    validate_palette_read_rows(seed_palette, "theme_seed_event_palette")
}

fn validate_theme_read(theme: &ThemeRowRead) -> Result<(), String> {
    validate_theme_id(&theme.id)?;
    validate_display_name(&theme.display_name)?;
    validate_hex_color(&theme.blend_canvas, "blend_canvas")?;
    validate_hex_color(&theme.seed_blend_canvas, "seed_blend_canvas")?;
    if theme.derivation_engine_version < 0 {
        return Err("derivation_engine_version cannot be negative".to_string());
    }
    validate_calendar_mode(&theme.calendar_default_mode, "calendar_default_mode")?;
    validate_calendar_mode(
        &theme.seed_calendar_default_mode,
        "seed_calendar_default_mode",
    )?;
    validate_hex_color(&theme.calendar_default_custom, "calendar_default_custom")?;
    validate_hex_color(
        &theme.seed_calendar_default_custom,
        "seed_calendar_default_custom",
    )?;
    validate_optional_icon_label(&theme.icon_label, "icon_label")?;
    validate_optional_icon_label(&theme.seed_icon_label, "seed_icon_label")
}

fn validate_token_read_rows(rows: &[TokenRowRead], field: &str) -> Result<(), String> {
    for row in rows {
        validate_theme_id(&row.theme_id)?;
        validate_token_identity(&row.kind, &row.key, field)?;
        validate_hex_color(&row.value, field)?;
        if !matches!(row.isolated, 0 | 1) {
            return Err(format!("{field} isolated must be 0 or 1"));
        }
    }
    Ok(())
}

fn validate_palette_read_rows(rows: &[PaletteRowRead], field: &str) -> Result<(), String> {
    for row in rows {
        validate_theme_id(&row.theme_id)?;
        validate_palette_slot(row.slot, field)?;
        validate_hex_color(&row.value, field)?;
    }
    Ok(())
}

fn validate_theme_write(write: &UserThemeWrite) -> Result<(), String> {
    validate_theme_id(&write.id)?;
    validate_display_name(&write.display_name)?;
    validate_icon_label(&write.icon_label, "icon_label")?;
    validate_icon_label(&write.seed_icon_label, "seed_icon_label")?;
    validate_hex_color(&write.blend_canvas, "blend_canvas")?;
    validate_hex_color(&write.seed_blend_canvas, "seed_blend_canvas")?;
    validate_calendar_mode(&write.calendar_default_mode, "calendar_default_mode")?;
    validate_calendar_mode(
        &write.seed_calendar_default_mode,
        "seed_calendar_default_mode",
    )?;
    validate_hex_color(&write.calendar_default_custom, "calendar_default_custom")?;
    validate_hex_color(
        &write.seed_calendar_default_custom,
        "seed_calendar_default_custom",
    )?;
    if write.derivation_engine_version < 0 {
        return Err("derivation_engine_version cannot be negative".to_string());
    }
    validate_token_rows(&write.tokens, "tokens")?;
    validate_palette_rows(&write.palette, "palette")?;
    validate_token_rows(&write.seed_tokens, "seed_tokens")?;
    validate_palette_rows(&write.seed_palette, "seed_palette")?;
    Ok(())
}

fn validate_display_name(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("display_name cannot be empty".to_string());
    }
    if value.chars().count() > MAX_DISPLAY_NAME_LENGTH {
        return Err(format!(
            "display_name cannot exceed {MAX_DISPLAY_NAME_LENGTH} characters"
        ));
    }
    Ok(())
}

fn validate_theme_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("theme id cannot be empty".to_string());
    }
    if matches!(id, "light" | "dark") {
        return Err(format!("theme id '{id}' is reserved"));
    }
    Ok(())
}

fn validate_token_identity(kind: &str, key: &str, field: &str) -> Result<(), String> {
    if !matches!(kind, "source" | "app" | "calendar") {
        return Err(format!("{field} contains invalid token kind '{kind}'"));
    }
    if key.trim().is_empty() {
        return Err(format!("{field} contains an empty token key"));
    }
    Ok(())
}

fn validate_icon_label(value: &str, field: &str) -> Result<(), String> {
    if matches!(value, "light" | "dark") {
        Ok(())
    } else {
        Err(format!("{field} must be 'light' or 'dark'"))
    }
}

fn validate_optional_icon_label(value: &Option<String>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        validate_icon_label(value, field)?;
    }
    Ok(())
}

fn validate_calendar_mode(value: &str, field: &str) -> Result<(), String> {
    if matches!(value, "light" | "dark" | "app-canvas" | "custom") {
        Ok(())
    } else {
        Err(format!(
            "{field} must be 'light', 'dark', 'app-canvas', or 'custom'"
        ))
    }
}

fn validate_token_rows(rows: &[ThemeTokenWrite], field: &str) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(rows.len());
    for row in rows {
        if !matches!(row.kind.as_str(), "source" | "app" | "calendar") {
            return Err(format!(
                "{field} contains invalid token kind '{}'",
                row.kind
            ));
        }
        if row.key.trim().is_empty() {
            return Err(format!("{field} contains an empty token key"));
        }
        validate_hex_color(&row.value, field)?;
        if !seen.insert((row.kind.as_str(), row.key.as_str())) {
            return Err(format!(
                "{field} contains duplicate token '{}:{}'",
                row.kind, row.key
            ));
        }
    }
    Ok(())
}

fn validate_palette_rows(rows: &[ThemePaletteWrite], field: &str) -> Result<(), String> {
    if rows.len() != PALETTE_SIZE {
        return Err(format!(
            "{field} must contain exactly {PALETTE_SIZE} entries"
        ));
    }
    let mut seen = HashSet::with_capacity(rows.len());
    for row in rows {
        validate_palette_slot(row.slot, field)?;
        validate_hex_color(&row.value, field)?;
        if !seen.insert(row.slot) {
            return Err(format!("{field} contains duplicate slot {}", row.slot));
        }
    }
    Ok(())
}

fn validate_palette_slot(slot: i64, field: &str) -> Result<(), String> {
    if slot < 0 || slot >= PALETTE_SIZE as i64 {
        return Err(format!("{field} contains invalid slot {slot}"));
    }
    Ok(())
}

fn validate_token_value_map(values: &HashMap<String, String>, field: &str) -> Result<(), String> {
    for (key, value) in values {
        if key.trim().is_empty() {
            return Err(format!("{field} contains an empty token key"));
        }
        validate_hex_color(value, field)?;
    }
    Ok(())
}

fn validate_hex_color(value: &str, field: &str) -> Result<(), String> {
    if is_hex_color(value) {
        Ok(())
    } else {
        Err(format!("{field} must be a 6 or 8 digit hex color"))
    }
}

fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.first() != Some(&b'#') {
        return false;
    }
    if bytes.len() != 7 && bytes.len() != 9 {
        return false;
    }
    bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

fn now_ms() -> Result<i64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system clock before unix epoch: {e}"))?;
    Ok(duration.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::{
        is_hex_color, validate_display_name, validate_palette_rows, validate_theme_id,
        validate_token_identity, validate_token_value_map, ThemePaletteWrite, PALETTE_SIZE,
    };
    use std::collections::HashMap;

    #[test]
    fn accepts_six_and_eight_digit_hex_colors() {
        assert!(is_hex_color("#123abc"));
        assert!(is_hex_color("#123abcff"));
        assert!(is_hex_color("#ABCDEF"));
    }

    #[test]
    fn rejects_non_hex_colors() {
        assert!(!is_hex_color("123abc"));
        assert!(!is_hex_color("#123abz"));
        assert!(!is_hex_color("#12345"));
        assert!(!is_hex_color("#1234567890"));
    }

    #[test]
    fn rejects_reserved_theme_ids() {
        assert!(validate_theme_id("custom").is_ok());
        assert!(validate_theme_id("light").is_err());
        assert!(validate_theme_id("dark").is_err());
        assert!(validate_theme_id("").is_err());
    }

    #[test]
    fn rejects_duplicate_palette_slots() {
        let mut rows: Vec<ThemePaletteWrite> = (0..PALETTE_SIZE)
            .map(|slot| ThemePaletteWrite {
                slot: slot as i64,
                value: "#123456".to_string(),
            })
            .collect();
        rows[1].slot = rows[0].slot;
        assert!(validate_palette_rows(&rows, "palette").is_err());
    }

    #[test]
    fn validates_theme_display_names() {
        assert!(validate_display_name("Custom").is_ok());
        assert!(validate_display_name(" ").is_err());
        assert!(validate_display_name(&"x".repeat(61)).is_err());
    }

    #[test]
    fn validates_token_identity() {
        assert!(validate_token_identity("source", "canvas", "token").is_ok());
        assert!(validate_token_identity("app", "--background", "token").is_ok());
        assert!(validate_token_identity("invalid", "canvas", "token").is_err());
        assert!(validate_token_identity("source", " ", "token").is_err());
    }

    #[test]
    fn validates_token_value_maps() {
        let mut values = HashMap::new();
        values.insert("--background".to_string(), "#123456".to_string());
        assert!(validate_token_value_map(&values, "derived_app").is_ok());

        values.insert("--foreground".to_string(), "red".to_string());
        assert!(validate_token_value_map(&values, "derived_app").is_err());
    }
}

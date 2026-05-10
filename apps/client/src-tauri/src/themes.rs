use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use sqlx::{Connection, Sqlite, Transaction};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

const PALETTE_SIZE: usize = 24;

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

fn validate_theme_write(write: &UserThemeWrite) -> Result<(), String> {
    validate_theme_id(&write.id)?;
    if write.display_name.trim().is_empty() {
        return Err("display_name cannot be empty".to_string());
    }
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

fn validate_theme_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("theme id cannot be empty".to_string());
    }
    if matches!(id, "light" | "dark") {
        return Err(format!("theme id '{id}' is reserved"));
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
        if row.slot < 0 || row.slot >= PALETTE_SIZE as i64 {
            return Err(format!("{field} contains invalid slot {}", row.slot));
        }
        validate_hex_color(&row.value, field)?;
        if !seen.insert(row.slot) {
            return Err(format!("{field} contains duplicate slot {}", row.slot));
        }
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
        is_hex_color, validate_palette_rows, validate_theme_id, ThemePaletteWrite, PALETTE_SIZE,
    };

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
}

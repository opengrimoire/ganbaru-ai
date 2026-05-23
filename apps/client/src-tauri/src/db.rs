use std::collections::HashSet;

use sqlx::{Row, SqlitePool};

#[derive(Debug)]
pub struct Migration {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS ganbaruai_schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            installed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("create migration table: {e}"))?;

    import_legacy_sqlx_migrations(pool).await?;
    let mut applied = load_applied_migration_versions(pool).await?;
    for migration in migrations() {
        if applied.contains(&migration.version) {
            continue;
        }
        let version = migration.version;
        apply_migration(pool, migration).await?;
        applied.insert(version);
    }
    Ok(())
}

async fn import_legacy_sqlx_migrations(pool: &SqlitePool) -> Result<(), String> {
    let has_legacy_table = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("check legacy migration table: {e}"))?
    .is_some();

    if !has_legacy_table {
        return Ok(());
    }

    let rows = sqlx::query(
        "SELECT version, description FROM _sqlx_migrations WHERE success = 1 ORDER BY version",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load legacy migrations: {e}"))?;

    for row in rows {
        let version: i64 = row
            .try_get("version")
            .map_err(|e| format!("read legacy migration version: {e}"))?;
        let description: String = row
            .try_get("description")
            .map_err(|e| format!("read legacy migration description: {e}"))?;
        sqlx::query(
            "INSERT OR IGNORE INTO ganbaruai_schema_migrations (version, description)
             VALUES (?, ?)",
        )
        .bind(version)
        .bind(description)
        .execute(pool)
        .await
        .map_err(|e| format!("record legacy migration {version}: {e}"))?;
    }
    Ok(())
}

async fn load_applied_migration_versions(pool: &SqlitePool) -> Result<HashSet<i64>, String> {
    let rows = sqlx::query("SELECT version FROM ganbaruai_schema_migrations")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load migrations: {e}"))?;
    let mut versions = HashSet::with_capacity(rows.len());
    for row in rows {
        let version: i64 = row
            .try_get("version")
            .map_err(|e| format!("read migration version: {e}"))?;
        versions.insert(version);
    }
    Ok(versions)
}

async fn migration_version_exists(pool: &SqlitePool, version: i64) -> Result<bool, String> {
    let exists =
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM ganbaruai_schema_migrations WHERE version = ?")
            .bind(version)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("check migration {version}: {e}"))?
            .is_some();
    Ok(exists)
}

async fn apply_migration(pool: &SqlitePool, migration: Migration) -> Result<(), String> {
    if migration.version == 11 {
        return apply_theme_calendar_default_migration(pool, migration).await;
    }

    let version = migration.version;
    let description = migration.description;
    let sql = migration.sql;

    sqlx::raw_sql("BEGIN IMMEDIATE")
        .execute(pool)
        .await
        .map_err(|e| format!("begin migration {version}: {e}"))?;

    // A second pool can reach this point after `run_migrations` loaded the
    // applied set but before this transaction acquired the SQLite write
    // lock. Recheck under the lock so concurrent DB initialization does not
    // re-run or re-record an already applied migration.
    match migration_version_exists(pool, version).await {
        Ok(true) => {
            sqlx::raw_sql("COMMIT")
                .execute(pool)
                .await
                .map_err(|e| format!("commit migration {version}: {e}"))?;
            return Ok(());
        }
        Ok(false) => {}
        Err(err) => {
            let _ = sqlx::raw_sql("ROLLBACK").execute(pool).await;
            return Err(err);
        }
    }

    if let Err(err) = sqlx::raw_sql(sql).execute(pool).await {
        let _ = sqlx::raw_sql("ROLLBACK").execute(pool).await;
        return Err(format!("run migration {version} {description}: {err}"));
    }

    if let Err(err) = sqlx::query(
        "INSERT INTO ganbaruai_schema_migrations (version, description)
         VALUES (?, ?)",
    )
    .bind(version)
    .bind(description)
    .execute(pool)
    .await
    {
        let _ = sqlx::raw_sql("ROLLBACK").execute(pool).await;
        return Err(format!("record migration {version}: {err}"));
    }

    sqlx::raw_sql("COMMIT")
        .execute(pool)
        .await
        .map_err(|e| format!("commit migration {version}: {e}"))?;
    Ok(())
}

async fn theme_column_exists(pool: &SqlitePool, column: &str) -> Result<bool, String> {
    let rows = sqlx::query("PRAGMA table_info(themes)")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("inspect themes columns: {e}"))?;

    for row in rows {
        let name: String = row
            .try_get("name")
            .map_err(|e| format!("read themes column name: {e}"))?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn add_theme_column_if_missing(
    pool: &SqlitePool,
    column: &str,
    sql: &str,
) -> Result<(), String> {
    if theme_column_exists(pool, column).await? {
        return Ok(());
    }
    sqlx::raw_sql(sql)
        .execute(pool)
        .await
        .map_err(|e| format!("add themes.{column}: {e}"))?;
    Ok(())
}

async fn apply_theme_calendar_default_migration(
    pool: &SqlitePool,
    migration: Migration,
) -> Result<(), String> {
    let version = migration.version;
    let description = migration.description;

    sqlx::raw_sql("BEGIN IMMEDIATE")
        .execute(pool)
        .await
        .map_err(|e| format!("begin migration {version}: {e}"))?;

    match migration_version_exists(pool, version).await {
        Ok(true) => {
            sqlx::raw_sql("COMMIT")
                .execute(pool)
                .await
                .map_err(|e| format!("commit migration {version}: {e}"))?;
            return Ok(());
        }
        Ok(false) => {}
        Err(err) => {
            let _ = sqlx::raw_sql("ROLLBACK").execute(pool).await;
            return Err(err);
        }
    }

    let result = async {
        add_theme_column_if_missing(
            pool,
            "calendar_default_mode",
            "ALTER TABLE themes
                ADD COLUMN calendar_default_mode TEXT NOT NULL DEFAULT 'app-canvas'
                CHECK (calendar_default_mode IN ('light', 'dark', 'app-canvas', 'custom'))",
        )
        .await?;
        add_theme_column_if_missing(
            pool,
            "calendar_default_custom",
            "ALTER TABLE themes
                ADD COLUMN calendar_default_custom TEXT NOT NULL DEFAULT '#27282A'",
        )
        .await?;
        add_theme_column_if_missing(
            pool,
            "seed_calendar_default_mode",
            "ALTER TABLE themes
                ADD COLUMN seed_calendar_default_mode TEXT NOT NULL DEFAULT 'app-canvas'
                CHECK (seed_calendar_default_mode IN ('light', 'dark', 'app-canvas', 'custom'))",
        )
        .await?;
        add_theme_column_if_missing(
            pool,
            "seed_calendar_default_custom",
            "ALTER TABLE themes
                ADD COLUMN seed_calendar_default_custom TEXT NOT NULL DEFAULT '#27282A'",
        )
        .await?;

        sqlx::raw_sql(migration.sql)
            .execute(pool)
            .await
            .map_err(|e| format!("run migration {version} {description}: {e}"))?;

        sqlx::query(
            "INSERT INTO ganbaruai_schema_migrations (version, description)
             VALUES (?, ?)",
        )
        .bind(version)
        .bind(description)
        .execute(pool)
        .await
        .map_err(|e| format!("record migration {version}: {e}"))?;

        Ok::<(), String>(())
    }
    .await;

    if let Err(err) = result {
        let _ = sqlx::raw_sql("ROLLBACK").execute(pool).await;
        return Err(err);
    }

    sqlx::raw_sql("COMMIT")
        .execute(pool)
        .await
        .map_err(|e| format!("commit migration {version}: {e}"))?;
    Ok(())
}

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema",
        sql: "
            -- calendars
            CREATE TABLE IF NOT EXISTS calendars (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'local',
                visible INTEGER NOT NULL DEFAULT 1,
                read_only INTEGER NOT NULL DEFAULT 0,
                source_url TEXT,
                last_synced TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO calendars (id, name, color, source)
                VALUES ('local', 'GanbaruAI', '', 'local');

            -- calendar events
            CREATE TABLE IF NOT EXISTS calendar_events (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                timezone TEXT NOT NULL DEFAULT '',
                calendar_id TEXT NOT NULL DEFAULT 'local',
                color TEXT,
                description TEXT NOT NULL DEFAULT '',
                rrule TEXT,
                repeat_until TEXT,
                environment_id TEXT,
                playlist_id TEXT,
                all_day INTEGER NOT NULL DEFAULT 0,
                location TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                transparency TEXT NOT NULL DEFAULT 'opaque',
                status TEXT NOT NULL DEFAULT 'confirmed',
                source_uid TEXT,
                visibility TEXT NOT NULL DEFAULT 'public',
                priority INTEGER,
                geo_lat REAL,
                geo_lng REAL,
                sequence INTEGER NOT NULL DEFAULT 0,
                guest_can_modify INTEGER NOT NULL DEFAULT 0,
                guest_can_invite_others INTEGER NOT NULL DEFAULT 1,
                guest_can_see_other_guests INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_calendar_events_start
                ON calendar_events(start_time);
            CREATE INDEX IF NOT EXISTS idx_calendar_events_end
                ON calendar_events(end_time);
            CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar
                ON calendar_events(calendar_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_source_uid
                ON calendar_events(calendar_id, source_uid);

            -- per-instance overrides for recurring events
            CREATE TABLE IF NOT EXISTS calendar_event_overrides (
                id TEXT PRIMARY KEY,
                parent_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                recurrence_id TEXT NOT NULL,
                title TEXT,
                start_time TEXT,
                end_time TEXT,
                description TEXT,
                location TEXT,
                url TEXT,
                color TEXT,
                status TEXT,
                transparency TEXT,
                visibility TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_overrides_parent_recid
                ON calendar_event_overrides(parent_event_id, recurrence_id);

            -- attendees
            CREATE TABLE IF NOT EXISTS calendar_event_attendees (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                name TEXT,
                email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'req-participant',
                status TEXT NOT NULL DEFAULT 'needs-action',
                rsvp INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_attendees_event
                ON calendar_event_attendees(event_id);

            -- alarms
            CREATE TABLE IF NOT EXISTS calendar_event_alarms (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                action TEXT NOT NULL DEFAULT 'display',
                trigger_type TEXT NOT NULL DEFAULT 'relative',
                trigger_value TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_alarms_event
                ON calendar_event_alarms(event_id);

            CREATE TABLE IF NOT EXISTS calendar_event_notifications (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                offset_minutes INTEGER NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_event_notifications_event
                ON calendar_event_notifications(event_id, sort_order);

            CREATE TABLE IF NOT EXISTS calendar_event_exdates (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                occurrence_date TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_event_exdates_event_date
                ON calendar_event_exdates(event_id, occurrence_date);

            CREATE TABLE IF NOT EXISTS calendar_event_rdates (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                occurrence_start TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_event_rdates_event_start
                ON calendar_event_rdates(event_id, occurrence_start);

            CREATE TABLE IF NOT EXISTS calendar_event_categories (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                category TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_event_categories_event
                ON calendar_event_categories(event_id, sort_order);

            CREATE TABLE IF NOT EXISTS calendar_event_extended_properties (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                property_key TEXT NOT NULL,
                property_value TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_event_extended_properties_key
                ON calendar_event_extended_properties(event_id, property_key);

            CREATE TABLE IF NOT EXISTS calendar_event_override_extended_properties (
                id TEXT PRIMARY KEY,
                override_id TEXT NOT NULL REFERENCES calendar_event_overrides(id) ON DELETE CASCADE,
                property_key TEXT NOT NULL,
                property_value TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_override_extended_properties_key
                ON calendar_event_override_extended_properties(override_id, property_key);

            CREATE TABLE IF NOT EXISTS calendar_event_organizers (
                event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
                name TEXT,
                email TEXT NOT NULL
            );

            -- pomodoro config per event
            CREATE TABLE IF NOT EXISTS pomodoro_configs (
                event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
                focus_duration_minutes INTEGER NOT NULL DEFAULT 40,
                short_break_minutes INTEGER NOT NULL DEFAULT 5,
                long_break_minutes INTEGER NOT NULL DEFAULT 10,
                pomodoro_count INTEGER NOT NULL DEFAULT 4,
                idle_timeout_minutes INTEGER
            );

            CREATE TABLE IF NOT EXISTS pomodoro_runs (
                id TEXT PRIMARY KEY,
                event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
                original_event_id TEXT NOT NULL,
                event_date TEXT NOT NULL,
                planned_start TEXT NOT NULL,
                planned_end TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                end_reason TEXT
                    CHECK(end_reason IS NULL OR end_reason IN
                        ('completed', 'stopped', 'interrupted', 'reconfigured', 'block_transition')),
                focus_duration_minutes INTEGER NOT NULL,
                short_break_minutes INTEGER NOT NULL,
                long_break_minutes INTEGER NOT NULL,
                pomodoro_count INTEGER NOT NULL,
                idle_timeout_minutes INTEGER,
                last_heartbeat TEXT NOT NULL,
                event_title_snapshot TEXT,
                inherited_focus_minutes INTEGER NOT NULL DEFAULT 0,
                inherited_cycle INTEGER NOT NULL DEFAULT 1,
                inherited_from_run_id TEXT REFERENCES pomodoro_runs(id) ON DELETE SET NULL,
                start_trigger TEXT NOT NULL DEFAULT 'manual'
                    CHECK(start_trigger IN ('manual', 'block_auto', 'block_transition', 'reconfigure', 'crash_recovery')),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pomodoro_runs_event_date
                ON pomodoro_runs(event_id, event_date);
            CREATE INDEX IF NOT EXISTS idx_pomodoro_runs_original_event
                ON pomodoro_runs(original_event_id);
            CREATE INDEX IF NOT EXISTS idx_pomodoro_runs_open
                ON pomodoro_runs(ended_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pomodoro_runs_single_open
                ON pomodoro_runs((1))
                WHERE ended_at IS NULL;

            -- pomodoro segment tracking
            CREATE TABLE IF NOT EXISTS pomodoro_segments (
                id TEXT PRIMARY KEY,
                event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
                event_date TEXT NOT NULL,
                run_id TEXT NOT NULL REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
                cycle_number INTEGER NOT NULL,
                phase TEXT NOT NULL CHECK(phase IN ('focus', 'short_break', 'long_break')),
                planned_start TEXT NOT NULL,
                planned_end TEXT NOT NULL,
                actual_start TEXT NOT NULL,
                actual_end TEXT,
                status TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active', 'completed', 'interrupted')),
                end_reason TEXT
                    CHECK(end_reason IS NULL OR end_reason IN
                        ('completed', 'stopped', 'skipped_by_user', 'event_expired', 'reconfigured', 'block_transition', 'crash_recovery')),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pomodoro_segments_event
                ON pomodoro_segments(event_id, event_date);
            CREATE INDEX IF NOT EXISTS idx_pomodoro_segments_run
                ON pomodoro_segments(run_id);
            CREATE INDEX IF NOT EXISTS idx_pomodoro_segments_run_actual
                ON pomodoro_segments(run_id, actual_start);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pomodoro_segments_single_active
                ON pomodoro_segments((1))
                WHERE status = 'active';

            CREATE TABLE IF NOT EXISTS pomodoro_pauses (
                id TEXT PRIMARY KEY,
                segment_id TEXT NOT NULL REFERENCES pomodoro_segments(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                reason TEXT NOT NULL CHECK(reason IN ('idle', 'manual', 'suspend')),
                detected_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pomodoro_pauses_segment
                ON pomodoro_pauses(segment_id, started_at);
            CREATE INDEX IF NOT EXISTS idx_pomodoro_pauses_reason
                ON pomodoro_pauses(reason, started_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pomodoro_pauses_single_open_per_segment
                ON pomodoro_pauses(segment_id)
                WHERE ended_at IS NULL;

            CREATE TABLE IF NOT EXISTS pomodoro_run_events (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
                segment_id TEXT REFERENCES pomodoro_segments(id) ON DELETE SET NULL,
                event_type TEXT NOT NULL CHECK(event_type IN (
                    'start', 'phase_start', 'phase_complete', 'pause_start', 'pause_end',
                    'idle_detected', 'suspend_detected', 'skip_break', 'extend_focus',
                    'reconfigure', 'block_transition', 'stop', 'complete', 'crash_recovery'
                )),
                occurred_at TEXT NOT NULL,
                phase TEXT CHECK(phase IS NULL OR phase IN ('focus', 'short_break', 'long_break')),
                reason TEXT,
                duration_seconds INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pomodoro_run_events_run
                ON pomodoro_run_events(run_id, occurred_at);
        ",
    },
    Migration {
        version: 3,
        description: "convert event color column from text slot names to integer slot indices",
        // SQLite ALTER cannot retype a column; drop and re-add. Existing
        // string values are dropped (treated as undefined; events render
        // with the fallback slot) since this is a single-user dev DB
        // and the new shape is incompatible with the old.
        sql: "
            ALTER TABLE calendar_events DROP COLUMN color;
            ALTER TABLE calendar_events ADD COLUMN color INTEGER;
            ALTER TABLE calendar_event_overrides DROP COLUMN color;
            ALTER TABLE calendar_event_overrides ADD COLUMN color INTEGER;
        ",
    },
    Migration {
        version: 4,
        description: "user-theme storage (themes, tokens, palette, seeds, dismissals)",
        // User themes move out of vault/config.json into normalized SQLite
        // rows. Built-in light/dark stay code-pinned and are forbidden
        // from this table by the CHECK on themes.id. The "snapshot" model
        // stores every resolved token as its own row: derivation runs at
        // write time, never at read time, so saved themes are stable
        // across derivation-engine changes. The seed_* tables mirror the
        // live tables at clone time and feed per-row reset / "Reset all".
        sql: "
            PRAGMA foreign_keys=ON;

            CREATE TABLE IF NOT EXISTS themes (
                id TEXT PRIMARY KEY CHECK (id NOT IN ('light', 'dark')),
                display_name TEXT NOT NULL,
                base TEXT NOT NULL CHECK (base IN ('light', 'dark')),
                blend_canvas TEXT NOT NULL,
                seed_blend_canvas TEXT NOT NULL,
                derivation_engine_version INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS theme_tokens (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('source', 'app', 'calendar')),
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                isolated INTEGER NOT NULL DEFAULT 0 CHECK (isolated IN (0, 1)),
                PRIMARY KEY (theme_id, kind, key)
            );
            CREATE INDEX IF NOT EXISTS idx_theme_tokens_kind
                ON theme_tokens(theme_id, kind);

            CREATE TABLE IF NOT EXISTS theme_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );

            CREATE TABLE IF NOT EXISTS theme_seed_tokens (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('source', 'app', 'calendar')),
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                isolated INTEGER NOT NULL DEFAULT 0 CHECK (isolated IN (0, 1)),
                PRIMARY KEY (theme_id, kind, key)
            );
            CREATE INDEX IF NOT EXISTS idx_theme_seed_tokens_kind
                ON theme_seed_tokens(theme_id, kind);

            CREATE TABLE IF NOT EXISTS theme_seed_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );

            CREATE TABLE IF NOT EXISTS theme_upgrade_dismissals (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                engine_version INTEGER NOT NULL,
                dismissed_at INTEGER NOT NULL,
                PRIMARY KEY (theme_id, engine_version)
            );
        ",
    },
    Migration {
        version: 5,
        description: "add scheme columns to themes (decorative day/night tag)",
        // SQLite ALTER TABLE cannot add a NOT NULL column with a CHECK
        // constraint to an existing table with rows, so the columns are
        // nullable here. The frontend hydrate path backfills NULLs from
        // canvas luminance on first read and writes them back, then every
        // future write goes through the typed bridge which always supplies
        // a 'light' or 'dark' value.
        sql: "
            ALTER TABLE themes ADD COLUMN scheme TEXT;
            ALTER TABLE themes ADD COLUMN seed_scheme TEXT;
        ",
    },
    Migration {
        version: 6,
        description: "drop base column from themes (snapshot makes it dead at paint time)",
        // The frontend now derives any required light/dark fallback from
        // canvas luminance at hydrate time, so the stored `base` field is
        // dead weight. SQLite supports DROP COLUMN since 3.35.0; the
        // bundled libsqlite3-sys is well above that.
        sql: "ALTER TABLE themes DROP COLUMN base;",
    },
    Migration {
        version: 7,
        description: "rename scheme columns to icon_label (purely a sun/moon tag)",
        // The field is decorative: it picks the sun/moon icon shown on the
        // theme card, nothing else. The old name `scheme` suggested it
        // changed something fundamental about how the theme renders, which
        // it does not. Rename keeps the data shape identical. SQLite has
        // RENAME COLUMN since 3.25.0.
        sql: "
            ALTER TABLE themes RENAME COLUMN scheme TO icon_label;
            ALTER TABLE themes RENAME COLUMN seed_scheme TO seed_icon_label;
        ",
    },
    Migration {
        version: 8,
        description: "backfill empty event timezones with 'UTC' as a defensive default",
        // After this migration, calendar_events.start_time and end_time are
        // UTC ISO 8601 with a Z suffix, and calendar_events.timezone is the
        // event's IANA home zone (used for recurrence math and re-export to
        // .ics with TZID=). The actual wall-clock-to-UTC rewrite happens in
        // the JS hydrator at boot (`hydrateCalendarEventTimezones`) because
        // SQLite has no IANA tz database. This SQL step only ensures the
        // timezone column is never empty so the parser cannot trip over a
        // row written before the column had a meaning.
        sql: "
            UPDATE calendar_events SET timezone = 'UTC' WHERE timezone = '';
        ",
    },
    Migration {
        version: 9,
        description: "remove obsolete theme implementation token rows",
        // The visual app theme contract no longer stores implementation
        // paint hooks that are derived at runtime or owned by component
        // code. Delete old live and seed rows so existing vaults match the
        // current token catalog instead of carrying stale key/value data.
        sql: "
            DELETE FROM theme_tokens
            WHERE kind = 'app'
              AND key IN (
                '--event-panel-edge',
                '--event-panel-shadow',
                '--event-panel-divider',
                '--event-panel-input-text',
                '--event-panel-placeholder',
                '--form-indicator',
                '--pomodoro-idle-text',
                '--pomodoro-idle-timer',
                '--cal-color-picker-outline',
                '--cal-description-editor-bg',
                '--cal-drag-preview-border'
              );

            DELETE FROM theme_seed_tokens
            WHERE kind = 'app'
              AND key IN (
                '--event-panel-edge',
                '--event-panel-shadow',
                '--event-panel-divider',
                '--event-panel-input-text',
                '--event-panel-placeholder',
                '--form-indicator',
                '--pomodoro-idle-text',
                '--pomodoro-idle-timer',
                '--cal-color-picker-outline',
                '--cal-description-editor-bg',
                '--cal-drag-preview-border'
              );
        ",
    },
    Migration {
        version: 10,
        description: "remove obsolete calendar today marker theme rows",
        // Date picker today chips now use the primary action colors. The
        // old calendar-specific rows are no longer painted or editable, so
        // existing user themes should not keep stale token data.
        sql: "
            DELETE FROM theme_tokens
            WHERE kind = 'calendar'
              AND key IN (
                '--cal-today-circle',
                '--cal-today-circle-text'
              );

            DELETE FROM theme_seed_tokens
            WHERE kind = 'calendar'
              AND key IN (
                '--cal-today-circle',
                '--cal-today-circle-text'
              );
        ",
    },
    Migration {
        version: 11,
        description: "add calendar color defaults and move calendar header to app tokens",
        // Column additions for this migration are handled by
        // `apply_theme_calendar_default_migration` so interrupted or
        // partially migrated DBs do not fail on duplicate column names.
        sql: "
            INSERT OR REPLACE INTO theme_tokens (theme_id, kind, key, value, isolated)
            SELECT theme_id, 'app', key, value, isolated
            FROM theme_tokens
            WHERE kind = 'calendar' AND key = '--cal-header-bg';

            INSERT OR REPLACE INTO theme_seed_tokens (theme_id, kind, key, value, isolated)
            SELECT theme_id, 'app', key, value, isolated
            FROM theme_seed_tokens
            WHERE kind = 'calendar' AND key = '--cal-header-bg';

            DELETE FROM theme_tokens
            WHERE kind = 'calendar' AND key = '--cal-header-bg';

            DELETE FROM theme_seed_tokens
            WHERE kind = 'calendar' AND key = '--cal-header-bg';
        ",
    },
    Migration {
        version: 12,
        description: "add iCalendar preservation storage",
        sql: "
            CREATE TABLE IF NOT EXISTS icalendar_objects (
                id TEXT PRIMARY KEY,
                calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
                source_kind TEXT NOT NULL
                    CHECK (source_kind IN ('import-file', 'import-zip-entry', 'local-export-base', 'subscription')),
                source_name TEXT NOT NULL DEFAULT '',
                source_fingerprint TEXT NOT NULL,
                prodid TEXT,
                version TEXT,
                method TEXT,
                calendar_scale TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_icalendar_objects_calendar
                ON icalendar_objects(calendar_id);
            CREATE INDEX IF NOT EXISTS idx_icalendar_objects_source
                ON icalendar_objects(calendar_id, source_kind, source_name);
            CREATE INDEX IF NOT EXISTS idx_icalendar_objects_fingerprint
                ON icalendar_objects(source_fingerprint);

            CREATE TABLE IF NOT EXISTS icalendar_components (
                id TEXT PRIMARY KEY,
                object_id TEXT NOT NULL REFERENCES icalendar_objects(id) ON DELETE CASCADE,
                parent_component_id TEXT REFERENCES icalendar_components(id) ON DELETE CASCADE,
                calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
                component_type TEXT NOT NULL,
                uid TEXT,
                recurrence_id TEXT,
                recurrence_id_value_type TEXT,
                sequence INTEGER,
                dtstart_key TEXT,
                projected_kind TEXT,
                projected_id TEXT,
                preservation_status TEXT NOT NULL
                    CHECK (preservation_status IN ('lossless', 'partial', 'unsupported', 'needs-review', 'regenerated', 'invalid')),
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_icalendar_components_calendar_type
                ON icalendar_components(calendar_id, component_type);
            CREATE INDEX IF NOT EXISTS idx_icalendar_components_uid
                ON icalendar_components(calendar_id, uid);
            CREATE INDEX IF NOT EXISTS idx_icalendar_components_uid_recurrence
                ON icalendar_components(calendar_id, uid, recurrence_id);
            CREATE INDEX IF NOT EXISTS idx_icalendar_components_projection
                ON icalendar_components(projected_kind, projected_id);
            CREATE INDEX IF NOT EXISTS idx_icalendar_components_status
                ON icalendar_components(preservation_status);
            CREATE INDEX IF NOT EXISTS idx_icalendar_components_object
                ON icalendar_components(object_id);

            CREATE TABLE IF NOT EXISTS icalendar_component_properties (
                id TEXT PRIMARY KEY,
                component_id TEXT NOT NULL REFERENCES icalendar_components(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                value_type TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_icalendar_properties_component
                ON icalendar_component_properties(component_id, sort_order);

            CREATE TABLE IF NOT EXISTS icalendar_property_parameters (
                id TEXT PRIMARY KEY,
                property_id TEXT NOT NULL REFERENCES icalendar_component_properties(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_icalendar_parameters_property
                ON icalendar_property_parameters(property_id, sort_order);

            CREATE TABLE IF NOT EXISTS icalendar_value_nodes (
                id TEXT PRIMARY KEY,
                property_id TEXT REFERENCES icalendar_component_properties(id) ON DELETE CASCADE,
                parameter_id TEXT REFERENCES icalendar_property_parameters(id) ON DELETE CASCADE,
                parent_node_id TEXT REFERENCES icalendar_value_nodes(id) ON DELETE CASCADE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                value_kind TEXT NOT NULL CHECK(value_kind IN ('array', 'text', 'number', 'boolean', 'null')),
                text_value TEXT,
                number_value REAL,
                boolean_value INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_icalendar_value_nodes_property
                ON icalendar_value_nodes(property_id, parent_node_id, sort_order);
            CREATE INDEX IF NOT EXISTS idx_icalendar_value_nodes_parameter
                ON icalendar_value_nodes(parameter_id, parent_node_id, sort_order);
            CREATE INDEX IF NOT EXISTS idx_icalendar_value_nodes_parent
                ON icalendar_value_nodes(parent_node_id, sort_order);

            CREATE TABLE IF NOT EXISTS icalendar_object_diagnostics (
                id TEXT PRIMARY KEY,
                object_id TEXT NOT NULL REFERENCES icalendar_objects(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_icalendar_object_diagnostics_object
                ON icalendar_object_diagnostics(object_id, sort_order);

            CREATE TABLE IF NOT EXISTS icalendar_component_projection_warnings (
                id TEXT PRIMARY KEY,
                component_id TEXT NOT NULL REFERENCES icalendar_components(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_icalendar_projection_warnings_component
                ON icalendar_component_projection_warnings(component_id, sort_order);
        ",
    },
    Migration {
        version: 13,
        description: "link calendar projections to preserved iCalendar components",
        sql: "
            ALTER TABLE calendar_events
                ADD COLUMN icalendar_component_id TEXT
                    REFERENCES icalendar_components(id) ON DELETE SET NULL;
            ALTER TABLE calendar_event_overrides
                ADD COLUMN icalendar_component_id TEXT
                    REFERENCES icalendar_components(id) ON DELETE SET NULL;
            ALTER TABLE calendar_event_attendees
                ADD COLUMN icalendar_component_id TEXT
                    REFERENCES icalendar_components(id) ON DELETE SET NULL;
            ALTER TABLE calendar_event_attendees
                ADD COLUMN icalendar_property_index INTEGER;
            ALTER TABLE calendar_event_alarms
                ADD COLUMN icalendar_component_id TEXT
                    REFERENCES icalendar_components(id) ON DELETE SET NULL;

            CREATE INDEX IF NOT EXISTS idx_calendar_events_icalendar_component
                ON calendar_events(icalendar_component_id);
            CREATE INDEX IF NOT EXISTS idx_overrides_icalendar_component
                ON calendar_event_overrides(icalendar_component_id);
            CREATE INDEX IF NOT EXISTS idx_attendees_icalendar_component
                ON calendar_event_attendees(icalendar_component_id);
            CREATE INDEX IF NOT EXISTS idx_alarms_icalendar_component
                ON calendar_event_alarms(icalendar_component_id);
        ",
    },
    Migration {
        version: 14,
        description: "add recurrence range to calendar overrides",
        sql: "ALTER TABLE calendar_event_overrides ADD COLUMN recurrence_range TEXT;",
    },
    Migration {
        version: 15,
        description: "add local event rsvp status",
        sql: "ALTER TABLE calendar_events ADD COLUMN local_rsvp_status TEXT;",
    },
    Migration {
        version: 16,
        description: "expand theme event palettes to 32 slots",
        sql: "
            ALTER TABLE theme_event_palette RENAME TO theme_event_palette_old;
            CREATE TABLE theme_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_event_palette (theme_id, slot, value)
                SELECT theme_id, slot, value
                FROM theme_event_palette_old
                WHERE slot >= 0 AND slot < 32;
            DROP TABLE theme_event_palette_old;

            ALTER TABLE theme_seed_event_palette RENAME TO theme_seed_event_palette_old;
            CREATE TABLE theme_seed_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_seed_event_palette (theme_id, slot, value)
                SELECT theme_id, slot, value
                FROM theme_seed_event_palette_old
                WHERE slot >= 0 AND slot < 32;
            DROP TABLE theme_seed_event_palette_old;
        ",
    },
    Migration {
        version: 17,
        description: "reorder event color slots",
        sql: "
            UPDATE calendar_events
            SET color = CASE color
                WHEN 0 THEN 0
                WHEN 1 THEN 1
                WHEN 2 THEN 3
                WHEN 3 THEN 4
                WHEN 4 THEN 6
                WHEN 5 THEN 19
                WHEN 6 THEN 7
                WHEN 7 THEN 8
                WHEN 8 THEN 9
                WHEN 9 THEN 10
                WHEN 10 THEN 11
                WHEN 11 THEN 12
                WHEN 12 THEN 13
                WHEN 13 THEN 14
                WHEN 14 THEN 17
                WHEN 15 THEN 18
                WHEN 16 THEN 20
                WHEN 17 THEN 21
                WHEN 18 THEN 22
                WHEN 19 THEN 25
                WHEN 20 THEN 24
                WHEN 21 THEN 27
                WHEN 22 THEN 31
                WHEN 23 THEN 30
                WHEN 24 THEN 2
                WHEN 25 THEN 5
                WHEN 26 THEN 15
                WHEN 27 THEN 16
                WHEN 28 THEN 23
                WHEN 29 THEN 26
                WHEN 30 THEN 29
                WHEN 31 THEN 28
                ELSE color
            END
            WHERE color BETWEEN 0 AND 31;

            UPDATE calendar_event_overrides
            SET color = CASE color
                WHEN 0 THEN 0
                WHEN 1 THEN 1
                WHEN 2 THEN 3
                WHEN 3 THEN 4
                WHEN 4 THEN 6
                WHEN 5 THEN 19
                WHEN 6 THEN 7
                WHEN 7 THEN 8
                WHEN 8 THEN 9
                WHEN 9 THEN 10
                WHEN 10 THEN 11
                WHEN 11 THEN 12
                WHEN 12 THEN 13
                WHEN 13 THEN 14
                WHEN 14 THEN 17
                WHEN 15 THEN 18
                WHEN 16 THEN 20
                WHEN 17 THEN 21
                WHEN 18 THEN 22
                WHEN 19 THEN 25
                WHEN 20 THEN 24
                WHEN 21 THEN 27
                WHEN 22 THEN 31
                WHEN 23 THEN 30
                WHEN 24 THEN 2
                WHEN 25 THEN 5
                WHEN 26 THEN 15
                WHEN 27 THEN 16
                WHEN 28 THEN 23
                WHEN 29 THEN 26
                WHEN 30 THEN 29
                WHEN 31 THEN 28
                ELSE color
            END
            WHERE color BETWEEN 0 AND 31;

            ALTER TABLE theme_event_palette RENAME TO theme_event_palette_before_reorder;
            CREATE TABLE theme_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_event_palette (theme_id, slot, value)
                SELECT theme_id,
                    CASE slot
                        WHEN 0 THEN 0
                        WHEN 1 THEN 1
                        WHEN 2 THEN 3
                        WHEN 3 THEN 4
                        WHEN 4 THEN 6
                        WHEN 5 THEN 19
                        WHEN 6 THEN 7
                        WHEN 7 THEN 8
                        WHEN 8 THEN 9
                        WHEN 9 THEN 10
                        WHEN 10 THEN 11
                        WHEN 11 THEN 12
                        WHEN 12 THEN 13
                        WHEN 13 THEN 14
                        WHEN 14 THEN 17
                        WHEN 15 THEN 18
                        WHEN 16 THEN 20
                        WHEN 17 THEN 21
                        WHEN 18 THEN 22
                        WHEN 19 THEN 25
                        WHEN 20 THEN 24
                        WHEN 21 THEN 27
                        WHEN 22 THEN 31
                        WHEN 23 THEN 30
                        WHEN 24 THEN 2
                        WHEN 25 THEN 5
                        WHEN 26 THEN 15
                        WHEN 27 THEN 16
                        WHEN 28 THEN 23
                        WHEN 29 THEN 26
                        WHEN 30 THEN 29
                        WHEN 31 THEN 28
                    END,
                    value
                FROM theme_event_palette_before_reorder
                WHERE slot BETWEEN 0 AND 31;
            DROP TABLE theme_event_palette_before_reorder;

            ALTER TABLE theme_seed_event_palette RENAME TO theme_seed_event_palette_before_reorder;
            CREATE TABLE theme_seed_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_seed_event_palette (theme_id, slot, value)
                SELECT theme_id,
                    CASE slot
                        WHEN 0 THEN 0
                        WHEN 1 THEN 1
                        WHEN 2 THEN 3
                        WHEN 3 THEN 4
                        WHEN 4 THEN 6
                        WHEN 5 THEN 19
                        WHEN 6 THEN 7
                        WHEN 7 THEN 8
                        WHEN 8 THEN 9
                        WHEN 9 THEN 10
                        WHEN 10 THEN 11
                        WHEN 11 THEN 12
                        WHEN 12 THEN 13
                        WHEN 13 THEN 14
                        WHEN 14 THEN 17
                        WHEN 15 THEN 18
                        WHEN 16 THEN 20
                        WHEN 17 THEN 21
                        WHEN 18 THEN 22
                        WHEN 19 THEN 25
                        WHEN 20 THEN 24
                        WHEN 21 THEN 27
                        WHEN 22 THEN 31
                        WHEN 23 THEN 30
                        WHEN 24 THEN 2
                        WHEN 25 THEN 5
                        WHEN 26 THEN 15
                        WHEN 27 THEN 16
                        WHEN 28 THEN 23
                        WHEN 29 THEN 26
                        WHEN 30 THEN 29
                        WHEN 31 THEN 28
                    END,
                    value
                FROM theme_seed_event_palette_before_reorder
                WHERE slot BETWEEN 0 AND 31;
            DROP TABLE theme_seed_event_palette_before_reorder;
        ",
    },
    Migration {
        version: 18,
        description: "move slate event color into neutral range",
        sql: "
            UPDATE calendar_events
            SET color = CASE color
                WHEN 19 THEN 30
                WHEN 20 THEN 19
                WHEN 21 THEN 20
                WHEN 22 THEN 21
                WHEN 23 THEN 22
                WHEN 24 THEN 23
                WHEN 25 THEN 24
                WHEN 26 THEN 25
                WHEN 27 THEN 26
                WHEN 28 THEN 27
                WHEN 29 THEN 28
                WHEN 30 THEN 29
                ELSE color
            END
            WHERE color BETWEEN 19 AND 30;

            UPDATE calendar_event_overrides
            SET color = CASE color
                WHEN 19 THEN 30
                WHEN 20 THEN 19
                WHEN 21 THEN 20
                WHEN 22 THEN 21
                WHEN 23 THEN 22
                WHEN 24 THEN 23
                WHEN 25 THEN 24
                WHEN 26 THEN 25
                WHEN 27 THEN 26
                WHEN 28 THEN 27
                WHEN 29 THEN 28
                WHEN 30 THEN 29
                ELSE color
            END
            WHERE color BETWEEN 19 AND 30;

            ALTER TABLE theme_event_palette RENAME TO theme_event_palette_before_slate_move;
            CREATE TABLE theme_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_event_palette (theme_id, slot, value)
                SELECT theme_id,
                    CASE slot
                        WHEN 19 THEN 30
                        WHEN 20 THEN 19
                        WHEN 21 THEN 20
                        WHEN 22 THEN 21
                        WHEN 23 THEN 22
                        WHEN 24 THEN 23
                        WHEN 25 THEN 24
                        WHEN 26 THEN 25
                        WHEN 27 THEN 26
                        WHEN 28 THEN 27
                        WHEN 29 THEN 28
                        WHEN 30 THEN 29
                        ELSE slot
                    END,
                    value
                FROM theme_event_palette_before_slate_move
                WHERE slot BETWEEN 0 AND 31;
            DROP TABLE theme_event_palette_before_slate_move;

            ALTER TABLE theme_seed_event_palette RENAME TO theme_seed_event_palette_before_slate_move;
            CREATE TABLE theme_seed_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_seed_event_palette (theme_id, slot, value)
                SELECT theme_id,
                    CASE slot
                        WHEN 19 THEN 30
                        WHEN 20 THEN 19
                        WHEN 21 THEN 20
                        WHEN 22 THEN 21
                        WHEN 23 THEN 22
                        WHEN 24 THEN 23
                        WHEN 25 THEN 24
                        WHEN 26 THEN 25
                        WHEN 27 THEN 26
                        WHEN 28 THEN 27
                        WHEN 29 THEN 28
                        WHEN 30 THEN 29
                        ELSE slot
                    END,
                    value
                FROM theme_seed_event_palette_before_slate_move
                WHERE slot BETWEEN 0 AND 31;
            DROP TABLE theme_seed_event_palette_before_slate_move;
        ",
    },
    Migration {
        version: 19,
        description: "swap neutral gray and slate event color slots",
        sql: "
            UPDATE calendar_events
            SET color = CASE color
                WHEN 30 THEN 31
                WHEN 31 THEN 30
                ELSE color
            END
            WHERE color IN (30, 31);

            UPDATE calendar_event_overrides
            SET color = CASE color
                WHEN 30 THEN 31
                WHEN 31 THEN 30
                ELSE color
            END
            WHERE color IN (30, 31);

            ALTER TABLE theme_event_palette RENAME TO theme_event_palette_before_neutral_swap;
            CREATE TABLE theme_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_event_palette (theme_id, slot, value)
                SELECT theme_id,
                    CASE slot
                        WHEN 30 THEN 31
                        WHEN 31 THEN 30
                        ELSE slot
                    END,
                    value
                FROM theme_event_palette_before_neutral_swap
                WHERE slot BETWEEN 0 AND 31;
            DROP TABLE theme_event_palette_before_neutral_swap;

            ALTER TABLE theme_seed_event_palette RENAME TO theme_seed_event_palette_before_neutral_swap;
            CREATE TABLE theme_seed_event_palette (
                theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
                value TEXT NOT NULL,
                PRIMARY KEY (theme_id, slot)
            );
            INSERT INTO theme_seed_event_palette (theme_id, slot, value)
                SELECT theme_id,
                    CASE slot
                        WHEN 30 THEN 31
                        WHEN 31 THEN 30
                        ELSE slot
                    END,
                    value
                FROM theme_seed_event_palette_before_neutral_swap
                WHERE slot BETWEEN 0 AND 31;
            DROP TABLE theme_seed_event_palette_before_neutral_swap;
        ",
    },
    Migration {
        version: 20,
        description: "normalize confidential event visibility",
        sql: "
            UPDATE calendar_events
            SET visibility = 'private'
            WHERE visibility = 'confidential';

            UPDATE calendar_event_overrides
            SET visibility = 'private'
            WHERE visibility = 'confidential';
        ",
    },
    Migration {
        version: 21,
        description: "persist empty meeting section state",
        sql: "
            ALTER TABLE calendar_events
                ADD COLUMN meeting_enabled INTEGER NOT NULL DEFAULT 0;

            UPDATE calendar_events
            SET meeting_enabled = 1
            WHERE location <> ''
                OR url <> ''
                OR geo_lat IS NOT NULL
                OR geo_lng IS NOT NULL
                OR local_rsvp_status IS NOT NULL
                OR guest_can_modify <> 0
                OR guest_can_invite_others <> 1
                OR guest_can_see_other_guests <> 1
                OR EXISTS (
                    SELECT 1
                    FROM calendar_event_attendees
                    WHERE calendar_event_attendees.event_id = calendar_events.id
                )
                OR EXISTS (
                    SELECT 1
                    FROM calendar_event_organizers
                    WHERE calendar_event_organizers.event_id = calendar_events.id
                );
        ",
    },
    Migration {
        version: 23,
        description: "add music playlists and playback state",
        sql: "
            CREATE TABLE IF NOT EXISTS music_playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS music_playlist_tracks (
                id TEXT PRIMARY KEY,
                playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
                position INTEGER NOT NULL CHECK (position >= 0),
                source_kind TEXT NOT NULL CHECK (source_kind IN ('local-file', 'youtube-video', 'youtube-playlist')),
                source_uri TEXT NOT NULL,
                source_identity TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                start_ms INTEGER CHECK (start_ms IS NULL OR start_ms >= 0),
                end_ms INTEGER CHECK (end_ms IS NULL OR end_ms >= 0),
                volume REAL CHECK (volume IS NULL OR (volume >= 0 AND volume <= 1)),
                rate REAL CHECK (rate IS NULL OR (rate >= 0.25 AND rate <= 2)),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks_playlist_position
                ON music_playlist_tracks(playlist_id, position);
            CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks_source_identity
                ON music_playlist_tracks(source_identity);

            CREATE TABLE IF NOT EXISTS music_track_skip_ranges (
                id TEXT PRIMARY KEY,
                track_id TEXT NOT NULL REFERENCES music_playlist_tracks(id) ON DELETE CASCADE,
                start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
                end_ms INTEGER NOT NULL CHECK (end_ms >= 0),
                sort_order INTEGER NOT NULL DEFAULT 0,
                CHECK (end_ms >= start_ms)
            );
            CREATE INDEX IF NOT EXISTS idx_music_track_skip_ranges_track
                ON music_track_skip_ranges(track_id, sort_order);

            CREATE TABLE IF NOT EXISTS music_track_break_sources (
                track_id TEXT PRIMARY KEY REFERENCES music_playlist_tracks(id) ON DELETE CASCADE,
                source_kind TEXT NOT NULL CHECK (source_kind IN ('local-file', 'youtube-video', 'youtube-playlist')),
                source_uri TEXT NOT NULL,
                source_identity TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                start_ms INTEGER CHECK (start_ms IS NULL OR start_ms >= 0),
                end_ms INTEGER CHECK (end_ms IS NULL OR end_ms >= 0),
                volume REAL CHECK (volume IS NULL OR (volume >= 0 AND volume <= 1)),
                rate REAL CHECK (rate IS NULL OR (rate >= 0.25 AND rate <= 2))
            );

            CREATE TABLE IF NOT EXISTS music_playback_states (
                source_identity TEXT PRIMARY KEY,
                source_kind TEXT NOT NULL CHECK (source_kind IN ('local-file', 'youtube-video', 'youtube-playlist')),
                position_ms INTEGER NOT NULL CHECK (position_ms >= 0),
                duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
                status TEXT NOT NULL CHECK (status IN ('idle', 'loading', 'ready', 'playing', 'paused', 'ended', 'error')),
                updated_at INTEGER NOT NULL
            );
        ",
    }]
}

#[cfg(test)]
mod tests {
    use super::run_migrations;
    use sqlx::{Row, SqlitePool};

    async fn migrated_memory_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    async fn insert_event(pool: &SqlitePool) {
        sqlx::query(
            "INSERT INTO calendar_events (id, title, start_time, end_time)
             VALUES ('event-1', 'Focus block', '2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_open_run(
        pool: &SqlitePool,
        id: &str,
    ) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
        sqlx::query(
            "INSERT INTO pomodoro_runs
                (id, event_id, original_event_id, event_date, planned_start, planned_end,
                 started_at, focus_duration_minutes, short_break_minutes, long_break_minutes,
                 pomodoro_count, last_heartbeat, start_trigger)
             VALUES (?, 'event-1', 'event-1', '2026-05-23',
                     '2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z',
                     '2026-05-23T09:00:00Z', 40, 5, 10, 4,
                     '2026-05-23T09:00:00Z', 'manual')",
        )
        .bind(id)
        .execute(pool)
        .await
    }

    #[test]
    fn schema_does_not_create_json_storage_columns() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_memory_pool().await;

            let rows = sqlx::query(
                "SELECT m.name AS table_name, p.name AS column_name
                 FROM sqlite_schema AS m, pragma_table_info(m.name) AS p
                 WHERE m.type = 'table'",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            let forbidden = [
                "pause_log",
                "raw_jcal",
                "skip_ranges_json",
                "break_source_json",
                "notifications",
                "exceptions",
                "categories",
                "geo",
                "rdate",
                "extended_properties",
                "organizer",
            ];
            let forbidden_tables = ["pomodoro_sessions"];
            for row in rows {
                let table_name: String = row.try_get("table_name").unwrap();
                let column_name: String = row.try_get("column_name").unwrap();
                assert!(
                    !forbidden_tables.contains(&table_name.as_str()),
                    "{table_name} should not be created as persisted storage",
                );
                assert!(
                    !forbidden.contains(&column_name.as_str()) && !column_name.ends_with("_json"),
                    "{table_name}.{column_name} should be normalized, not JSON storage",
                );
            }
        });
    }

    #[test]
    fn schema_allows_only_one_open_pomodoro_run() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_memory_pool().await;
            insert_event(&pool).await;

            insert_open_run(&pool, "run-1").await.unwrap();
            assert!(insert_open_run(&pool, "run-2").await.is_err());

            sqlx::query(
                "UPDATE pomodoro_runs
                 SET ended_at = '2026-05-23T09:30:00Z', end_reason = 'stopped'
                 WHERE id = 'run-1'",
            )
            .execute(&pool)
            .await
            .unwrap();

            insert_open_run(&pool, "run-2").await.unwrap();
        });
    }

    #[test]
    fn schema_allows_only_one_active_pomodoro_segment() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_memory_pool().await;
            insert_event(&pool).await;
            insert_open_run(&pool, "run-1").await.unwrap();

            sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, cycle_number, phase,
                     planned_start, planned_end, actual_start, status)
                 VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                         '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                         '2026-05-23T09:00:00Z', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let second_active = sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, cycle_number, phase,
                     planned_start, planned_end, actual_start, status)
                 VALUES ('segment-2', 'event-1', '2026-05-23', 'run-1', 1, 'short_break',
                         '2026-05-23T09:40:00Z', '2026-05-23T09:45:00Z',
                         '2026-05-23T09:40:00Z', 'active')",
            )
            .execute(&pool)
            .await;

            assert!(second_active.is_err());
        });
    }

    #[test]
    fn deleting_calendar_event_preserves_pomodoro_segments() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_memory_pool().await;
            insert_event(&pool).await;
            insert_open_run(&pool, "run-1").await.unwrap();

            sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, cycle_number, phase,
                     planned_start, planned_end, actual_start, actual_end, status, end_reason)
                 VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                         '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                         '2026-05-23T09:00:00Z', '2026-05-23T09:20:00Z',
                         'interrupted', 'stopped')",
            )
            .execute(&pool)
            .await
            .unwrap();

            sqlx::query("DELETE FROM calendar_events WHERE id = 'event-1'")
                .execute(&pool)
                .await
                .unwrap();

            let segment_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_segments WHERE id = 'segment-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let event_id: Option<String> =
                sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(segment_count, 1);
            assert_eq!(event_id, None);
        });
    }

    #[test]
    fn schema_allows_only_one_open_pause_per_segment() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_memory_pool().await;
            insert_event(&pool).await;
            insert_open_run(&pool, "run-1").await.unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, cycle_number, phase,
                     planned_start, planned_end, actual_start, status)
                 VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                         '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                         '2026-05-23T09:00:00Z', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();

            sqlx::query(
                "INSERT INTO pomodoro_pauses (id, segment_id, started_at, reason)
                 VALUES ('pause-1', 'segment-1', '2026-05-23T09:10:00Z', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let second_open_pause = sqlx::query(
                "INSERT INTO pomodoro_pauses (id, segment_id, started_at, reason)
                 VALUES ('pause-2', 'segment-1', '2026-05-23T09:15:00Z', 'idle')",
            )
            .execute(&pool)
            .await;

            assert!(second_open_pause.is_err());
        });
    }
}

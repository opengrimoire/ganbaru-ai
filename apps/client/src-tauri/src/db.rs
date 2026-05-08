use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema",
        sql: "
            -- kanban tasks
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'backlog'
                    CHECK(status IN ('backlog', 'todo', 'in_progress', 'done')),
                priority TEXT NOT NULL DEFAULT 'medium'
                    CHECK(priority IN ('easy', 'medium', 'hard', 'epic')),
                estimated_pomodoros INTEGER NOT NULL DEFAULT 1,
                actual_pomodoros INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- task tags
            CREATE TABLE IF NOT EXISTS task_tags (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                tag TEXT NOT NULL,
                PRIMARY KEY (task_id, tag)
            );

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
                notifications TEXT,
                exceptions TEXT,
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
                categories TEXT,
                geo TEXT,
                sequence INTEGER NOT NULL DEFAULT 0,
                rdate TEXT,
                extended_properties TEXT,
                organizer TEXT,
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
                extended_properties TEXT,
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

            -- pomodoro config per event
            CREATE TABLE IF NOT EXISTS pomodoro_configs (
                event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
                focus_duration_minutes INTEGER NOT NULL DEFAULT 40,
                short_break_minutes INTEGER NOT NULL DEFAULT 5,
                long_break_minutes INTEGER NOT NULL DEFAULT 10,
                pomodoro_count INTEGER NOT NULL DEFAULT 4,
                idle_timeout_minutes INTEGER
            );

            -- pomodoro segment tracking
            CREATE TABLE IF NOT EXISTS pomodoro_segments (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                event_date TEXT NOT NULL,
                run_id TEXT NOT NULL,
                cycle_number INTEGER NOT NULL,
                phase TEXT NOT NULL CHECK(phase IN ('focus', 'short_break', 'long_break')),
                planned_start TEXT NOT NULL,
                planned_end TEXT NOT NULL,
                actual_start TEXT,
                actual_end TEXT,
                pause_log TEXT,
                status TEXT NOT NULL DEFAULT 'planned'
                    CHECK(status IN ('planned', 'active', 'completed', 'skipped', 'interrupted')),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pomodoro_segments_event
                ON pomodoro_segments(event_id, event_date);
            CREATE INDEX IF NOT EXISTS idx_pomodoro_segments_run
                ON pomodoro_segments(run_id);

            -- pomodoro sessions (completed focus periods)
            CREATE TABLE IF NOT EXISTS pomodoro_sessions (
                id TEXT PRIMARY KEY,
                task_id TEXT REFERENCES tasks(id),
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 1,
                app_switch_count INTEGER NOT NULL DEFAULT 0,
                break_extended INTEGER NOT NULL DEFAULT 0,
                focus_score REAL NOT NULL DEFAULT 1.0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "add event_id to pomodoro_sessions",
        sql: "ALTER TABLE pomodoro_sessions ADD COLUMN event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL;",
        kind: MigrationKind::Up,
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
        kind: MigrationKind::Up,
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
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 24),
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
                slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 24),
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
        kind: MigrationKind::Up,
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
        kind: MigrationKind::Up,
    },
    Migration {
        version: 6,
        description: "drop base column from themes (snapshot makes it dead at paint time)",
        // The frontend now derives any required light/dark fallback from
        // canvas luminance at hydrate time, so the stored `base` field is
        // dead weight. SQLite supports DROP COLUMN since 3.35.0; the
        // bundled libsqlite3-sys is well above that.
        sql: "ALTER TABLE themes DROP COLUMN base;",
        kind: MigrationKind::Up,
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
        kind: MigrationKind::Up,
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
        kind: MigrationKind::Up,
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
        kind: MigrationKind::Up,
    }]
}

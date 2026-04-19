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
    }]
}

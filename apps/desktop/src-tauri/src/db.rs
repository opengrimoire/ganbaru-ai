use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema",
        sql: "
            -- skill tree branches
            CREATE TABLE IF NOT EXISTS skill_branches (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6366f1',
                parent_branch_id TEXT REFERENCES skill_branches(id),
                depth INTEGER NOT NULL DEFAULT 0
            );

            -- skill tree nodes
            CREATE TABLE IF NOT EXISTS skill_nodes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                node_type TEXT NOT NULL DEFAULT 'basic' CHECK(node_type IN ('basic', 'notable', 'keystone')),
                branch_id TEXT NOT NULL REFERENCES skill_branches(id),
                level INTEGER NOT NULL DEFAULT 0,
                current_xp INTEGER NOT NULL DEFAULT 0,
                required_xp INTEGER NOT NULL DEFAULT 100,
                unlocked INTEGER NOT NULL DEFAULT 0,
                last_practiced_at TEXT
            );

            -- skill node parent relationships (DAG)
            CREATE TABLE IF NOT EXISTS skill_node_parents (
                node_id TEXT NOT NULL REFERENCES skill_nodes(id),
                parent_id TEXT NOT NULL REFERENCES skill_nodes(id),
                PRIMARY KEY (node_id, parent_id)
            );

            -- kanban tasks
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'backlog' CHECK(status IN ('backlog', 'todo', 'in_progress', 'done')),
                priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('easy', 'medium', 'hard', 'epic')),
                estimated_pomodoros INTEGER NOT NULL DEFAULT 1,
                actual_pomodoros INTEGER NOT NULL DEFAULT 0,
                session_block_id TEXT REFERENCES session_blocks(id),
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- task to skill branch mapping
            CREATE TABLE IF NOT EXISTS task_skill_branches (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                branch_id TEXT NOT NULL REFERENCES skill_branches(id),
                PRIMARY KEY (task_id, branch_id)
            );

            -- task tags
            CREATE TABLE IF NOT EXISTS task_tags (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                tag TEXT NOT NULL,
                PRIMARY KEY (task_id, tag)
            );

            -- calendar session blocks
            CREATE TABLE IF NOT EXISTS session_blocks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                pomodoro_count INTEGER NOT NULL DEFAULT 4,
                focus_duration_minutes INTEGER NOT NULL DEFAULT 25,
                short_break_minutes INTEGER NOT NULL DEFAULT 5,
                long_break_minutes INTEGER NOT NULL DEFAULT 15,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                environment_id TEXT,
                playlist_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- session block to skill branch mapping
            CREATE TABLE IF NOT EXISTS session_block_skill_branches (
                session_block_id TEXT NOT NULL REFERENCES session_blocks(id) ON DELETE CASCADE,
                branch_id TEXT NOT NULL REFERENCES skill_branches(id),
                PRIMARY KEY (session_block_id, branch_id)
            );

            -- pomodoro sessions (completed focus periods)
            CREATE TABLE IF NOT EXISTS pomodoro_sessions (
                id TEXT PRIMARY KEY,
                session_block_id TEXT REFERENCES session_blocks(id),
                task_id TEXT REFERENCES tasks(id),
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 1,
                app_switch_count INTEGER NOT NULL DEFAULT 0,
                break_extended INTEGER NOT NULL DEFAULT 0,
                focus_score REAL NOT NULL DEFAULT 1.0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- xp ledger
            CREATE TABLE IF NOT EXISTS xp_entries (
                id TEXT PRIMARY KEY,
                session_block_id TEXT REFERENCES session_blocks(id),
                task_id TEXT REFERENCES tasks(id),
                pomodoro_session_id TEXT REFERENCES pomodoro_sessions(id),
                activity_xp REAL NOT NULL DEFAULT 0,
                focus_xp REAL NOT NULL DEFAULT 0,
                clarity_xp REAL NOT NULL DEFAULT 0,
                intensity_xp REAL NOT NULL DEFAULT 0,
                execution_xp REAL NOT NULL DEFAULT 0,
                total_xp REAL NOT NULL DEFAULT 0,
                streak_multiplier REAL NOT NULL DEFAULT 1.0,
                timestamp TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- xp to branch distribution
            CREATE TABLE IF NOT EXISTS xp_branch_distribution (
                xp_entry_id TEXT NOT NULL REFERENCES xp_entries(id) ON DELETE CASCADE,
                branch_id TEXT NOT NULL REFERENCES skill_branches(id),
                xp_amount REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (xp_entry_id, branch_id)
            );

            -- streaks
            CREATE TABLE IF NOT EXISTS streaks (
                id TEXT PRIMARY KEY DEFAULT 'current',
                current_count INTEGER NOT NULL DEFAULT 0,
                longest_count INTEGER NOT NULL DEFAULT 0,
                last_active_date TEXT,
                freeze_available INTEGER NOT NULL DEFAULT 0,
                freeze_used INTEGER NOT NULL DEFAULT 0
            );

            -- daily xp caps tracking
            CREATE TABLE IF NOT EXISTS daily_xp_caps (
                date TEXT NOT NULL,
                branch_id TEXT NOT NULL REFERENCES skill_branches(id),
                xp_earned REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (date, branch_id)
            );

            -- insert initial streak record
            INSERT OR IGNORE INTO streaks (id) VALUES ('current');
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "add color, description, repeat, notification to session blocks",
        sql: "
            ALTER TABLE session_blocks ADD COLUMN color TEXT;
            ALTER TABLE session_blocks ADD COLUMN description TEXT NOT NULL DEFAULT '';
            ALTER TABLE session_blocks ADD COLUMN repeat_rule TEXT;
            ALTER TABLE session_blocks ADD COLUMN notification_minutes INTEGER;
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 3,
        description: "add exceptions and repeat_until for recurring event overrides",
        sql: "
            ALTER TABLE session_blocks ADD COLUMN exceptions TEXT;
            ALTER TABLE session_blocks ADD COLUMN repeat_until TEXT;
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 4,
        description: "restructure calendar schema: rename table, add timezone/calendar_id, normalize pomodoro config",
        sql: "
            ALTER TABLE session_blocks RENAME TO calendar_events;

            ALTER TABLE calendar_events ADD COLUMN timezone TEXT NOT NULL DEFAULT '';
            ALTER TABLE calendar_events ADD COLUMN calendar_id TEXT NOT NULL DEFAULT 'local';
            ALTER TABLE calendar_events RENAME COLUMN repeat_rule TO rrule;

            ALTER TABLE calendar_events DROP COLUMN pomodoro_count;
            ALTER TABLE calendar_events DROP COLUMN focus_duration_minutes;
            ALTER TABLE calendar_events DROP COLUMN short_break_minutes;
            ALTER TABLE calendar_events DROP COLUMN long_break_minutes;

            CREATE TABLE IF NOT EXISTS pomodoro_configs (
                event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
                focus_duration_minutes INTEGER NOT NULL DEFAULT 40,
                short_break_minutes INTEGER NOT NULL DEFAULT 5,
                long_break_minutes INTEGER NOT NULL DEFAULT 10,
                pomodoro_count INTEGER NOT NULL DEFAULT 4
            );

            CREATE TABLE IF NOT EXISTS calendar_event_skill_branches (
                event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                branch_id TEXT NOT NULL REFERENCES skill_branches(id),
                PRIMARY KEY (event_id, branch_id)
            );
            DROP TABLE IF EXISTS session_block_skill_branches;

            CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
            CREATE INDEX IF NOT EXISTS idx_calendar_events_end ON calendar_events(end_time);
            CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(calendar_id);
        ",
        kind: MigrationKind::Up,
    }]
}

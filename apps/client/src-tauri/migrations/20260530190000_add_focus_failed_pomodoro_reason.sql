PRAGMA foreign_keys=OFF;

DROP INDEX IF EXISTS idx_pomodoro_segments_event;
DROP INDEX IF EXISTS idx_pomodoro_segments_run;
DROP INDEX IF EXISTS idx_pomodoro_segments_run_actual;
DROP INDEX IF EXISTS idx_pomodoro_segments_single_active;

CREATE TABLE pomodoro_segments_new (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
    event_date TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('focus', 'short_break', 'long_break')),
    planned_start TEXT NOT NULL,
    planned_end TEXT NOT NULL,
    actual_start TEXT NOT NULL,
    actual_end TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'interrupted')),
    end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('completed', 'stopped', 'skipped_by_user', 'event_expired', 'focus_failed', 'reconfigured', 'block_transition', 'crash_recovery')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pomodoro_segments_new (
    id, event_id, event_date, run_id, cycle_number, phase, planned_start, planned_end,
    actual_start, actual_end, status, end_reason, created_at
)
SELECT
    id, event_id, event_date, run_id, cycle_number, phase, planned_start, planned_end,
    actual_start, actual_end, status, end_reason, created_at
FROM pomodoro_segments;

DROP TABLE pomodoro_segments;
ALTER TABLE pomodoro_segments_new RENAME TO pomodoro_segments;

CREATE INDEX idx_pomodoro_segments_event ON pomodoro_segments(event_id, event_date);
CREATE INDEX idx_pomodoro_segments_run ON pomodoro_segments(run_id);
CREATE INDEX idx_pomodoro_segments_run_actual ON pomodoro_segments(run_id, actual_start);
CREATE UNIQUE INDEX idx_pomodoro_segments_single_active ON pomodoro_segments((1)) WHERE status = 'active';

DROP INDEX IF EXISTS idx_pomodoro_run_events_run;

CREATE TABLE pomodoro_run_events_new (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
    segment_id TEXT REFERENCES pomodoro_segments(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('start', 'phase_start', 'phase_complete', 'pause_start', 'pause_end', 'idle_detected', 'focus_failed', 'suspend_detected', 'skip_break', 'extend_focus', 'reconfigure', 'block_transition', 'stop', 'complete', 'crash_recovery')),
    occurred_at TEXT NOT NULL,
    phase TEXT CHECK (phase IS NULL OR phase IN ('focus', 'short_break', 'long_break')),
    reason TEXT,
    duration_seconds INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pomodoro_run_events_new (
    id, run_id, segment_id, event_type, occurred_at, phase, reason, duration_seconds, created_at
)
SELECT
    id, run_id, segment_id, event_type, occurred_at, phase, reason, duration_seconds, created_at
FROM pomodoro_run_events;

DROP TABLE pomodoro_run_events;
ALTER TABLE pomodoro_run_events_new RENAME TO pomodoro_run_events;

CREATE INDEX idx_pomodoro_run_events_run ON pomodoro_run_events(run_id, occurred_at);

PRAGMA foreign_keys=ON;

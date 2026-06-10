ALTER TABLE pomodoro_configs RENAME TO pomodoro_configs_old;

CREATE TABLE pomodoro_configs (
    event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
    rhythm_kind TEXT NOT NULL CHECK (rhythm_kind IN ('count', 'sequence')),
    rhythm_source TEXT NOT NULL CHECK (rhythm_source IN ('preset', 'custom')),
    preset_key TEXT CHECK (
        preset_key IS NULL OR preset_key IN ('auto', 'creative', 'balanced', 'deep', 'extended')
    ),
    idle_timeout_minutes INTEGER CHECK (idle_timeout_minutes IS NULL OR idle_timeout_minutes > 0)
);

INSERT INTO pomodoro_configs (
    event_id,
    rhythm_kind,
    rhythm_source,
    preset_key,
    idle_timeout_minutes
)
SELECT
    event_id,
    rhythm_kind,
    rhythm_source,
    preset_key,
    idle_timeout_minutes
FROM pomodoro_configs_old;

ALTER TABLE pomodoro_config_count_rhythms RENAME TO pomodoro_config_count_rhythms_old;

CREATE TABLE pomodoro_config_count_rhythms (
    event_id TEXT PRIMARY KEY REFERENCES pomodoro_configs(event_id) ON DELETE CASCADE,
    focus_duration_minutes INTEGER NOT NULL CHECK (focus_duration_minutes > 0),
    short_break_minutes INTEGER NOT NULL CHECK (short_break_minutes > 0),
    long_break_minutes INTEGER NOT NULL CHECK (long_break_minutes > 0),
    long_break_after_focus_count INTEGER NOT NULL CHECK (
        long_break_after_focus_count >= 1 AND long_break_after_focus_count <= 12
    )
);

INSERT INTO pomodoro_config_count_rhythms (
    event_id,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    long_break_after_focus_count
)
SELECT
    event_id,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    long_break_after_focus_count
FROM pomodoro_config_count_rhythms_old;

DROP TABLE pomodoro_config_count_rhythms_old;

ALTER TABLE pomodoro_config_sequence_steps RENAME TO pomodoro_config_sequence_steps_old;

CREATE TABLE pomodoro_config_sequence_steps (
    event_id TEXT NOT NULL REFERENCES pomodoro_configs(event_id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL CHECK (step_index >= 0 AND step_index < 12),
    focus_duration_minutes INTEGER NOT NULL CHECK (focus_duration_minutes > 0),
    break_phase TEXT NOT NULL CHECK (break_phase IN ('short_break', 'long_break')),
    break_duration_minutes INTEGER NOT NULL CHECK (break_duration_minutes > 0),
    PRIMARY KEY (event_id, step_index)
);

INSERT INTO pomodoro_config_sequence_steps (
    event_id,
    step_index,
    focus_duration_minutes,
    break_phase,
    break_duration_minutes
)
SELECT
    event_id,
    step_index,
    focus_duration_minutes,
    break_phase,
    break_duration_minutes
FROM pomodoro_config_sequence_steps_old;

DROP TABLE pomodoro_config_sequence_steps_old;
DROP TABLE pomodoro_configs_old;

ALTER TABLE pomodoro_runs RENAME TO pomodoro_runs_old;

CREATE TABLE pomodoro_runs (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
    original_event_id TEXT NOT NULL,
    event_date TEXT NOT NULL,
    planned_start TEXT NOT NULL,
    planned_end TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('completed', 'stopped', 'interrupted', 'reconfigured', 'block_transition')),
    rhythm_kind TEXT NOT NULL CHECK (rhythm_kind IN ('count', 'sequence')),
    rhythm_source TEXT NOT NULL CHECK (rhythm_source IN ('preset', 'custom')),
    preset_key TEXT CHECK (
        preset_key IS NULL OR preset_key IN ('auto', 'creative', 'balanced', 'deep', 'extended')
    ),
    idle_timeout_minutes INTEGER,
    last_heartbeat TEXT NOT NULL,
    event_title_snapshot TEXT,
    inherited_focus_minutes INTEGER NOT NULL DEFAULT 0,
    inherited_rhythm_position INTEGER NOT NULL DEFAULT 1,
    inherited_from_run_id TEXT REFERENCES pomodoro_runs(id) ON DELETE SET NULL,
    start_trigger TEXT NOT NULL DEFAULT 'manual' CHECK (start_trigger IN ('manual', 'block_auto', 'block_transition', 'reconfigure', 'crash_recovery')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pomodoro_runs (
    id,
    event_id,
    original_event_id,
    event_date,
    planned_start,
    planned_end,
    started_at,
    ended_at,
    end_reason,
    rhythm_kind,
    rhythm_source,
    preset_key,
    idle_timeout_minutes,
    last_heartbeat,
    event_title_snapshot,
    inherited_focus_minutes,
    inherited_rhythm_position,
    inherited_from_run_id,
    start_trigger,
    created_at
)
SELECT
    id,
    event_id,
    original_event_id,
    event_date,
    planned_start,
    planned_end,
    started_at,
    ended_at,
    end_reason,
    rhythm_kind,
    rhythm_source,
    preset_key,
    idle_timeout_minutes,
    last_heartbeat,
    event_title_snapshot,
    inherited_focus_minutes,
    inherited_rhythm_position,
    inherited_from_run_id,
    start_trigger,
    created_at
FROM pomodoro_runs_old;

ALTER TABLE pomodoro_run_count_rhythms RENAME TO pomodoro_run_count_rhythms_old;

CREATE TABLE pomodoro_run_count_rhythms (
    run_id TEXT PRIMARY KEY REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
    focus_duration_minutes INTEGER NOT NULL CHECK (focus_duration_minutes > 0),
    short_break_minutes INTEGER NOT NULL CHECK (short_break_minutes > 0),
    long_break_minutes INTEGER NOT NULL CHECK (long_break_minutes > 0),
    long_break_after_focus_count INTEGER NOT NULL CHECK (
        long_break_after_focus_count >= 1 AND long_break_after_focus_count <= 12
    )
);

INSERT INTO pomodoro_run_count_rhythms (
    run_id,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    long_break_after_focus_count
)
SELECT
    run_id,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    long_break_after_focus_count
FROM pomodoro_run_count_rhythms_old;

DROP TABLE pomodoro_run_count_rhythms_old;

ALTER TABLE pomodoro_run_sequence_steps RENAME TO pomodoro_run_sequence_steps_old;

CREATE TABLE pomodoro_run_sequence_steps (
    run_id TEXT NOT NULL REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL CHECK (step_index >= 0 AND step_index < 12),
    focus_duration_minutes INTEGER NOT NULL CHECK (focus_duration_minutes > 0),
    break_phase TEXT NOT NULL CHECK (break_phase IN ('short_break', 'long_break')),
    break_duration_minutes INTEGER NOT NULL CHECK (break_duration_minutes > 0),
    PRIMARY KEY (run_id, step_index)
);

INSERT INTO pomodoro_run_sequence_steps (
    run_id,
    step_index,
    focus_duration_minutes,
    break_phase,
    break_duration_minutes
)
SELECT
    run_id,
    step_index,
    focus_duration_minutes,
    break_phase,
    break_duration_minutes
FROM pomodoro_run_sequence_steps_old;

DROP TABLE pomodoro_run_sequence_steps_old;

ALTER TABLE pomodoro_segments RENAME TO pomodoro_segments_old;

CREATE TABLE pomodoro_segments (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
    event_date TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
    rhythm_position INTEGER NOT NULL CHECK (rhythm_position > 0),
    phase TEXT NOT NULL CHECK (phase IN ('focus', 'short_break', 'long_break')),
    planned_start TEXT NOT NULL,
    planned_end TEXT NOT NULL,
    actual_start TEXT NOT NULL,
    actual_end TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'interrupted')),
    end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('completed', 'stopped', 'skipped_by_user', 'event_expired', 'focus_failed', 'reconfigured', 'block_transition', 'crash_recovery')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pomodoro_segments (
    id,
    event_id,
    event_date,
    run_id,
    rhythm_position,
    phase,
    planned_start,
    planned_end,
    actual_start,
    actual_end,
    status,
    end_reason,
    created_at
)
SELECT
    id,
    event_id,
    event_date,
    run_id,
    rhythm_position,
    phase,
    planned_start,
    planned_end,
    actual_start,
    actual_end,
    status,
    end_reason,
    created_at
FROM pomodoro_segments_old;

ALTER TABLE pomodoro_pauses RENAME TO pomodoro_pauses_old;

CREATE TABLE pomodoro_pauses (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES pomodoro_segments(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    reason TEXT NOT NULL CHECK (reason IN ('idle', 'manual', 'suspend')),
    detected_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pomodoro_pauses (
    id,
    segment_id,
    started_at,
    ended_at,
    reason,
    detected_at,
    created_at
)
SELECT
    id,
    segment_id,
    started_at,
    ended_at,
    reason,
    detected_at,
    created_at
FROM pomodoro_pauses_old;

DROP TABLE pomodoro_pauses_old;

ALTER TABLE pomodoro_run_events RENAME TO pomodoro_run_events_old;

CREATE TABLE pomodoro_run_events (
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

INSERT INTO pomodoro_run_events (
    id,
    run_id,
    segment_id,
    event_type,
    occurred_at,
    phase,
    reason,
    duration_seconds,
    created_at
)
SELECT
    id,
    run_id,
    segment_id,
    event_type,
    occurred_at,
    phase,
    reason,
    duration_seconds,
    created_at
FROM pomodoro_run_events_old;

DROP TABLE pomodoro_run_events_old;
DROP TABLE pomodoro_segments_old;
DROP TABLE pomodoro_runs_old;

CREATE INDEX idx_pomodoro_runs_event_date ON pomodoro_runs(event_id, event_date);
CREATE INDEX idx_pomodoro_runs_original_event ON pomodoro_runs(original_event_id);
CREATE INDEX idx_pomodoro_runs_open ON pomodoro_runs(ended_at);
CREATE UNIQUE INDEX idx_pomodoro_runs_single_open ON pomodoro_runs((1)) WHERE ended_at IS NULL;
CREATE INDEX idx_pomodoro_segments_event ON pomodoro_segments(event_id, event_date);
CREATE INDEX idx_pomodoro_segments_run ON pomodoro_segments(run_id);
CREATE INDEX idx_pomodoro_segments_run_actual ON pomodoro_segments(run_id, actual_start);
CREATE UNIQUE INDEX idx_pomodoro_segments_single_active ON pomodoro_segments((1)) WHERE status = 'active';
CREATE INDEX idx_pomodoro_pauses_segment ON pomodoro_pauses(segment_id, started_at);
CREATE INDEX idx_pomodoro_pauses_reason ON pomodoro_pauses(reason, started_at);
CREATE UNIQUE INDEX idx_pomodoro_pauses_single_open_per_segment ON pomodoro_pauses(segment_id) WHERE ended_at IS NULL;
CREATE INDEX idx_pomodoro_run_events_run ON pomodoro_run_events(run_id, occurred_at);

ALTER TABLE calendar_event_archive_pomodoro_configs RENAME TO calendar_event_archive_pomodoro_configs_old;

CREATE TABLE calendar_event_archive_pomodoro_configs (
    archive_event_id TEXT PRIMARY KEY REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    rhythm_kind TEXT NOT NULL CHECK (rhythm_kind IN ('count', 'sequence')),
    rhythm_source TEXT NOT NULL CHECK (rhythm_source IN ('preset', 'custom')),
    preset_key TEXT CHECK (
        preset_key IS NULL OR preset_key IN ('auto', 'creative', 'balanced', 'deep', 'extended')
    ),
    idle_timeout_minutes INTEGER CHECK (idle_timeout_minutes IS NULL OR idle_timeout_minutes > 0)
);

INSERT INTO calendar_event_archive_pomodoro_configs (
    archive_event_id,
    rhythm_kind,
    rhythm_source,
    preset_key,
    idle_timeout_minutes
)
SELECT
    archive_event_id,
    rhythm_kind,
    rhythm_source,
    preset_key,
    idle_timeout_minutes
FROM calendar_event_archive_pomodoro_configs_old;

ALTER TABLE calendar_event_archive_pomodoro_config_count_rhythms RENAME TO calendar_event_archive_pomodoro_config_count_rhythms_old;

CREATE TABLE calendar_event_archive_pomodoro_config_count_rhythms (
    archive_event_id TEXT PRIMARY KEY REFERENCES calendar_event_archive_pomodoro_configs(archive_event_id) ON DELETE CASCADE,
    focus_duration_minutes INTEGER NOT NULL CHECK (focus_duration_minutes > 0),
    short_break_minutes INTEGER NOT NULL CHECK (short_break_minutes > 0),
    long_break_minutes INTEGER NOT NULL CHECK (long_break_minutes > 0),
    long_break_after_focus_count INTEGER NOT NULL CHECK (
        long_break_after_focus_count >= 1 AND long_break_after_focus_count <= 12
    )
);

INSERT INTO calendar_event_archive_pomodoro_config_count_rhythms (
    archive_event_id,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    long_break_after_focus_count
)
SELECT
    archive_event_id,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    long_break_after_focus_count
FROM calendar_event_archive_pomodoro_config_count_rhythms_old;

DROP TABLE calendar_event_archive_pomodoro_config_count_rhythms_old;

ALTER TABLE calendar_event_archive_pomodoro_config_sequence_steps RENAME TO calendar_event_archive_pomodoro_config_sequence_steps_old;

CREATE TABLE calendar_event_archive_pomodoro_config_sequence_steps (
    archive_event_id TEXT NOT NULL REFERENCES calendar_event_archive_pomodoro_configs(archive_event_id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL CHECK (step_index >= 0 AND step_index < 12),
    focus_duration_minutes INTEGER NOT NULL CHECK (focus_duration_minutes > 0),
    break_phase TEXT NOT NULL CHECK (break_phase IN ('short_break', 'long_break')),
    break_duration_minutes INTEGER NOT NULL CHECK (break_duration_minutes > 0),
    PRIMARY KEY (archive_event_id, step_index)
);

INSERT INTO calendar_event_archive_pomodoro_config_sequence_steps (
    archive_event_id,
    step_index,
    focus_duration_minutes,
    break_phase,
    break_duration_minutes
)
SELECT
    archive_event_id,
    step_index,
    focus_duration_minutes,
    break_phase,
    break_duration_minutes
FROM calendar_event_archive_pomodoro_config_sequence_steps_old;

DROP TABLE calendar_event_archive_pomodoro_config_sequence_steps_old;
DROP TABLE calendar_event_archive_pomodoro_configs_old;

-- Accepted execution metadata and request receipts share the history transaction.
-- Existing run and segment rows remain the evidence for phases that actually started.
CREATE TABLE focus_execution_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    state_json TEXT NOT NULL CHECK (
        json_valid(state_json) AND json_type(state_json) = 'object'
        AND length(CAST(state_json AS BLOB)) <= 65536
    ),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

INSERT INTO focus_execution_state (singleton, state_json, updated_at_ms)
VALUES (1, '{}', 0);

CREATE TABLE focus_execution_receipts (
    command_id TEXT PRIMARY KEY CHECK (length(command_id) BETWEEN 1 AND 128),
    request_json TEXT NOT NULL CHECK (
        json_valid(request_json) AND json_type(request_json) = 'object'
        AND length(CAST(request_json AS BLOB)) <= 65536
    ),
    result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND json_type(result_json) = 'object'
        AND length(CAST(result_json AS BLOB)) <= 262144
    ),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0)
);

-- Retain precise inherited work without reinterpreting existing minute snapshots.
ALTER TABLE pomodoro_runs ADD COLUMN inherited_focus_milliseconds INTEGER
    CHECK (inherited_focus_milliseconds IS NULL OR inherited_focus_milliseconds >= 0);
ALTER TABLE pomodoro_runs ADD COLUMN inherited_phase_milliseconds INTEGER
    CHECK (inherited_phase_milliseconds IS NULL OR inherited_phase_milliseconds >= 0);

-- The accepted work budget is distinct from a deadline clipped by the event window.
-- Native execution fills this value before committing a new segment.
ALTER TABLE pomodoro_segments ADD COLUMN chosen_duration_ms INTEGER
    CHECK (chosen_duration_ms IS NULL OR chosen_duration_ms > 0);

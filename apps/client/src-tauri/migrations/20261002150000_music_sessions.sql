CREATE TABLE music_session_checkpoints (
    device_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    checkpoint_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE music_session_receipts (
    device_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    committed_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, action_id)
);

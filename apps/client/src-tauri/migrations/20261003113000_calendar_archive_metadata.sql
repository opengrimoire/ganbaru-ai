-- Archive identity is independent from the original recurrence identity.
-- Older archives retain their established identity when this column is NULL.
ALTER TABLE calendar_events_archive ADD COLUMN original_occurrence_id TEXT;
ALTER TABLE calendar_events_archive ADD COLUMN recurrence_date TEXT
    CHECK (recurrence_date IS NULL OR length(recurrence_date) = 10);

-- A nullable projection reference identifies the exact historical snapshot.
-- Original execution identity and timestamps remain immutable.
ALTER TABLE pomodoro_runs ADD COLUMN calendar_archive_id TEXT
    REFERENCES calendar_events_archive(id) ON DELETE SET NULL;
CREATE INDEX idx_pomodoro_runs_calendar_archive ON pomodoro_runs(calendar_archive_id);

CREATE TABLE calendar_event_archive_import_objects (
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    object_id TEXT NOT NULL REFERENCES icalendar_objects(id) ON DELETE CASCADE,
    PRIMARY KEY (archive_event_id, object_id)
);
CREATE INDEX idx_calendar_archive_import_objects_object
    ON calendar_event_archive_import_objects(object_id);
CREATE INDEX idx_calendar_archive_component ON calendar_events_archive(icalendar_component_id);
CREATE INDEX idx_calendar_archive_alarm_component ON calendar_event_archive_alarms(icalendar_component_id);
CREATE INDEX idx_calendar_archive_attendee_component ON calendar_event_archive_attendees(icalendar_component_id);
CREATE INDEX idx_calendar_archive_override_component ON calendar_event_archive_overrides(icalendar_component_id);

CREATE TABLE calendar_event_archive_task_links (
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL CHECK (trim(task_id) <> ''),
    link_kind TEXT NOT NULL CHECK (link_kind IN ('scheduled', 'reference')),
    created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
    PRIMARY KEY (archive_event_id, task_id)
);

-- Preserve independent snapshot and override assignments, including versions.
-- Referenced library identities are historical facts and do not cascade away.
CREATE TABLE calendar_event_archive_music_assignments (
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('event-snapshot', 'event-override')),
    phase TEXT NOT NULL CHECK (phase IN ('focus', 'short-break', 'long-break')),
    behavior TEXT NOT NULL CHECK (behavior IN (
        'inherit', 'play-automatically', 'prepare-silently', 'pause-music', 'keep-current-music'
    )),
    playlist_id TEXT,
    soundscape_id TEXT,
    provenance_kind TEXT NOT NULL CHECK (provenance_kind IN ('explicit', 'copied-project', 'work-environment')),
    provenance_id TEXT,
    updated_at INTEGER NOT NULL CHECK (updated_at > 0),
    version INTEGER NOT NULL CHECK (version > 0),
    soundscape_behavior TEXT NOT NULL CHECK (soundscape_behavior IN (
        'inherit', 'play-selected', 'pause-soundscape', 'keep-current-soundscape'
    )),
    PRIMARY KEY (archive_event_id, owner_kind, phase)
);

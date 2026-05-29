CREATE TABLE calendars (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    name TEXT NOT NULL CHECK (trim(name) <> ''),
    color TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'ics')),
    visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
    read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
    source_url TEXT,
    last_synced TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (trim(created_at) <> ''),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (trim(updated_at) <> '')
);

INSERT INTO calendars
    (id, name, color, source, visible, read_only, created_at, updated_at)
VALUES (
    'local',
    'Ganbaru AI',
    '',
    'local',
    1,
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE icalendar_objects (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('import-file', 'import-zip-entry', 'local-export-base', 'subscription')),
    source_name TEXT NOT NULL DEFAULT '',
    source_fingerprint TEXT NOT NULL,
    prodid TEXT,
    version TEXT,
    method TEXT,
    calendar_scale TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_icalendar_objects_calendar ON icalendar_objects(calendar_id);
CREATE INDEX idx_icalendar_objects_source ON icalendar_objects(calendar_id, source_kind, source_name);
CREATE INDEX idx_icalendar_objects_fingerprint ON icalendar_objects(source_fingerprint);

CREATE TABLE icalendar_components (
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
    preservation_status TEXT NOT NULL CHECK (preservation_status IN ('lossless', 'partial', 'unsupported', 'needs-review', 'regenerated', 'invalid')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_icalendar_components_calendar_type ON icalendar_components(calendar_id, component_type);
CREATE INDEX idx_icalendar_components_uid ON icalendar_components(calendar_id, uid);
CREATE INDEX idx_icalendar_components_uid_recurrence ON icalendar_components(calendar_id, uid, recurrence_id);
CREATE INDEX idx_icalendar_components_projection ON icalendar_components(projected_kind, projected_id);
CREATE INDEX idx_icalendar_components_status ON icalendar_components(preservation_status);
CREATE INDEX idx_icalendar_components_object ON icalendar_components(object_id);

CREATE TABLE icalendar_component_properties (
    id TEXT PRIMARY KEY,
    component_id TEXT NOT NULL REFERENCES icalendar_components(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value_type TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_icalendar_properties_component ON icalendar_component_properties(component_id, sort_order);

CREATE TABLE icalendar_property_parameters (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES icalendar_component_properties(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_icalendar_parameters_property ON icalendar_property_parameters(property_id, sort_order);

CREATE TABLE icalendar_value_nodes (
    id TEXT PRIMARY KEY,
    property_id TEXT REFERENCES icalendar_component_properties(id) ON DELETE CASCADE,
    parameter_id TEXT REFERENCES icalendar_property_parameters(id) ON DELETE CASCADE,
    parent_node_id TEXT REFERENCES icalendar_value_nodes(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    value_kind TEXT NOT NULL CHECK (value_kind IN ('array', 'object', 'text', 'number', 'boolean', 'null')),
    object_key TEXT,
    text_value TEXT,
    number_value REAL,
    boolean_value INTEGER
);
CREATE INDEX idx_icalendar_value_nodes_property ON icalendar_value_nodes(property_id, parent_node_id, sort_order);
CREATE INDEX idx_icalendar_value_nodes_parameter ON icalendar_value_nodes(parameter_id, parent_node_id, sort_order);
CREATE INDEX idx_icalendar_value_nodes_parent ON icalendar_value_nodes(parent_node_id, sort_order);

CREATE TABLE icalendar_object_diagnostics (
    id TEXT PRIMARY KEY,
    object_id TEXT NOT NULL REFERENCES icalendar_objects(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_icalendar_object_diagnostics_object ON icalendar_object_diagnostics(object_id, sort_order);

CREATE TABLE icalendar_component_projection_warnings (
    id TEXT PRIMARY KEY,
    component_id TEXT NOT NULL REFERENCES icalendar_components(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_icalendar_projection_warnings_component ON icalendar_component_projection_warnings(component_id, sort_order);

CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    title TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL CHECK (trim(start_time) <> ''),
    end_time TEXT NOT NULL CHECK (trim(end_time) <> ''),
    timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (trim(timezone) <> ''),
    calendar_id TEXT NOT NULL DEFAULT 'local' REFERENCES calendars(id) ON DELETE RESTRICT,
    color INTEGER CHECK (color IS NULL OR (color >= 0 AND color < 32)),
    description TEXT NOT NULL DEFAULT '',
    rrule TEXT,
    repeat_until TEXT,
    environment_id TEXT,
    playlist_id TEXT,
    all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
    location TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    transparency TEXT NOT NULL DEFAULT 'opaque' CHECK (transparency IN ('opaque', 'transparent')),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    source_uid TEXT,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    priority INTEGER CHECK (priority IS NULL OR (priority >= 0 AND priority <= 9)),
    geo_lat REAL,
    geo_lng REAL,
    sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    guest_can_modify INTEGER NOT NULL DEFAULT 0 CHECK (guest_can_modify IN (0, 1)),
    guest_can_invite_others INTEGER NOT NULL DEFAULT 1 CHECK (guest_can_invite_others IN (0, 1)),
    guest_can_see_other_guests INTEGER NOT NULL DEFAULT 1 CHECK (guest_can_see_other_guests IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (trim(created_at) <> ''),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (trim(updated_at) <> ''),
    icalendar_component_id TEXT REFERENCES icalendar_components(id) ON DELETE SET NULL,
    local_rsvp_status TEXT CHECK (local_rsvp_status IS NULL OR local_rsvp_status IN ('needs-action', 'accepted', 'declined', 'tentative', 'delegated')),
    meeting_enabled INTEGER NOT NULL DEFAULT 0 CHECK (meeting_enabled IN (0, 1)),
    CHECK (
        (geo_lat IS NULL AND geo_lng IS NULL)
        OR (
            geo_lat IS NOT NULL
            AND geo_lng IS NOT NULL
            AND geo_lat >= -90
            AND geo_lat <= 90
            AND geo_lng >= -180
            AND geo_lng <= 180
        )
    )
);
CREATE INDEX idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX idx_calendar_events_end ON calendar_events(end_time);
CREATE INDEX idx_calendar_events_calendar ON calendar_events(calendar_id);
CREATE UNIQUE INDEX idx_calendar_events_source_uid ON calendar_events(calendar_id, source_uid);
CREATE INDEX idx_calendar_events_icalendar_component ON calendar_events(icalendar_component_id);

CREATE TABLE calendar_event_overrides (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    parent_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    recurrence_id TEXT NOT NULL CHECK (trim(recurrence_id) <> ''),
    title TEXT,
    start_time TEXT,
    end_time TEXT,
    description TEXT,
    location TEXT,
    url TEXT,
    color INTEGER CHECK (color IS NULL OR (color >= 0 AND color < 32)),
    status TEXT CHECK (status IS NULL OR status IN ('confirmed', 'tentative', 'cancelled')),
    transparency TEXT CHECK (transparency IS NULL OR transparency IN ('opaque', 'transparent')),
    visibility TEXT CHECK (visibility IS NULL OR visibility IN ('public', 'private')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (trim(created_at) <> ''),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (trim(updated_at) <> ''),
    icalendar_component_id TEXT REFERENCES icalendar_components(id) ON DELETE SET NULL,
    recurrence_range TEXT CHECK (recurrence_range IS NULL OR recurrence_range = 'this-and-future')
);
CREATE UNIQUE INDEX idx_overrides_parent_recid ON calendar_event_overrides(parent_event_id, recurrence_id);
CREATE INDEX idx_overrides_icalendar_component ON calendar_event_overrides(icalendar_component_id);

CREATE TABLE calendar_event_attendees (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT NOT NULL CHECK (trim(email) <> ''),
    role TEXT NOT NULL DEFAULT 'req-participant' CHECK (role IN ('chair', 'req-participant', 'opt-participant', 'non-participant')),
    status TEXT NOT NULL DEFAULT 'needs-action' CHECK (status IN ('needs-action', 'accepted', 'declined', 'tentative', 'delegated')),
    rsvp INTEGER NOT NULL DEFAULT 0 CHECK (rsvp IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    icalendar_component_id TEXT REFERENCES icalendar_components(id) ON DELETE SET NULL,
    icalendar_property_index INTEGER CHECK (icalendar_property_index IS NULL OR icalendar_property_index >= 0)
);
CREATE INDEX idx_attendees_event ON calendar_event_attendees(event_id);
CREATE INDEX idx_attendees_icalendar_component ON calendar_event_attendees(icalendar_component_id);

CREATE TABLE calendar_event_alarms (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    action TEXT NOT NULL DEFAULT 'display' CHECK (action IN ('display', 'audio', 'email')),
    trigger_type TEXT NOT NULL DEFAULT 'relative' CHECK (trigger_type IN ('relative', 'absolute')),
    trigger_value TEXT NOT NULL CHECK (trim(trigger_value) <> ''),
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    icalendar_component_id TEXT REFERENCES icalendar_components(id) ON DELETE SET NULL
);
CREATE INDEX idx_alarms_event ON calendar_event_alarms(event_id);
CREATE INDEX idx_alarms_icalendar_component ON calendar_event_alarms(icalendar_component_id);

CREATE TABLE calendar_event_notifications (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    offset_minutes INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);
CREATE INDEX idx_event_notifications_event ON calendar_event_notifications(event_id, sort_order);

CREATE TABLE calendar_event_exdates (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    occurrence_date TEXT NOT NULL CHECK (trim(occurrence_date) <> ''),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);
CREATE UNIQUE INDEX idx_event_exdates_event_date ON calendar_event_exdates(event_id, occurrence_date);

CREATE TABLE calendar_event_rdates (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    occurrence_start TEXT NOT NULL CHECK (trim(occurrence_start) <> ''),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);
CREATE UNIQUE INDEX idx_event_rdates_event_start ON calendar_event_rdates(event_id, occurrence_start);

CREATE TABLE calendar_event_categories (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (trim(category) <> ''),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);
CREATE INDEX idx_event_categories_event ON calendar_event_categories(event_id, sort_order);

CREATE TABLE calendar_event_extended_properties (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    property_key TEXT NOT NULL CHECK (trim(property_key) <> ''),
    property_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);
CREATE UNIQUE INDEX idx_event_extended_properties_key ON calendar_event_extended_properties(event_id, property_key);

CREATE TABLE calendar_event_override_extended_properties (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    override_id TEXT NOT NULL REFERENCES calendar_event_overrides(id) ON DELETE CASCADE,
    property_key TEXT NOT NULL CHECK (trim(property_key) <> ''),
    property_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);
CREATE UNIQUE INDEX idx_override_extended_properties_key ON calendar_event_override_extended_properties(override_id, property_key);

CREATE TABLE calendar_event_organizers (
    event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT NOT NULL CHECK (trim(email) <> '')
);

CREATE TABLE pomodoro_configs (
    event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
    focus_duration_minutes INTEGER NOT NULL DEFAULT 40 CHECK (focus_duration_minutes > 0),
    short_break_minutes INTEGER NOT NULL DEFAULT 5 CHECK (short_break_minutes > 0),
    long_break_minutes INTEGER NOT NULL DEFAULT 10 CHECK (long_break_minutes > 0),
    pomodoro_count INTEGER NOT NULL DEFAULT 4 CHECK (pomodoro_count > 0),
    idle_timeout_minutes INTEGER CHECK (idle_timeout_minutes IS NULL OR idle_timeout_minutes > 0)
);

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
    start_trigger TEXT NOT NULL DEFAULT 'manual' CHECK (start_trigger IN ('manual', 'block_auto', 'block_transition', 'reconfigure', 'crash_recovery')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pomodoro_runs_event_date ON pomodoro_runs(event_id, event_date);
CREATE INDEX idx_pomodoro_runs_original_event ON pomodoro_runs(original_event_id);
CREATE INDEX idx_pomodoro_runs_open ON pomodoro_runs(ended_at);
CREATE UNIQUE INDEX idx_pomodoro_runs_single_open ON pomodoro_runs((1)) WHERE ended_at IS NULL;

CREATE TABLE pomodoro_segments (
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
    end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('completed', 'stopped', 'skipped_by_user', 'event_expired', 'reconfigured', 'block_transition', 'crash_recovery')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pomodoro_segments_event ON pomodoro_segments(event_id, event_date);
CREATE INDEX idx_pomodoro_segments_run ON pomodoro_segments(run_id);
CREATE INDEX idx_pomodoro_segments_run_actual ON pomodoro_segments(run_id, actual_start);
CREATE UNIQUE INDEX idx_pomodoro_segments_single_active ON pomodoro_segments((1)) WHERE status = 'active';

CREATE TABLE pomodoro_pauses (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES pomodoro_segments(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    reason TEXT NOT NULL CHECK (reason IN ('idle', 'manual', 'suspend')),
    detected_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pomodoro_pauses_segment ON pomodoro_pauses(segment_id, started_at);
CREATE INDEX idx_pomodoro_pauses_reason ON pomodoro_pauses(reason, started_at);
CREATE UNIQUE INDEX idx_pomodoro_pauses_single_open_per_segment ON pomodoro_pauses(segment_id) WHERE ended_at IS NULL;

CREATE TABLE pomodoro_run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES pomodoro_runs(id) ON DELETE CASCADE,
    segment_id TEXT REFERENCES pomodoro_segments(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('start', 'phase_start', 'phase_complete', 'pause_start', 'pause_end', 'idle_detected', 'suspend_detected', 'skip_break', 'extend_focus', 'reconfigure', 'block_transition', 'stop', 'complete', 'crash_recovery')),
    occurred_at TEXT NOT NULL,
    phase TEXT CHECK (phase IS NULL OR phase IN ('focus', 'short_break', 'long_break')),
    reason TEXT,
    duration_seconds INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pomodoro_run_events_run ON pomodoro_run_events(run_id, occurred_at);

CREATE TABLE calendar_events_archive (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    source_event_id TEXT NOT NULL CHECK (trim(source_event_id) <> ''),
    archived_at TEXT NOT NULL CHECK (trim(archived_at) <> ''),
    title TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL CHECK (trim(start_time) <> ''),
    end_time TEXT NOT NULL CHECK (trim(end_time) <> ''),
    timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (trim(timezone) <> ''),
    calendar_id TEXT NOT NULL CHECK (trim(calendar_id) <> ''),
    color INTEGER CHECK (color IS NULL OR (color >= 0 AND color < 32)),
    description TEXT NOT NULL DEFAULT '',
    rrule TEXT,
    repeat_until TEXT,
    environment_id TEXT,
    playlist_id TEXT,
    all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
    location TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    transparency TEXT NOT NULL DEFAULT 'opaque' CHECK (transparency IN ('opaque', 'transparent')),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    source_uid TEXT,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    priority INTEGER CHECK (priority IS NULL OR (priority >= 0 AND priority <= 9)),
    geo_lat REAL,
    geo_lng REAL,
    sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    guest_can_modify INTEGER NOT NULL DEFAULT 0 CHECK (guest_can_modify IN (0, 1)),
    guest_can_invite_others INTEGER NOT NULL DEFAULT 1 CHECK (guest_can_invite_others IN (0, 1)),
    guest_can_see_other_guests INTEGER NOT NULL DEFAULT 1 CHECK (guest_can_see_other_guests IN (0, 1)),
    created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
    updated_at TEXT NOT NULL CHECK (trim(updated_at) <> ''),
    icalendar_component_id TEXT,
    local_rsvp_status TEXT CHECK (local_rsvp_status IS NULL OR local_rsvp_status IN ('needs-action', 'accepted', 'declined', 'tentative', 'delegated')),
    meeting_enabled INTEGER NOT NULL DEFAULT 0 CHECK (meeting_enabled IN (0, 1)),
    CHECK (
        (geo_lat IS NULL AND geo_lng IS NULL)
        OR (
            geo_lat IS NOT NULL
            AND geo_lng IS NOT NULL
            AND geo_lat >= -90
            AND geo_lat <= 90
            AND geo_lng >= -180
            AND geo_lng <= 180
        )
    )
);
CREATE INDEX idx_calendar_events_archive_source ON calendar_events_archive(source_event_id);
CREATE INDEX idx_calendar_events_archive_calendar ON calendar_events_archive(calendar_id);

CREATE TABLE calendar_event_archive_pomodoro_configs (
    archive_event_id TEXT PRIMARY KEY REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    focus_duration_minutes INTEGER NOT NULL CHECK (focus_duration_minutes > 0),
    short_break_minutes INTEGER NOT NULL CHECK (short_break_minutes > 0),
    long_break_minutes INTEGER NOT NULL CHECK (long_break_minutes > 0),
    pomodoro_count INTEGER NOT NULL CHECK (pomodoro_count > 0),
    idle_timeout_minutes INTEGER CHECK (idle_timeout_minutes IS NULL OR idle_timeout_minutes > 0)
);

CREATE TABLE calendar_event_archive_notifications (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    offset_minutes INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

CREATE TABLE calendar_event_archive_exdates (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    occurrence_date TEXT NOT NULL CHECK (trim(occurrence_date) <> ''),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

CREATE TABLE calendar_event_archive_rdates (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    occurrence_start TEXT NOT NULL CHECK (trim(occurrence_start) <> ''),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

CREATE TABLE calendar_event_archive_categories (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (trim(category) <> ''),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

CREATE TABLE calendar_event_archive_extended_properties (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    property_key TEXT NOT NULL CHECK (trim(property_key) <> ''),
    property_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

CREATE TABLE calendar_event_archive_organizers (
    archive_event_id TEXT PRIMARY KEY REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT NOT NULL CHECK (trim(email) <> '')
);

CREATE TABLE calendar_event_archive_attendees (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    source_attendee_id TEXT NOT NULL CHECK (trim(source_attendee_id) <> ''),
    name TEXT,
    email TEXT NOT NULL CHECK (trim(email) <> ''),
    role TEXT NOT NULL DEFAULT 'req-participant' CHECK (role IN ('chair', 'req-participant', 'opt-participant', 'non-participant')),
    status TEXT NOT NULL DEFAULT 'needs-action' CHECK (status IN ('needs-action', 'accepted', 'declined', 'tentative', 'delegated')),
    rsvp INTEGER NOT NULL DEFAULT 0 CHECK (rsvp IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    icalendar_component_id TEXT,
    icalendar_property_index INTEGER CHECK (icalendar_property_index IS NULL OR icalendar_property_index >= 0)
);

CREATE TABLE calendar_event_archive_alarms (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    source_alarm_id TEXT NOT NULL CHECK (trim(source_alarm_id) <> ''),
    action TEXT NOT NULL DEFAULT 'display' CHECK (action IN ('display', 'audio', 'email')),
    trigger_type TEXT NOT NULL DEFAULT 'relative' CHECK (trigger_type IN ('relative', 'absolute')),
    trigger_value TEXT NOT NULL CHECK (trim(trigger_value) <> ''),
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    icalendar_component_id TEXT
);

CREATE TABLE calendar_event_archive_overrides (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_event_id TEXT NOT NULL REFERENCES calendar_events_archive(id) ON DELETE CASCADE,
    source_override_id TEXT NOT NULL CHECK (trim(source_override_id) <> ''),
    recurrence_id TEXT NOT NULL CHECK (trim(recurrence_id) <> ''),
    title TEXT,
    start_time TEXT,
    end_time TEXT,
    description TEXT,
    location TEXT,
    url TEXT,
    color INTEGER CHECK (color IS NULL OR (color >= 0 AND color < 32)),
    status TEXT CHECK (status IS NULL OR status IN ('confirmed', 'tentative', 'cancelled')),
    transparency TEXT CHECK (transparency IS NULL OR transparency IN ('opaque', 'transparent')),
    visibility TEXT CHECK (visibility IS NULL OR visibility IN ('public', 'private')),
    created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
    updated_at TEXT NOT NULL CHECK (trim(updated_at) <> ''),
    icalendar_component_id TEXT,
    recurrence_range TEXT CHECK (recurrence_range IS NULL OR recurrence_range = 'this-and-future')
);
CREATE INDEX idx_calendar_event_archive_overrides_source ON calendar_event_archive_overrides(source_override_id);

CREATE TABLE calendar_event_archive_override_extended_properties (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    archive_override_id TEXT NOT NULL REFERENCES calendar_event_archive_overrides(id) ON DELETE CASCADE,
    property_key TEXT NOT NULL CHECK (trim(property_key) <> ''),
    property_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

CREATE TABLE themes (
    id TEXT PRIMARY KEY CHECK (id NOT IN ('light', 'dark')),
    display_name TEXT NOT NULL,
    blend_canvas TEXT NOT NULL,
    seed_blend_canvas TEXT NOT NULL,
    derivation_engine_version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    icon_label TEXT,
    seed_icon_label TEXT,
    calendar_default_mode TEXT NOT NULL DEFAULT 'app-canvas' CHECK (calendar_default_mode IN ('light', 'dark', 'app-canvas', 'custom')),
    calendar_default_custom TEXT NOT NULL DEFAULT '#27282A',
    seed_calendar_default_mode TEXT NOT NULL DEFAULT 'app-canvas' CHECK (seed_calendar_default_mode IN ('light', 'dark', 'app-canvas', 'custom')),
    seed_calendar_default_custom TEXT NOT NULL DEFAULT '#27282A'
);

CREATE TABLE theme_tokens (
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('source', 'app', 'calendar')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    isolated INTEGER NOT NULL DEFAULT 0 CHECK (isolated IN (0, 1)),
    PRIMARY KEY (theme_id, kind, key)
);
CREATE INDEX idx_theme_tokens_kind ON theme_tokens(theme_id, kind);

CREATE TABLE theme_event_palette (
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
    value TEXT NOT NULL,
    PRIMARY KEY (theme_id, slot)
);

CREATE TABLE theme_seed_tokens (
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('source', 'app', 'calendar')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    isolated INTEGER NOT NULL DEFAULT 0 CHECK (isolated IN (0, 1)),
    PRIMARY KEY (theme_id, kind, key)
);
CREATE INDEX idx_theme_seed_tokens_kind ON theme_seed_tokens(theme_id, kind);

CREATE TABLE theme_seed_event_palette (
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 32),
    value TEXT NOT NULL,
    PRIMARY KEY (theme_id, slot)
);

CREATE TABLE theme_upgrade_dismissals (
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    engine_version INTEGER NOT NULL,
    dismissed_at INTEGER NOT NULL,
    PRIMARY KEY (theme_id, engine_version)
);

CREATE TABLE music_playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE music_playlist_tracks (
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
CREATE INDEX idx_music_playlist_tracks_playlist_position ON music_playlist_tracks(playlist_id, position);
CREATE INDEX idx_music_playlist_tracks_source_identity ON music_playlist_tracks(source_identity);

CREATE TABLE music_track_skip_ranges (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL REFERENCES music_playlist_tracks(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
    end_ms INTEGER NOT NULL CHECK (end_ms >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CHECK (end_ms >= start_ms)
);
CREATE INDEX idx_music_track_skip_ranges_track ON music_track_skip_ranges(track_id, sort_order);

CREATE TABLE music_track_break_sources (
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

CREATE TABLE music_playback_states (
    source_identity TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('local-file', 'youtube-video', 'youtube-playlist')),
    position_ms INTEGER NOT NULL CHECK (position_ms >= 0),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    status TEXT NOT NULL CHECK (status IN ('idle', 'loading', 'ready', 'playing', 'paused', 'ended', 'error')),
    updated_at INTEGER NOT NULL
);

CREATE TABLE doomscrolling_usage_samples (
    id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
    source_type TEXT NOT NULL CHECK (source_type IN ('website', 'desktop-app', 'mobile-app')),
    source_key TEXT NOT NULL CHECK (trim(source_key) <> ''),
    display_name TEXT,
    started_at INTEGER NOT NULL CHECK (started_at >= 0),
    elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds > 0 AND elapsed_seconds <= 86400),
    local_date TEXT NOT NULL CHECK (
        length(local_date) = 10
        AND substr(local_date, 5, 1) = '-'
        AND substr(local_date, 8, 1) = '-'
    ),
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
);
CREATE INDEX idx_doomscrolling_usage_samples_date_source ON doomscrolling_usage_samples(local_date, source_type, source_key);
CREATE INDEX idx_doomscrolling_usage_samples_started ON doomscrolling_usage_samples(started_at);

-- Live Calendar references may change without rewriting execution provenance.
ALTER TABLE pomodoro_runs ADD COLUMN current_occurrence_id TEXT
CHECK (current_occurrence_id IS NULL OR trim(current_occurrence_id) <> '');
ALTER TABLE pomodoro_runs ADD COLUMN current_event_date TEXT
CHECK (current_event_date IS NULL OR trim(current_event_date) <> '');
ALTER TABLE pomodoro_runs ADD COLUMN current_event_title TEXT;

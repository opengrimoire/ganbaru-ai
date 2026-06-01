DELETE FROM pomodoro_configs
WHERE event_id IN (
    SELECT id FROM calendar_events WHERE all_day = 1
);

DELETE FROM calendar_event_archive_pomodoro_configs
WHERE archive_event_id IN (
    SELECT id FROM calendar_events_archive WHERE all_day = 1
);

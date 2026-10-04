# Calendar

Calendar is the time anchor for Ganbaru AI. Focus sessions, project scheduling, music automation, notifications, and future work environments attach to calendar events, so correctness and durable history take priority over feature breadth.

**Status: Partial.** The principal views, native canonical recurrence, reviewed scoped editing, deletion and Undo are implemented. Shared fixtures and transaction tests cover supported recurrence and Focus reference behavior. Real desktop/Android acceptance remains required; unsupported imported recurrence keeps its explicit preservation limits.

## Current scope

| Capability | Status |
| --- | --- |
| Day, work-cycle, week, and month views | Implemented |
| Timed and all-day event creation and editing | Implemented |
| Multiple calendars, visibility, colors, and deletion safeguards | Implemented |
| Notifications and platform delivery | Implemented |
| Native recurrence expansion and reviewed scoped editing | Implemented with documented supported-rule limits; physical acceptance pending |
| iCalendar import, export, preservation, and recurrence interop | Implemented with documented limits |
| Project, task, Pomodoro, and music linkage | Implemented |
| Shared-calendar identity and attendee write permissions | Planned |

## Event identity and history

Calendar events are structured SQLite data. An event title may be empty; every calendar surface renders a localized untitled-event fallback when it is. Empty titles remain valid because fast block creation and imported events should not be rejected solely for lacking a label.

Timed events store canonical instants and an IANA home zone. By default, display follows the device zone; an optional preference can preserve home-zone display. All-day events are floating date ranges and stay on the same dates across time zones.

Started, tracked, active, or otherwise referenced events are protected history. Operations that would remove or reinterpret them archive, cap, or materialize them instead of silently deleting them. Future untracked events can be deleted when no durable reference depends on them.

## Cross-feature linkage

- **Pomodoro:** an event can own focus settings and the active run identity. See [Pomodoro](../pomodoro/README.md).
- **Projects:** events and tasks can share a project and explicit task-event links. See [Projects](../projects/README.md).
- **Music:** projects and events can provide phase soundtrack assignments. See [Music automation](../music/automation.md).
- **Doomscrolling:** Pomodoro phase state can activate current blocker snapshots. See [Doomscrolling activation](../doomscrolling/rules-and-activation.md).
- **Work environments:** planned environment context can add portable defaults and platform-specific actions. See [Work environments](../work-environments.md).

## Documentation map

- [Views and navigation](views-and-navigation.md)
- [Event editing](event-editing.md)
- [Recurrence model](recurrence.md)
- [Recurrence editing](recurrence-editing.md)
- [Deletion and undo](deletion-and-undo.md)
- [iCalendar interoperability](../../interop/icalendar/README.md)
- [Recurrence expansion algorithm](../../algorithms/calendar/recurrence-expansion.md)
- [Time-conflict detection](../../algorithms/calendar/time-conflict-detection.md)

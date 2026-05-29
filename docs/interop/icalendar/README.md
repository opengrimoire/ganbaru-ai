# iCalendar compatibility

This folder is the planning hub for full iCalendar (`.ics`) compatibility in Ganbaru AI. It describes how the app can accept, preserve, edit where possible, and export highly compatible calendar files without depending on Google, Outlook, CalDAV, email, or any hosted service.

The target is file-format compatibility first. Ganbaru AI should eventually be able to import every legal RFC 5545 iCalendar object, preserve the parts the app does not yet understand, project supported `VEVENT` data into the existing calendar UI, and export data without corrupting unsupported fields.

## Non-goals

Full file compatibility is not the same as full scheduling automation. The app can preserve RFC 5546 invitation metadata offline, but sending replies, cancellations, invitations, email alarms, or remote calendar updates requires a user-configured transport such as email, CalDAV, Google, or another provider. Those transports are optional future integrations.

Full file compatibility is also not the same as showing every component in the UI. `VTODO`, `VJOURNAL`, and `VFREEBUSY` can be preserved before the app has task, journal, or free/busy UI surfaces for them.

## Design summary

Use two layers:

1. **Lossless preservation layer.** Store imported iCalendar objects and components in durable structured storage, with all properties, parameters, value types, nested components, custom `X-*` fields, and timezone definitions intact.
2. **App projection layer.** Keep the current normalized calendar rows as the lean model for rendering, editing, pomodoro, search, and visible-window queries.

The normal calendar boot path must use only projected rows. It must not parse raw `.ics` content, load every preserved component, or expand unbounded recurrence sets at startup.

## Documents

- [Standards scope](./standards-scope.md): target standards, related RFCs, and boundaries.
- [Architecture](./architecture.md): lossless preservation plus normalized projection.
- [Data model](./data-model.md): proposed SQLite responsibilities and table shape.
- [Milestones](./milestones.md): implementation phases and exit criteria.
- [Conformance checklist](./conformance-checklist.md): component, property, parameter, and value-type tracking.
- [Fixtures and clients](./fixtures-and-clients.md): automated fixtures and manual client testing.
- [Edit merge policy](./edit-merge-policy.md): how user edits update projected and preserved data.
- [Recurrence and timezones](./recurrence-and-timezones.md): recurrence, value type, `VTIMEZONE`, and DST strategy.
- [Scheduling boundary](./scheduling-boundary.md): offline preservation versus transport-backed actions.
- [Performance budget](./performance-budget.md): startup, memory, import, export, and recurrence limits.
- [Migration plan](./migration-plan.md): rollout and existing data handling.
- [Decisions](./decisions.md): architecture decision log.

Client behavior notes live in [clients](./clients/). They record practical interop observations. They do not define standards behavior.

## Completion principle

A feature is considered compatible only when it has:

- a standards interpretation
- a storage or preservation rule
- an import rule
- an export rule
- an edit policy
- automated fixtures where practical
- manual client test coverage for major clients when behavior is client-sensitive

# Calendar schema

The calendar domain preserves editable local events, imported source fidelity, recurrence identity, notification state, project scheduling links, and Pomodoro history without making any one UI projection authoritative.

## Calendars and events

Every event belongs to a calendar. The built-in local calendar uses a stable semantic identity. Imported calendars receive their own identity so an import can be reviewed, removed, or repeated without mixing source ownership into the local calendar.

Current event rows hold the editable canonical projection used by the app. Archive rows preserve events that cannot be hard-deleted because history, project links, imported identity, or another durable relationship still refers to them. Archive is a data-preservation state, not merely a hidden UI filter.

Event start and end are instants with enough local and home-zone information to render and edit calendar intent. All-day events use date semantics. Callers must not infer elapsed duration by subtracting wall-clock labels across a timezone transition.

Calendar services validate positive ranges, visibility, ownership, recurrence consistency, and protected relationships before writing. Multi-row edits commit transactionally.

## Recurrence identity

A recurring series has three relevant identities:

- the template or original event;
- the civil recurrence instant selected from the rule;
- a concrete override or generated occurrence.

Pomodoro and project history retain both concrete event identity and original-series identity where needed. Editing an occurrence must not make earlier history point to a newly generated ID.

Native semantic edit receipts live in the active vault and commit with the Calendar and Focus changes. A receipt binds a command identity to its complete intent and reviewed native result. Replay returns the accepted result even if the source was subsequently changed or removed. Current execution aliases can identify a preserved materialization while original run and segment provenance remains unchanged. Receipt cleanup is not implemented; retaining them preserves retry behavior across restart.

Normalized recurrence data stores the supported rule components, exception dates, additional dates, and overrides needed by the app. Raw iCalendar preservation is kept separately for source fidelity. The normalized projection drives current behavior; preservation rows allow export or future conformance improvements without pretending unsupported properties were applied.

Recurring edits use an explicit commit plan. Operations such as this occurrence, this and following, or entire series may create, update, split, archive, or detach several rows. The plan is validated completely before one transaction applies it.

Expansion semantics and current conformance gaps are documented in [Recurrence expansion](../../algorithms/calendar/recurrence-expansion.md).

## Import preservation

iCalendar import is staged. Parsing and validation produce a bounded plan before canonical rows are committed. Source calendar, component, property, parameter, timezone, alarm, organizer, attendee, attachment, and unknown-property preservation remain associated with stable imported identities.

Preservation data is not a second editable event model. When the user edits an imported event, the application updates the canonical projection while retaining enough provenance to explain or export source values according to the interoperability policy.

Import deduplication uses source identities and explicit replacement behavior. Titles, timestamps, or display order are not sufficient identity. A failed import leaves the previous calendar intact.

## Notifications

Calendar notification definitions are portable event data. Scheduled native alarm handles and delivery state are platform-specific projections. Reconciliation compares current canonical notification intent with platform capability and recreates missing native schedules where safe.

Delivery receipts and interaction state must be idempotent. A repeated platform callback cannot create duplicate application actions. Android exact-alarm and permission state remain device-local capability facts.

## Projects and Pomodoro

Project task scheduling links reference exact task and event identities and record link meaning. Moving or archiving an event does not erase the task. Deleting a task does not generically erase a protected event.

Pomodoro configuration is attached to the calendar event, but each run snapshots the rhythm and event context needed for history. Later calendar edits never rewrite elapsed runs or segments. Protected deletion and archive behavior is defined by invariants 6 and 7 in [Data invariants](../invariants.md).

## Deletion and repair

Hard deletion is allowed only when no protected relationship or preservation requirement remains. Domain services choose among hard delete, archive, recurrence detach, and relationship removal. Generic callers do not bypass that decision.

Archives retain normalized children, Focus configuration and steps, task-link meaning and timestamps, and both Music assignment owners with their original versions. Historical task and Music identities do not cascade away when those referenced objects are later removed. Opaque archive keys distinguish operations; original occurrence identity and an optional scoped recurrence date identify the preserved selection independently of that key. Current archives explicitly record their original occurrence identity.

Imported archive snapshots own independent preservation graphs. Explicit archive-to-object ownership allows cleanup after successful restoration without deleting a graph still referenced by another live or archived projection. Removing an original calendar transfers archive-owned graphs to the built-in local calendar's storage custody while preserving the archive's historical calendar identity. Archive-only custody does not publish its timezones, unknown components or METHOD in Local exports. Shared envelopes remain exportable while a live projection uses them; independent imports without archive owners retain passthrough export. Ownership is read from the current archive-to-object records, without reconstructing missing ownership from obsolete development archives. The built-in calendar cannot be removed.

Run archive pointers identify the exact preserved Calendar record. Deletion changes nullable Calendar references in the same transaction as an explicitly authorized Focus stop, recurrence writes and the immutable receipt; original execution facts remain unchanged. Short-lived native Undo keeps its complete preimage in process memory, restores only the captured Calendar rows and nullable references, and rejects changed post-deletion state. An accepted Undo receipt survives expiry without retaining an indefinite copy of hard-deleted data. Permanent archive restoration validates current source-calendar, recurrence and task relationships before consuming the archive.

Repair routines may rebuild derived indexes and native schedules. They must not synthesize new event identity from mutable presentation fields or discard unknown imported data merely because the current UI does not expose it.

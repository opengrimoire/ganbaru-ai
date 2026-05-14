# Milestones

This tracker breaks full iCalendar compatibility into implementation phases. Each milestone should finish with docs updates, tests or fixtures, and a commit.

Implementation status as of 2026-05-14: milestones 1 through 12 have code, documentation, tests, and commits in this repository. Manual client runs are still unrecorded because they require disposable accounts or apps outside this environment. Performance benchmark rows were not added because no new recorded benchmark methodology was run; the implemented performance work is documented in [Performance budget](./performance-budget.md).

## Milestone 1: compatibility audit baseline

Goal: establish a complete map of current support against RFC 5545 and related standards.

Deliverables:

- Fill in [Conformance checklist](./conformance-checklist.md) for components, major properties, parameters, and value types.
- Mark each item as projected, preserved, exported, editable, tested, unsupported, or unknown.
- Link existing parser, serializer, recurrence, and storage tests to checklist rows where possible.
- Identify critical compatibility gaps that can corrupt common client exports.

Exit criteria:

- The checklist shows current state without pretending partial support is full support.
- Known lossy behavior is documented in calendar docs and migration notes.

## Milestone 2: lossless preservation schema

Goal: add durable storage for structured iCalendar objects and components without changing the visible calendar performance path.

Deliverables:

- SQLite migrations for preservation tables.
- TypeScript and Rust DTOs for preserved objects and components.
- Import path stores parsed components before projection.
- Unsupported legal components are stored, not dropped.
- Existing `.ics` import still creates projected `VEVENT` rows.

Exit criteria:

- Importing a fixture with `VTODO`, `VJOURNAL`, `VFREEBUSY`, unknown properties, and `X-*` fields preserves them.
- Visible calendar load queries do not read preservation JSON.

## Milestone 3: projection links and diagnostics

Goal: make every projected row traceable to preserved source data.

Deliverables:

- Link projected events, attendees, alarms, and overrides to preserved components.
- Store projection warnings for lossy mappings.
- Add diagnostics for unsupported components and unsupported property parameters.
- Add an internal debug or repair surface later, but not required in this milestone.

Exit criteria:

- A full event can be loaded with its preservation status and diagnostics.
- Re-import updates both preserved data and projection consistently.

## Milestone 4: lossless export merge

Goal: export preserved data plus current supported edits without corrupting unsupported fields.

Deliverables:

- Structured export merger for linked components.
- Local generated components for rows with no preserved source.
- Stable serialization with CRLF, UTF-8 octet folding, TEXT escaping, parameter escaping, and deterministic ordering.
- Tests proving unsupported properties and parameters survive supported edits.

Exit criteria:

- Parse, project, edit supported field, export, parse again preserves unsupported fields.
- Deleted projected rows do not reappear from preserved data.

## Milestone 5: property, parameter, and value-type completeness

Goal: support or preserve every registered core RFC 5545 property, parameter, and value type.

Deliverables:

- Complete value parser and serializer coverage.
- Binary and URI attachment handling as inert data unless user opens it.
- Complete attendee and organizer parameter preservation.
- Language, alternate representation, directory, sent-by, delegation, relationship, and member parameters preserved.

Exit criteria:

- Conformance checklist shows no unknown core RFC 5545 properties, parameters, or value types.
- Unsupported app semantics are still exported losslessly.

## Milestone 6: recurrence and timezone completeness

Goal: make recurrence and timezone behavior standards-complete enough for major clients and robust fixtures.

Deliverables:

- Full `RRULE` and `BY*` parsing and serialization.
- Correct `RDATE`, `EXDATE`, `RECURRENCE-ID`, and `RANGE=THISANDFUTURE` preservation.
- Floating date and floating date-time preservation.
- UTC, `TZID`, and all-day date handling.
- Custom `VTIMEZONE` storage and matching to IANA zones when possible.
- Window-bounded recurrence expansion with caps for pathological input.

Exit criteria:

- Complex recurrence fixtures round-trip and expand correctly in bounded windows.
- Custom timezone fixtures preserve original definitions even when projection maps to an IANA zone.

## Milestone 7: non-event components

Goal: preserve all legal component types and project them when GanbaruAI has a relevant feature surface.

Deliverables:

- Preserve `VTODO`, `VJOURNAL`, `VFREEBUSY`, and standalone `VTIMEZONE`.
- Decide projection targets for future tasks, diary, and free/busy views.
- Ensure unsupported components export with original properties intact.

Exit criteria:

- Mixed-component calendars round-trip without dropping unsupported components.
- Feature docs document which components are visible and which are preserved only.

## Milestone 8: scheduling metadata boundary

Goal: preserve scheduling data safely without pretending to send messages.

Deliverables:

- Preserve `METHOD`, attendee participation fields, organizer fields, `REQUEST-STATUS`, delegation, replies, and cancellations.
- Make attendee response controls read-only unless identity can prove the current user.
- Document future transports: email, CalDAV, Google, and local invitation export.

Exit criteria:

- Scheduling fixtures are preserved and exported.
- The UI does not imply that offline edits have notified anyone.

## Milestone 9: fixture and client interop suite

Goal: prove compatibility with standards fixtures and real client exports.

Deliverables:

- Automated fixture suite covering standard feature classes.
- Client fixture folders or documented fixture generation steps.
- Manual test plans for Google Calendar, Outlook, Apple Calendar, Thunderbird, Nextcloud, Proton Calendar, and Fastmail.
- Semantic comparison helpers for round-trip tests.

Exit criteria:

- Each supported checklist area has at least one automated fixture.
- Each major client has current manual test notes with date and version.

## Milestone 10: performance hardening

Goal: keep full compatibility from making the app heavy.

Deliverables:

- Import time and memory measurements for large files.
- Export time measurements for large calendars.
- Startup and visible-window load measurements before and after preservation storage.
- Recurrence expansion caps and diagnostics for pathological rules.
- File, zip, component, property, and attachment limits.

Exit criteria:

- Startup does not parse preserved components.
- Visible-window load uses projected rows only.
- Performance docs include measured budget results.

## Milestone 11: migration and rollout

Goal: safely introduce preservation storage for existing users.

Deliverables:

- Idempotent migrations.
- Existing normalized events export normally.
- Existing imported events are marked as having no preserved source when provenance is missing.
- Documentation explains which old lossy imports cannot be reconstructed.

Exit criteria:

- Existing databases open without data loss.
- New imports use preservation storage.
- Old data remains editable and exportable through generated components.

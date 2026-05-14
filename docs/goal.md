# Goal: implement full iCalendar compatibility

Implement the iCalendar compatibility plan for GanbaruAI end to end. Work indefinitely until the implementation is complete, verified, documented, and committed in meaningful milestones. If this conversation is compacted, resume from this file, the latest `git status`, the latest commits, and the docs under `docs/interop/icalendar/`.

This goal is for code implementation, not another planning-only pass. The target is highly compatible offline `.ics` file import and export for legal RFC 5545 iCalendar files, while preserving GanbaruAI's local-first architecture, app performance, and normalized calendar UI model.

## Current context

GanbaruAI already has a useful `VEVENT`-focused `.ics` subset:

- Parser, serializer, and tests live in `apps/client/src/lib/calendar/ics/`.
- Calendar import and bulk import logic live in `apps/client/src/lib/stores/calendar-bulk-import.ts` and `apps/client/src-tauri/src/calendar_import.rs`.
- Calendar reads and writes live mainly in `apps/client/src-tauri/src/calendar_reads.rs`, `apps/client/src-tauri/src/calendar_events.rs`, and `apps/client/src-tauri/src/calendars.rs`.
- SQLite migrations are defined in `apps/client/src-tauri/src/db.rs`.
- Calendar feature and data docs live in `docs/features/calendar.md`, `docs/features/calendar-recurrence.md`, and `docs/data/schema.md`.
- The compatibility plan lives in `docs/interop/icalendar/`.

Recent fixes already addressed several immediate issues: all-day exclusive `DTEND`, status and free-busy rendering, recurring `EXDATE` export time, zoned `RECURRENCE-ID` export, UTF-8 line folding, parameter escaping, and all-day override date handling. Do not regress those fixes.

## Core objective

GanbaruAI should be able to:

- parse legal RFC 5545 iCalendar objects within documented safety limits
- preserve every imported legal component, property, parameter, value type, nested component, timezone definition, unknown standard field, and `X-*` extension in durable structured storage
- project supported `VEVENT` data into the existing normalized app schema for rendering, editing, pomodoro, search, notifications, and visible-window queries
- preserve unsupported components such as `VTODO`, `VJOURNAL`, `VFREEBUSY`, standalone `VTIMEZONE`, and unsupported nested data before the app has dedicated UI for them
- export standards-shaped `.ics` files by merging current app edits into preserved structured components without corrupting unsupported fields
- generate valid `.ics` components for local app events that have no preserved source
- keep normal startup, RAM, and visible-window calendar queries lean by loading projected rows only
- keep scheduling metadata inert unless a future user-configured transport exists

Full offline file compatibility must not require Google login, account setup, tokens, hosted services, CalDAV, email, or network access. Future transports may be useful for real RSVP sending, invitations, cancellations, email alarms, or remote sync, but they are outside this base compatibility implementation.

## Required reading

Before implementing each milestone, read the relevant files:

- `docs/interop/icalendar/README.md`
- `docs/interop/icalendar/standards-scope.md`
- `docs/interop/icalendar/architecture.md`
- `docs/interop/icalendar/data-model.md`
- `docs/interop/icalendar/milestones.md`
- `docs/interop/icalendar/conformance-checklist.md`
- `docs/interop/icalendar/fixtures-and-clients.md`
- `docs/interop/icalendar/edit-merge-policy.md`
- `docs/interop/icalendar/recurrence-and-timezones.md`
- `docs/interop/icalendar/scheduling-boundary.md`
- `docs/interop/icalendar/performance-budget.md`
- `docs/interop/icalendar/migration-plan.md`
- `docs/interop/icalendar/decisions.md`
- all files under `docs/interop/icalendar/clients/`

Use the standards as source of truth. Client docs are compatibility notes, not definitions of correct behavior. When external confirmation is needed, use primary sources first: RFC 5545, RFC 5546, RFC 6868, RFC 7265, RFC 7986, and IANA iCalendar registries. Official client documentation is acceptable for client-specific behavior.

## Architectural invariants

Use a two-layer model:

1. Lossless preservation layer: durable structured iCalendar storage, preferably jCal-like or a typed representation that preserves the iCalendar data model.
2. App projection layer: the current normalized calendar rows used by the app for fast UI behavior.

The preservation layer must not be required for normal calendar boot or visible-window rendering. It may be loaded for import, export, detailed compatibility diagnostics, repair tools, and event details that need preserved metadata.

The app projection layer may be smaller than the iCalendar data model, but every lossy projection from imported data must retain a link to preserved source data and diagnostics.

Structured export merging is required. Do not splice raw text blindly into exported files. The exporter must know which supported fields were edited and must avoid writing stale preserved values for fields now owned by the app projection.

Unsupported or unsafe data is preserved as inert data. Do not fetch external URLs, execute attachments, execute scripts, trust HTML descriptions, or make network calls during import/export.

## Data and migration requirements

Design and implement durable SQLite storage for preserved iCalendar data. Table names may be adjusted to match codebase conventions, but responsibilities must cover:

- calendar or import object identity
- imported source metadata
- component type
- component UID
- recurrence identity
- sequence and scheduling method when present
- structured component JSON
- raw object or component representation when useful for diagnostics
- projected event or override links
- preservation status
- warnings and diagnostics
- timestamps
- indexes for calendar export, re-import dedupe, UID lookup, recurrence lookup, and projected-row lookup

Migrations must be idempotent and safe for existing users. Existing normalized events remain editable and exportable as generated components. Existing imported rows that lack preserved source data must not be treated as lossless historical imports. Old lossy imports cannot be magically reconstructed, and docs must say that plainly.

Update `docs/data/schema.md` whenever schema responsibilities or persistent fields change.

## Import requirements

The final import flow should:

1. Keep existing safe file picker, path validation, `.ics` cap, zip cap, entry cap, aggregate cap, encrypted-entry rejection, and zip-slip protection.
2. Parse iCalendar into a structured representation with preserved property names, parameter names, value types, values, groups where relevant, nested components, and ordering when needed for stable diagnostics.
3. Validate structure, required fields, value types, recurrence fields, timezone references, and configured limits.
4. Store the full object and each component in preservation tables before or together with projection.
5. Project supported `VEVENT` components into `calendar_events`, `calendar_event_overrides`, `calendar_event_attendees`, and `calendar_event_alarms`.
6. Preserve unsupported legal components without projection.
7. Link projected rows to preserved components.
8. Store import diagnostics and lossy-projection warnings.
9. Keep re-import safe using calendar source identity, `UID`, `RECURRENCE-ID`, and `SEQUENCE` rules.
10. Keep descriptions sanitized before rendering or persistence into app-facing fields.

Invalid or malicious files should fail safely with useful diagnostics. Legal but unsupported content should be preserved whenever it is within configured safety limits.

## Export requirements

The final export flow should:

1. Load projected rows for the requested calendar.
2. Load preserved components only for components included in the export.
3. Merge supported app edits into linked preserved components.
4. Preserve unsupported properties, parameters, value types, nested components, and components that were not edited.
5. Generate clean components for local events or old imported rows with no preserved source.
6. Ensure deleted projected rows do not reappear from preservation storage.
7. Emit needed `VTIMEZONE` data, preferring preserved definitions when still valid.
8. Serialize with CRLF line endings, UTF-8 octet folding, TEXT escaping, RFC 6868 parameter escaping, correct value types, stable ordering, and valid calendar structure.
9. Write through the existing atomic export path.

Round trips must be tested both structurally and semantically. Unsupported fields must survive supported edits.

## Recurrence and timezone requirements

Implement or preserve the full recurrence and time model needed for RFC-compatible files:

- full `RRULE` and `BY*` parsing and serialization
- `RDATE`
- `EXDATE`
- `RECURRENCE-ID`
- `RANGE=THISANDFUTURE` preservation, with edit support only when safe
- UTC date-times
- `TZID` date-times
- all-day `VALUE=DATE`
- floating date-times as distinct from device-zone times
- custom `VTIMEZONE` definitions
- Windows timezone names mapped for projection when safe, while preserving original values
- DST transition correctness
- window-bounded recurrence expansion
- caps and diagnostics for pathological recurrence rules

Never expand recurrence unboundedly. Tests should compare occurrence sets inside bounded windows, not only serialized strings.

## Scheduling boundary

Preserve scheduling metadata, but do not act as a transport:

- `METHOD`
- `ORGANIZER`
- `ATTENDEE`
- `PARTSTAT`
- `RSVP`
- delegation and member parameters
- `REQUEST-STATUS`
- cancellation and reply metadata

The app must not imply that offline edits notified anyone. Attendee response controls must remain read-only unless identity support can prove the current user is that attendee. Sending invitations, RSVP replies, cancellations, email alarms, or remote updates requires a future user-configured transport and is out of scope for this goal.

## Non-event components

Preserve every legal component even when it has no current app UI:

- `VTODO`
- `VJOURNAL`
- `VFREEBUSY`
- standalone `VTIMEZONE`
- nested `VALARM`
- `STANDARD` and `DAYLIGHT` inside `VTIMEZONE`
- unknown registered and custom components within safety limits

Do not invent UI surfaces for these unless needed for compatibility diagnostics. Projection into future task, diary, notes, or availability features can be documented, but preservation and export come first.

## Performance and security requirements

Compatibility must not make the app heavy:

- normal startup must not parse preserved components
- visible-window loads must query projected rows only
- preserved JSON must load lazily
- imports and exports may be heavier, but must stay bounded and measured
- large imports should batch or stream where practical
- recurrence expansion must be window bounded
- file size, zip, component count, property count, nesting depth, unfolded line length, attachment size, and recurrence work must have caps
- attachments and URLs remain inert unless the user explicitly opens them
- no telemetry, analytics, remote fetches, or hosted-service dependency

Update `docs/PERFORMANCE.md` only when a benchmark methodology and recorded result actually justify it. Follow the repository benchmark versioning rules.

## Fixture and test requirements

Add automated fixtures and tests for:

- minimal valid `VEVENT`
- all-day single-day event
- all-day multi-day event
- yearly all-day event
- UTC timed event
- `TZID` timed event
- floating timed event
- timed recurrence with `EXDATE`
- recurrence with `RDATE`
- overrides with `RECURRENCE-ID`
- `RANGE=THISANDFUTURE`
- custom `VTIMEZONE`
- DST transition recurrence
- alarms, including repeat and duration preservation
- organizer and attendee parameters
- attachments as inert data
- custom `X-*` properties
- unknown registered-style properties
- non-ASCII text
- escaped text values
- escaped parameter values
- folded UTF-8 lines
- `VTODO`
- `VJOURNAL`
- `VFREEBUSY`
- mixed-component calendars
- invalid and malicious files
- large synthetic files for import and export limits

Prefer focused tests next to the code they cover. Expand `parser.test.ts`, `serializer.test.ts`, `round-trip.test.ts`, store tests, Rust import tests, migration tests, and recurrence tests as appropriate.

Manual client testing should use disposable calendars. Target Google Calendar, Outlook, Apple Calendar, Thunderbird, Nextcloud, Proton Calendar, and Fastmail. If an account, operating system, exported fixture, or manual result is needed from Victor, document the exact request and keep working on independent milestones while waiting.

Do not fake manual results. Client docs should clearly distinguish planned tests from observed results, with date and version notes when available.

## Milestones

Commit after each completed major milestone with a one-line conventional commit message. Before each commit, state the intended commit message. Do not include AI attribution or co-authors.

### Milestone 1: audit baseline

- Compare current code against `docs/interop/icalendar/conformance-checklist.md`.
- Update the checklist with current projected, preserved, exported, editable, tested, unsupported, and unknown status.
- Link existing tests to checklist areas where useful.
- Document known lossy behavior without pretending partial support is complete.
- Run focused checks and commit.

### Milestone 2: preservation schema

- Add SQLite migrations for preservation tables and indexes.
- Add typed DTOs and validators for preserved iCalendar objects, components, diagnostics, and statuses.
- Store parsed legal components during import, including unsupported components.
- Ensure normal visible-window reads do not query preservation JSON.
- Add migration and import tests.
- Update schema docs and commit.

### Milestone 3: projection links and diagnostics

- Link projected events, overrides, attendees, and alarms to preserved components.
- Store projection warnings and import diagnostics.
- Make re-import update preservation and projection consistently.
- Add tests for re-import dedupe, sequence handling, warnings, and linked rows.
- Update docs and commit.

### Milestone 4: lossless export merge

- Implement structured export merging for linked components.
- Generate clean components for unlinked local rows.
- Preserve unsupported data across supported edits.
- Prevent deleted projected rows from reappearing.
- Add round-trip tests for supported edits plus unsupported preserved fields.
- Update docs and commit.

### Milestone 5: property, parameter, and value-type completeness

- Cover every core RFC 5545 property, parameter, and value type with projection or preservation.
- Preserve complete attendee and organizer parameter sets.
- Preserve attachments as inert data.
- Preserve language, alternate representation, directory, sent-by, delegation, relationship, and member parameters.
- Update conformance checklist and tests.
- Commit.

### Milestone 6: recurrence and timezone completeness

- Complete recurrence parsing, serialization, preservation, and bounded expansion.
- Preserve custom timezone definitions and map to IANA zones for projection only when safe.
- Preserve floating timed events distinctly.
- Add semantic recurrence and timezone fixture tests.
- Update recurrence docs and commit.

### Milestone 7: non-event components

- Preserve and export `VTODO`, `VJOURNAL`, `VFREEBUSY`, standalone `VTIMEZONE`, and nested components.
- Keep unsupported components out of normal UI queries.
- Document future projection paths without implementing unrelated feature surfaces.
- Add mixed-component fixture tests and commit.

### Milestone 8: scheduling metadata boundary

- Preserve scheduling metadata safely.
- Keep attendee response controls read-only unless identity support exists.
- Ensure export does not imply messages were sent.
- Add scheduling fixtures and docs.
- Commit.

### Milestone 9: fixture and client interop suite

- Build automated fixture coverage for every supported checklist area.
- Add semantic comparison helpers for round-trip tests.
- Add or update client docs with generated fixture instructions and observed results when available.
- Request Victor-provided manual fixtures or results only when needed.
- Commit.

### Milestone 10: performance hardening

- Measure startup, visible-window load, import, export, and large recurrence cases where practical.
- Add caps and diagnostics for pathological files and recurrence rules.
- Confirm startup does not parse preserved components.
- Confirm visible-window reads use projected rows only.
- Update performance docs if recorded results are meaningful.
- Commit.

### Milestone 11: migration and rollout

- Ensure existing databases open without data loss.
- Ensure old normalized events export normally as generated components.
- Mark old imported rows without preserved source accurately.
- Document unreconstructable historical loss.
- Run full validation and commit.

### Milestone 12: final audit

- Re-read this goal and every `docs/interop/icalendar/` doc.
- Verify implementation satisfies the conformance checklist or clearly marks any remaining future work that is truly out of scope.
- Run `pnpm -w run validate`.
- Run any additional focused tests or benchmarks introduced by the implementation.
- Confirm `git status` shows no local changes after the final commit.
- Summarize commits, validation results, residual risks, and any manual client tests still waiting on Victor.
- Mark the long-running goal complete only after the implementation, docs, tests, and commits are done.

## Validation rules

Use `pnpm -w run check` for fast feedback while coding.

Use `pnpm -w run test` after changes to tested code.

Use `pnpm -w run validate` before reporting the implementation complete.

Run Rust tests and TypeScript tests relevant to each touched area. Add tests when changing parser, serializer, recurrence, migrations, import, export, security limits, or UI state. Do not rely on manual Tauri UI verification from this environment.

Run the repository whitespace check before commits. Keep markdown sentence case. Do not add em dash characters or repeated hyphen characters in new markdown, comments, docs, or commit messages.

## Dependency and security rules

Prefer existing dependencies and platform APIs. The app already uses the Temporal polyfill and current iCalendar parsing code. Add a new dependency only if the implementation genuinely needs it, the package is established and auditable, and Victor has approved the supply-chain risk.

Do not disable package-security protections. Do not add analytics, telemetry, hosted services, or background network behavior.

Treat all imported calendar content as hostile user-supplied data. Validate unknown external data before using it as typed data. Never use TypeScript `any`.

## Completion criteria

The goal is complete only when:

- lossless preservation storage exists and is used for new imports
- legal unsupported components and fields are preserved and exported within safety limits
- supported `VEVENT` data still projects into the existing calendar UI model
- export merging preserves unsupported data while reflecting supported app edits
- recurrence, timezones, all-day dates, floating timed events, and overrides are handled according to the docs
- scheduling metadata is preserved but not acted on without transport
- non-event components round-trip even before dedicated UI exists
- performance budgets are respected
- existing data migrates safely
- conformance docs and feature docs match the implementation
- automated tests and fixtures cover the implemented compatibility surface
- `pnpm -w run validate` passes
- all major milestones are committed
- the final worktree is clean

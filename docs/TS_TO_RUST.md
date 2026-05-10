# TypeScript to Rust refactor plan

This document records which TypeScript logic should move behind Rust-backed
domain APIs as GanbaruAI grows. The goal is not to reduce TypeScript line count
for its own sake. The goal is to put durable data, native behavior, recovery,
and high-integrity mutations in the layer best suited to enforce them.

The current performance baseline before this plan is `2026-05-09-01` in
`docs/PERFORMANCE.md`.

## Implementation status

Started with the Phase 0 foundation, Phase 1 calendar persistence, Phase 2
import application, Phase 3 Pomodoro persistence, and Phase 4 theme
persistence:

- Added a shared Rust SQLite resolver for the registered app databases.
- Enabled `PRAGMA foreign_keys=ON` on direct sqlx connections used by the
  backend transaction path.
- Moved full user-theme snapshot insert and replace writes behind Rust commands
  with one transaction per write.
- Moved theme delete, legacy icon-label backfill, and upgrade-dismissal writes
  behind Rust commands so they use the same backend database boundary.
- Moved row-level theme editor helpers, source cascade, rebake, reset, and
  dismissal loading behind focused Rust commands. This completes Phase 4 for
  durable theme writes.
- Replaced the calendar bulk import raw SQL batch path with the typed Rust
  `calendar_bulk_import` command. TypeScript still parses ICS and performs the
  existing wall-clock conversions; Rust now owns deduplication, SEQUENCE
  comparison, parent and child row replacement, validation, and the transaction.
- Removed the generic `db_execute_batch` command from the Tauri command surface.
- Moved basic calendar event create, patch, and delete paths behind Rust
  commands. Patch covers parent fields, attendees, alarms, and Pomodoro config.
- Routed simple recurrence exception and repeat-until updates, plus clear-all,
  through Rust commands.
- Moved detach-instance and split-series database transactions behind Rust
  commands, including parent row updates, child row copies, and Pomodoro segment
  reassignment for detached instances.
- Moved calendar list add, visibility toggle, and remove operations behind Rust
  commands. Calendar removal now deletes events and the calendar row in one
  transaction.
- Moved calendar Pomodoro progress detection for recurring instances behind
  Rust commands, so the decision to protect historical progress before
  structural recurrence edits no longer relies on frontend SQL.
- Moved Pomodoro segment insertion, segment status and pause updates, orphan
  cleanup, and completed session writes behind Rust commands. Rust now
  validates segment enums and pause-log JSON, computes focus score for
  completed sessions, and canonicalizes recurring instance ids to DB-backed
  parent event ids before writing through the foreign-key boundary.
- Updated day-column persisted segment loading so rows stored against a
  recurring parent event id can still render under the visible virtual
  instance id for the matching date.
- Moved the placeholder Kanban task add, status update, and delete writes
  behind typed Rust commands. Kanban is not a large current feature yet, but
  tasks are structured source-of-truth data and future CLI-visible state.
- Moved the timezone hydrator's durable row application behind one Rust
  transaction while keeping browser `Temporal` responsible for IANA timezone
  conversion.
- Moved full user-theme row loading behind Rust validation. TypeScript still
  preserves editor display order after the backend returns grouped rows.

## Decision rule

Move logic to Rust when at least one of these is true:

- It mutates durable SQLite state across multiple tables.
- It enforces source-of-truth invariants that must survive UI bugs, crashes,
  app restarts, or future CLI access.
- It handles filesystem, compression, OS integration, process state, idle
  detection, tray, notifications, or native windows.
- It is a bulk operation where sending SQL or large payloads through the
  frontend adds avoidable latency, memory pressure, or IPC overhead.
- It will also be needed by the future `ganbaruai` CLI.
- It currently trusts database rows, imported files, or persisted JSON without
  enough runtime validation.

Keep logic in TypeScript when it is primarily UI state, Svelte reactivity,
DOM layout, editor buffers, drag state, viewport decisions, browser `Intl`
display formatting, immediate previews, or CSS/theme rendering. Those areas are
not part of this migration plan unless they become persistence boundaries.

## Current boundary

Rust currently owns:

- Tauri startup, plugin wiring, tray, native notifications, idle and break
  overlays, restart and reset helpers, benchmark state, and memory reporting in
  `apps/client/src-tauri/src/lib.rs` and related modules.
- SQLite migrations in `apps/client/src-tauri/src/db.rs`.
- Vault file I/O, generic text file read/write, and safe `.ics.zip` extraction
  in `apps/client/src-tauri/src/vault.rs`.
- Typed Kanban task mutation commands in `apps/client/src-tauri/src/kanban.rs`.
- Typed theme persistence commands in `apps/client/src-tauri/src/themes.rs`.
- Typed calendar bulk import application in
  `apps/client/src-tauri/src/calendar_import.rs`.

TypeScript currently owns most normal SQLite writes through
`apps/client/src/lib/api/db.ts`, including calendar, Pomodoro, theme, and
Kanban mutations. That is acceptable for early development, but it becomes a
weak boundary as data invariants and CLI access grow.

## Target architecture

Rust should become the authoritative domain layer for structured data:

- Rust owns SQLite schema, migrations, transactions, domain validation,
  recovery, and source-of-truth mutations.
- TypeScript owns interaction state, rendering, previews, editor buffers, and
  immediate UI ergonomics.
- Shared future CLI behavior lives in Rust crates that can be called by both
  Tauri commands and the `ganbaruai` CLI.
- Frontend stores may keep slim in-memory caches, but they should update those
  caches from Rust command results rather than independently rebuilding durable
  mutations.

## Phase 0: Rust domain foundation

Before moving feature logic, create a safer backend shape.

- Module layout: add focused Rust modules such as `calendar`, `pomodoro`,
  `themes`, and `db_path` under `src-tauri/src`. This keeps Tauri command
  wiring thin and prevents `lib.rs` from becoming the domain layer.
- Database access: use typed `sqlx` queries and explicit transactions for
  domain commands. This prevents frontend auto-commit chains from leaving
  partial writes.
- Command design: prefer narrow commands over generic SQL execution. This
  reduces accidental misuse and makes permission boundaries auditable.
- Validation: validate persisted strings, JSON payloads, enum values, ids, and
  foreign key relationships at command boundaries. SQLite rows and imports are
  external data from the app's perspective.
- Types: define serde DTOs for frontend command inputs and outputs. Mirror
  TypeScript types manually at first to avoid broad code generation
  dependencies before the shape stabilizes.
- Performance setup: make SQLite performance assumptions explicit, including
  `PRAGMA foreign_keys=ON` and any WAL decision. Current batch comments assume
  WAL behavior, but the setup should be visible and testable.
- Tests: add Rust unit tests for pure logic and DB integration tests for
  transactional commands. Keep matching TypeScript tests where UI previews
  remain in TS to prevent behavior drift during incremental migration.

Completion gate:

- `pnpm -w run validate` passes.
- New Rust domain commands have focused tests.
- No frontend call site can write through a new Rust command and a duplicate
  raw SQL path for the same mutation.

## Phase 1: Calendar persistence and invariants

Move calendar source-of-truth mutations out of
`apps/client/src/lib/stores/calendar.svelte.ts` and related helpers.

Initial Rust commands should cover:

- Add event.
- Patch event.
- Delete or archive event according to data safety rules.
- Add, replace, or delete attendees.
- Add, replace, or delete alarms.
- Add, replace, or delete per-instance overrides.
- Add recurrence exceptions.
- Cap a recurring series.
- Detach a recurring instance.
- Split a recurring series.
- Protect historical Pomodoro segments before structural recurrence edits.
- Load slim event rows and full event rows with runtime validation.

Current implementation has Rust commands for basic event creation, patch, and
deletion. Patch covers parent fields, attendees, alarms, and Pomodoro config.
Simple exception and repeat-until updates also use the patch command. Detach
and split now use focused Rust transactions. Historical Pomodoro progress
detection before structural edits also uses Rust. Per-instance override writes
and typed reads are still Phase 1 work.

Why this should move:

- Calendar writes span `calendar_events`, `pomodoro_configs`,
  `calendar_event_attendees`, `calendar_event_alarms`,
  `calendar_event_overrides`, and `pomodoro_segments`.
- These operations are source-of-truth mutations, not UI concerns.
- Recurring event edits and Pomodoro segment protection encode durable safety
  rules. They should not depend on the frontend store being correct.
- Rust transactions can guarantee all-or-nothing behavior for operations that
  are currently several frontend SQL calls.
- The future CLI will need the same event mutation rules.

Keep in TypeScript during this phase:

- Visible-window recurrence expansion.
- Calendar layout.
- Edit panel state.
- Drag and resize preview state.
- Optimistic cache updates, provided Rust returns canonical updated rows.

Risk to manage:

- Timezone conversion currently relies on `Temporal`. Until Rust has a reviewed
  IANA timezone approach, the frontend may still pass canonical UTC instants
  into Rust. Rust should validate shape and persist atomically, then timezone
  ownership can move later.

Success criteria:

- Calendar structural operations are one Rust transaction each.
- Deleting or editing events with historical progress cannot bypass app rules
  through normal frontend paths.
- Existing calendar, recurrence, and import tests still pass.
- A failed child-row write cannot leave a partially updated event.

## Phase 2: Calendar bulk import database application

Replace the current TypeScript SQL statement builder in
`apps/client/src/lib/stores/calendar-bulk-import.ts` with a typed Rust import
application command.

Current implementation uses `calendar_bulk_import` for the database application
layer. TypeScript still builds a typed import payload after ICS parsing and
wall-clock conversion.

The command should receive either parsed event DTOs or a higher-level import
payload and should:

- Deduplicate by `(calendar_id, source_uid)`.
- Compare RFC 5545 `SEQUENCE`.
- Insert new parent events.
- Update existing parent events.
- Replace attendees, alarms, and overrides in lockstep.
- Return an import summary with added, updated, skipped, and warnings.

Why this should move:

- The previous intermediate state used a generic `db_execute_batch` command;
  that path allowed frontend-built SQL to cross the IPC boundary.
- Import applies untrusted external data to durable state.
- A typed Rust command reduces IPC payload size and removes arbitrary SQL
  statement execution from the import path.
- The same import behavior will be useful to the future CLI.

Risk to manage:

- Do not move `.ics` parsing in the same step. Keep `ical.js` initially and
  move only the database application layer. That keeps dependency risk and
  behavior drift contained.

Success criteria:

- Import behavior remains idempotent for re-imports.
- Equal or higher `SEQUENCE` replaces parent and child rows atomically.
- Lower `SEQUENCE` skips without touching the stored row.
- Large import performance is no worse than the `2026-05-09-01` baseline.

## Phase 3: Pomodoro persisted session service

Move the persisted runtime state machine behind Rust commands while keeping
Svelte as the display and control surface.

Rust should own:

- Starting a session from a calendar block.
- Pausing and resuming.
- Stopping.
- Advancing phase.
- Skipping break.
- Reconfiguring an active session.
- Transitioning between adjacent or overlapping blocks.
- Creating, completing, interrupting, and skipping segments.
- Writing pause intervals.
- Writing focus sessions and focus score.
- Orphan cleanup and crash recovery.
- Heartbeat or last-active recovery data, once the schema supports it.

Why this should move:

- Pomodoro is always-running and tightly coupled to native idle detection,
  overlays, tray, notifications, and durable history.
- Current segment updates are scattered through the Svelte store and several
  are fire-and-forget.
- Recovery and analytics should not depend on the frontend having completed
  every async write before a crash.
- The future CLI needs to read and explain Pomodoro state consistently.

Schema issue status:

- The current implementation can use synthetic recurring ids such as
  `templateId::YYYY-MM-DD`, while `pomodoro_segments.event_id` is declared as a
  foreign key to `calendar_events(id)`. That relationship is inconsistent
  unless recurring instances are detached before progress is written or the
  schema changes to model run identity differently.
- Current Rust segment and session writes resolve synthetic recurring ids to
  the DB-backed parent event id and retain the concrete instance date on
  `pomodoro_segments.event_date`. This keeps existing foreign keys intact and
  lets detach-instance transactions move dated progress rows to standalone
  events later.

Recommended schema direction:

- Align the implementation with the data docs by introducing explicit
  `pomodoro_runs` and `pomodoro_pauses`, or update the docs to match the
  current segment/session model before moving the service.
- Prefer pause rows over JSON pause logs for recovery and analytics.
- Preserve historical event references without requiring every recurring
  instance to be a physical `calendar_events` row.

Current implementation status:

- Segment insertion, segment updates, pause-log writes, completed-session
  inserts, focus-score calculation, event-scoped cleanup, and startup orphan
  cleanup now run through Rust commands.
- Svelte still owns live timer decisions, transitions, notification timing,
  native overlay calls, in-memory session state, and segment-plan construction.
  Those are the next Phase 3 boundary if the full persisted runtime service is
  implemented.

Keep in TypeScript during this phase:

- Timer display formatting.
- Calendar rail and title-bar display.
- Button state.
- Idle overlay fallback UI on platforms where native overlay is unavailable.

Success criteria:

- Exactly one active persisted segment or run can exist at a time.
- Stopping, suspend recovery, idle pause, and break acknowledgment are durable
  even if the app exits shortly after the action.
- Frontend state can be reconstructed from Rust-owned persisted state.
- Pomodoro tests cover transitions before and after the move.

## Phase 4: Theme persistence transactions

Move durable theme writes from `apps/client/src/lib/api/themes.ts` into Rust
transactions.

Current implementation routes snapshot insert, snapshot replacement, theme
delete, row-level token and palette edits, source cascade, rebake, resets,
legacy icon-label backfill, and upgrade-dismissal record/load through Rust
commands. Full user-theme row loading stays in TypeScript until Phase 6 typed
reads.

Rust should own:

- Insert user theme snapshot.
- Replace full theme content.
- Delete theme.
- Reset token to seed.
- Reset palette slot to seed.
- Reset whole theme to seed.
- Record and load upgrade dismissals.
- Backfill legacy nullable fields.

Keep in TypeScript:

- Theme editor state.
- Color picker behavior.
- CSS token application to the DOM.
- Color derivation and immediate preview, unless the CLI later needs to create
  or validate theme snapshots independently.

Why this should move:

- The current TypeScript database layer explicitly notes that multi-statement
  theme writes are not true transactions through the SQL plugin pool.
- Theme rows span several normalized tables and seed mirrors.
- Import and replacement should never leave half a theme in SQLite.

Success criteria:

- Theme insert and replacement are atomic.
- Seed and live rows cannot diverge through partial writes.
- Existing theme import/export validation still passes.
- No new broad dependency is introduced for simple validation or color math.

## Phase 5: Persisted data migrations

Move future durable data migrations toward Rust wherever practical.

The current timezone hydration logic in
`apps/client/src/lib/stores/timezone-migration.ts` is a special case because it
uses browser `Temporal` and IANA timezone behavior. Current implementation
keeps that conversion in TypeScript, but applies the resulting event and
override row rewrites through the Rust `calendar_apply_timezone_hydration`
command in one transaction.

For future migrations:

- Put durable schema and cleanup migrations near `src-tauri/src/db.rs`.
- Keep migrations idempotent.
- Avoid config-file markers when the migration only concerns SQLite state.
- Use transactions for every multi-row rewrite.
- Add tests for old-row inputs and repeated runs.

For timezone conversion specifically, move the IANA rules to Rust only after a
Rust timezone dependency review. A Rust conversion implementation must match
`Temporal` behavior for DST gaps and fall-back ambiguity.

## Phase 6: Runtime validation and typed reads

After the highest-risk writes move, migrate selected read boundaries to Rust
commands where validation matters.

Candidates:

- Calendar slim row load.
- Calendar full event load.
- Pomodoro active state load.
- Theme snapshot load.
- Import conflict lookup.

Current implementation status:

- Theme snapshot load now uses the Rust `theme_load_all` command with backend
  validation for theme rows, token rows, palette rows, icon labels, calendar
  modes, and hex colors.
- Calendar Pomodoro progress protection reads and calendar import conflict
  handling already run through Rust commands.

Why this should move:

- Current TypeScript mapping casts string unions and JSON blobs into typed
  shapes with limited validation.
- Backend validation makes corrupted or stale rows visible earlier.
- The same typed reads are useful for the CLI.

Do not move every query. UI-specific filtered or derived reads can remain in
TypeScript until they become shared or sensitive.

## Phase 7: Recurrence and iCalendar, only when justified

Recurrence expansion and `.ics` parsing are plausible Rust candidates, but they
should not be first.

Move recurrence expansion later only if:

- The CLI needs identical recurrence expansion.
- Calendar window queries become backend-owned.
- Performance measurements show the TypeScript expansion path is a real cost.

Move iCalendar parsing or serialization later only if:

- Large imports block the UI after the database application layer has moved.
- The CLI needs import/export parity.
- A Rust iCalendar dependency passes supply-chain and maintenance review.

Until then:

- Keep `apps/client/src/lib/components/calendar/recurrence.ts` in TypeScript.
- Keep `apps/client/src/lib/calendar/ics/parser.ts` and
  `apps/client/src/lib/calendar/ics/serializer.ts` in TypeScript.
- Keep existing tests as the behavior contract for any future Rust port.

## Security and dependency rules

This migration should reduce risk, not add it.

- Do not add Rust crates for small utilities that are easy to write locally.
- Review any new time, recurrence, iCalendar, archive, or color dependency for
  maintenance, scope, transitive dependency weight, and known advisories.
- Keep untrusted file parsing behind size limits and path checks.
- Avoid broad commands that accept arbitrary SQL or unrestricted paths.
- Prefer explicit allowlisted command shapes.
- Preserve offline behavior and avoid telemetry or network dependencies.

## Performance rules

Use `docs/PERFORMANCE.md` as the comparison record.

Before each major phase:

- Record the current benchmark baseline if the existing baseline is stale.
- Identify which scenario should improve or stay flat.

After each major phase:

- Run `pnpm -w run validate`.
- Run the benchmark suite from a release build when the change could affect
  startup, idle memory, stress memory, or interaction latency.
- Compare against `2026-05-09-01` or the latest newer canonical baseline.

Expected performance wins:

- Fewer frontend SQL round trips for multi-table writes.
- Lower IPC payloads for imports.
- Less duplicate statement construction in the webview.
- More predictable recovery and fewer stale in-memory assumptions.

Expected tradeoffs:

- Some commands may require extra DTO serialization.
- Early migrations may not reduce memory until raw frontend write paths are
  removed.
- Moving logic too early can duplicate TypeScript and Rust behavior, which is a
  stability risk. Migrate one ownership boundary at a time.

## Suggested order

1. Build the Rust domain foundation.
2. Move calendar persistence commands.
3. Move calendar bulk import application.
4. Resolve Pomodoro schema direction.
5. Move Pomodoro persisted session service.
6. Move theme persistence transactions.
7. Move future durable migrations to Rust by default.
8. Add typed Rust reads where validation or CLI sharing justifies it.
9. Revisit recurrence and iCalendar only with a measured or CLI-driven need.

This order prioritizes data safety first, performance second, and code size
last. Large TypeScript files should still be split for maintainability, but
file size alone is not a Rust migration reason.

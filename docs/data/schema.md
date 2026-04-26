# Data schema

Every table in `app.db`, with the rationale behind subtle columns and constraints. New tables are added here as features land. Stub headings exist for tables that are designed but not yet implemented; fill them in when the feature ships.

All timestamps are ISO 8601 in UTC with a `Z` suffix. The UI converts to local time for display. Storing in UTC is the only thing that survives DST transitions, timezone changes, and user travel without rewriting historical data.

UUIDs are the primary key for all user-data tables. Auto-incrementing integers are avoided because they leak insertion order and complicate sync. UUIDs are generated client-side at write time.

## Calendar

### `calendar_events`

The active calendar. One row per event (or per recurring template, with instances expanded on read).

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key. For recurring templates, also the base UUID for the first occurrence. |
| `user_id` | UUID | Owner. Defaults to the local UUID in single-user mode. |
| `title` | text | Display title. |
| `description` | text or null | Rich text (markdown source). |
| `start_time` | ISO datetime | Event start (UTC). |
| `end_time` | ISO datetime | Event end (UTC). For all-day, midnight to midnight in the user's timezone, converted to UTC. |
| `all_day` | boolean | True if this is an all-day event. Time pickers hide when this is true. |
| `color` | integer or null | Slot index (0..23) into the active theme's 24-slot `eventPalette`. See `features/themes.md` for the palette and theme model. Values are validated on read via `normalizeEventColor`: in-range integers pass through, out-of-range or non-numeric values fall back to the `FALLBACK_COLOR_INDEX` slot with a deduped warning. |
| `recurrence_rule` | text or null | RFC 5545 RRULE string. Null for non-recurring events. |
| `recurrence_exceptions` | text or null | Comma-separated EXDATE values (`YYYY-MM-DD`). Null if none. |
| `recurrence_parent_id` | UUID or null | For detached instances, points to the original template. Used to trace history. |
| `pomodoro_config` | JSON or null | Per-event pomodoro settings (see "Pomodoro config"). Null means pomodoro is disabled for this event. |
| `notification_config` | JSON or null | Notification offsets and channels. Null means no notifications. |
| `attendees` | JSON or null | Placeholder. Designed for shared/team events. |
| `timezone` | text | IANA timezone name (`America/Los_Angeles`). Stored alongside UTC for display correctness across DST. |
| `environment_id` | UUID or null | FK to `work_environments` (planned). Null when no environment is attached. |
| `created_at` | ISO datetime | Row creation time. |
| `updated_at` | ISO datetime | Last modification. Bumped on any column change. |

Indexes: `(user_id, start_time)`, `(user_id, recurrence_parent_id)`, `(end_time)` for archival sweeps.

Why `recurrence_rule` is plain text (the RRULE string) instead of decomposed columns: the RRULE format is the lingua franca for calendar interop. Storing it intact means import/export from iCalendar, Google Calendar, or other RFC 5545 sources is trivial. Decomposed columns would force a translation layer at every boundary.

Why `pomodoro_config` is JSON instead of FK to a `pomodoro_configs` table: the config is per-event, immutable after the event is created (changing it ends the active run, see `algorithms/pomodoro-state-machine.md`), and small. A separate table earns no normalization benefit and adds a join to every event read.

### `calendar_events_archive`

Same schema as `calendar_events`, plus `archived_at` (ISO datetime). Past events that the user archived live here. The calendar UI never queries this table; analytics and stats join via `original_event_id` on `pomodoro_runs`.

## Pomodoro

The pomodoro tracking system uses three tables: runs, segments, and pauses. Together they record every session from start to finish with enough resolution for both real-time rendering and long-term analytics.

### `pomodoro_runs`

One row per continuous session of pomodoro work. Created when the timer starts, closed when the session ends. Stores a config snapshot so historical analysis can correlate outcomes with the exact settings in force at the time, even if the user later changes their config.

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key. |
| `event_id` | UUID or null | FK to `calendar_events` (SET NULL on delete/archive). Null after the event is archived. |
| `original_event_id` | UUID | Event ID at the time the run was created. Not a FK, just a value. Used to join to `calendar_events_archive` for analytics. |
| `event_date` | `YYYY-MM-DD` | The calendar day this run belongs to. |
| `user_id` | UUID | Owner. Required for future multi-user support. |
| `started_at` | ISO datetime | When the session started. |
| `ended_at` | ISO datetime or null | When the session ended. Null if still running. |
| `end_reason` | enum or null | `completed`, `stopped`, `interrupted`, `reconfigured`, `block_transition`. Null if still running. |
| `focus_duration_minutes` | integer | Config snapshot. |
| `short_break_minutes` | integer | Config snapshot. |
| `long_break_minutes` | integer | Config snapshot. |
| `pomodoro_count` | integer | Cycles before a long break. Config snapshot. |
| `idle_timeout_minutes` | integer or null | Idle threshold. Null disables idle detection for this run. Config snapshot. |
| `last_heartbeat` | ISO datetime | Updated every ~30 seconds while the session is active. Used for crash recovery. |
| `event_title_snapshot` | text or null | Event title at the time of the run. Preserved for analytics after archival. |
| `inherited_focus_minutes` | integer | Focus minutes accumulated in the current cycle, carried from the preceding run. 0 for fresh sessions. Non-zero when created by block transition or reconfiguration. |
| `inherited_cycle` | integer | Cycle number carried from the preceding run. 1 for fresh sessions. Determines whether the next break is short or long. |
| `inherited_from_run_id` | UUID or null | FK to `pomodoro_runs`. The run from which state was inherited. Null for fresh sessions. Enables tracing transition chains in analytics. |
| `experiment_id` | text or null | A/B testing label, if any. |
| `variant` | text or null | A/B testing variant, if any. |
| `created_at` | ISO datetime | Row creation time. |

Indexes: `(user_id, event_date)`, `(event_id)`, `(original_event_id)`, `(ended_at)` for finding open runs on startup.

Why the inherited fields are on the run instead of derived from the chain of previous runs: traversing the chain is fragile (previous runs might reference archived events) and slow (the chain length is unbounded). Capturing the inherited state on the run itself makes each run self-contained for plan derivation. See `algorithms/pomodoro-segments-and-plan.md`.

Why `original_event_id` is duplicated alongside `event_id` instead of relying on the FK: archival triggers a SET NULL on `event_id`. Without `original_event_id`, the run would be orphaned from analytics queries. The two-field pattern (live FK plus immutable historical pointer) keeps both joins clean.

### `pomodoro_segments`

One row per uninterrupted stretch of focus or break. A row is only created when its phase begins. The first focus segment is written when the session starts. The next segment (break or focus) is written only when the previous one ends and the next phase actually begins. A phase that never ran has no row.

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key. |
| `run_id` | UUID | FK to `pomodoro_runs` (CASCADE delete). |
| `cycle_number` | integer | Which pomodoro cycle (1 to `pomodoro_count`). |
| `phase` | enum | `focus`, `short_break`, `long_break`. |
| `planned_start` | ISO datetime | When the segment was scheduled to begin. |
| `planned_end` | ISO datetime | When the segment was scheduled to end. |
| `actual_start` | ISO datetime | When the segment actually started. Always set; a row exists only if the phase ran. |
| `actual_end` | ISO datetime or null | When the segment ended. Null if still running. |
| `status` | enum | `active`, `completed`, `interrupted`. See below. |
| `created_at` | ISO datetime | Row creation time. |

Indexes: `(run_id, actual_start)`, `(status)` for finding active segments quickly.

Why a row is only written when the phase begins (lazy segment creation): writing planned segments up front would create rows that may never reflect reality (a session can stop or reconfigure mid-cycle). Lazy creation means every row corresponds to actual history, simplifying analytics and avoiding "ghost" segments.

#### Segment statuses

| Status | Meaning |
|---|---|
| `active` | Currently running. Exactly one at a time across the whole database (invariant 2). |
| `completed` | Finished normally. Focus reached the planned end, or break was acknowledged. |
| `interrupted` | Started but cut short. App closed, session stopped, event time expired mid-segment. |

There are no `planned` or `skipped` statuses. A skipped break is detected from the gap between two consecutive focus segments on the same run (no break row in between). Adding `skipped` would duplicate this signal and create two ways to express the same fact.

### `pomodoro_pauses`

One row per pause within a segment. A pause records when the timer was not advancing during a segment, with the reason.

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key. |
| `segment_id` | UUID | FK to `pomodoro_segments` (CASCADE delete). |
| `started_at` | ISO datetime | When the pause began. |
| `ended_at` | ISO datetime or null | When the pause ended. Null if still paused. |
| `reason` | enum | `idle`, `suspend`, `manual`. |
| `created_at` | ISO datetime | Row creation time. |

Indexes: `(segment_id, started_at)`, `(reason, started_at)` for time-of-day idle analytics.

Why pauses are individual rows instead of a JSON array on the segment row:

1. **Crash recovery is trivial.** Closing open pauses is a single `UPDATE pomodoro_pauses SET ended_at = ? WHERE ended_at IS NULL`. With JSON, recovery would require parsing, mutating, and rewriting every pause blob.
2. **Analytics use standard SQL.** Queries like "average idle duration by hour of day" become simple aggregations. With JSON, every row would need to be parsed in the client or in a custom SQL function.
3. **Writes are atomic.** Inserting one row is one statement. Updating a JSON pause means read-modify-write, which can corrupt mid-crash.

### Pomodoro config (per-event, embedded in `calendar_events.pomodoro_config`)

| Field | Default | Description |
|---|---|---|
| `focusDurationMinutes` | 40 | Focus period length. |
| `shortBreakMinutes` | 5 | Short break length. |
| `longBreakMinutes` | 10 | Long break after `pomodoroCount` cycles. |
| `pomodoroCount` | 4 | Cycles before a long break. |
| `idleTimeoutMinutes` | null | Auto-pause threshold. Null disables idle detection for this event. |

Built-in presets the UI can apply: automatic (40/5/10), deep focus (40/5/10), creative (25/5/15), extended (50/10/10), custom.

### Run reference integrity (for recurring events)

After any structural operation on a recurring event, runs must point to valid, resolvable event IDs. The synthetic ID format is `templateId::YYYY-MM-DD`.

| Operation | Effect on run `event_id` |
|---|---|
| Detach instance | Updated from `templateId::date` to the standalone's new UUID. |
| Split series | Runs on old dates keep `templateId::date` (old template still exists, capped). Runs on new dates reference `newTemplateId::date`. |
| Delete template (future-only, no past instances) | Runs are deleted via CASCADE (no past data exists to preserve). |
| Archive template | `event_id` becomes null via SET NULL. `original_event_id` preserves the link. |
| Add recurrence to existing event | Existing runs keep the base UUID. Future instance runs use `UUID::date`. Both are valid. |
| Remove recurrence (scope "all") | Past instances are detached first (runs transferred). Template becomes non-recurring. Runs on the base UUID remain valid. |

Code that resolves an `event_id` on a run must handle three formats:

1. A plain UUID (non-recurring event, or the first occurrence of a template).
2. A synthetic `UUID::date` (recurring instance that still expands).
3. A null (archived event, join to `calendar_events_archive` via `original_event_id`).

If a synthetic ID no longer expands (e.g. an UNTIL cap removed the instance and detach failed), the run is an orphan. Analytics surface orphaned runs as a data integrity warning, not silent failure.

## Themes

User-authored themes persist as a normalized snapshot across six tables. Built-in light and dark stay code-pinned in `apps/client/src/lib/stores/themes.ts` and never appear in the database; the schema's `CHECK (id NOT IN ('light', 'dark'))` on `themes.id` defends against any import collision. The full feature design lives in `features/themes.md`.

Boot order matters: `apps/client/src/main.ts` awaits `ensureConfigLoaded()` and then `hydrateUserThemes()` before mounting the app. The hydrate helper runs an idempotent one-time migration that walks the legacy `themes.user` blob from `vault/config.json`, runs the current derivation engine to produce missing tokens, writes one transaction per theme, then removes `themes.user` from the config so subsequent boots load purely from SQLite.

### `themes`

One row per user theme. Carries identity, the active blend canvas (the bg dimmed event tiles blend toward), and the engine version stamp that drives the rebake banner.

| Field | Type | Description |
|---|---|---|
| `id` | text | Primary key. `CHECK (id NOT IN ('light', 'dark'))` so an import cannot shadow a built-in. |
| `display_name` | text | User-visible name. Trimmed and length-capped at 60 chars by the client. |
| `base` | text | `'light'` or `'dark'`. Used to fill any missing token from `BASE_APP_TOKENS` / `BASE_CALENDAR_TOKENS` during legacy import. The luminance of the live `--background` is what actually drives the dark-mode class at runtime, so this column is a default, not a binding. |
| `blend_canvas` | text | Hex bg the dimmed event variants blend toward. Auto-tracks `--cal-bg` whenever that token is non-isolated, otherwise the user pins it directly. |
| `seed_blend_canvas` | text | Clone-time snapshot of `blend_canvas` for "Reset all". |
| `derivation_engine_version` | integer | The `DERIVATION_ENGINE_VERSION` constant in force when the snapshot was written. The editor surfaces a rebake banner when this trails the code constant and no row in `theme_upgrade_dismissals` matches. |
| `created_at` | integer | Unix epoch ms. |
| `updated_at` | integer | Unix epoch ms. Bumped on every mutator transaction. |

### `theme_tokens`

One row per resolved color value, across three peer kinds. Sources drive multi-token derivation when one of them is edited; app and calendar tokens are the rendered shell snapshot. Source key names are bare (`canvas`, `ink`, `primary`, `destructive`, `confirm`, `warning`); app and calendar key names keep their `--prefixed` CSS form.

| Field | Type | Description |
|---|---|---|
| `theme_id` | text | FK to `themes(id)` ON DELETE CASCADE. |
| `kind` | text | `'source'`, `'app'`, or `'calendar'`. |
| `key` | text | Source name (bare) or CSS custom-property name (`--token`). |
| `value` | text | Hex color (`#rrggbb` or `#rrggbbaa`). |
| `isolated` | integer | `0` (re-derive on source edits) or `1` (user-pinned, skip during cascade). |

Primary key: `(theme_id, kind, key)`. Index: `(theme_id, kind)` for fast per-kind lookups.

The `isolated` flag replaces the old override/derived split. `isolated=1` means "do not re-derive this token when sources change"; `isolated=0` means it participates in the next source-edit cascade. Toggling Isolated on a row does not touch `value` because the snapshot already holds the auto-derived value at the moment the user pinned it.

### `theme_event_palette`

The 24-slot positional event color palette. Slot indices map directly into `eventPalette[i]` on the client.

| Field | Type | Description |
|---|---|---|
| `theme_id` | text | FK to `themes(id)` ON DELETE CASCADE. |
| `slot` | integer | `CHECK (slot >= 0 AND slot < 24)`. |
| `value` | text | Hex color. |

Primary key: `(theme_id, slot)`.

### `theme_seed_tokens`

Clone-time snapshot of every `theme_tokens` row. Per-row reset reads from this table to restore both the value and the isolated flag, so a theme that was cloned with pins keeps those pins through a row reset. "Reset all" reads the entire seed snapshot in one transaction.

Schema mirrors `theme_tokens` exactly:

| Field | Type | Description |
|---|---|---|
| `theme_id` | text | FK to `themes(id)` ON DELETE CASCADE. |
| `kind` | text | `'source'`, `'app'`, or `'calendar'`. |
| `key` | text | Same key names as `theme_tokens`. |
| `value` | text | Hex color at clone time. |
| `isolated` | integer | Pinned state at clone time. |

Primary key: `(theme_id, kind, key)`. Index: `(theme_id, kind)`.

### `theme_seed_event_palette`

Clone-time snapshot of `theme_event_palette`. Per-slot reset and "Reset all" pull from here.

| Field | Type | Description |
|---|---|---|
| `theme_id` | text | FK to `themes(id)` ON DELETE CASCADE. |
| `slot` | integer | `CHECK (slot >= 0 AND slot < 24)`. |
| `value` | text | Hex color at clone time. |

Primary key: `(theme_id, slot)`.

### `theme_upgrade_dismissals`

Tracks "Maybe later" decisions on the rebake banner so the same prompt does not return for an unchanged engine version.

| Field | Type | Description |
|---|---|---|
| `theme_id` | text | FK to `themes(id)` ON DELETE CASCADE. |
| `engine_version` | integer | The version the user dismissed against. |
| `dismissed_at` | integer | Unix epoch ms. |

Primary key: `(theme_id, engine_version)`.

The editor only suppresses the banner when a dismissal exists for the *current* `DERIVATION_ENGINE_VERSION`. Bumping the constant invalidates older dismissals automatically because no row matches the new version yet, so users see the prompt again whenever the derivation engine actually changes.

### Why a normalized snapshot rather than a JSON blob

Three motivations lined up at once. First, structural changes to the token catalog (renames, additions, splits) need a row-level migration path; a JSON blob is opaque to schema migration and forces every saved theme through a tolerant validator. Second, the snapshot model decouples saved themes from the live derivation engine: a theme written today still paints the exact same colors next year, even if the engine bumps. Third, sources are no longer privileged storage; they sit as peer rows next to the app and calendar tokens, which matches the user's intuition that surface tokens like `--card` and `--popover` are not "less important" than the source palette.

JSON keeps a role as the export format only: `serializeTheme` emits a v1 envelope (`schemaVersion: 1`, full snapshot, `appIsolated` / `calendarIsolated` arrays) and `validateThemeJson` accepts both v1 and the legacy `appTokenOverrides` / `calendarTokenOverrides` shape (the legacy branch re-derives at import time and folds overrides into the isolated-flag sets).

## Other features (stub)

These tables are designed but their detailed shape is filled in when the feature ships. Each feature doc owns the deeper definition.

- **`kanban_tasks`:** id, title, description, column, priority, estimated_pomodoros, linked_event_id, created_at, updated_at.
- **`work_environments`:** id, name, apps_to_open (JSON), browser_tabs (JSON), playlist_id, blocker_ruleset_id.
- **`notes_index`:** path, title, modified_at, tags, backlinks. Source of truth is the markdown file under `vault/notes/`.
- **`diary_index`:** date, type (morning/evening), mood, energy, sleep_hours, path. Source of truth is the markdown file under `vault/diary/`.
- **`projects`:** id, name, status, lifecycle_phase, created_at.
- **`playlists`:** id, name, tracks (JSON of file paths or YouTube IDs).

When designing one of these, follow the pomodoro pattern: snapshot any value that the user could change later but that an audit query needs to know about at the moment of the action.

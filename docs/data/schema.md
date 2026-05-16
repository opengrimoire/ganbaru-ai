# Data schema

Every table in `app.db`, with the rationale behind subtle columns and constraints. New tables are added here as features land. Stub headings exist for tables that are designed but not yet implemented; fill them in when the feature ships.

All timestamps are ISO 8601 in UTC with a `Z` suffix. The UI converts to the device's current IANA zone for display, recomputing on visibility, focus, and a 60s sanity poll so a user who travels from NYC to Tokyo sees their events shift to the correct local wall clock without reloading the app. Storing in UTC is the only thing that survives DST transitions, timezone changes, and user travel without rewriting historical data.

UUIDs are the primary key for all user-data tables. Auto-incrementing integers are avoided because they leak insertion order and complicate sync. UUIDs are generated client-side at write time.

## Data evolution rule

Persisted data is a user-owned contract. Any schema, config, JSON, import/export, or token-catalog change must explicitly handle existing installs and older exported files. Before removing or renaming stored data, check for live rows, seed/reset rows, stale config keys, legacy JSON fields, import validators, export serializers, and fallback behavior.

Do not leave obsolete persistent data behind. If a column, row key, config key, or JSON field stops having meaning, add a narrow migration or cleanup path and document why it is safe. Migrations should be idempotent, preserve user-authored values that still map to current behavior, and delete only data that is dead or derivable from current canonical data.

## Calendar

### `calendars`

Top-level grouping for events. Lets the user keep their local data in `local` while imported `.ics` files land in their own deletable rows so a tester can re-import the same Google export repeatedly without polluting the main calendar.

| Field | Type | Description |
|---|---|---|
| `id` | text | Primary key. The built-in row uses `'local'`. Imported rows get a fresh UUID. |
| `name` | text | Display name. Imported calendars use the `.ics` basename, such as an email address when Google exports one calendar per email. Older rows may still use `Imported from <basename> (YYYY-MM-DD)`, but the UI normalizes those labels. |
| `color` | text | Per-calendar color hex (`''` to inherit from theme). Reserved for future per-calendar UI. |
| `source` | text | `'local'` for the built-in calendar, `'ics'` for `.ics` imports. Future values: `'subscription'`, `'google'`, `'caldav'`. |
| `visible` | integer | 0 or 1. Toggled per calendar in the (planned) calendars panel. |
| `read_only` | integer | 0 or 1. Reserved for read-only sources (subscriptions, shared). Imported `.ics` rows are writable today. |
| `source_url` | text or null | Origin of the calendar. For `.ics` imports, the file's basename (used to dedupe re-imports of the same file). For future subscriptions, the URL. |
| `last_synced` | ISO datetime or null | When the calendar last fetched from its source. Reserved for subscriptions. |
| `created_at` | ISO datetime | Row creation time. |
| `updated_at` | ISO datetime | Last modification. |

The `local` row is seeded on first boot (`INSERT OR IGNORE`) and can never be deleted from the UI. Deleting an imported calendar runs at the application layer (`stores/calendars.svelte.ts.remove`): events are removed first (`DELETE FROM calendar_events WHERE calendar_id = $1`), which cascades through `calendar_event_overrides`, `calendar_event_attendees`, and `calendar_event_alarms` via their FK `ON DELETE CASCADE` on `calendar_events.id`; the `calendars` row is then deleted.

### `icalendar_objects`

Lossless import preservation table introduced by migration v12. One row stores one top-level imported iCalendar object for a calendar source. The normal calendar render path does not read this table.

Fields:

- `id`: primary key.
- `calendar_id`: owning calendar. Cascades when the calendar is deleted.
- `source_kind`: origin class, currently `import-file` or `import-zip-entry` for Settings imports. Future values can support generated export bases or subscriptions.
- `source_name`: file basename or zip entry basename used to replace preservation rows on re-import of the same source.
- `source_fingerprint`: deterministic fingerprint of the imported text for diagnostics and later dedupe work.
- `prodid`, `version`, `method`, `calendar_scale`: object-level properties copied out for indexed diagnostics while the full object remains in `raw_jcal`.
- `raw_jcal`: structured JSON representation of the full object.
- `diagnostics`: JSON warning list captured during parse and projection.
- `created_at`, `updated_at`: row timestamps.

Indexes: `(calendar_id)`, `(calendar_id, source_kind, source_name)`, and `(source_fingerprint)`.

### `icalendar_components`

Lossless component preservation table introduced by migration v12. One row stores one component from an imported object, including unsupported components such as `VTODO`, `VJOURNAL`, `VFREEBUSY`, nested `VALARM`, and `STANDARD` or `DAYLIGHT` blocks. Migration v13 links projected rows back to these components. The normal calendar render path does not read this table.

Fields:

- `id`: primary key.
- `object_id`: parent `icalendar_objects` row. Cascades when the object is replaced or deleted.
- `parent_component_id`: parent component for nested components.
- `calendar_id`: owning calendar for export and cleanup queries.
- `component_type`: lowercase component name such as `vevent`, `vtodo`, `vjournal`, `vfreebusy`, `vtimezone`, or `valarm`.
- `uid`: copied `UID` when present.
- `recurrence_id`: copied `RECURRENCE-ID` when present.
- `recurrence_id_value_type`: original value type for the recurrence identity.
- `sequence`: copied `SEQUENCE` when present.
- `dtstart_key`: copied `DTSTART` value for diagnostics and future lookup.
- `raw_jcal`: structured JSON representation of the component and its properties.
- `projected_kind`, `projected_id`: optional reverse link to a normalized app row. Currently used for projected `event`, `alarm`, and `override` rows.
- `preservation_status`: diagnostic state such as `partial` or `unsupported`.
- `projection_warnings`: JSON warning list for lossy projection notes.
- `sort_order`: component order among siblings.
- `created_at`, `updated_at`: row timestamps.

Indexes: `(calendar_id, component_type)`, `(calendar_id, uid)`, `(calendar_id, uid, recurrence_id)`, `(projected_kind, projected_id)`, `(preservation_status)`, and `(object_id)`.

### `calendar_events`

The active calendar. One row per event (or per recurring template, with instances expanded on read).

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key. For recurring templates, also the base UUID for the first occurrence. |
| `user_id` | UUID | Owner. Defaults to the local UUID in single-user mode. |
| `title` | text | Display title. |
| `description` | text or null | Rich text stored as sanitized HTML in the current implementation. Raw descriptions are capped at 20,000 characters before sanitization. |
| `start_time` | ISO datetime | Event start as a UTC ISO 8601 instant (`YYYY-MM-DDTHH:MM:SSZ`). |
| `end_time` | ISO datetime | Event end as a UTC ISO 8601 instant (`YYYY-MM-DDTHH:MM:SSZ`). For all-day events, the date portion is treated as a floating calendar date with no zone conversion. The internal all-day end date is inclusive for rendering, while `.ics` `DTEND;VALUE=DATE` remains exclusive on import and export. |
| `all_day` | boolean | True if this is an all-day event. Time pickers hide when this is true. |
| `meeting_enabled` | boolean | True when the Meeting section is enabled, even if every optional meeting field is empty. |
| `location` | text | Plain text location. Empty string means none. |
| `url` | text | Call link or event URL shown by Meeting. Empty string means none. |
| `color` | integer or null | Slot index (0..31) into the active theme's 32-slot `eventPalette`. See `features/themes.md` for the palette and theme model. Values are validated on read via `normalizeEventColor`: in-range integers pass through, out-of-range or non-numeric values fall back to the `FALLBACK_COLOR_INDEX` slot with a deduped warning. |
| `transparency` | enum | `opaque` means busy, `transparent` means free. Defaults to `opaque`; used for scheduling, import, and export, not as an event color or surface pattern. |
| `status` | enum | `confirmed`, `tentative`, or `cancelled`. Defaults to `confirmed`. Event-level cancelled controls cancelled rendering; attendee RSVP can still drive the local surface pattern independently. |
| `visibility` | enum | `public` or `private`. Imported `CONFIDENTIAL` values normalize to `private`. The database default is `public` to match missing iCalendar `CLASS`, while app-authored panel events default to `private`. |
| `recurrence_rule` | text or null | RFC 5545 RRULE string. Null for non-recurring events. |
| `recurrence_exceptions` | text or null | Comma-separated EXDATE recurrence dates (`YYYY-MM-DD`). Null if none. Timed `.ics` EXDATE values import as the occurrence's local date in the event home zone, then export again at the event's original start time with UTC or `TZID` to match the master event. |
| `recurrence_parent_id` | UUID or null | For detached instances, points to the original template. Used to trace history. |
| `pomodoro_config` | JSON or null | Per-event pomodoro settings (see "Pomodoro config"). Null means pomodoro is disabled for this event. |
| `notification_config` | JSON or null | Notification offsets and channels. Null means no notifications. |
| `attendees` | JSON or null | Placeholder. Designed for shared/team events. |
| `local_rsvp_status` | text or null | App-local RSVP state for the "You (Local, no email provided)" meeting row. It drives local event surface patterns before an email identity exists and is not exported as iCalendar `ATTENDEE` data. |
| `timezone` | text | IANA home zone (`America/Los_Angeles`). Required and non-empty. Used as the anchor for recurrence math (so "9 AM daily" stays 9 AM through DST, walked via `Temporal.PlainDate` arithmetic), and as the `TZID` on `.ics` re-export. The render zone (what the UI shows) is independent: it tracks the device's current zone by default, with an opt-in preference (`preferences.eventTimezoneDisplay`) to pin display to this home zone instead. |
| `environment_id` | UUID or null | FK to `work_environments` (planned). Null when no environment is attached. |
| `created_at` | ISO datetime | Row creation time. |
| `updated_at` | ISO datetime | Last modification. Bumped on any column change. |

Indexes: `(user_id, start_time)`, `(user_id, recurrence_parent_id)`, `(end_time)` for archival sweeps.

Why `recurrence_rule` is plain text (the RRULE string) instead of decomposed columns: the RRULE format is the lingua franca for calendar interop. Storing it intact means import/export from iCalendar, Google Calendar, or other RFC 5545 sources is trivial. Decomposed columns would force a translation layer at every boundary.

Per-instance overrides live in `calendar_event_overrides` (one row per detached or modified instance). The `recurrence_id` column is a UTC ISO 8601 instant identifying the original DTSTART of the overridden occurrence (the iCalendar `RECURRENCE-ID` field). Matching is by instant, not by wall clock, so a timed override survives DST transitions and zone changes intact. All-day override start and end values use the same floating date convention as all-day event rows: the date portion is canonical and no zone conversion is applied on read.

`calendar_event_overrides.recurrence_range` stores the projected `RECURRENCE-ID` `RANGE` parameter. The only supported value is `this-and-future`, from RFC 5545 `RANGE=THISANDFUTURE`. Imported cancelled overrides with this range hide that occurrence and all following generated occurrences during expansion while preserving the override for export.

The full iCalendar compatibility data model is in `docs/interop/icalendar/data-model.md`. New imports keep raw iCalendar components and properties available for future lossless round trips while projecting the subset the app understands into these normalized calendar tables. Migration v13 adds nullable `icalendar_component_id` links to `calendar_events`, `calendar_event_overrides`, `calendar_event_attendees`, and `calendar_event_alarms`; attendee rows also keep `icalendar_property_index` so an `ATTENDEE` row can be traced to the original property inside its preserved `VEVENT`. Migration v15 adds `calendar_events.local_rsvp_status` as local-only UI state, deliberately outside the iCalendar attendee projection. Full-event loads can join preservation diagnostics on demand, but visible-window loads continue to query only projected calendar rows.

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
| Remove recurrence (scope "all") | Protected history remains resolvable through a capped historical template or detached standalones. The selected mutable occurrence becomes the non-recurring survivor. Runs on the selected occurrence transfer to the survivor when the selected occurrence was synthetic. |

When recurrence is removed with scope "all," the base UUID remains the run target only when the selected survivor can safely reuse the template without rewriting protected history. If protected history keeps the old template, the selected survivor is detached into a standalone event, and runs attached to `templateId::date` for that selected occurrence move to the survivor event ID. Runs attached to other protected occurrences remain resolvable through the capped historical template unless those occurrences had to be detached, in which case they move to their detached standalone IDs.

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
| `icon_label` | text or null | `'light'` or `'dark'`. Purely decorative sun/moon tag ("was this theme meant for day or night use?"); does not affect the runtime `.dark` class or calendar contrast behavior. Nullable for backward compatibility (rows from before migration v5 are filled in on hydrate via canvas luminance). Previously named `scheme`; renamed to `icon_label` in migration v7 to make clear it is a label, not a rendering switch. The dropped `base` column previously played the same role for legacy imports, but the snapshot model derives any required fallback from canvas luminance at hydrate time, so it was removed in migration v6. |
| `seed_icon_label` | text or null | Clone-time snapshot of `icon_label` for "Reset all". Nullable on the same grounds. |
| `blend_canvas` | text | Hex bg the dimmed event variants blend toward. Auto-tracks `--cal-bg` whenever that token is non-isolated, otherwise the user pins it directly. |
| `seed_blend_canvas` | text | Clone-time snapshot of `blend_canvas` for "Reset all". |
| `derivation_engine_version` | integer | The `DERIVATION_ENGINE_VERSION` constant in force when the snapshot was written. The editor surfaces a rebake banner when this trails the code constant and no row in `theme_upgrade_dismissals` matches. |
| `calendar_default_mode` | text | One of `'light'`, `'dark'`, `'app-canvas'`, or `'custom'`. Selects the default bundle used for the internal calendar surface, event palette, and calendar details. Migration v11 backfills existing themes to `'app-canvas'`, preserving the previous behavior. |
| `calendar_default_custom` | text | Hex basis used when `calendar_default_mode = 'custom'`. |
| `seed_calendar_default_mode` | text | Clone-time snapshot of `calendar_default_mode` for "Reset all". |
| `seed_calendar_default_custom` | text | Clone-time snapshot of `calendar_default_custom` for "Reset all". |
| `created_at` | integer | Unix epoch ms. |
| `updated_at` | integer | Unix epoch ms. Bumped on every mutator transaction. |

### `theme_tokens`

One row per resolved color value, across three peer kinds. Sources drive multi-token derivation when one of them is edited; app and calendar tokens are the rendered shell snapshot. Source key names are bare (`canvas`, `ink`, `primary`, `destructive`, `confirm`, `warning`); app and calendar key names keep their `--prefixed` CSS form.

Migration v9 removes app-token rows that used to store implementation paint hooks now derived at runtime or owned by component code. This keeps existing vaults aligned with the current token catalog instead of preserving obsolete live or seed rows.

Migration v11 moves `--cal-header-bg` from `kind='calendar'` to `kind='app'` because Calendar header now follows App canvas by default while remaining independently pinnable. The remaining calendar tokens cover the internal grid surface and details only.

| Field | Type | Description |
|---|---|---|
| `theme_id` | text | FK to `themes(id)` ON DELETE CASCADE. |
| `kind` | text | `'source'`, `'app'`, or `'calendar'`. |
| `key` | text | Source name (bare) or CSS custom-property name (`--token`). |
| `value` | text | Hex color (`#rrggbb` or `#rrggbbaa`). |
| `isolated` | integer | `0` (re-derive on source edits) or `1` (user-pinned, skip during cascade). |

Primary key: `(theme_id, kind, key)`. Index: `(theme_id, kind)` for fast per-kind lookups.

The key is identity, not presentation order. Theme token reads use the client-side `THEME_TOKEN_ROW_ORDER` in their SQL `ORDER BY`, and writes iterate the same order, so raw token rows follow the token-bearing theme editor sections without storing a separate sort column. Event palette slot rows are ordered in their own table.

The `isolated` flag replaces the old override/derived split. `isolated=1` means "do not re-derive this token when sources change"; `isolated=0` means it participates in the next source-edit cascade. Toggling Isolated on a row does not touch `value` because the snapshot already holds the auto-derived value at the moment the user pinned it.

### `theme_event_palette`

The 32-slot positional event color palette. Slot indices map directly into `eventPalette[i]` on the client.

| Field | Type | Description |
|---|---|---|
| `theme_id` | text | FK to `themes(id)` ON DELETE CASCADE. |
| `slot` | integer | `CHECK (slot >= 0 AND slot < 32)`. |
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
| `slot` | integer | `CHECK (slot >= 0 AND slot < 32)`. |
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

JSON keeps a role as the export format only: `serializeTheme` emits a v2 envelope (`schemaVersion: 2`, full snapshot, `calendarDefaults`, `appIsolated` / `calendarIsolated` arrays) and `validateThemeJson` accepts v2, v1, and the legacy `appTokenOverrides` / `calendarTokenOverrides` shape. Older v1 or legacy calendar-header rows are migrated into the app-token header row during import.

## Other features (stub)

These tables are designed but their detailed shape is filled in when the feature ships. Each feature doc owns the deeper definition.

- **`kanban_tasks`:** id, title, description, column, priority, estimated_pomodoros, linked_event_id, created_at, updated_at.
- **`work_environments`:** id, name, apps_to_open (JSON), browser_tabs (JSON), playlist_id, blocker_ruleset_id.
- **`notes_index`:** path, title, modified_at, tags, backlinks. Source of truth is the markdown file under `vault/notes/`.
- **`diary_index`:** date, type (morning/evening), mood, energy, sleep_hours, path. Source of truth is the markdown file under `vault/diary/`.
- **`projects`:** id, name, status, lifecycle_phase, created_at.
- **`playlists`:** id, name, tracks (JSON of file paths or YouTube IDs).

When designing one of these, follow the pomodoro pattern: snapshot any value that the user could change later but that an audit query needs to know about at the moment of the action.

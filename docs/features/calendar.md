# Calendar

The calendar is the anchor of the app. Every other feature ties back to a time block: pomodoro sessions auto-start when their event begins, work environments activate, music playlists roll, the procrastination stopper enforces its rules. If the calendar is wrong, everything downstream is wrong. The calendar therefore prioritizes correctness over breadth: a small number of thoroughly-handled mechanics rather than every property a heavy calendar app exposes.

Recurrence math, structural operations on recurring series, and conflict resolution between overlapping blocks each have their own documents:

- `features/calendar-recurrence.md`: detach, split, template-wide edit, and the rules that keep past instances safe.
- `algorithms/recurrence-expansion.md`: how an RRULE turns into a list of instances.
- `algorithms/time-conflict-detection.md`: containment, overlap, and tiebreakers.
- `features/pomodoro.md`: how events drive the pomodoro feature.
- `features/pomodoro-progress-displays.md`: the rail rendered along the day column.

This doc covers the user-facing calendar surface: views, the event model, interactions, the edit panel, scrolling and zoom, all-day events, and active-session protection.

## View modes

Three views, switched from the navigation bar.

**Day view.** A single day column, full-height. Best for a deep look at one day's schedule, especially when running a pomodoro (the rail is most readable here). All-day events appear as chips at the top.

**Week view.** Seven day columns side by side, labeled with weekday names and dates. Best for planning. The rail appears in each day column independently, scoped to that day's runs and events.

**Month view.** A grid of day cells, each summarizing the day's events as small rows. The rail is **not** rendered in month view: the cells are too small for a 6px rail to communicate anything meaningful, and the user is in a planning context, not an in-session context.

The current view persists across app restarts. Switching views never changes the underlying selection or scroll target unless the new view cannot represent the current state.

## Event model

A calendar event is a structured record (see `data/schema.md` for the table). The user-visible properties:

- **Title:** plain text, required.
- **Start and end:** stored as UTC ISO 8601 instants. The render zone defaults to the device's current IANA zone and updates without app restart on visibility, focus, and a 60s sanity poll, so a user who travels from NYC to Tokyo sees the wall clock shift accordingly. An opt-in preference (`preferences.eventTimezoneDisplay = "homeZone"`) pins display to the event's home zone instead. All-day events are floating dates: they render on the same calendar day in any zone.
- **All-day flag:** when true, time pickers hide and the event renders as a chip in the all-day band rather than a block in the day column.
- **Color:** one of 24 palette slots. Events store the slot index (an integer 0..23); each theme owns the hex it resolves to, so themes can recolor slots without rewriting events. The index is internal only; the picker shows hex codes. Unknown values fall back to the theme's fallback slot. See `features/themes.md` for the full palette, the two-layer color model, and the custom-theme workflow.
- **Description:** rich text (markdown source under the hood). Used for context, links, agendas.
- **Notifications:** zero or more offsets in minutes before the event start. The list is configured per-event; defaults can be set globally.
- **Meeting:** a unified section that groups location (plain text with optional geo coordinates), call link (URL), and attendees (RFC 5545 ATTENDEE shape with RSVP status and guest permissions). The section is collapsible in the event panel and shares the same header pattern as pomodoro, notifications, and recurrence. It is considered enabled when any of its fields has content, so there is no separate on/off flag. Attendee sync behavior for shared and team events is described in `data/sync.md` once collaboration ships.
- **Pomodoro config:** optional. When present, the event participates in the pomodoro system. See `features/pomodoro.md`.
- **Recurrence:** optional RRULE. See `features/calendar-recurrence.md`.
- **Timezone:** IANA home zone. Required and non-empty. Anchors recurrence math (so "9 AM daily" stays 9 AM through DST) and is the `TZID` on `.ics` re-export. Independent of the render zone: changing your device zone does not rewrite this field.

Events without a pomodoro config are still first-class citizens. They appear in the calendar, drive notifications, and trigger work-environment activation. They simply do not show a rail and do not contribute to focus stats.

## Interactions

The day and week views support direct manipulation:

- **Click and drag on empty space** creates a new event. The drag defines the time range. Releasing opens the edit panel anchored at the new block.
- **Click on empty space** creates a one-hour event starting at the clicked time.
- **Click on an event** opens the edit panel anchored at the block.
- **Drag an event body** moves it. The pointer snaps to a configurable minute granularity.
- **Drag the top or bottom edge** resizes from that side. The opposite edge stays put.
- **Esc, click outside, or pressing Save** closes the edit panel.
- **Right-click** opens a context menu (delete, archive, duplicate). Past events show archive instead of delete.

In month view, click on a day cell to switch to day view focused on that date. Click on an event row to open the edit panel.

## Edit panel

The edit panel is anchored to the block being edited (or to the click point for a new event). It does not float in the center of the screen. Anchoring keeps the user oriented: they can see the event in context while editing.

Anchor positioning rules:

- The panel opens to the side with more available space (right of the block when possible, left otherwise).
- If the block scrolls out of view during editing, the panel scrolls with it. The panel does not detach.
- For new-event drags, the anchor uses the drag rectangle. As the user types or changes color, a live preview overlay matches the eventual block.

Inside the panel, sections are split per concern:

- **PomodoroSection:** toggle pomodoro on or off, pick a preset, override individual config fields. Contains the per-event focus duration, short and long break, pomodoro count, and idle timeout.
- **RecurrenceSection:** pick a preset (none, daily, weekdays, weekly, monthly, yearly) or open the advanced editor for custom RRULEs.
- **NotificationsSection:** add and remove notification offsets.
- **AttendeesSection:** add and remove attendees with role and RSVP status. Placeholder until sharing ships.
- **DescriptionEditor:** rich text editor for the description, backed by markdown.
- **ColorPicker:** swatches for the 24 palette slots; hovering a swatch reveals its hex value.
- **TimezoneSelector:** IANA timezone for the event. Defaults to the user's timezone.
- **TimePicker:** start and end time. Hidden when all-day is on.

Unsaved changes are tracked. Closing the panel with unsaved edits prompts to save or discard. Confirmation dialogs opened from the panel own their pointer events, so the panel's outside-close listener must not block clicks on dialog buttons. Saving on a recurring event triggers the scope picker (this, following, all). See `features/calendar-recurrence.md`.

## Smooth scrolling and zoom

The day and week timed grid uses one shared wheel path for the timeline, the custom scrollbar, the all-day band, and modified wheel input on the separated day-name header. Wheel deltas are normalized by delta mode and multiplied so normal wheel ticks cover more distance, with a stronger multiplier for lighter deltas so gentle wheel movement starts more easily. The final movement uses a continuous-speed target animation: wheel input accumulates a target scroll position, and one animation loop moves toward it without easing, deceleration, or a momentum tail. Single-tick movement uses the base speed. Longer accumulated target distances can raise the active speed during the same scroll burst, but the speed is not reduced while finishing the burst, which avoids an end-settle feeling. The day-name and all-day header band sits outside the timeline scroll container so it stays visually stable while the timed grid scrolls beneath it.

Vertical zoom maps minutes to pixels. The discrete zoom levels in pixels per hour are `[30, 45, 67, 100, 150, 200]`. The default is 45, where the 15min grid reads as 100% in settings. The header `-` and `+` controls and the Shift + - and Shift + + shortcuts snap to the nearest level. Shift + 0 resets the calendar timeline zoom while preserving the visible time position where possible.

## Window loading and rapid navigation

Calendar rendering is windowed. The frontend asks Rust for the visible date range instead of keeping the whole event database in memory. Non-recurring rows are bounded by the visible window, while recurring templates are expanded only for that requested range.

Rapid navigation is latest-wins. If the user holds an arrow key or a scripted driver sends many forward/back requests, stale intermediate windows must not each force a full row map, recurrence expansion, state apply, and paint. The app may finish a native query that has already started, but once a newer target exists it should skip stale mapping, stale expansion where possible, and stale state application.

The store keeps only a small bounded cache of render windows. Day and week views prefetch adjacent windows after a successful foreground load so normal previous/next navigation can swap from cache without blanking. Mutations clear the cache so saved edits, imports, deletes, detach, and split operations cannot reuse stale render state.

Held keyboard navigation is gated. It fires one immediate navigation for a normal key press, then after the hold delay runs repeat ticks at a fixed cadence. Each tick navigates once only when no anchor commit is pending. Foreground window loads are latest-wins and must not delay the repeat cadence; a new held tick may supersede a stale load target. Busy main-thread frames naturally delay or skip timer callbacks, and missed repeats are not replayed later. Background prefetch must not block held-key motion. Keyup and blur cancel future held-repeat ticks immediately. The release-tail speed-log mark only measures the final settle after the app receives keyup, not the physical delay before the browser can process keyup if the main thread is already blocked.

## All-day events

All-day events render in a band at the top of the day or week view. They span columns when the event covers multiple days. Within the band, events stack into rows so that overlapping all-day events all remain visible.

Drag-to-create still works in the all-day band (drag across day columns to set the date range). Resizing changes the start or end date by a whole day at a time, since there is no time component.

Time-based view manipulations (zoom, scroll) do not affect the all-day band height. The band auto-sizes to fit its row count.

## Active session protection

When a pomodoro session is running on an event, the calendar UI restricts certain edits to keep the timer's assumptions valid. The restrictions are not arbitrary: each one corresponds to a hazard documented in `data/hazards.md` (hazard 2).

- **Delete is unavailable.** A past or in-progress event with tracking data can only be archived, never deleted (invariant 7). The delete button is hidden; the only available action is archive, and only after the session is stopped.
- **End-time edits propagate.** Resizing the event end changes when the session expires. The timer schedules a new expiration tick; the rail reflects the new boundary.
- **Start-time edits are no-ops for the running session.** The session already started; segments already exist. The new start time only affects future rendering of the rail background.
- **Recurrence edits are scoped carefully.** Editing a recurring event with an active session always preserves the active session by detaching the active instance into a standalone before the structural change applies. See `features/calendar-recurrence.md`.
- **Pomodoro toggle off stops the session.** Disabling pomodoro on an active event ends the run with `end_reason = stopped` before removing the config.
- **Reconfiguration ends the run and starts a new one with inheritance.** Changing focus duration mid-session is allowed, but it transitions the run rather than mutating it in place. See `algorithms/pomodoro-state-machine.md`.

For events without an active session but with past tracking data, the protections are weaker: the event can be moved, resized, recolored. The tracking data stays anchored to its original timestamps, so the rail's segments can land outside the event's new block (still valid historical data).

## Examples

**A typical day, week view.** The user opens the app on Monday morning. The week view shows seven columns. Today's column has "Standup 09:30-10:00" (no pomodoro) and "Deep Work 10:00-12:00" (pomodoro 40/5/10). At 10:00, the rail in today's column starts showing green for Deep Work. As the user progresses, the rail fills with focus segments and break marks. Other days in the week show their planned events with empty rails.

**Creating an event by dragging.** The user is in day view. They drag from 14:00 to 16:00 in the day column. A live preview shows a placeholder block in the user's default color. Releasing opens the edit panel anchored to the right of the block. The user types "Reading" and clicks the pomodoro toggle. Saving collapses the panel; the block now shows the title and the rail begins projecting break marks.

**An all-day event spanning a week.** The user creates "Conference" with all-day on, dragging from Monday to Friday in the all-day band. The event renders as a single chip across all five day columns. In month view, it appears as a row across the same span. None of these renderings shows a rail.

**Switching from week to month.** The user is in week view with a session running. They switch to month view. The session keeps running; the title bar ring (see `features/pomodoro-progress-displays.md`) continues to show focus progress. Switching back to week view re-renders the rail with all the segments that accumulated during the month-view interval.

## Import and export

The Settings modal exposes a "Calendars" section (under the "Data" group) that lists every calendar (built-in `local` plus every imported one) and offers three actions:

- **Import .ics file.** Opens a native file picker filtered to `.ics` and `.zip`. A plain `.ics` is read through the existing vault command, parsed via `lib/calendar/ics/parser.ts`, and bulk-upserted by `(calendar_id, source_uid)`. A `.ics.zip` (Google Calendar's default export shape, where each calendar is a separate `.ics` inside the bundle) is unpacked by the Rust command `vault_read_ics_zip_entries`, which uses the `zip` crate with only the deflate feature enabled, validates entry paths through `enclosed_name` (zip-slip protection), refuses encrypted entries, and caps each entry at 25 MiB / aggregate 250 MiB / 1024 entries to reject decompression bombs. Each `.ics` entry becomes its own imported calendar (one toast aggregating the totals). Re-importing the same file always lands in the same `Imported from <basename> (YYYY-MM-DD)` row, so events deduplicate by UID instead of stacking. Warnings (lossy fields, unknown TZIDs, malformed events) print to the console.
- **Export to .ics.** Per-calendar. Opens a save dialog, serializes every event in that calendar through `lib/calendar/ics/serializer.ts`, and writes the result through the vault command.
- **Delete calendar.** Per-row, with a confirm dialog. The cascade runs in two stages: `stores/calendars.svelte.ts.remove` first deletes every event in the calendar (which cascades through `calendar_event_overrides`, `calendar_event_attendees`, and `calendar_event_alarms` via their FK `ON DELETE CASCADE` on `calendar_events.id`), then deletes the `calendars` row. The built-in `local` calendar can never be deleted.

Re-import idempotence is driven by RFC 5545 `SEQUENCE`. On a re-import, an event with a lower sequence than the stored row is skipped, equal-or-higher overwrites in place (replacing all child rows in lockstep). Events without a `SEQUENCE` default to 0 on both sides, so the behavior degrades to "always overwrite on re-import", which is what the major calendars do anyway.

What is preserved end-to-end through parse → serialize → parse: title, start, end, all-day flag, IANA home zone, RRULE, EXDATE (date-only), RDATE, RECURRENCE-ID overrides (with their own per-instance title / start / end / description / location / status / transparency / visibility / extended properties), STATUS, CLASS, TRANSP, PRIORITY, SEQUENCE, CATEGORIES, GEO, ORGANIZER, ATTENDEE rows, VALARM rows, X-* extended properties, and Google's guest-permissions X-properties.

What is lossy or dropped: VALARM `REPEAT` and `DURATION` (no schema columns; one deduped warning); EXDATE time-of-day exclusions are coerced to date-only (matches our recurrence-engine's exception model); `METHOD` and meeting-invitation semantics are ignored (every import is treated as the user's own copy); `DTSTAMP` / `LAST-MODIFIED` / `CREATED` are not threaded into the database (we keep our own `created_at` / `updated_at`); unknown TZIDs fall back to UTC with one deduped warning; full DST rule blocks inside foreign VTIMEZONE definitions are ignored on import (we re-anchor to the IANA name).

The mental model: an `.ics` import is a separate calendar that the user can delete in one click. The title-bar reset-database button still wipes everything, including imported calendars. Re-importing the same file is always safe.

## What this doc does not cover

Recurring instance expansion and structural operations are in `features/calendar-recurrence.md`. The pomodoro timer, break screen, and idle behavior are in their own docs under `features/`. Rail rendering and band computation are in `features/pomodoro-progress-displays.md`. Conflict tiebreakers are in `algorithms/time-conflict-detection.md`.

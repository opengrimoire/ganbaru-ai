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
- **Start and end:** stored in UTC, displayed in the user's local timezone (or the event's timezone if the event was imported with one). All-day events use the user's local day boundaries.
- **All-day flag:** when true, time pickers hide and the event renders as a chip in the all-day band rather than a block in the day column.
- **Color:** one of 24 palette slots. Events store the slot index (an integer 0..23); each theme owns the hex it resolves to, so themes can recolor slots without rewriting events. The index is internal only; the picker shows hex codes. Unknown values fall back to the theme's fallback slot. See `features/themes.md` for the full palette, the two-layer color model, and the custom-theme workflow.
- **Description:** rich text (markdown source under the hood). Used for context, links, agendas.
- **Notifications:** zero or more offsets in minutes before the event start. The list is configured per-event; defaults can be set globally.
- **Meeting:** a unified section that groups location (plain text with optional geo coordinates), call link (URL), and attendees (RFC 5545 ATTENDEE shape with RSVP status and guest permissions). The section is collapsible in the event panel and shares the same header pattern as pomodoro, notifications, and recurrence. It is considered enabled when any of its fields has content, so there is no separate on/off flag. Attendee sync behavior for shared and team events is described in `data/sync.md` once collaboration ships.
- **Pomodoro config:** optional. When present, the event participates in the pomodoro system. See `features/pomodoro.md`.
- **Recurrence:** optional RRULE. See `features/calendar-recurrence.md`.
- **Timezone:** IANA name. Stored alongside the UTC times so a meeting created in one timezone displays correctly when the user travels.

Events without a pomodoro config are still first-class citizens. They appear in the calendar, drive notifications, and trigger work-environment activation. They simply do not show a rail and do not contribute to focus stats.

## Interactions

The day and week views support direct manipulation:

- **Click and drag on empty space** creates a new event. The drag defines the time range. Releasing opens the edit panel anchored at the new block.
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

Unsaved changes are tracked. Closing the panel with unsaved edits prompts to save or discard. Saving on a recurring event triggers the scope picker (this, following, all). See `features/calendar-recurrence.md`.

## Smooth scrolling and zoom

The day and week views use a momentum-based scroll: dragging or wheeling builds velocity, lifting the input lets the velocity decay smoothly. This makes long-range navigation (jumping from morning to evening) feel direct without forcing the user to overshoot and correct.

Vertical zoom maps minutes to pixels. The discrete zoom levels in pixels per hour are `[30, 45, 67, 100, 150, 200]`. The default is 100. Zooming in or out (Ctrl+wheel, or pinch on touch) snaps to the nearest level.

For "power scrolls" (rapid wheel events), the renderer applies a brief zoom in instantly to avoid the row-height transition flashing through intermediate values. Smooth interpolation is reserved for ordinary scroll-and-rest patterns.

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

## What this doc does not cover

Recurring instance expansion and structural operations are in `features/calendar-recurrence.md`. The pomodoro timer, break screen, and idle behavior are in their own docs under `features/`. Rail rendering and band computation are in `features/pomodoro-progress-displays.md`. Conflict tiebreakers are in `algorithms/time-conflict-detection.md`.

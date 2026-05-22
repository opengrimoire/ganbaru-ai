# Calendar

The calendar is the anchor of the app. Every other feature ties back to a time block: pomodoro sessions auto-start when their event begins, work environments activate, music playlists roll, the procrastination stopper enforces its rules. If the calendar is wrong, everything downstream is wrong. The calendar therefore prioritizes correctness over breadth: a small number of thoroughly-handled mechanics rather than every property a heavy calendar app exposes.

Recurrence math, structural operations on recurring series, and conflict resolution between overlapping blocks each have their own documents:

- `features/calendar-recurrence.md`: template, instance, detach, split, and the rules that keep past instances safe.
- `features/calendar-recurrence-editing.md`: event panel preview, scope switching, recurrence save semantics, and post-save rendering.
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
- **Time format:** the calendar can display times in 24-hour or 12-hour am/pm form (`preferences.calendarTimeFormat`). This is presentation-only. Event storage, recurrence math, import/export, and time editing commits continue to use canonical 24-hour values.
- **All-day flag:** when true, time pickers hide and the event renders as a chip in the all-day band rather than a block in the day column.
- **Color:** one of 32 palette slots. Events store the slot index (an integer 0..31); each theme owns the hex it resolves to, so themes can recolor slots without rewriting events. The index is internal only; the picker shows hex codes. Unknown values fall back to the theme's fallback slot. See `features/themes.md` for the full palette, the two-layer color model, and the custom-theme workflow.
- **Description:** rich text stored as sanitized HTML in the current implementation, capped at 20,000 raw characters before sanitization. Used for context, links, agendas. Closed event panels show a plain text preview; rich formatting appears only while editing.
- **Notifications:** zero or more offsets in minutes before the event start. The list is configured per-event; defaults can be set globally.
- **Availability:** busy or free scheduling metadata (`TRANSP` in `.ics`). Defaults to busy. It affects availability for scheduling and import/export, not the event's color or surface pattern.
- **Visibility:** public or private (`CLASS` in `.ics`). New app-authored events default to private. Imported `CONFIDENTIAL` is treated as private, and missing `CLASS` imports as public per iCalendar defaults.
- **Meeting:** a unified section that groups location (plain text with optional geo coordinates), call link (URL), organizer, the local user's participation row, and attendees (RFC 5545 ORGANIZER / ATTENDEE shape with RSVP status and guest permissions). The section is collapsible in the event panel and shares the same header pattern as pomodoro, notifications, and recurrence. Its enabled state is stored separately so a user can keep Meeting on without adding guests, a location, or a call link. Imported organizers are read-only metadata and should not be duplicated as removable attendees in the panel. The local placeholder row is shown as "You (Local, no email provided)"; its non-accepted RSVP state is stored as app-local event metadata, drives the local surface pattern, is not counted as a stored attendee, and is not exported as an `ATTENDEE` or `ORGANIZER`. Imported `.ics` calendars may infer "You (<email>)" from the source calendar filename when that filename is an email and an organizer or attendee row matches it. Other imported attendee emails must not be relabeled as "You" until identity settings can match the user's real email to an attendee row. Row-level attendee actions should remain visible for organizer, self, and guests, but disabled with a not-allowed cursor whenever the current identity or permissions do not allow the action. Attendee sync behavior for shared and team events is described in `data/sync.md` once collaboration ships.
- **Pomodoro config:** optional. When present, the event participates in the pomodoro system. See `features/pomodoro.md`.
- **Recurrence:** optional RRULE. See `features/calendar-recurrence.md` and `features/calendar-recurrence-editing.md`.
- **Timezone:** IANA home zone. Required and non-empty. Anchors recurrence math (so "9 am daily" stays 9 am through DST) and is the `TZID` on `.ics` re-export. Independent of the render zone: changing your device zone does not rewrite this field.

Events without a pomodoro config are still first-class citizens. They appear in the calendar, drive notifications, and trigger work-environment activation. They simply do not show a rail and do not contribute to focus stats.

Event notifications are transient native desktop notifications, not sound-only alerts. The notification title is the event title, and the body includes the lead time, time range or all-day label, and location when available. Clicking the notification or its Open calendar action switches the main app to Calendar and requests that the OS show and focus the main window. Ubuntu GNOME and other compositors may still block the raise request through focus-stealing prevention. The app asks the OS not to keep calendar reminders in notification history after the popup disappears, though final persistence behavior depends on the user's desktop notification server.

## Interactions

The day and week views support direct manipulation:

- **Click and drag on empty space** creates a new event. The drag defines the time range. Releasing opens the edit panel anchored at the new block.
- **Click on empty space** creates a one-hour event starting at the clicked time.
- **Click on an event** opens the edit panel anchored at the block.
- **Drag an event body** moves it. The pointer snaps to a configurable minute granularity.
- **Drag the top or bottom edge** resizes from that side. The opposite edge stays put.
- **Esc, click outside, or pressing Save** closes the edit panel.
- **Right-click** opens a context menu (delete, archive, duplicate). Past events show archive instead of delete.
- **Delete event** removes the event immediately and shows a bottom `Event deleted` toast with `Undo` for 5 seconds. Closing the toast, letting it expire, or closing the app makes the delete permanent.

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
- **MeetingSection:** toggle Meeting on or off, edit location, edit call link, show organizer metadata, show the local user's participation row, and add or remove attendees with role and read-only RSVP status on locally authored events. Imported events with an external organizer keep organizer and attendee rows as read-only metadata until identity and permissions exist. The app must not let users change another attendee's RSVP response unless a future shared-calendar identity model can prove that attendee is the current user.
- **DescriptionEditor:** rich text editor for the description, stored as sanitized HTML in the current implementation. The frontend and Rust backend both enforce the same subset: bold, italic, underline, ordered and unordered lists, list items, paragraphs or divs, line breaks, and HTTP(S) links. Both boundaries cap raw descriptions at 20,000 characters before sanitizing. The backend sanitizes descriptions before database writes and again before returning rows, so old stored values are cleaned on read. Outside active editing, the panel renders only a plain text preview in the main Svelte DOM. Markdown remains the long-term document format direction, but calendar descriptions are not markdown-backed yet.
- **ColorPicker:** swatches for the 32 palette slots; hovering a swatch reveals its hex value.
- **TimezoneSelector:** IANA timezone for the event. Defaults to the user's timezone.
- **TimePicker:** start and end time. Hidden when all-day is on.

Unsaved changes are tracked. Closing the panel with unsaved edits prompts to save or discard. Confirmation dialogs opened from the panel own their pointer events, so the panel's outside-close listener must not block clicks on dialog buttons. Saving on an event that was already part of a saved recurring series uses the scope picker (this, following, all). Adding repeat to a saved non-recurring event does not show the scope picker because there is no previous series to scope. See `features/calendar-recurrence-editing.md`.

## Smooth scrolling and zoom

The day and week timed grid uses one shared wheel path for the timeline, the custom scrollbar, the all-day band, and modified wheel input on the separated day-name header. Wheel deltas are normalized by delta mode and multiplied so normal wheel ticks cover more distance, with a stronger multiplier for lighter deltas so gentle wheel movement starts more easily. The final movement uses a continuous-speed target animation: wheel input accumulates a target scroll position, and one animation loop moves toward it without easing, deceleration, or a momentum tail. Single-tick movement uses the base speed. Longer accumulated target distances can raise the active speed during the same scroll burst, but the speed is not reduced while finishing the burst, which avoids an end-settle feeling. The day-name and all-day header band sits outside the timeline scroll container so it stays visually stable while the timed grid scrolls beneath it.

Vertical zoom maps minutes to pixels. The discrete zoom levels are percentage steps `[50%, 75%, 100%, 125%, 150%, 200%, 300%, 400%]`, where 100% is 50 pixels per hour. The header `-` and `+` controls and the Shift + - and Shift + + shortcuts snap to the nearest level. Shift + 0 resets the calendar timeline zoom while preserving the visible time position where possible.

## Window loading and rapid navigation

Calendar rendering is windowed. The frontend asks Rust for the visible date range instead of keeping the whole event database in memory. Non-recurring rows are bounded by the visible window, while recurring templates are expanded only for that requested range.

Rapid navigation is latest-wins. If the user holds an arrow key or a scripted driver sends many forward/back requests, stale intermediate windows must not each force a full row map, recurrence expansion, state apply, and paint. The app may finish a native query that has already started, but once a newer target exists it should skip stale mapping, stale expansion where possible, and stale state application.

The store keeps only a small bounded cache of render windows. Day and week views prefetch adjacent windows after a successful foreground load so normal previous/next navigation can swap from cache without blanking. Mutations clear the cache so saved edits, imports, deletes, detach, and split operations cannot reuse stale render state.

Held keyboard navigation is gated. It fires one immediate navigation for a normal key press, then after the hold delay runs repeat ticks at a fixed cadence. Each tick navigates once only when no anchor commit is pending. Foreground window loads are latest-wins and must not delay the repeat cadence; a new held tick may supersede a stale load target. Busy main-thread frames naturally delay or skip timer callbacks, and missed repeats are not replayed later. Background prefetch must not block held-key motion. Keyup and blur cancel future held-repeat ticks immediately. The release-tail speed-log mark only measures the final settle after the app receives keyup, not the physical delay before the browser can process keyup if the main thread is already blocked.

## All-day events

All-day events render in a band at the top of the day or week view. They span columns when the event covers multiple days. Within the band, events stack into rows so that overlapping all-day events all remain visible.

Drag-to-create still works in the all-day band (drag across day columns to set the date range). Resizing changes the start or end date by a whole day at a time, since there is no time component.

Internally, all-day ranges use an inclusive end date because the UI needs to know the last visible day. `.ics` import and export convert this to and from RFC 5545 `VALUE=DATE` semantics, where `DTEND` is the first non-included date.

Event status and availability preserve the selected palette color. Past event color dimming is controlled by `preferences.calendarDimPastEvents` and is on by default; when enabled, it is the only state that dims the fill color. Free/busy (`TRANSP` in `.ics`) is scheduling metadata shown in the event panel, not a grid pattern. Event-level `STATUS` is preserved for import/export but is not a primary top-strip edit control. Event-level cancelled is still a global cancellation marker and uses the left-leaning diagonal hatch plus a line-through title. Otherwise, when an imported calendar identity matches an attendee row, that attendee RSVP becomes the render-only surface status in the closed calendar grid and open panel: accepted has no pattern, pending uses a subtle dot pattern, tentative uses vertical pinstripes, and declined uses the same cancelled/declined treatment. If no email identity matches, app-local RSVP metadata for the "You (Local, no email provided)" row can drive the same surface pattern without becoming iCalendar attendee data.

Closed event blocks show repeat indicators. Meeting blocks show a generic meeting indicator only when Meeting is enabled without a call link or location. A call link uses the video-call indicator, a location uses the location indicator, and both appear when both fields exist. Notification settings stay inside the event panel and do not add a block icon.

Time-based view manipulations (zoom, scroll) do not affect the all-day band height. The band auto-sizes to fit its row count.

## Active session protection

When a pomodoro session is running on an event, the calendar UI restricts certain edits to keep the timer's assumptions valid. The restrictions are not arbitrary: each one corresponds to a hazard documented in `data/hazards.md` (hazard 2).

- **Delete is unavailable.** A past or in-progress event with tracking data can only be archived, never deleted (invariant 7). The delete button is hidden; the only available action is archive, and only after the session is stopped.
- **End-time edits propagate.** Resizing the event end changes when the session expires. The timer schedules a new expiration tick; the rail reflects the new boundary.
- **Start-time edits are no-ops for the running session.** The session already started; segments already exist. The new start time only affects future rendering of the rail background.
- **Recurrence edits are scoped carefully.** Editing a recurring event with an active session must preserve the active run across `Only this`, `Following`, and `All`. Depending on the scope, the active occurrence may remain on the old template, move to a new template, become the selected collapse survivor, or be detached; the run transfers only when Save changes the active occurrence's event ID. See `features/calendar-recurrence.md`.
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

- **Import .ics file.** Calls the Rust command `vault_pick_and_read_ics_import`, which opens a native file picker filtered to `.ics` and `.zip`, validates the selected path in Rust, and reads only after the user chooses a file. Plain `.ics` files are capped at 25 MiB, parsed via `lib/calendar/ics/parser.ts`, and bulk-upserted by `(calendar_id, source_uid)`. A `.ics.zip` (Google Calendar's default export shape, where each calendar is a separate `.ics` inside the bundle) is unpacked in Rust with the `zip` crate using only the deflate feature enabled. The zip path validates entry paths through `enclosed_name` (zip-slip protection), refuses encrypted entries, and caps each entry at 25 MiB / aggregate 250 MiB / 1024 entries to reject decompression bombs. Each `.ics` entry becomes its own imported calendar (one toast aggregating the totals). Re-importing the same file always lands in the same calendar keyed by the source filename, so events deduplicate by UID instead of stacking. Imported calendar UI labels show the `.ics` basename and an `ics` tag; the import date belongs in the settings details, not in the main label. Warnings (lossy fields, unknown TZIDs, malformed events) print to the console.
- **Export to .ics.** Per-calendar. Serializes every event in that calendar through `lib/calendar/ics/serializer.ts`, then calls `vault_pick_and_write_ics_export`. Rust owns the native save dialog, validates the final `.ics` path, and writes the file atomically.
- **Delete calendar.** Per-row, with a confirm dialog. The cascade runs in two stages: `stores/calendars.svelte.ts.remove` first deletes every event in the calendar (which cascades through `calendar_event_overrides`, `calendar_event_attendees`, and `calendar_event_alarms` via their FK `ON DELETE CASCADE` on `calendar_events.id`), then deletes the `calendars` row. The built-in `local` calendar can never be deleted.

Re-import idempotence is driven by RFC 5545 `SEQUENCE`. On a re-import, an event with a lower sequence than the stored row is skipped, equal-or-higher overwrites in place (replacing all child rows in lockstep). Events without a `SEQUENCE` default to 0 on both sides, so the behavior degrades to "always overwrite on re-import", which is what the major calendars do anyway.

The complete iCalendar compatibility plan lives in `docs/interop/icalendar/`. It defines the target standards scope, the preservation and normalized projection architecture, fixture strategy, client-specific test plans, migration path, and performance budget for moving from the current pragmatic `.ics` support to broad RFC-compatible import and export.

New imports also store structured iCalendar object and component JSON in preservation tables. Projected events, attendees, alarms, and recurrence overrides link back to preserved components so full event loads can expose preservation status, projection warnings, and raw component JSON for export merging. The visible calendar window still reads only normalized event rows. Export merges linked preserved `VEVENT` and nested `VALARM` components with the app's current supported fields, so unsupported event properties, unsupported parameters, inert URI attachments, imported `DURATION` shape, floating date-time shape, and `RECURRENCE-ID;RANGE=THISANDFUTURE` survive supported edits. Preserved `VTIMEZONE` definitions are emitted before generated timezone stubs. Top-level non-event components are passed through unchanged. Rows without preserved components still export through generated components.

When an import contains duplicate master `VEVENT` components with the same `UID`, GanbaruAI projects the newest revision by `SEQUENCE`, then by `LAST-MODIFIED`, `DTSTAMP`, or `CREATED` when sequence ties. This handles Google exports that include an older uncapped recurrence plus a newer capped recurrence for the same event identity.

Scheduling metadata remains offline data. RSVP status is displayed as imported or locally stored event data, not as a sendable response. Export reuses a preserved object-level `METHOD` only when the calendar has one distinct preserved method; mixed imported methods fall back to `PUBLISH` because a single calendar backup export cannot truthfully represent multiple scheduling message types.

Rows imported before preservation storage existed cannot be made lossless automatically. When a full event has an imported `UID` but no linked preserved component, the app marks its iCalendar preservation state as `regenerated` and export uses generated fields from the normalized row.

Recurring timed exports keep recurrence identifiers in the same time model as the master event. If a Google-style recurring event uses `TZID`, `DTSTART`, `DTEND`, `EXDATE`, and override `RECURRENCE-ID` all use that zone and the original wall-clock start time. UTC recurring events use UTC `Z` values. All-day recurring events use date-only `VALUE=DATE` values.

The serializer emits CRLF line endings, folds content lines by UTF-8 octets, escapes TEXT values, and quotes/caret-escapes parameter values such as attendee and organizer `CN`.

What is preserved end-to-end through parse → serialize → parse for projected data: title, start, end, all-day flag, IANA home zone, RRULE, EXDATE (date-only), RDATE, RECURRENCE-ID overrides (with their own per-instance title / start / end / description / location / status / transparency / visibility / extended properties / `RANGE=THISANDFUTURE`), STATUS, CLASS, TRANSP, PRIORITY, SEQUENCE, CATEGORIES, GEO, ORGANIZER, ATTENDEE rows, VALARM rows, X-* extended properties, and Google's guest-permissions X-properties. Visibility follows Google Calendar style semantics: `PUBLIC` and `PRIVATE` are first-class values, and imported `CONFIDENTIAL` is normalized to `PRIVATE`. For newly imported linked `VEVENT` components, unsupported event properties, unsupported property parameters, and unsupported `VALARM` fields are preserved by export merging unless the projected row or projected alarm was deleted.

New events created in the app default to private visibility. Imports keep their source meaning: missing `CLASS` still imports as `PUBLIC` per iCalendar defaults, while `CONFIDENTIAL` imports as `PRIVATE`.

What remains lossy in the normalized projection or generated export: arbitrary EXDATE time-of-day values are coerced to recurrence dates, then exported at the event's original start time; meeting-invitation semantics are not acted on (every import is treated as the user's own copy); `DTSTAMP` / `LAST-MODIFIED` / `CREATED` are not threaded into normalized event columns (we keep our own `created_at` / `updated_at`); unknown TZIDs fall back to UTC with one deduped warning; full DST rule blocks inside foreign VTIMEZONE definitions are preserved for export but are not used for app recurrence math. Imported cancelled recurrence overrides hide their affected occurrences, including `RANGE=THISANDFUTURE`, but the UI still does not expose a dedicated edit operation for creating that iCalendar range manually. Non-event components such as `VTODO`, `VJOURNAL`, and `VFREEBUSY` are preserved on import and passed through on export, but they are not visible or editable in the app until their future feature surfaces exist.

The code-backed current support matrix is tracked in `docs/interop/icalendar/conformance-checklist.md`.

The mental model: an `.ics` import is a separate calendar that the user can delete in one click. The reset-database command still wipes everything, including imported calendars. Re-importing the same file is always safe.

## What this doc does not cover

Recurring instance expansion and structural operations are in `features/calendar-recurrence.md`. Event panel recurrence edit semantics are in `features/calendar-recurrence-editing.md`. The pomodoro timer, break screen, and idle behavior are in their own docs under `features/`. Rail rendering and band computation are in `features/pomodoro-progress-displays.md`. Conflict tiebreakers are in `algorithms/time-conflict-detection.md`.

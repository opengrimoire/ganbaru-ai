# Calendar views and navigation

## View modes

**Day view** shows one day with timed and all-day regions. It is the default mobile view and the most detailed planning and focus surface.

**Work-cycle view** shows a configurable compact span for the user's working rhythm without assuming a Monday-to-Friday culture.

**Week view** shows seven days and supports cross-day planning.

**Month view** summarizes each day with compact event chips and opens a full-day list when all events cannot remain legible. Month view is a planning surface and does not render the Pomodoro timeline rail.

Changing views never stops an active session. When the user returns to a detailed view, the event block and progress rail reconstruct from canonical timer history.

## Navigation

Users can move by the view's natural interval, jump to today, select a date, and use documented keyboard shortcuts when focus is not inside an editor, picker, or dialog. Held-key navigation is paced and cancellable; it does not replay missed ticks after a busy frame.

Rapid navigation uses latest-request-wins semantics. Older data cannot replace a newer requested window. Prefetch may improve adjacent navigation but never blocks foreground movement or becomes the source of truth.

## Scrolling and zoom

Day and week timelines preserve a stable relationship between scroll position, wall-clock time, and event geometry. Zoom changes time density without changing event instants. The app keeps the user's current temporal anchor when practical.

Automatic scrolling to the active event or current time must not fight recent manual scrolling. Direct user interaction wins until the surface has been idle long enough to make automatic positioning useful again.

## Timed events

Timed blocks occupy their interval and share horizontal space when they overlap. Their position follows event time, not title length or content. Dragging an empty interval creates a draft; dragging an existing event moves it; resizing changes the appropriate boundary.

Active events protect their recorded start. Direct manipulation may extend or shorten the end within valid limits, but it cannot move the block or change the top boundary once Pomodoro history establishes the start.

## All-day events

All-day events use inclusive visible dates and an exclusive stored end boundary. They render in the all-day band and month cells, not on the timed rail. Multi-day events retain one continuous identity across their span.

Turning a timed event into all-day removes wall-clock editing without converting it through the current device zone in a way that shifts intended dates. Turning an all-day event into timed requires an explicit local time and duration.

## Month overflow

Month cells keep event labels legible before maximizing count. When events do not fit, a localized `+N more` control opens a scrollable one-event-per-row day list. Each row exposes title and time, supports keyboard activation, and opens the normal event panel.

Closing the day list also requests closure of any nested event panel through the normal unsaved-change flow.

## Calendar visibility

Calendar visibility affects presentation and scheduling queries without deleting events. The built-in local calendar cannot be deleted. Deleting another calendar follows event protection rules: future untracked events can be removed, while protected history is archived with enough source identity to remain understandable.

## Accessibility

Every view provides a non-pointer route for navigation, event opening, creation, and overflow access. Color is never the only status signal. Patterns, labels, and accessible names communicate cancellation, response state, active focus, and controls.

Touch layouts retain appropriately sized controls and native panning. Desktop hover affordances also appear on focus.

Timed blocks and all-day chips are focusable controls with visible focus and accessible event names. Enter and Space open the same event panel as a click without starting a drag; held activation keys do not repeatedly reopen it.

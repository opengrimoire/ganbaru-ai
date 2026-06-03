# Pomodoro progress displays

The pomodoro system surfaces progress in three places: a small ring in the title bar, a ring in the system tray, and a vertical timeline rail in the calendar day, work-cycle, and week views. They serve different purposes (always-visible, OS-level, and in-context) and follow different rendering rules, but they share one principle: each shows only what the user needs to make a decision in the next minute, not the full history of the session.

This doc covers what each surface shows, when each is visible, and why the design favors near-future information over comprehensive readouts.

## Title bar SVG ring

The title bar ring is a small circular progress indicator rendered as inline SVG inside the app's title bar. It is always visible while the app window is open and a focus phase is running.

What it shows:

- **Focus only.** The ring appears while the current focus opportunity is active. When focus ends and a break begins, the ring is hidden until the next focus starts.
- **Time remaining until the next phase transition.** The visible arc represents remaining focus time. If the event window is shorter than the configured focus duration, the segment is clipped to the event end. At the start of a focus period the ring is full, and the remaining arc shrinks toward empty as the transition approaches. The tooltip and menu status show minutes and seconds remaining.
- **Usable focus opportunity while paused.** Manual pause stops focus credit, but it does not stop the calendar event. While paused, the ring keeps counting down only when the event end is the limiting deadline. The calendar rail remains empty for the paused interval.
- **Paused reminder.** While a focus session is manually paused, the remaining arc gently pulses between white and empty-ring gray so the paused state is visible at a glance without using a warning color. The pulse holds at both endpoints, then eases through the transition frames. The title bar reads the same pulse frame that drives the tray icon, avoiding a separate CSS animation that can drift out of phase.
- **Title bar icon fit.** The idle ring uses the subdued empty-track stroke so no active session reads as empty. The active remaining arc uses the same title bar icon color as the Music and utility icons. The ring renders 0.5px larger than the nominal icon box to compensate for the circular SVG's internal padding, so the right-side title bar controls read as one set.

What it does not show:

- The cycle number.
- How many focus periods remain in the session.
- Total accumulated focus today.
- Any break information.

The reason for the narrow scope: the title bar is a glance surface. A user who looks at it during a focus period is asking "how much longer until I can break?" not "what is my total focus today?" The latter belongs in stats. The ring being hidden during breaks reinforces this: when the user is on break, they should be on break, not watching a timer drain.

The ring menu mirrors the tray menu's compact controls and adds a subdued Music volume row. Its Pomodoro section includes `Pause focus` or `Resume focus`, enabled only during an active focus phase, `Extend focus 3 minutes` once per focus period when the event window has room, `Go to break now` during focus, and `Start focus now` during breaks. A thin separator splits those Pomodoro actions from the Music status. Its Music section shows the active media title when one is loaded, without redundant status or category prefixes, and offers play/pause, previous, next, direct volume adjustment, and opening the Music view. Scrolling over the ring menu, the ring button, or the title bar music button adjusts Music volume instead of switching tabs. While the ring menu is open, title bar wheel input keeps adjusting Music volume instead of navigating tabs. The ring and Music button tooltips show the shared Music volume on a second line.

## System tray RGBA ring

The tray icon is an RGBA-rendered circular progress ring. It mirrors the title bar ring's semantics but lives in the OS tray (or menu bar on macOS), making it visible even when the app window is hidden, minimized, or behind other windows.

Tray-specific menu behavior and platform implementation details live in `features/tray-icon.md`.

What it shows:

- **Focus only**, same as the title bar ring.
- **Time remaining until the next phase transition**, same encoding.
- **Paused reminder**, same intent as the title bar ring, implemented by switching between cached raster frames.

What it does not show:

- Same exclusions as the title bar ring.

The tray ring is the most ambient surface: it sits in the user's peripheral vision constantly. The pixel-level rendering (RGBA, not SVG) is necessary because tray icons on most platforms accept raster images more reliably than vector ones. Normal progress redraws only when the quantized ring state changes. Manual pause uses a small slow frame cycle, fine-grained enough to feel alive without turning the tray into a high-frame-rate animation surface.

When clicked, the tray icon opens or focuses the main window. The tray menu offers session controls without needing the main window: `Pause focus` or `Resume focus`, enabled only during an active focus phase, `Extend focus 3 minutes` once per focus period when the event window has room, `Go to break now` during focus, and `Start focus now` during breaks. Those Pomodoro actions stay visible but disabled when unavailable, matching the Music controls. The tray music status shows only the active media title when one is loaded, without redundant status or category prefixes. Shuffle remains controlled from the Music view rather than from the tray menu.

## Vertical timeline rail (calendar day and multi-day views)

The rail is a narrow vertical strip on the left edge of each day column, showing the day's pomodoro activity in time-aligned bands. Unlike the rings, the rail is contextual: it appears only in day view, work-cycle view, and week view, where the day column gives time a vertical extent that the rail can map onto.

The rail is the densest of the three displays. It conveys:

- **Past focus and breaks**, drawn from persisted segments.
- **The currently active phase**, growing in real-time.
- **Projected future breaks**, computed from the run's plan or from the event's pomodoro config when no session is running.

It is described in detail in this section because, unlike the rings, the rail's rules interact with overlap, containment, and inheritance rules from elsewhere.

When switching between day, work-cycle, and week views, the calendar loads the visible view's persisted pomodoro segment snapshot before committing the new view. Day columns receive that snapshot as render input instead of starting their own per-column queries, so focus fills and break marks appear together with the events rather than flashing from a planned state to a persisted state after mount.

### Visual structure

When the day has multiple pomodoro events, their time ranges merge into contiguous rail containers (the union of overlapping ranges). Within a container, the rail renders bands at each minute according to the rules below. Between containers (no pomodoro events), the rail is absent.

### Three colors, no sub-variations

The rail renders exactly three visual states:

| State | Color | When shown |
|-------|-------|------------|
| Filled | Focus marker (`--cal-timeline-focus`, default `#39965c` light and `#2a8049` dark) | Persisted focus segments, only the time the user was actually working (paused intervals excluded). Always in the past relative to the current time. |
| Break | Break marker (`--cal-timeline-break`, default `#000000`) | Planned future breaks, active breaks, completed break time, legitimate break extensions, and the first 10 seconds after a break reaches 0. One uniform appearance regardless of past, current, or projected. |
| Empty | Empty rail (`--cal-timeline-rail`) | Everything else: future focus time, past time with no session, stopped gaps, idle, manual pause, suspend, unofficial break overtime after the 10 seconds of grace, and break time that never started. |

There is no separate color for the active focus, no warmer green for "fresh" segments, no different shade for projected vs persisted breaks. The user reads the rail as "what is solid is real, what is marked is structure, what is empty is opportunity." Three shades, three meanings.

### Green fill rules

A green band is rendered for a time range only when all of the following hold:

- The segment's `phase` is `focus`.
- The segment's `status` is `completed`, `interrupted`, or `active`.
- For an `active` segment, green extends from `actual_start` to now (never beyond, see invariant 1 in `data/invariants.md`).
- Paused intervals within the segment are excluded. Green is split into bands around each pause's `[started_at, ended_at]` range.

If any condition fails, no green is drawn for that range. There is no projection of future focus as green; future focus is empty (the user has not done it yet).

### Break mark rules

Breaks come from two sources:

1. **Persisted break segments** (`status` `completed` or `active`): rendered as the official break allowance that actually ran, from `actual_start` to `min(actual_end or now, planned_end + 10 seconds)`. User-requested break extensions move `planned_end`, so they are legitimate break-marker time. If the user stays away longer than 10 seconds after the planned break end, the extra overtime is empty.
2. **Projected breaks**: computed from the run's config and current cycle position for future time within the event window. These represent where breaks will occur if the session continues.

Break phases are written lazily like focus phases. A break that never begins has no segment row and produces no band. If a break begins and is cut short, the row records the short actual interval, and only the portion inside the planned break allowance plus the 10 seconds of grace renders with the break marker.

### Projected breaks during a stop-and-restart gap

When a session has stopped but the event still has remaining time, the rail continues to show projected break marks for the remaining time. These are computed as if a new session were starting right now, with a full focus period followed by breaks per the event's config. As the seconds tick by during the gap, the projected positions shift because "now" changes. The auto-start poll (~1s) recomputes them.

When the user restarts (via auto-start or manually), the projected breaks become the actual plan and lock in place. From then on, those break positions are stable for the duration of the session (invariant 3).

The product reason for keeping break marks visible during a gap: break marks are a visual incentive. They tell the user "it is not too late, you can keep going, your next break is right there." Removing them after a stop says "your session is over, you failed, close the app." Showing them says "come back, it is not a big deal, just keep going." This aligns with the anti-procrastination philosophy.

The data reason for not persisting projected breaks: they are ephemeral. They shift every moment as "now" changes, and if the user never restarts, they never correspond to any run. Storing them would mean recording predictions for every possible restart time, which is unbounded data for zero analytical value. The gap itself (between the stopped run's `ended_at` and the next run's `started_at`) is fully preserved in the runs table.

### Past overlay

A semi-transparent overlay covers the column from midnight to the current time. This naturally dims both green fills and break marks that are in the past, giving the user a quick sense of "where they are in the day" without needing a separate now-indicator. The overlay is behind the rail (lower z-index) so it affects everything uniformly.

### When the rail is hidden

The rail is rendered in day view, work-cycle view, and week view, never in month view. The reasons:

- Month view cells are too small for a 6px rail to convey meaningful detail.
- Month view is a planning surface, not a working surface. The user looking at month view is asking "what is on my schedule" not "how is my session going."

Within day, work-cycle, and week views, the rail is shown for any day that has at least one pomodoro event. Days with only non-pomodoro events have no rail.

## When each surface is shown or hidden

| Surface | Shown when | Hidden when |
|---------|-----------|-------------|
| Title bar ring | App window is open and a focus phase is active, including manual pause while the event window is still active | Break phase, no active session, or event deadline passed |
| Tray ring | A focus phase is active, including manual pause while the event window is still active, regardless of window state | Break phase, no active session, or event deadline passed |
| Rail | Day view, work-cycle view, or week view, day has at least one pomodoro event | Month view, days with no pomodoro events |

The tray ring and title bar ring are deliberately the same shape and the same metric (focus countdown). The user does not have to learn two visualizations; they learn one and read it from whichever surface is convenient.

## Why "until next transition" only

Across all three surfaces, the metric is "time until the next phase transition," not session totals or cycle position. This is a deliberate choice for a few reasons.

**Working memory budget.** A user in deep focus has a small budget for ambient information. Cramming "current cycle: 3 of 4, 22 minutes left in this focus, 5 minute break next, then 18 more minutes, then long break" into a peripheral surface is noise. "22 minutes" is signal.

**Decision-relevant information.** What does a user need from a glance? Whether to push through to the break or wrap up the current thought. Both depend on time remaining, not on session-level totals. Totals belong in stats, where they are accumulated across days and inform planning, not in-session decisions.

**Stop-the-clock pressure.** Showing total session time creates pressure to "make the number bigger." Showing time remaining creates the opposite: a countdown to relief. The latter is more aligned with the anti-procrastination philosophy: the goal is to enable focus, not to gamify focus duration.

For users who do want detailed session information (cycle position, total focus today, break adherence), the stats surface is the right place. The progress displays are intentionally narrow.

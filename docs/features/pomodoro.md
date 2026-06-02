# Pomodoro

The pomodoro feature is the work mechanic underneath the calendar. A calendar event with a pomodoro config attached becomes a session: a structured loop of focus and break phases that runs while the event is in window. The user does not start a timer separately. The timer follows the calendar.

This doc covers the user-facing loop. The pieces that make it work each have their own document:

- `features/pomodoro-progress-displays.md`: the title bar ring, tray ring, and timeline rail.
- `features/tray-icon.md`: tray menu behavior and platform-specific tray icon implementation details.
- `features/pomodoro-break-screen.md`: the overlay that enforces breaks.
- `features/pomodoro-idle-detection.md`: what happens when the user steps away.
- `algorithms/pomodoro-state-machine.md`: the decision functions behind ticks and transitions.
- `algorithms/pomodoro-segments-and-plan.md`: how the plan is derived and how segments are written.
- `algorithms/idle-detection.md`: per-OS idle detection.
- `data/schema.md`: the run, segment, and pause tables.

## Purpose and philosophy

The pomodoro technique is not the only valid focus method, but it has two properties that make it well suited for an anti-procrastination tool. First, it imposes external structure on focus: the timer decides when to break, not the user's willpower. Second, it makes "starting" small: the next focus block is always at most one full focus period long. Both properties weaken the procrastination loop, which feeds on unbounded effort and the absence of external scaffolding.

The implementation extends the classic technique in two ways:

- **Sessions are bound to calendar events.** A pomodoro is not a free-floating timer; it is the work pattern for a specific block of scheduled time. When the event ends, the session ends. When the next event begins, a new session begins. The user does not have to remember to start or stop.
- **State carries across consecutive events.** If the user finishes 25 minutes of focus on one event and the next event starts immediately, the new event begins with a break (the focus was earned). The cycle does not reset. See "Block transitions" below.

These two extensions turn the timer from a per-task tool into a continuous work rhythm that lasts as long as the calendar has back-to-back work blocks.

## Default config and configurability

A pomodoro config has five fields:

| Field | Default | Meaning |
|-------|---------|---------|
| `focusDurationMinutes` | 40 | Length of one focus period |
| `shortBreakMinutes` | 5 | Break between focus periods within a cycle |
| `longBreakMinutes` | 10 | Break after `pomodoroCount` focus periods |
| `pomodoroCount` | 4 | Number of focus periods before a long break |
| `idleTimeoutMinutes` | 3 | Auto-pause threshold; null disables idle detection |

Defaults are set globally in user settings. Focus settings control the idle threshold for new Pomodoro events and whether new events start with Pause on inactivity enabled. That default is enabled at 3 minutes, with a warning confirmation before turning it off. Each event stores its own config; the event panel can still turn Pause on inactivity off, which writes `null`. The override is per-event, not per-recurrence-instance: changing the config on a recurring template applies to all instances; changing it on a detached or split instance applies only to that instance and its forward continuations (see `features/calendar-recurrence.md`).

Built-in presets give the user a starting point without dialing in numbers:

- **Automatic** 40/5/10: the global default. Long focus, short breaks.
- **Deep focus** 40/5/10: same numbers as automatic, named separately so the user can mark intent.
- **Creative** 25/5/15: shorter focus with a longer recovery break.
- **Extended** 50/10/10: even longer focus for tasks that need warmup.
- **Custom**: any combination.

Presets are starting points only; the user can edit any field after picking one.

## Session lifecycle (high level)

A session has three structural moments: it begins, it runs through phases, it ends. Each is handled by a decision function (see `algorithms/pomodoro-state-machine.md`); this section gives the user-facing view.

**Begin.** A session begins when the calendar event's time window includes the current moment, the event has a pomodoro config, and no session is already running on a higher-priority event. The trigger can be:

- The user opens the app while a pomodoro event is in window (auto-start).
- The clock advances into the start of a pomodoro event (the auto-start poll, every ~1 second, picks it up).
- The user manually starts a session by clicking the play control on an event.

The session always begins from the current moment, never from the event's scheduled start. If the event was scheduled for 14:00 and the user opens the app at 14:40, the session covers 14:40 onward. The 40-minute gap is honest: the user was not working.

**Run.** Once started, the session loops through phases. The first phase is a full-length focus period unless the event window ends first (concentration is assumed broken at any session start, including restarts after a stop). After focus completes, the session enters a short break, unless the cycle count has reached `pomodoroCount`, in which case it enters a long break. Each break is followed by another focus, and the loop repeats.

The user can pause manually, the system can auto-pause for idle, and the system can register a suspend pause when the OS sleeps. All three are handled with the same data structure (a row in `pomodoro_pauses`), but their UX differs (see `features/pomodoro-idle-detection.md`). Paused time never counts as focus progress or break credit. If the event deadline becomes the limiting factor while manually paused, the title bar and tray countdown continue to show the usable focus opportunity left in the event, while the calendar rail keeps the paused interval empty.

Music can follow manual focus pauses through the Music settings page. The `Pause if the focus session is paused` setting is on by default; it pauses Music only when Music was already playing and resumes Music only if Pomodoro caused that pause.

**End.** A session ends for one of several reasons, each recorded in `pomodoro_runs.end_reason`:

- `completed`: the event's end time was reached.
- `stopped`: the user clicked stop.
- `interrupted`: the app crashed or was killed (recovery sets this from the heartbeat).
- `reconfigured`: the user changed the pomodoro config mid-session, ending this run and starting a new one with the updated config.
- `block_transition`: the timer moved to a new event (consecutive or overlapping), starting a new run on that event with state inherited from this one.

After a session ends, the calendar event remains in place. If the event still has time remaining, the user can manually restart, or auto-start will re-engage on the next poll.

## Block transitions

When one pomodoro event ends and another pomodoro event begins immediately (or starts inside the window of the ending event), the system transitions rather than restarting fresh. The transition carries two pieces of state from the old run to the new run:

- `inherited_focus_minutes`: how many minutes of focus had accumulated in the current cycle when the old run ended.
- `inherited_cycle`: which cycle number the user was on.

These two values let the new run pick up exactly where the old one left off, but with the new event's config. The first phase of the new run is determined as follows:

- If `inherited_focus_minutes >= focus_duration_minutes` of the new config: the user has earned a break. The first phase is a short break, or a long break if `inherited_cycle >= pomodoro_count`.
- Otherwise: the first phase is focus, lasting `focus_duration_minutes - inherited_focus_minutes` minutes (the remaining focus needed to complete the current cycle under the new config).

This matters because back-to-back events should feel like one continuous session, not a series of resets. Without inheritance, finishing 25 minutes of focus exactly as the event ends would punish the user with another 25-minute focus on the next event, denying them the break they earned.

**Example, transition awarding a break.** "Morning Focus" (09:00-11:00, 40/5) is followed by "Afternoon Sprint" (11:00-13:00, 25/5). The user has been focused since 10:35, accumulating 25 minutes of focus in cycle 3. At 11:00, Morning Focus expires. The system finds Afternoon Sprint starting at 11:00 and transitions: the new run on Sprint gets `inherited_focus_minutes=25, inherited_cycle=3`. Since 25 meets Sprint's 25-minute focus threshold, Sprint starts with a short break. The user takes their well-deserved break, then begins fresh focus periods at Sprint's 25-minute cadence.

**Example, transition with partial focus.** Same setup, but the user only accumulated 10 minutes of focus in the current cycle when Morning Focus ended. The new run on Sprint gets `inherited_focus_minutes=10, inherited_cycle=3`. Since 10 < 25, the first phase is focus, lasting 25 - 10 = 15 minutes. After this bridge focus, Sprint's 25/5 cadence takes over.

Transitions never happen across midnight or across non-pomodoro gaps. If the next event has no pomodoro config, the session ends with `end_reason=completed` and the next event runs without a timer.

## Notifications

The system shows two notifications related to the timer, in addition to whatever the OS shows for calendar events.

**Pre-break notification.** When 60 seconds remain in the current focus period, the system shows a desktop notification and plays the focus-ending warning sound. The threshold is named `NOTIFICATION_THRESHOLD` (60 seconds) in the state machine. The point of the heads-up is to let the user reach a stopping point in their work rather than being yanked out of context the moment focus ends.

The focus controls can offer `Extend focus 3 minutes` once per focus period when the current event window still has room to extend the visible timer. The action is available from the title bar ring, from the tray ring, and from the first pre-break notification. If the user uses it from any surface, the timer extends the current focus opportunity, updates the active focus segment's planned end, records an `extend_focus` run event, rearms the 60-second pre-break notification, and marks the extension as used for that focus period. Later controls and notifications in the same focus period do not offer another extension, so the user still gets a final warning without accidentally chaining extra focus time.

**Break behavior.** When focus turns into a break, the app plays the break-start sound and shows the break screen. When the break ends, the break screen handles acknowledgement and the app plays the break-finished sound immediately, then repeats it at the Focus settings Break screen cadence until acknowledgement or auto-advance (see `features/pomodoro-break-screen.md`). The same sound can also play once before the break ends, based on the Focus settings warning lead time. No separate notification is shown.

**Event completion screens.** When a Pomodoro calendar event naturally expires and no active successor event takes over, the app shows a terminal completion screen through the same enforced full-screen overlay system as break and idle screens. The primary monitor gets the Svelte completion UI and secondary monitors get blocker windows using the active completion color. Any key or click acknowledges and closes the screen. If music is playing, the app fades the music down, pauses it before the completion sound, waits for that sound to finish, then resumes the music and fades it back to the previous volume. If later Pomodoro events remain on the same local date, it uses the event-finished sound. If no later Pomodoro events remain that day, it uses the Pomodoro day-complete sound. On Friday, the day-complete case uses the Pomodoro workweek-complete sound instead. Manual End event actions do not show this screen.

Calendar event notifications (configured per event, in minutes before start) are independent of the pomodoro system. They fire whether or not the event has a pomodoro config, using the app's event notification sound.

## Linkage to calendar

The calendar is the source of truth for when sessions run. The pomodoro system reads the event's window to decide when to start, when to transition, and when to end. The pomodoro system writes nothing back to the calendar event itself; it writes to its own normalized tables: configs, runs, segments, pauses, and run events.

This means:

- Events without a pomodoro config simply do not participate in the timer. They show on the calendar like any other event. All-day events cannot have a pomodoro config because the timer needs a concrete start and end time.
- A local active event without a pomodoro config can still use the calendar panel's End event action. It cuts only the event end time to now and does not create or close pomodoro data. The same active event can enable Pomodoro from the panel; that protected save stores only the new config and starts a fresh session from the current moment.
- An active pomodoro event shows End event in the calendar panel instead of archive or delete. Ending closes the run at the exact current instant, stores the cut event end with second precision so scheduler behavior stops immediately, and leaves the resulting past event available for archive. The calendar uses the standard "Stop the focus session?" modal when ending the only current pomodoro event would stop the focus session; overlapping pomodoro events use inline red confirmation. Calendar removal and clear-all operations still reject active runs until they are closed.
- Editing the event's time changes when the session ends (see `features/calendar.md` → "Active session protection").
- Deleting future untracked events removes only calendar data. Archiving protected events preserves runs and segments by setting live `event_id` FKs to null while keeping `pomodoro_runs.original_event_id` and `event_title_snapshot`. For recurring occurrences, `original_event_id` keeps the exact synthetic ID.

The dependency runs one way: pomodoro depends on calendar, not the other way around. Removing the pomodoro feature would not break the calendar; removing the calendar would leave pomodoro with nothing to drive it.

## Where to look next

- For the actual visual surfaces (ring, tray, rail): `features/pomodoro-progress-displays.md`.
- For tray-specific menu behavior and platform details: `features/tray-icon.md`.
- For the break screen UI and overtime behavior: `features/pomodoro-break-screen.md`.
- For idle and suspend handling from the user's perspective: `features/pomodoro-idle-detection.md`.
- For the decision rules behind ticks and transitions: `algorithms/pomodoro-state-machine.md`.
- For how the plan is derived and segments are written: `algorithms/pomodoro-segments-and-plan.md`.
- For the data tables: `data/schema.md`.
- For the cross-cutting hazards the design has to survive: `data/hazards.md`.

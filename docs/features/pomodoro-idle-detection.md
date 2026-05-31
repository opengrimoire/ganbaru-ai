# Pomodoro idle detection

When the user is mid-focus but no longer at the keyboard, the system has a choice: keep the timer running and pretend the user was working, or pause the timer and reflect reality. The pomodoro feature picks reality. Idle detection is the mechanism that pauses the timer when the user steps away and resumes when they come back.

This doc covers what idle means from the user's perspective, how it is detected, the overlay that appears, and how the system distinguishes idle (voluntary inactivity) from suspend (the OS slept). The per-OS detection sources are described in `algorithms/idle-detection.md`.

## Purpose

The whole point of tracking focus time is to have a record of when the user was actually focused. If the rail's green fill includes time when the user was on a phone call, in a meeting in another room, or making coffee, the analytical signal is destroyed: focus stats become a measure of "time the timer was running" rather than "time spent working."

Idle detection keeps the green honest. When the user is away, the timer pauses, the active segment splits around the pause, and the rail visibly shows the gap. When the user comes back quickly, the timer resumes from where it paused. When the idle overlay has been visible for 60 seconds, the focus attempt is considered failed and the next return restarts a full focus period in the same Pomodoro cycle.

## Idle threshold

The idle threshold is stored as `idleTimeoutMinutes` on the pomodoro config. `null` disables idle detection for that event. New Pomodoro events start with idle detection enabled by default and use the Focus settings threshold, which defaults to 3 minutes and supports values from 1 to 15 minutes.

A reasonable value is 1-5 minutes:

- **1 minute** suits users who want strict tracking and are okay with brief mental pauses being recorded as gaps.
- **5 minutes** suits users who want to ignore short interruptions like quick water refills.

The value is stored per event through the pomodoro config. The normal event panel uses the Focus settings threshold when a Pomodoro event is created or saved with idle detection enabled, and stores `null` when the event's idle pause toggle is off.

The threshold applies only to focus phases. Breaks do not pause for idle, because being away during a break is the entire point of a break.

Idle checks use a threshold-aware scheduler. While the user is far from the configured threshold, the app checks coarsely. Once the operating system reports an idle duration near the threshold, the next check is scheduled close to that threshold, with a 1-second minimum. This avoids polling the operating system every second through the full focus period while keeping the overlay close to the user's configured idle time. The per-OS detection sources and scheduler constants live in `algorithms/idle-detection.md`.

## Idle vs suspend distinction

Idle and suspend look superficially similar (the user was not at the computer for some time), but they differ in how they happen and what the system can know about them.

**Idle.** The user is at the computer (or nearby) but not interacting. The timer ticks normally; the activity sensor sees no input; after the threshold elapses, the system declares idle. A pause is created with `reason = idle`. The OS is awake the entire time.

**Suspend.** The OS itself goes to sleep (the user closed a laptop lid, or the OS triggered suspend due to inactivity, or the user invoked sleep manually). The timer stops ticking because no clock advances. On wake, the next tick fires after a long gap (much longer than 1 second). The system detects the gap (`SUSPEND_THRESHOLD_MS = 15000`, 15 seconds) and creates a pause with `reason = suspend`.

The 15-second threshold is heuristic. A normal tick gap is 1 second. A 15-second gap is unusual enough to flag as suspend without being so high that brief CPU spikes (e.g. another process briefly starving the timer) get misclassified.

The two reasons are recorded separately because they have different analytical meaning. Idle pauses tell the user "you walked away during focus; here is the pattern." Suspend pauses tell the user "you closed the lid; this is not a focus problem." Mixing them would obscure the signal.

## Idle overlay

When the system detects idle, it shows the idle overlay: a fullscreen window similar to the break screen but with different content.

The overlay says, in effect, "you have been idle for X minutes; the timer has paused; here is what to do." Its displayed idle duration starts from the operating system's detected idle duration, so it includes the configured idle threshold instead of starting at zero when the overlay appears. The top of the screen shows the current date and time using the user's runtime locale, with date and time separated by `|`. The idle timer uses the same runtime UI font as the rest of the app, with bold tabular numerals and oversized display sizing so it is readable from a distance. Supporting date, label, and control text is intentionally large enough to read from a distance without competing with the timer. Idle and focus-failed states use `#A33728` as the background and `#F9D573` as the main text color. Secondary labels and hints reuse the main text color at lower opacity so the timer remains dominant. The idle sound plays once the overlay has mounted and painted, then every 10 seconds while the overlay is in the paused state, but only before the focus-failure boundary. After 60 seconds on the visible overlay, the focus-failed sound owns that exact boundary, the repeated idle sound stops, and the copy changes to a failed-focus state. The idle overlay has one direct control:

- **Space.** Before focus failure, closes the overlay and resumes the timer where it paused. The pause row is closed (`ended_at = now`). After focus failure, starts a fresh full focus timer in the same open run and the same Pomodoro cycle. The previous partial focus segment is preserved as `interrupted` with `end_reason = focus_failed`; the idle gap remains empty.

The idle overlay does not expose a stop action. To stop the focus session intentionally, the user must cut the active block event from the event panel.

Like the break screen, the idle overlay uses a Svelte visual surface inside a Rust/Tauri-enforced fullscreen overlay window. The primary monitor shows the interactive idle state, and additional monitors use fullscreen blocker windows with the same state background color. Secondary blocker clicks refocus the main overlay, and Svelte blocker keydown forwarding is best-effort on platforms that use webview blockers. The same native enforcement guard covers topmost placement, ordinary app-switching shortcuts, display and system idle inhibition, presentation options on macOS, and monitor reconciliation while the idle overlay is active. See `features/pomodoro-break-screen.md` for the platform details and explicit escape limits.

## What happens when idle is detected

When the system declares idle:

1. The current focus segment continues to exist (it is not marked completed). The active segment is still active; only paused.
2. A pause row is created with `started_at` set to the detected idle start, clamped to the segment start if needed, `ended_at = NULL`, `reason = idle`, and `segment_id` pointing at the current segment.
3. The timer pauses. The countdown stops decrementing.
4. The idle overlay appears.
5. The rail's green fill for the current segment now ends at the pause's `started_at`. The empty rail background extends from there.

The segment's `actual_end` is not set during the pause. The segment is still active; it has just been split around the pause for rendering purposes.

Idle data and overlay timing use different anchors on purpose. The pause row is backdated to the operating system's detected idle start, so the database and rail do not count away time as focus. The 60-second focus-failure timer starts when the overlay becomes visible, so slow webview startup does not make the failure feel early or late to the user.

If the overlay remains visible for 60 seconds, the active segment is marked `interrupted` with `end_reason = focus_failed`, and a `focus_failed` run event with reason `long_idle` is recorded. The segment's `actual_end` remains the idle pause start, so neither the idle minute nor the time after it counts as focus. The run stays open until the user returns; intentional session stopping stays outside the idle overlay and must go through the active block event's cut flow.

## Resume flow

When the user resumes before focus failure:

1. The pause row is closed (`ended_at = now`).
2. The timer resumes from the same remaining seconds. If 15 minutes were left when the pause started, 15 minutes are still left.
3. The overlay closes if it was still showing.
4. The rail's green fill picks up again from `now`. The segment now has two green bands: from `actual_start` to the pause's `started_at`, and from the pause's `ended_at` onward.

The segment is the same segment, with the same `id`. Pauses split the segment for rendering; they do not split it as data. This keeps analytics joins simple: one segment row, multiple pause rows.

When the user returns after focus failure:

1. The failed segment stays in history as an interrupted focus segment.
2. A new active focus segment is inserted in the same run.
3. The timer restarts from the full configured focus duration, limited by the active event end time.
4. The Pomodoro cycle count does not advance and the long-break cadence is not reset.

## When idle detection does not fire

Idle detection is suppressed in several cases:

- **Idle threshold is null.** The user disabled idle detection on this event.
- **Active phase is a break.** Breaks are time-away by design; pausing them for idle would be backwards.
- **No active session.** Without an active focus segment, there is nothing to pause.
- **The system already paused the segment.** Multiple sources cannot create overlapping pauses on the same segment.

## App wake dialog

When the app wakes from suspend (distinct from a focus idle pause), the system shows a small dialog instead of the full overlay: "the system was suspended for X minutes; the focus timer has been paused. What do you want to do?" Suspend can offer resume, stop, or close because it is a recovery confirmation, not the enforced idle overlay.

The dialog is less invasive than the overlay because suspend is a known external event, not a user behavior pattern. The user already knows the system was asleep; the dialog is a confirmation, not an enforcement.

## Example: idle pause and green fill splitting

The user starts focus at 10:00 with a 5-minute idle threshold. They work until 10:15, then step away from the keyboard without pausing. At 10:20 (5 minutes of continuous inactivity), the system detects idle, creates a pause row backdated to the operating system's detected idle start (`started_at = 10:15, reason = idle`), pauses the timer, and shows the idle overlay. The user returns at 10:30 and resumes. The pause row gets `ended_at = 10:30`.

On the rail, the green fill for this segment shows two bands: 10:00-10:15 (working) and 10:30 onward (working again). The 10:15-10:30 gap is empty, honestly reflecting that the user was away. The timer resumes where the real focus ended: if 10 minutes were remaining at 10:15, the timer still shows 10 minutes at 10:30.

Analytics later can compute: this segment had 1 idle pause of 15 minutes, total focus time was elapsed minus pauses.

## Example: laptop suspend during focus

The user is focused at 11:00. They close the laptop at 11:10 (or the OS sleeps for any reason). The timer tick loop stops because no clock is ticking. When the laptop wakes at 11:40, the next tick fires and detects a 30-minute gap (much greater than the 15-second `SUSPEND_THRESHOLD_MS`). A pause row is created with `started_at = 11:10, ended_at = 11:40, reason = suspend`. The suspend dialog appears.

If the user resumes, the timer continues from where it was at 11:10 (so if 15 minutes were remaining, 15 minutes are still remaining). The rail shows green from 11:00-11:10 and from 11:40 onward, with the suspend gap empty.

If the user stops, the segment is marked interrupted with `actual_end = 11:40` (the wake time, not now), and the run ends.

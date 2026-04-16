# Idle detection

The pomodoro feature pauses the timer when the user steps away (see `features/pomodoro-idle-detection.md` for the user-facing behavior). To do that, the system needs to know whether the user is actively using the computer. This is platform-specific: each OS exposes user activity through different APIs, and a portable strategy needs adapters for each one.

This doc covers the per-OS detection sources, the threshold semantics, the heuristic that distinguishes idle from suspend, the pause record creation flow, and the resume flow.

## Detection sources per OS

The system reads "time since last user input" from the OS. The exact APIs vary.

**Linux (X11 and Wayland).**

- On X11, the XScreenSaver extension exposes `XScreenSaverQueryInfo`, which returns idle time in milliseconds. This is the standard approach used by most Linux idle detection.
- On Wayland, no portable API equivalent to XScreenSaver exists. Compositor-specific APIs (e.g. KDE's `org.kde.idle1` D-Bus interface, Mutter's similar surface) are the practical sources. A fallback to `rdev` or `evdev` direct device monitoring is possible but requires elevated permissions.

**Windows.**

- `GetLastInputInfo` from User32, returning the system uptime tick of the last input event. The current uptime tick minus the returned value gives idle time. This is well-supported and stable across Windows versions.

**macOS.**

- `IOHIDIdleTime` via the IOKit `IORegistry`. Returns the time since the last HID event in nanoseconds. Standard approach used by most macOS idle detectors.

**Cross-platform Rust libraries.**

- The `rdev` crate provides an event-monitoring interface that works across platforms but is more invasive (it hooks input events globally rather than reading idle time on demand). It is a fallback when the native idle-time APIs are unavailable.
- The `sysinfo` crate exposes some platform information but does not provide idle time directly.

The chosen strategy is to use the native API for each OS where available, with a documented fallback if the API is unavailable (e.g. Wayland without a compositor-specific idle interface).

The polling cadence is `IDLE_CHECK_INTERVAL_MS = 15000` (15 seconds). This is frequent enough to detect idle within a reasonable window of the threshold and infrequent enough to avoid measurable battery impact.

## Idle threshold

The threshold is `idle_timeout_minutes` on the pomodoro config (see `algorithms/pomodoro-segments-and-plan.md`). When the OS reports idle time exceeding the threshold, the system declares the user idle.

The threshold is per-event, not global. A "deep work" event can have a 1-minute threshold for strict tracking; a "casual coding" event can have a 5-minute threshold to ignore quick interruptions.

A null threshold disables idle detection entirely for that event. The system reads the threshold once when the active segment starts (or when the config changes mid-session via reconfiguration).

## Idle vs suspend distinction

The idle and suspend cases need to be told apart because they are conceptually different events.

**Idle.** The OS is awake the entire time. The system's tick loop continues to fire every second. The OS reports increasing idle time. After the threshold elapses, the system creates a pause with `reason = idle`.

**Suspend.** The OS sleeps. The system's tick loop stops because no clock advances. On wake, the next tick fires after a long gap. The system detects the gap (`SUSPEND_THRESHOLD_MS = 15000`) and creates a pause with `reason = suspend`. The OS-reported idle time is not used; the suspend duration is computed from the wall-clock gap between ticks.

The 15-second threshold for suspend is heuristic. A normal tick gap is 1 second. A 15-second gap is far enough above normal that it is almost certainly a suspend, while not so high that brief CPU starvation (e.g. another process spiking) gets misclassified.

If both signals fire (the tick loop suspended AND the OS reports idle), the suspend signal wins because it is more specific: a suspend implies the user could not have been giving input, regardless of what idle time the OS reports.

## Pause record creation

When idle is detected:

1. Read the active run's `id` and the active segment's `id`.
2. Create a row in `pomodoro_pauses`:
   - `segment_id = active_segment.id`
   - `started_at = now`
   - `ended_at = NULL`
   - `reason = idle`
3. Pause the timer (the application state stops decrementing remaining seconds). The active segment's `actual_end` is not set; the segment is still active, just paused.
4. Show the idle overlay (see `features/pomodoro-idle-detection.md`).

Multiple idle pauses within a single segment are allowed. If the user becomes idle, returns, becomes idle again (each time exceeding the threshold), each idle period gets its own pause row.

When suspend is detected, the same flow runs except `reason = suspend`. A suspend pause has both `started_at` and `ended_at` set immediately because the suspend is a single contiguous interval that ended on wake (the tick that detected the gap is the wake event). Specifically:

- `started_at = wake_time - gap_duration`
- `ended_at = wake_time`

This differs from idle, where `ended_at` is null until the user explicitly resumes.

## Resume flow

When the user provides input after an idle pause:

1. The system detects input via the OS's input layer (the same mechanism as the activity sensor).
2. The active idle pause is closed: `ended_at = now`.
3. The timer resumes: the remaining seconds from the moment of pause are restored, and the countdown continues.
4. The idle overlay is dismissed if it was still showing.
5. The rail's green fill picks up from `now`. The segment now has two green bands separated by the pause.

If the user clicks the "stop" option on the idle overlay instead of resuming:

1. The active idle pause is closed: `ended_at = now`.
2. The active segment is marked interrupted: `status = interrupted`, `actual_end = now`.
3. The run is ended: `ended_at = now`, `end_reason = stopped`.
4. The overlay is dismissed.

If the user dismisses the overlay without choosing (e.g. clicks outside, presses Esc once), the timer remains paused. The user can return at any time and resume or stop. The pause row stays open until a resume or stop happens.

For suspend pauses, the flow is simpler: the pause is already closed by the time the user sees anything (the wake-detecting tick closed it). The system shows the suspend dialog, and the user chooses to resume or stop. If they resume, the timer continues from where it was. If they stop, the run ends with `end_reason = stopped` and the segment is marked interrupted with `actual_end = now`.

## Edge cases

**Idle during a break.** Idle detection is suppressed during breaks. Being away during a break is the entire point of a break, and pausing the break for idle would be backwards. The idle overlay does not appear during breaks.

**Idle threshold equals zero.** A zero threshold would mean "any momentary lack of input is idle." This is treated as the threshold being effectively disabled for practical purposes (the system sets a minimum effective threshold of one polling interval to avoid pause-thrashing).

**OS reports decreasing idle time without explicit input.** Some OS APIs reset idle time on events that the system cannot directly observe (e.g. a USB device wake). The system trusts the OS-reported idle time; if it decreases, the user is treated as active. This avoids a false-positive pause when the OS knows about activity that the system itself did not detect.

**Multiple monitors with different activity.** Idle time is system-wide, not per-monitor. The user moving the mouse on any display counts as active. This is the correct behavior: the user is one person, and any input is engagement.

**OS API unavailable.** If the per-OS API fails (e.g. Wayland without a compositor idle interface and no fallback), idle detection is disabled. The system logs the unavailability once at startup. The pomodoro session continues to run but does not pause for idle. This is degraded but functional.

## Why this design

The alternative to per-OS APIs is to monitor input events directly (via `rdev` or similar). This works but has drawbacks:

- It requires running an event hook continuously, consuming CPU even when the system is idle.
- It needs elevated permissions on some platforms (especially macOS, which prompts for accessibility access).
- It captures more information than the system needs (specific keys and mouse positions, vs. just "is the user idle").

The OS-reported idle time, when available, is cheaper, less invasive, and sufficient. It is what most idle-detection tools use and what the system's threat model allows (no input content is ever read).

The fallback to event monitoring exists for environments where the OS API is unavailable, but it is the second choice, not the primary.

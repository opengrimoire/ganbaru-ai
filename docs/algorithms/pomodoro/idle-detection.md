# Idle detection

Idle detection pauses a running focus phase when operating-system input inactivity reaches the event's configured threshold. It never captures keystrokes, pointer content, camera frames, or application text.

The user-visible overlay and choices are defined by the Pomodoro idle feature. This document defines native activity sources, polling, pause timing, focus failure, and recovery interaction.

## Platform sources

The Rust adapter returns elapsed idle milliseconds when the platform source succeeds, an explicit unavailable value when it fails, and a best-effort webcam-in-use signal.

### Linux

The primary idle source is GNOME Mutter's IdleMonitor GetIdletime call through gdbus. If that is unavailable, the adapter tries xprintidle. When neither succeeds, the adapter reports the source as unavailable.

Webcam use is inferred by scanning process file descriptors for opened video devices. The adapter does not read device content.

Current code does not directly call XScreenSaver, implement a KDE-specific API, or fall back to rdev or evdev.

### Windows

Idle duration comes from GetLastInputInfo and the system tick count. Webcam use is inferred through the current user's camera capability-use registry state.

The calculation handles one 32-bit system tick wrap and returns a bounded non-negative duration. A GetLastInputInfo failure reports the source as unavailable instead of reporting user activity.

### macOS

Idle duration is read by invoking ioreg for IOHIDSystem and parsing HIDIdleTime. Webcam use is inferred from a bounded process-name check for known camera consumers.

This is not direct in-process IOKit integration. A future native adapter may replace the command without changing threshold semantics.

### Other platforms

Unsupported targets report the idle source as unavailable and report no webcam use. Mobile lifecycle recovery is separate from desktop idle detection and must not infer idle from missing foreground ticks.

## Privacy and webcam suppression

When webcam use is detected, idle pausing is suppressed and the scheduler uses its coarse polling interval. This avoids marking a meeting or recording session as failed focus merely because keyboard and pointer input stopped.

The signal is best effort. False negatives may still produce an idle pause, and false positives may delay one. No camera stream, frame, microphone data, window title, or meeting identity is collected or persisted.

## Threshold contract

The event configuration supplies idle_timeout_minutes. Null disables idle detection. A configured value must be a positive integer. Zero is rejected by SQLite and Rust validation.

Idle triggers when reported idle duration is greater than or equal to the threshold. Detection runs only when:

- a Pomodoro run is active;
- the current phase is focus;
- no suspend-away state is active;
- no idle pause is already active;
- the threshold is enabled;
- webcam use is not detected.

The run snapshots the idle setting. Explicit reconfiguration updates current runtime interpretation through the same controlled reconfiguration path as rhythm changes.

## Threshold-aware scheduling

Current policy uses a minimum check interval of one second and a maximum of 15 seconds.

When reported idle is far below the threshold, the next check waits at most 15 seconds. As the threshold approaches, the delay becomes the remaining time to the threshold, bounded to at least one second. Webcam suppression uses the maximum interval.

These values are implementation policy, not database meaning. They may change after measurement without a schema migration as long as threshold and backdating semantics remain intact.

## Creating an idle pause

At threshold crossing, the pure decision calculates:

- idle start as now minus the operating-system idle duration;
- remaining focus at that inferred boundary;
- the observed idle duration for presentation and audit.

The controller bounds the inferred start against the active segment and existing pause state, persists an idle pause, freezes the timer, stops ordinary idle checks, updates enforcement and tray state, and shows the idle overlay.

Backdating prevents the threshold interval from being counted as focus merely because detection was delayed. The active segment remains active while the pause is recoverable.

## Focus failure

If the idle overlay remains unresolved for 60 seconds, current behavior marks the active focus segment interrupted with focus-failed reason at the pause start boundary and appends a focus-failure run event. The overlay may then offer a fresh focus restart if the calendar block remains eligible.

The native owner starts that grace period only after the matching warning reports paint completion and a visible window. The primary native overlay or its main-window fallback can acknowledge one run, segment, idle-detection timestamp, and vault generation. Rust records the first accepted acknowledgement using its own clock. Duplicate delivery cannot extend the deadline, and stale episodes cannot acknowledge a newer warning. Slow loading or failed presentation leaves the pause recoverable; the Calendar event deadline still applies. Persistence failure rejects the acknowledgement and permits a bounded retry.

The live owner measures grace with a monotonic clock. Civil clock corrections cannot shorten or extend it. The core accepts elapsed-grace evidence only for the current run, segment, and committed visibility marker, with at least the required elapsed duration. Recovery discards an older controller's visibility marker; it preserves accepted idle pause history without treating a previous process or device's display as a current warning. Android does not run the desktop idle grace timer.

Restart after failure creates a new active focus segment with the configured duration, capped by the event boundary. It does not reopen or extend the interrupted segment.

This 60-second delay is user-visible policy, not a persistence encoding. A future product change must update feature copy and focused tests.

## Return before focus failure

When the user returns before failure, resuming closes the idle pause at the chosen return boundary and shifts the phase deadline by the effective pause duration. Focus progress continues from the remaining amount captured at idle start.

Stopping instead closes the segment and run without counting the idle interval as focus. Repeated resume or stop commands are idempotent.

## Interaction with suspend

A long frontend tick gap may mean the operating system suspended rather than the user merely stopped input. Suspend lifecycle handling takes precedence. Idle detection skips while suspend-away state exists and does not create a second pause over the same interval.

On cold startup, recovery uses persisted heartbeat, pause, segment, event, and platform evidence. It does not call current idle duration and retroactively classify the entire offline interval as idle.

See [Pomodoro state machine](state-machine.md) for recovery order.

## Failure behavior

Failure to query a platform source produces an explicit unavailable sample. The controller does not interpret that sample as recent activity and does not create or backdate an idle pause. It retries at the maximum polling interval. This preserves the distinction between known activity and missing platform evidence while remaining safe against false idle pauses.

Diagnostic presentation is still pending. A future improvement may add bounded logging or a user-visible degraded-state indicator without changing the unavailable-sample contract.

## Required tests

Required coverage includes:

- exact threshold and one millisecond below it;
- disabled and invalid thresholds;
- focus versus break, paused, suspended, and stopped states;
- webcam suppression;
- inferred start and segment-start clamping;
- threshold-aware delay bounds;
- repeated idle periods in one segment;
- focus failure at exactly 60 seconds;
- delayed or absent warning paint, acknowledgement rollback, stale episode identities, and duplicate delivery;
- monotonic grace through civil clock corrections, generation invalidation, and controller recovery;
- resume, stop, event expiry, and fresh restart;
- suspend and cold-recovery precedence;
- platform parser failures and bounded output;
- unavailable source samples and retry scheduling.

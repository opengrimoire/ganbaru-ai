# Pomodoro break screen

When a focus phase ends, a break begins. The break screen is the surface that enforces it. The screen covers the user's display, prevents them from continuing to work, and offers a small set of controls (extend the break, skip the break, take longer than planned). The aim is to make ignoring the break harder than taking it, without making the app feel hostile.

This doc covers the surfaces, controls, overtime behavior, and edge cases.

## Purpose

A break only works if the user actually takes one. A subtle notification ("time for a break!") is too easy to dismiss; an alarm sound is annoying without being effective. The break screen takes a stronger position: it physically occupies the screen so that switching back to work requires deliberate action.

This is not arbitrary friction. It mirrors physical interventions like stretching at a desk: easier to do once standing than from the chair. The break screen forces the equivalent transition, and gives the user a clear "okay, I am on break" framing.

## Surfaces

The break screen has one visual implementation and a native enforcement layer.

**Svelte overlay window.** A dedicated Tauri webview window mounts the Pomodoro blocked-screen UI. This is the canonical visual surface for the break countdown, break finished state, idle paused state, and idle focus-failed state. Keeping the UI in Svelte makes the blocked screens share the same component system as the rest of the app and avoids maintaining separate per-OS UI implementations.

**Rust/Tauri enforcement.** Rust creates a fullscreen, undecorated, always-on-top overlay window for the primary display and marks the overlay as active until the Pomodoro state machine closes it. The overlay is protected by a scoped enforcement guard that starts before windows are shown and stops when the Pomodoro state machine closes the overlay. The guard owns cleanup for window labels, power assertions, shortcut restoration, native platform state, and monitor reconciliation, so starting a new overlay first closes any previous guard and cleanup remains safe after partial setup.

On Linux, the app inhibits the screensaver, temporarily disables configured desktop shortcuts, and uses native blocker windows with the active state background color for secondary monitors while the overlay is active, then restores them when the overlay closes.

On Windows 10 and 11, Tauri still owns the Svelte overlay windows, and Rust reinforces them with native `HWND_TOPMOST` placement after creation. A scoped low-level keyboard hook blocks ordinary shell escape chords while the overlay is active, including Alt+Tab, Alt+Esc, the Windows key, Win+D, Win+M, Win+Tab, Win+number shortcuts, and Ctrl+Esc. Non-blocked keys are passed through immediately so overlay controls such as Space, Esc counting, and Ctrl+Shift+Space keep working. The app also uses `SetThreadExecutionState` to request that the system and display stay awake while the overlay is active, then resets the execution state on cleanup.

On currently supported macOS versions, Rust sets overlay windows to the screen saver window level and applies AppKit presentation options while the overlay is active: full screen, hidden Dock, hidden menu bar, disabled process switching, disabled Force Quit panel, disabled session termination, and disabled hide application. The previous presentation options are restored on cleanup. The app also creates IOKit assertions for user-idle display sleep and system sleep, then releases them when the overlay closes.

For multi-monitor setups, the primary monitor gets the full Svelte overlay UI. Additional monitors get fullscreen blocker windows using the active state's background color. They do not carry controls; they exist to remove useful work surfaces while the break is enforced. On Linux these blockers use the native GTK/GDK monitor APIs because they are more reliable than webview monitor placement on Wayland.

While the overlay is active, Rust reconciles monitor geometry at a low frequency. If displays are connected, disconnected, moved, or resized, the primary overlay is moved or recreated and secondary blockers are recreated or removed as needed.

Secondary blockers forward safe input back to the main overlay. A click on a secondary blocker acknowledges the break if the break-complete screen is active; otherwise it refocuses the main overlay. On platforms where secondary blockers are Svelte webviews, blocker keydown events are forwarded to the main overlay as best-effort input. On Linux native blockers, keyboard handling stays owned by the main overlay because taking focus on secondary blockers would make shortcut behavior less predictable.

The countdown is anchored to an absolute break end timestamp, not to a relative duration captured before the overlay opens. If the webview takes time to appear, the displayed time reflects the real phase time that has already passed. The break-start sound is triggered by the Svelte overlay after the surface has painted, so the user hears it with the blocked screen instead of before it.

During the countdown, the top of the screen shows the current date and time using the user's runtime locale, with date and time separated by `|`. The break-complete screen hides this timestamp because it is an acknowledgement state, not a timed break state.

The countdown timer uses the same runtime UI font as the rest of the app, with bold tabular numerals and oversized display sizing so it is readable from a distance. Supporting date, label, and control text is intentionally large enough to read from a distance without competing with the timer.

Break countdown uses `#035B33` as the background and white as the main text color. Break complete uses `#EEBA04` as the background and `#0D0502` as the main text color. Secondary labels and hints reuse the main text color at lower opacity so the state remains readable from a distance without competing with the main message.

This does not try to defeat a user with OS-level control of the machine. A forced process kill, power-off, Windows Ctrl+Alt+Del, macOS security prompts, or desktop environment action outside the app's control can still terminate or bypass Ganbaru AI. The goal is to block normal app switching, accidental dismissal, and ordinary close paths without turning the app into hostile system software.

## Controls

The break screen has a small, deliberate control set.

| Control | Effect |
|---------|--------|
| Default (no input) | When the break timer reaches 0, the screen waits for the user to start the next focus phase. |
| `Ctrl+Shift+Space` | Extends the current break. The hint remains stable until the maximum extension is reached, then it disappears. |
| Three `Esc` presses in succession | Skips the break. The next focus phase starts immediately. |

The three-press skip is intentionally awkward. A single Esc would let the user dismiss breaks reflexively, defeating the purpose. Three presses are fast enough that a determined user can skip in under two seconds, but slow enough that an absentminded press does not skip by accident.

The Ctrl+Shift+Space chord extends the current break, capped at 3 added minutes per break. This handles the common case where the user is mid-stretch or mid-conversation when the break would end and needs slightly more time. The cap prevents the user from indefinitely extending the break and losing the rhythm.

There is no "stop the session" control on the break screen. Stopping the session must go through the main window, which makes it a deliberate action rather than an impulse during a moment of resistance.

## Overtime

If the user does not interact with the break screen and the break timer reaches 0, the system enters overtime. The break-finished sound plays immediately, then every 10 seconds until the user acknowledges the screen or the system auto-advances. The break segment's `actual_end` is not set yet; the segment continues to be the active segment, but the timer counts up instead of down.

Overtime is capped at `MAX_BREAK_OVERTIME_SECONDS` (1800 seconds = 30 minutes). During overtime:

- The break mark on the rail keeps growing for 10 seconds. After that grace window, the extra waiting time is empty on the rail, matching idle and pause gaps.
- A reminder alert fires every 10 seconds prompting the user to start the next focus phase.
- After 30 minutes of overtime, the system auto-advances to focus. The break segment is marked completed, with `actual_end` capped at 10 seconds after the planned break end.

The rail gives the user 10 seconds of grace to return without treating a long absence as break time. The 30 minute cap prevents the break screen from waiting forever if the user never comes back.

**Example.** Focus ends at 09:25. The break screen appears with a 5-minute timer. The user does not acknowledge it. At 09:30 the timer reaches 0, overtime begins, and the break mark on the rail keeps growing until 09:30:10. At 09:35 the user clicks "start focus." The break segment is marked completed with `actual_end = 09:30:10`, and the 09:30:10 to 09:35 gap stays empty on the rail. If the user still had not acknowledged by 10:00, the system would auto-advance to focus with the same capped break end.

## Suspend and wake during break

The break screen interacts with system suspend in a specific way.

**Suspend during break.** If the OS sleeps while the break screen is showing, the timer pauses naturally (no ticks fire). On wake, the next tick detects the gap (> 15s, see `algorithms/pomodoro-state-machine.md`) and creates a pause row with `reason = suspend` on the active break segment. The break screen is still on screen because Tauri windows survive suspend; the timer resumes from where it paused.

**Suspend triggered by the user.** If the user explicitly closes the laptop or triggers sleep during a break, the same flow applies: the suspend pause is recorded, and on wake the break resumes.

The break screen does not need special suspend handling beyond what the rest of the timer does. It is aware of the pause records via the same data layer, so the time remaining shown on the screen accounts for the pause when the user wakes.

## Display change mid-break

If a monitor is connected or disconnected during a break (common on laptops being plugged into an external display), the enforcement guard reconciles the overlay against the current monitor list. The main overlay is kept on the current primary monitor when possible, and secondary blockers are recreated for every non-primary monitor.

If the operating system is still settling a display configuration, the overlay can briefly lag behind the final geometry. The next reconciliation pass refreshes blocker coverage and reinforces native topmost or screen-saver-level state on platforms that need it.

## When the break screen is hidden

The break screen only shows for `short_break` and `long_break` phases of an active session. It does not show for:

- Suspend pauses (the user is not at the computer; nothing to enforce).
- Idle pauses (handled by the idle overlay, see `features/pomodoro-idle-detection.md`).
- Manual pauses (the user explicitly chose to pause; no need to enforce a break).
- Reconfiguration bridge segments that happen to be break phases (the bridge represents continuation of an interrupted state, not a fresh break to enforce).

The closing of the break screen always coincides with a phase transition: either the next focus segment starts, or the session ends because the event window closed.

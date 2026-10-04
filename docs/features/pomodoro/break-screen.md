# Pomodoro break screen

The break screen makes recovery harder to ignore than a normal notification without pretending to take control of the operating system from its owner.

## Purpose

When a short or long break begins, the app presents a deliberate transition away from work. The surface shows the remaining break and only the controls needed to extend, deliberately skip, or begin the next focus phase.

The feature blocks ordinary window switching and accidental dismissal where supported. A user can still terminate the process, power off, use operating-system security surfaces, or otherwise bypass the app. Ganbaru AI is not hostile lock-in or device-management software.

## Surfaces and enforcement

The primary display uses a Svelte overlay so countdown, localization, state, controls, and accessibility share the application component system. Secondary displays receive quiet blocker surfaces while enforcement is active.

A scoped Rust guard owns topmost placement, monitor reconciliation, power assertions, supported ordinary app-switch shortcut suppression, and cleanup. Linux, Windows, and future macOS builds use platform-appropriate adapters. Cleanup is idempotent after partial setup, display changes, or application exit.

Connecting, disconnecting, moving, or resizing displays reconciles overlay coverage without duplicating active controls. Secondary clicks return attention to the primary overlay.

## Deadline

The countdown derives from the persisted absolute phase deadline. It does not restart because a WebView took time to appear. The break-start sound plays after the visible surface is ready so audio and visual transition occur together.

## Controls

`Mod + Shift + Space` extends the break by one minute while the configured extension allowance remains. Settings can allow 1, 3, 5, 10, or 15 extensions, with 3 as the default, or disable extension.

Repeated `Escape` presses can deliberately end the break early. Settings can require 1, 3, 10, 20, or 50 presses, with 10 as the default, or disable early ending. The intentionally awkward default prevents reflexive dismissal while preserving a deliberate escape.

The screen does not expose a stop-session action. Stopping remains a deliberate action through the active event or main Pomodoro surface.

Terminal completion screens accept one key or click to acknowledge. They do not offer extension, skip, restart, or stop because the run has already reached its terminal state.

Desktop acceptance must check ending warnings and manual-pause reminders while main-window JavaScript is suspended, including an extension, persisted reminder dismissal, and an action clicked after the displayed phase changes. Check completion audio with native local Music and a browser playback host. Change volume, pause, or choose another track during the sound; the latest manual choice must survive restoration. Also check unavailable audio output and a vault handoff during completion. Unit tests cover timing, identities, source completion, interruption, and bounds; they do not establish operating-system notification or audio behavior.

## Sounds

Settings control an optional warning before break end and the reminder cadence after end. `None` for repeat still permits the immediate break-finished cue. A warning that is already in the past does not fire late.

Packaged sounds follow [audio asset rules](../../development/audio-assets.md).

## Overtime

When the countdown reaches zero, the screen waits for acknowledgement and counts overtime. The immediate completion sound plays, then repeats at the configured cadence.

Only the first ten seconds after the planned break end count as official break allowance on the Calendar rail. Later waiting time is empty, matching pause and away time. The prompt says “Ready to return.” Waiting, including more than 30 minutes, never authorizes another focus interval. The user must accept the return, or the event deadline closes the session.

The break segment's effective completed end remains capped to the official allowance plus grace. This preserves honest break history even if the user returns much later.

## Suspend and wake

System suspend creates a suspend pause through the shared state machine. On wake, the break resumes from its remaining duration rather than crediting sleep time as break activity.

The overlay guard reconciles displays and native enforcement after wake. Suspend logic remains canonical in the timer state, not the overlay.

## Visibility

The break screen appears for active short- and long-break phases. It does not appear for:

- Idle pauses, which use the [idle overlay](idle-and-suspend.md).
- Suspend while the user is absent.
- Manual focus pause.
- Internal reconfiguration bridges that do not represent a fresh break.

Closing the screen coincides with a real phase transition, acknowledgement, terminal state, or explicit safe cleanup. Hiding the window alone does not advance the timer.

## Accessibility

Countdown and controls are readable at distance, localized, keyboard operable, and announced by state. Required actions do not depend on color or animation. Reduced-motion preferences apply to nonessential transitions, and secondary displays do not contain unreachable duplicate controls.

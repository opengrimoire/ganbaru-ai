# Pomodoro idle and suspend behavior

Idle detection prevents away time from being recorded as focus. Suspend detection handles a sleeping operating system separately because it carries different evidence and recovery expectations.

**Migration status: Partial.** Native accepted state drives desktop idle overlays and failure sounds. The primary overlay or its main-window fallback acknowledges a painted, visible warning; Rust records the first accepted visibility time and owns the 60-second grace deadline. The frontend never declares failure from its own timer. Automated persistence and retry checks exist; real window visibility and platform acceptance remain pending.

## Idle threshold

Idle detection applies only to focus phases. An event can disable it or store a threshold initialized from global or project defaults. Supported settings are 1, 2, 3, 4, 5, 10, or 15 minutes, with 3 minutes as the default.

Changing the global threshold during an active run can update an already enabled detector. It does not enable detection for an event that explicitly disabled it.

Checks adapt to distance from the threshold rather than polling at maximum frequency for an entire phase. Platform detection sources and pure timing behavior are specified in [idle detection](../../algorithms/pomodoro/idle-detection.md).

Break phases do not pause for idle because time away is their purpose.

## Idle versus suspend

**Idle** means the operating system remained awake but reported no user activity through the configured threshold. The pause begins at the detected idle start and uses reason `idle`.

**Suspend** means the application clock stopped advancing because the system slept. A sufficiently large tick gap is recorded as reason `suspend` from the last credible active time through wake.

The reasons remain distinct in history. Idle can reveal a focus interruption pattern. Suspend usually reflects an external lifecycle event and should not be presented as failed attention.

## Idle pause

When idle is declared:

1. The active focus segment remains the same segment.
2. A pause begins at the detected idle start, clamped to the segment boundary.
3. The countdown freezes.
4. The Calendar rail stops focus fill at the pause start.
5. A full-screen idle overlay appears on the primary display, with secondary blockers where supported.

The pause is backdated to the operating system's evidence so threshold time is not counted as focus. The overlay's user-visible failure window starts when the overlay is actually visible.

Rust commits the first scoped visibility acknowledgement and measures the live grace period with a monotonic clock. Civil clock corrections cannot shorten or extend that grace. A restarted controller must show and acknowledge its own warning; it cannot reuse another process or device's visibility marker as current display evidence.

## Return before focus failure

Pressing Space closes the idle pause and resumes with the same remaining focus time. The same segment continues, and the Calendar rail shows separate focus bands before and after the pause.

Pause rows split rendering and analytics intervals without creating false new focus segments.

## Long idle and focus failure

If the visible idle overlay remains unacknowledged for 60 seconds, the current focus segment becomes interrupted with a focus-failed reason. Focus credit ends at the detected idle start, so neither the threshold interval nor later absence counts.

Returning after failure and pressing Space starts a fresh full focus opportunity in the same open run and cycle, clipped by the event end. Cycle count and long-break cadence do not advance merely because one opportunity failed.

The idle overlay has no stop action. Intentional stop remains in the active event or main Pomodoro surface.

## Suspend recovery

On wake, a compact dialog explains the detected suspend duration and offers valid recovery such as resume or stop. It is less forceful than the idle overlay because sleep is a known system event rather than inferred user behavior.

Resume preserves the remaining time from before suspend. Stop records an interruption at the credible wake boundary without counting suspended time as focus.

Android native phase reconciliation follows persisted deadlines and native projection rules rather than relying on the WebView tick-gap heuristic.

## Overlay enforcement

The idle surface reuses the scoped break-screen enforcement boundary: a Svelte primary overlay, quiet secondary blockers, supported topmost and ordinary app-switch protection, monitor reconciliation, and reliable cleanup.

The design does not prevent process termination or operating-system security actions. See [Break screen](break-screen.md) for the shared product boundary.

## Suppression

Idle detection does not fire when:

- It is disabled for the event.
- There is no active focus segment.
- The current phase is a break.
- Another pause already owns the segment.
- The platform cannot provide trustworthy activity evidence and the adapter reports unavailable.

Unavailable detection remains explicit and never fabricates activity or idle time.

## Accessibility

The overlay explains why the timer paused, how long the system believes the user was away, and what Space will do in the current state. Idle and failed-focus states use text and sound in addition to color. Repeated audio stops at the failure boundary so cues do not overlap.

# Pomodoro state machine

The pomodoro feature's behavior is governed by a small set of pure decision functions. Each function takes the current state (the run, the active segment, recent ticks, the calendar context) and returns a decision (continue, advance, transition, reconfigure, recover, do nothing). The functions have no side effects: they read state and return a decision; the caller applies the decision by writing to the database and updating the UI.

This doc covers the decision functions, why they are pure, the heartbeat that backs crash recovery, the named constants, and the recovery procedure. The user-facing surfaces are in `features/pomodoro.md` and the data model is in `algorithms/pomodoro-segments-and-plan.md` and `data/schema.md`.

## Pure decision functions

There are six decision functions. Each is a `(state) -> decision` mapping with no I/O.

### `decideTick`

Called every second while a session is active.

**Inputs:** the current run, the active segment, the time since the last tick, the current wall-clock time, the calendar event window.

**Returns:** one of:

- `tick`: normal countdown, decrement remaining seconds.
- `notify`: 60 seconds remain in focus; emit a notification.
- `advance`: phase ended, advance to the next phase.
- `expire`: event time expired, end the run (or transition if a consecutive event exists).
- `suspend_pause`: tick gap > `SUSPEND_THRESHOLD_MS`, create a suspend pause.
- `noop`: nothing to do.

The order of checks inside `decideTick` is: suspend first (because a long tick gap means the rest of this tick's reasoning is based on stale state), then expire, then phase end, then notify, then normal tick.

### `decideAdvancePhase`

Called when `decideTick` returns `advance`.

**Inputs:** the current run, the active segment, the run's config, the cycle position.

**Returns:** the next phase (`focus`, `short_break`, `long_break`) and a flag indicating whether to skip (only relevant if `skipNextBreak` is set on the next break).

The rule is straightforward: focus → break (short or long depending on cycle), break → focus (cycle increments after short, resets after long). The `skipNextBreak` flag, if set, causes the function to skip directly from focus to focus, recorded as the absence of a break segment between two focus segments.

### `decideTransition`

Called when `decideTick` returns `expire` and the calendar has a consecutive or overlapping pomodoro event.

**Inputs:** the ending run, the ending segment, the new event, the time of the transition.

**Returns:** the inherited state (`inherited_focus_minutes`, `inherited_cycle`) for the new run and the first phase of the new run (derived using the new event's config and the inherited state, see `algorithms/pomodoro-segments-and-plan.md` "Plan vs segments").

If the calendar has no consecutive event, `decideTick` returns `expire` directly (without calling `decideTransition`) and the run ends with `end_reason = completed`.

### `decideReconfigure`

Called when the user changes the pomodoro config mid-session.

**Inputs:** the current run, the active segment, the time of reconfiguration, the new config.

**Returns:** the inherited state for the new run and the bridge segment specification (same phase as the interrupted segment, with remaining time from the old config). After the bridge, the new config's cycle rules take over.

The reason for the bridge segment: a reconfiguration mid-focus should let the user finish their current train of thought, not snap them into a break or a fresh focus immediately. The bridge gives them the rest of the planned phase under the old config; the new config kicks in after.

### `decideIdleCheck`

Called periodically (every ~15 seconds during focus).

**Inputs:** the current run, the active segment, the user's idle time (from per-OS detection sources, see `algorithms/idle-detection.md`), the run's config (`idle_timeout_minutes`).

**Returns:** one of:

- `idle_pause`: idle time exceeds threshold, create an idle pause.
- `noop`: idle time is below threshold, or threshold is null, or active phase is a break.

The function does not check whether a pause is already active; the caller does that to keep the function pure.

### `decideStartFromBlock`

Called by the auto-start poll (every ~1 second, on app open, on calendar change).

**Inputs:** the calendar's pomodoro events overlapping `now`, the currently running session (if any).

**Returns:** one of:

- `noop`: same block, same config, same end. Nothing changed.
- `update_end_only`: same block, end time changed (the user resized the event). Update the stored end time.
- `reconfigure`: same block, config changed. End the current run with `reconfigured`, start a new one.
- `transition`: different block. End the current run with `block_transition`, start a new one with inheritance.
- `new_session`: no existing session. Create a new run starting fresh.

The selection of which event to pick when multiple overlap follows the auto-start tiebreakers in `algorithms/time-conflict-detection.md`.

## Why pure functions

Keeping the decision logic in pure functions has several benefits.

**Testability.** A test can construct any combination of inputs and assert the decision, without needing a database, a calendar, or wall-clock time. This is how the corner cases (tick exactly on event end, reconfigure during a paused break, transition with no inheritable state) get covered.

**Predictability.** Two reads of the same state produce the same decision. Bugs in the side-effecting layer (the writer) cannot corrupt the decision logic; bugs in the decision logic surface as test failures, not as data loss.

**Auditability.** Given a run's history (segments, pauses, end_reason), the decisions that were made are reconstructable by replaying inputs through the same functions. This is useful when investigating "why did the timer do X" reports from users.

**Safe to call multiple times.** A pure function returning the same decision twice is a no-op for the caller (the writer can guard with idempotency checks). This makes recovery easier: replaying ticks during a recovery scan does not corrupt state.

The opposite design (decisions interleaved with writes) would make all of the above harder. Tests would need a database. Bugs could create dirty state that hides real bugs. Replaying would risk double-writes.

## Heartbeat

`pomodoro_runs.last_heartbeat` is updated approximately every 30 seconds while the session is active. The heartbeat is the basis for crash recovery: if the app stops without setting `ended_at`, recovery uses `last_heartbeat` as the run's true end time.

Heartbeat properties:

- **Frequency:** every ~30 seconds. Chosen to bound the recovery error to ~30 seconds while keeping write traffic minimal.
- **Atomic single-row update.** Each heartbeat is one `UPDATE pomodoro_runs SET last_heartbeat = ? WHERE id = ? AND ended_at IS NULL`. SQLite handles this in a microsecond or two, no contention.
- **Independent of segment writes.** Heartbeats fire on their own schedule, not tied to phase boundaries. This way a crash mid-segment still has a recent heartbeat.

Without the heartbeat, recovery would have to use the active segment's planned end (overestimating focus time on crash mid-phase) or now (catastrophic if the app crashed and reopened hours later). The heartbeat gives a tight bound regardless of when recovery runs.

## Constants

| Constant | Value | Used by | Reason |
|----------|-------|---------|--------|
| `SUSPEND_THRESHOLD_MS` | 15000 (15 seconds) | `decideTick` | A normal tick gap is ~1 second. 15 seconds is unusual enough to flag as suspend without misclassifying brief CPU starvation. |
| `NOTIFICATION_THRESHOLD` | 60 (seconds) | `decideTick` | Gives the user a one-minute heads-up before focus ends so they can reach a stopping point. |
| `MAX_BREAK_OVERTIME_SECONDS` | 1800 (30 minutes) | break-end logic | Caps overtime at 30 minutes. After that, the system auto-advances to focus to prevent indefinite breaks from corrupting analytics. |
| `HEARTBEAT_INTERVAL_MS` | 30000 (30 seconds) | heartbeat scheduler | Bounds crash recovery error to ~30 seconds. |
| `AUTO_START_POLL_MS` | 1000 (1 second) | auto-start scheduler | Catches calendar boundary crossings promptly enough that event-start notifications and pomodoro auto-start feel aligned with the system clock. |
| `IDLE_CHECK_INTERVAL_MS` | 15000 (15 seconds) | idle scheduler | Frequent enough to detect idle within a reasonable window of the threshold; infrequent enough to not poll the OS constantly. |

These values are constants, not user settings, because changing them changes the meaning of the timestamps in the database. Users who want different thresholds (e.g. longer suspend tolerance) would need a code change. The trade is intentional: a stable schema is more valuable than a knob no one will turn.

## State diagram

A run lives in one of four high-level states. Transitions are triggered by the decision functions.

```
                  decideStartFromBlock returns new_session
                 ─────────────────────────────────────────
                                                          │
                                                          v
   ┌─────────────┐    decideTick: noop/tick/notify    ┌────────┐
   │   IDLE      │ <───────────────────────────────── │ ACTIVE │
   │ (no run)    │                                    └────────┘
   └─────────────┘                                       │  ^
       ^   ^                                             │  │
       │   │  end_reason set                             │  │
       │   │  (completed, stopped,                       │  │
       │   │   interrupted, reconfigured,                │  │
       │   │   block_transition)                         │  │
       │   │                                             │  │
       │   └─────────────────────────────────────────────┘  │
       │                                                    │
       │       decideAdvancePhase, decideTransition,        │
       │       decideReconfigure                            │
       │                                                    │
       │              ┌──────────┐                          │
       │              │ ACTIVE'  │ (new run from inherited) │
       │              └──────────┘ ─────────────────────────┘
       │                   ^
       │                   │
       │   ┌────────────┐  │  decideIdleCheck: idle_pause
       └── │ PAUSED     │ <┘
           │ (active +  │
           │  open      │
           │  pause)    │
           └────────────┘
                ^
                │
                v
           User resumes (closes pause)
```

In ASCII this is approximate. The states are:

- **IDLE**: no active run. The system polls auto-start.
- **ACTIVE**: a run is open with an active segment. `decideTick` fires every second.
- **PAUSED**: an active run with an open pause. `decideTick` is suppressed until the pause closes.
- **ACTIVE' (transition target)**: a new run created from an old run via `decideTransition` or `decideReconfigure`. Functionally an ACTIVE state, distinguished here only because the transition is the most subtle state change.

A session can move from ACTIVE to PAUSED and back many times within a single segment. A session moves from ACTIVE to a new ACTIVE' (closing the old run) only on transition, reconfiguration, or end-and-restart.

## Recovery procedure

On app startup, the system scans for runs with `ended_at = NULL`. For each:

1. **Determine the true end time.** Use `last_heartbeat`. This is the most recent moment the system was confirmed alive. If `last_heartbeat` is older than 60 seconds, the run is treated as crashed.
2. **Close the run.** Set `ended_at = last_heartbeat`, `end_reason = interrupted`.
3. **Close the active segment.** Find any segment on this run with `status = active`. Set `status = interrupted`, `actual_end = run.last_heartbeat`.
4. **Close any open pauses.** Find any pause on the active segment (or any segment on this run, defensively) with `ended_at = NULL`. Set `ended_at = run.last_heartbeat`.
5. **Record recovery.** Insert a `pomodoro_run_events` row with `event_type = crash_recovery`.

Each step is an independent SQL UPDATE. Each is atomic. The full recovery sweep is idempotent: running it twice produces the same result as running it once, because step 1 only acts on rows that still match the criteria.

This is safe because:

- Pauses are individual rows, not JSON blobs. Closing them needs only `UPDATE WHERE ended_at IS NULL`. No string surgery is needed.
- Each field update is its own SQL statement; partial recovery (a crash during recovery) leaves a recoverable state for the next attempt.
- The worst-case data loss is one heartbeat interval (~30 seconds).

After recovery, the system runs `decideStartFromBlock` for the current calendar context. If a pomodoro event is currently in window, a fresh session starts (as a new run, not resuming the recovered one).

### Why not resume the recovered run

Resuming would mean reopening a run that was closed during recovery, undoing some of the closure. This is awkward (segments and pauses are already closed) and runs counter to the user's likely expectation: after a crash, concentration is broken. A fresh session at the user's first interaction makes the boundary clear.

### External tools and recovery

External tools (CLI exports, analytics scripts, backup utilities) might read the database while the app is not running, including immediately after a crash before the user has reopened the app. To produce correct data, external readers should treat any run where `ended_at IS NULL` and `last_heartbeat` is older than 60 seconds as a crashed session, applying the same logic (use `last_heartbeat` as the true end time) before computing analytics.

The `ganbaru-ai` CLI is expected to handle this automatically. Third-party scripts that read the database directly are responsible for their own recovery handling. The schema documentation calls this out so authors of such scripts know what to do.

## Why the state machine is the source of truth

Every database write that the pomodoro feature performs traces back to a decision function returning a non-`noop` decision. The application code that runs the writes does not invent new transitions; it executes what the functions return. This makes the state machine the single source of truth for "what can happen to a session." Adding a new transition (e.g. a new end_reason) means adding a new decision function output, then handling it in the writer.

This separation also makes the cross-cutting hazards (see `data/hazards.md`) tractable: each hazard maps to one or more decision functions, and the test surface for the hazard is the same as the test surface for those functions.

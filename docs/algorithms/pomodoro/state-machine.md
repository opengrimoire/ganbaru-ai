# Pomodoro state machine

The Rust Pomodoro owner separates decisions from persistence, native effects, and presentation. A decision receives a complete snapshot and current time, then returns one semantic action. The native controller applies that action in one transaction before publishing effects. Svelte sends intents and paints committed projections. The duplicate TypeScript adaptive engine has been removed; frozen conformance fixtures remain exercised by Rust tests. See [Focus authority](focus-authority.md).

## Why decisions are pure

Time and lifecycle code is easiest to break at exact boundaries. Pure decisions allow tests to construct a state directly and assert behavior at event end, phase end, notification threshold, suspend return, config change, and overlapping calendar transitions without a database or wall-clock wait.

The state machine does not choose which overlapping event owns auto-start. Calendar selection occurs first under [Time conflict detection](../calendar/time-conflict-detection.md).

## Timer snapshot

A tick decision needs:

- phase and rhythm position;
- current config snapshot;
- visible remaining seconds and absolute phase deadline;
- active calendar block deadline;
- previous tick time;
- notification state;
- pause, idle, suspend, and overtime state relevant to ticking;
- platform policy for delayed JavaScript ticks.

The decision does not query the database or operating system. Callers normalize those inputs first.

## Tick priority

One tick applies this order:

1. Detect a suspend-sized JavaScript tick gap when the platform policy enables it.
2. If return from the gap is already beyond the calendar block, choose suspend plus block expiry.
3. Otherwise preserve pre-suspend remaining time and enter suspend-away handling.
4. If no suspend action applies, expire the calendar block at or after its deadline.
5. Derive monotonic remaining seconds from the phase deadline and prior visible value.
6. At zero, distinguish focus completion from break completion.
7. During focus, emit the one-shot approaching-end notification at the configured threshold.
8. Otherwise return an ordinary countdown update.

Calendar block expiry precedes phase completion when both occur on the same tick. Work cannot continue outside the owning event merely because a phase also reached zero.

Current desktop suspend-gap threshold is 15 seconds. This is lifecycle policy, not database meaning. Mobile compatibility paths may disable JavaScript-gap interpretation and use native lifecycle evidence instead.

## Phase advancement

After a focus phase:

- an explicit skip-next-break preference advances directly to the next focus position and records the skipped-break decision;
- otherwise the rhythm chooses a short or long break for the completed focus position.

After a short or long break, the rhythm advances to the next focus position. Count rhythms use their long-break cadence. Sequence rhythms use their normalized bounded position sequence.

The outgoing segment closes before the incoming segment starts. The Rust transition service commits the transition, run event, adaptive decision, and incoming segment together. Recovery uses native execution state and does not adopt unreferenced runs from earlier development implementations.

Break completion enters the user-visible return or overtime flow. Another focus interval requires acceptance. The pure phase decision still identifies the next logical focus position.

## Calendar block activation

When the calendar scheduler reports an eligible block, the decision distinguishes:

- no change to the same block;
- only the same block's end changing;
- same-block config reconfiguration;
- rebuilding future projections after an end-only change;
- transition from another active block;
- a fresh session.

Overtime protects the current completed-phase flow from an unrelated rhythm rebuild. An end change still updates the hard calendar deadline.

A transition between blocks receives the incoming rhythm and inherited progress from the outgoing run. A true gap starts fresh. Adjacent or overlapping blocks may carry inherited focus and rhythm position according to transition policy.

## Cross-block transition

If the outgoing state is focus, accumulated non-paused focus is compared with the incoming configuration's focus duration at the relevant position.

- If accumulated focus meets or exceeds the new threshold, the new run begins with the appropriate break.
- Otherwise focus continues with new duration minus accumulated focus.

If the outgoing state is a break and the previous block has expired, the new block begins fresh focus. Otherwise the compatible break remains active under the new run boundary.

The inherited amounts are persisted on the new run so later projection does not traverse an unbounded history chain.

## Reconfiguration

Reconfiguration preserves elapsed active progress, not the old phase's remaining duration.

For the current phase:

1. Determine old phase duration at the current rhythm position.
2. Derive elapsed non-paused progress from explicit evidence or old duration minus remaining.
3. Determine the new phase duration at the normalized position.
4. Set remaining to the maximum of zero and new duration minus elapsed.
5. Exit overtime if the phase again has positive remaining time.
6. Reset a focus notification only when the new remaining time is above its notification boundary.

If elapsed progress already satisfies a shorter new duration, the phase boundary is immediately due. Past segments are not changed.

## Pause and idle decisions

Ordinary manual pause and resume are allowed only in compatible running state. Idle and suspend overlays own their own resolution flow and cannot be bypassed by the generic pause command.

Idle decisions run only during unpaused focus with an enabled positive threshold and no webcam suppression. Exact behavior is in [Idle detection](idle-detection.md).

Resume closes the active pause and shifts the phase deadline by effective paused duration. A paused phase does not finish merely because its former deadline passed.

## Side-effect ordering

A controller applying a transition follows this order:

1. Revalidate current generation and command preconditions.
2. Compute the pure decision.
3. Persist all canonical rows in one transaction where the operation spans rows.
4. Update in-memory runtime from the committed result.
5. Reconcile notification schedules, overlays, media, tray, extension, and secondary-window state.
6. Emit bounded invalidation to other windows.

If a native effect fails after commit, state remains canonical and reconciliation retries. Do not roll back user history because a tray or sound effect failed.

## Heartbeats

An open run records a periodic heartbeat. Desktop crash recovery uses it as a conservative upper bound on recent live state. The heartbeat is not a sample of focus activity and is not written on every visual tick.

Without it, desktop recovery would have to close a crash at the old planned phase end or at startup now, either of which can greatly overcount. Heartbeat cadence balances recovery error and write overhead and can be tuned without changing schema meaning.

## Desktop cold recovery

On startup, Rust inspects open runs and active segments before the frontend begins ordinary scheduling.

For each candidate it validates run shape, event identity, phase, rhythm, timestamps, active-segment uniqueness, pauses, and heartbeat. Ambiguous or invalid state closes conservatively as interrupted.

A stale desktop run is bounded by its last valid heartbeat and persisted pause evidence. It does not count the entire time until startup as work. Open pause rows are normalized, terminal run and segment state is written once, and later recovery repeats no additional mutation.

## Live suspend recovery

When a delayed desktop tick crosses the suspend threshold, the decision captures remaining time at the last tick and the away interval.

If the event expired while away, block-expiry handling closes the run. Otherwise suspend-away state blocks ordinary countdown until the user resolves return behavior. The phase deadline is reconstructed from pre-suspend remaining time rather than allowing sleep to consume focus.

Idle detection is suppressed during this flow so one away interval does not create both idle and suspend pauses.

## Android cold recovery

Android cannot rely on JavaScript heartbeats while the WebView is backgrounded. An accepted phase and its pauses can be reconstructed from SQLite without a JavaScript heartbeat. Scheduled notifications do not supply execution evidence.

Recovery validates the active vault and committed run, event window, phase deadline, rhythm, and pauses. A valid phase may resume toward current time. Expired or ambiguous state closes conservatively. Recovery has no notification projection argument and cannot create a scheduled run or future phases.

Legacy suspend pauses created by earlier WebView-throttling behavior may be normalized according to the compatibility rule. A genuine open manual or idle pause remains paused and time away does not count.

Desktop and Android recovery must not be collapsed into one now-minus-heartbeat formula.

## Scheduler behavior

Visual countdown updates occur regularly while running. Calendar auto-start is deadline-driven: it schedules the next relevant event start or end, and reruns on calendar or lifecycle invalidation. While a due desktop commitment awaits fresh local activity, admission is retried every 15 seconds. Android requires explicit starts. Error retry uses a separate bounded delay.

There is no AUTO_START_POLL_MS constant and no one-second calendar polling contract.

## Required tests

The decision and controller layers cover:

- exact event end and phase end, including simultaneous boundaries;
- notification threshold and reconfiguration around it;
- short break, long break, skipped break, and sequence position;
- same-block edits and cross-block transitions;
- accumulated focus under shorter and longer incoming rhythms;
- pause and resume deadline movement;
- suspend gap below, at, and above policy threshold;
- block expiry during suspend;
- desktop and Android cold recovery with valid, stale, paused, and malformed evidence;
- repeated commands and repeated recovery;
- persistence success followed by a failed native effect.

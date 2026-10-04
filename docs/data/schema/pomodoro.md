# Pomodoro schema

Pomodoro persistence separates planned rhythm, one run's configuration snapshot, actual phases, pauses, lifecycle events, and adaptive evidence. This prevents later calendar or preference edits from rewriting history.

## Event configuration

An eligible calendar event has one Pomodoro configuration. Count rhythms define focus, short break, long break, and long-break cadence. Sequence rhythms define a bounded repeating sequence. Replacing a rhythm validates the complete new shape before transactionally replacing its child rows.

The optional idle timeout is positive when present. Null disables idle detection. Zero is invalid and is not treated as a special disabled value.

Configuration is future intent. It is not the source of truth for a phase that already started.

## Runs

A run is the durable session header. It records the concrete event, original recurring-series identity where applicable, event date and planned window, actual start and end, end reason, start trigger, event-title snapshot, rhythm snapshot, idle setting, heartbeat, and inherited state.

The native semantic Calendar edit service stores a current occurrence alias, current device-day date, and current title separately from original run provenance. An active retarget checks the execution revision, exact run, and prior occurrence identity; it changes only the current reference and accepted active segment before reconciling the new canonical deadline and configuration. Manual pauses and elapsed evidence survive. Closed-run materializations update the current run reference without rewriting completed segments. Calendar history reads request exact visible occurrence identities and resolve the current alias, falling back to the run's original occurrence identity, within the same read snapshot as its pauses. Device-day dates remain execution evidence; the frontend does not use them to reconstruct recurrence identities. Indexed occurrence lookups exclude unrelated dates before applying row limits, so a long-lived recurring series cannot exhaust a visible occurrence's allowance with other dates. Oversized identity sets, segment sets, and pause sets fail explicitly rather than producing a truncated rail. The frontend submits reviewed native Calendar operations and projects their committed results.

Recurrence protection uses original home-zone occurrence identities, not the run's device-local planning date. Those dates can differ around midnight and must not be substituted for each other.

Inherited focus and rhythm position are copied onto the new run rather than recomputed through an unbounded chain of older runs. This keeps one run self-contained even if earlier calendar rows are later archived.

At most one run is open in ordinary operation. More importantly, a partial unique constraint permits at most one globally active segment. Recovery may briefly observe an open run without an active segment and must resolve it deterministically.

Multiple runs may refer to the same event. They remain separate history and are never merged by title, time range, or event identity.

## Segments

Segments represent phases that actually started. The database does not pre-create the full future plan. A segment records run identity, phase, rhythm position, planned and actual boundaries, status, and the duration chosen for that phase.

Completed and interrupted rows are immutable history. The active row may be closed, paused through related rows, or transitioned to a new row in one transaction. A planned UI band is a projection until its segment starts.

This lazy model avoids deleting speculative rows after a stop or calendar edit. It also makes plan-versus-actual analysis possible by comparing history with the deterministic run snapshot and recorded adaptive decisions.

Detailed derivation is in [Plan and history](../../algorithms/pomodoro/plan-and-history.md).

## Pauses

A pause belongs to one segment and has a reason and start boundary. An open pause has no end boundary. Manual, idle, and suspend-related states are normalized according to platform recovery rules.

Pause intervals cannot begin before their segment, extend after a closed segment, or overlap in a way that counts the same time twice. Resume closes the pause and moves the effective phase deadline. Wall time spent paused is not focus or break progress.

Idle detection may backdate a pause to the inferred start of inactivity, bounded by the segment start and existing pause evidence. Suspend handling has precedence when lifecycle evidence shows that the operating system was not running ordinary idle checks.

## Run events

Run events are append-only explanations for lifecycle decisions that are not fully expressed by final segment rows, such as skip, extension, reconfiguration, transition, stop, completion, and recovery. They support audit and analytics without turning logs into canonical state.

Repeated commands must not append duplicate semantic events. State preconditions and command receipts protect transitions where retries are expected.

Adaptive decisions are not encoded only as generic run events. They have dedicated durable records so chosen values, context, assignment, and later outcome can be analyzed independently.

## Recovery evidence

The heartbeat bounds desktop crash recovery. It is not a continuously exact activity log. Startup combines heartbeat, run state, active segment, pauses, event window, platform lifecycle evidence, and current time to choose a conservative result.

Desktop cold recovery does not assume that all time since the last write was focus. Valid Android cold recovery may use later native evidence when the active event and phase are still valid. Invalid or ambiguous state is interrupted rather than generously extended.

Recovery is idempotent. Running it twice must not create another terminal event, pause, segment, or run.

## Reconfiguration

Reconfiguration preserves elapsed active progress. Remaining time is the new phase duration minus elapsed non-paused progress. If elapsed progress already meets the new duration, the next boundary is immediately due.

Past segments remain unchanged. Future projection uses the new rhythm and persisted boundary decisions. The reconfiguration and any resulting segment transition commit together so no caller can observe a new configuration with an old active-phase interpretation.

## Adaptive data

Adaptive Pomodoro is explicit opt-in and local. Storage separates:

- context and policy snapshots;
- phase or run boundary decisions;
- experiment definitions and bounded variants;
- deterministic assignments;
- later outcomes and aggregate evidence;
- terminal experiment state and cooldown.

A decision records the previous and selected value, reason codes, relevant state scores, policy version, and target phase or run. The selected value is persisted in the same backend transaction that starts the affected segment or run. Outcomes are appended later and never rewrite the original decision.

The stable policy is in [Adaptive policy](../../algorithms/pomodoro/adaptive-policy.md). Current experiment lanes are in [Adaptive experiments](../../algorithms/pomodoro/adaptive-experiments.md).

## Time and deletion

Pomodoro history uses normalized timestamp text within this domain. Durations are derived from instants and closed pauses, not local clock labels.

Calendar deletion and recurrence edits preserve referenced history. A run stores enough event context to remain interpretable after archive. Cleanup may remove derived adaptive aggregates and rebuild them, but never silently deletes canonical segments, pauses, decisions, or outcomes that remain in retention scope.

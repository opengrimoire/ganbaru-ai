# Pomodoro segments and plan derivation

A pomodoro session writes data to four history tables: `pomodoro_runs`, `pomodoro_segments`, `pomodoro_pauses`, and `pomodoro_run_events` (see `data/schema.md`). The run row is the session header, segments are the actual phases that ran, pauses are interruptions within segments, and run events are the audit trail for lifecycle decisions such as skip break, focus extension, reconfigure, transition, stop, complete, and crash recovery. The user-facing pomodoro mechanics in `features/pomodoro.md` are implemented on top of this structure.

A core decision in this design: the **plan** for a session (the schedule of focus and break phases) is **never stored**. It is derived on demand from the run's config snapshot and inherited state. Segments record what actually happened. Comparing actuals to the derived plan gives plan-vs-actual analysis without ever needing a plan table.

This doc explains how that derivation works, why segments are written lazily, what the inherited fields mean, and how pauses fit in. Worked examples cover the common scenarios.

## Plan vs segments

Given a run's `started_at`, config snapshot (`focus_duration_minutes`, `short_break_minutes`, `long_break_minutes`, `pomodoro_count`), and inherited state (`inherited_focus_minutes`, `inherited_cycle`), the planned schedule is fully deterministic:

- If `inherited_focus_minutes >= focus_duration_minutes`: the first phase is a break. Short break if `inherited_cycle < pomodoro_count`, long break otherwise.
- If `0 < inherited_focus_minutes < focus_duration_minutes`: the first phase is focus, lasting `focus_duration_minutes - inherited_focus_minutes` minutes (the remaining focus needed to complete the current cycle).
- If `inherited_focus_minutes == 0`: the first phase is a full-length focus period at cycle `inherited_cycle` (which is 1 for fresh sessions).

After the first phase, the standard cycle rules apply using the run's config:

- Focus → short break (if `cycle < pomodoro_count`) or long break (if `cycle == pomodoro_count`).
- Short break → focus (cycle increments).
- Long break → focus (cycle resets to 1).

Repeating these rules produces the planned schedule for the rest of the session.

This derivation covers all run origins:

- **Fresh session** (`new_session`): inherited values are 0 and 1, so the first phase is a full-length focus at cycle 1. This includes restarts after any stop, because concentration is assumed broken.
- **Block transition**: inherited values carry the ending run's cycle position and accumulated focus. The first phase reflects the handoff.
- **Reconfiguration**: inherited values carry the position within the reconfigured run. The bridge segment (same phase as the interrupted one, with the remaining time from the old config) is the first actual segment of the new run.

Storing plan rows would duplicate this information and create a synchronization problem: every block transition and reconfiguration would have to update both the inherited fields and the plan rows, with the risk of them diverging silently. By keeping the plan derived, the inherited fields are the only source of truth.

### Inherited focus during a break phase

If a transition or reconfiguration happens while the user is on a break, `inherited_focus_minutes` is 0. The break already "resolved" the accumulated focus. The `inherited_cycle` carries the current cycle number. After the bridge break (if reconfiguring) or the immediate break (if transitioning), the next focus starts fresh at the new config's full duration.

## Lazy segment creation

A segment row is only created when its phase begins. The first focus segment is written when the session starts. The next segment (break or focus) is written only when the previous one ends and the next phase actually begins. A phase that never ran has no row.

This rule has three consequences:

1. **Skipped breaks have no break segment row.** If the user sets `skipNextBreak`, no break segment is created. The next focus segment starts immediately. The skip is also logged as `pomodoro_run_events.event_type = skip_break`, so analytics can distinguish an intentional skip from a missing break row.
2. **Future segments do not exist.** At any moment in an active session, only the current segment and previously completed segments exist as rows. The future is computed on the fly for rendering (see `features/pomodoro-progress-displays.md`) and by the state machine for transitions.
3. **Crash recovery is simple.** A crash leaves the active segment with `status = active` and `actual_end = NULL`. Recovery sets `status = interrupted` and `actual_end = run.last_heartbeat`. No future segments need cleanup because none exist.

The alternative (write all planned segments at session start, then update them as they complete) would require constant synchronization between the plan and the user's actual behavior, plus a "planned but never ran" status to handle skips and early stops. The lazy approach avoids both.

## Inherited state fields

Three fields on `pomodoro_runs` carry state across run boundaries:

| Field | Type | Meaning |
|-------|------|---------|
| `inherited_focus_minutes` | integer | Focus minutes accumulated in the current cycle, carried from the preceding run. 0 for fresh sessions. |
| `inherited_cycle` | integer | Cycle number carried from the preceding run. 1 for fresh sessions. |
| `inherited_from_run_id` | UUID or null | FK to the run from which state was inherited. Null for fresh sessions. |

The first two are inputs to the plan derivation above. The third is for traceability: an analytics query can follow the chain back through transitions and reconfigurations to reconstruct a continuous work episode that spans multiple runs.

### Why inherit at all

Without inheritance, every block transition and reconfiguration would start fresh: the user would face a new full-length focus period immediately after one ended, denying them the break they earned. Inheritance lets back-to-back events feel like one continuous session.

### Why store inherited state on the run rather than derive it

Without `inherited_focus_minutes` and `inherited_cycle`, reconstructing the plan for a transition or reconfiguration run would require traversing the chain of previous runs and their segments. This is fragile because previous runs might have null live event FKs after archive and only retain the exact occurrence in `original_event_id`. It is also slow because chain length is unbounded if many transitions happen. Capturing the inherited state on the run itself makes each run self-contained: the plan can be derived from the run alone, without joining anywhere else.

## End reasons

When a run ends, `pomodoro_runs.end_reason` is set to one of:

| Reason | Trigger |
|--------|---------|
| `completed` | Event time expired. The session ran to the end of its block. |
| `stopped` | User clicked stop. |
| `interrupted` | App crashed or was killed. Recovery sets this from the heartbeat. |
| `reconfigured` | User changed the pomodoro config mid-session, ending this run and starting a new one with the updated config. |
| `block_transition` | Timer moved to a new event (consecutive or overlapping), starting a new run on that event with state inherited from this one. |

A null `end_reason` means the run is still active (or, on read after a crash, still needs recovery).

## Three segment statuses

A segment's `status` is one of:

| Status | Meaning |
|--------|---------|
| `active` | Currently running. Exactly one active segment exists globally at any time. |
| `completed` | Finished normally: focus timer reached zero, or break ended (timer ran out and user acknowledged, or auto-advance after overtime cap). |
| `interrupted` | Started but cut short: app closed, session stopped, event time expired mid-segment. |

There is no `planned` status because segments are written lazily (a segment that never ran has no row). There is no `skipped` status for the same reason: a skipped break has no row.

The exactly-one-active rule (invariant 2) is enforced at write time: starting a new segment also closes the previous one (sets `status = completed` or `interrupted` and `actual_end`).

## Pause records

Each pause within a segment is its own row in `pomodoro_pauses`. The fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `segment_id` | UUID | FK to `pomodoro_segments` (CASCADE delete) |
| `started_at` | ISO datetime | When the pause began |
| `ended_at` | ISO datetime or null | When the pause ended. Null if still paused |
| `reason` | `idle`, `suspend`, `manual` | Why the pause happened |

Multiple pauses can exist on the same segment (a segment can be interrupted multiple times). At any moment, at most one pause per segment has `ended_at = NULL` (the currently active pause).

Pause and segment timestamps are normalized before persistence. A pause cannot start before its segment's `actual_start`, and a closed pause cannot end before its normalized start. A finalized segment cannot have `actual_end` before `actual_start`. This protects focus history from operating-system idle timestamps that predate an auto-started segment and from exact cut actions that may land inside the same minute as the segment start.

### Why pauses are rows, not JSON

Storing pauses as a JSON array on the segment row would cause three problems:

1. **Crash recovery becomes fragile.** Closing open pauses in a JSON blob requires string manipulation in SQL (e.g. `REPLACE(..., 'null]', ...)`), which can corrupt data when multiple intervals exist or formatting varies. Individual rows need only `UPDATE pomodoro_pauses SET ended_at = ? WHERE ended_at IS NULL`.
2. **Analytics require JSON parsing.** Querying "average idle duration by time of day" means parsing JSON in every row. With individual rows, standard SQL aggregation applies directly.
3. **Writes are not atomic.** Updating a JSON pause means reading the full blob, deserializing, appending, re-serializing, and writing back. A crash mid-sequence can produce corrupted JSON. A single row INSERT is atomic.

The hazard catalog (see `data/hazards.md`, hazard 8) covers pause edge cases that depend on this structural choice.

## Run events

`pomodoro_run_events` records the decisions that matter even when the final row state is already correct. It is not a replacement for runs, segments, or pauses. It is an append-only trail for audit and analytics.

Events written by the timer include:

| Event type | When written |
|------------|--------------|
| `start` | A run is created. |
| `phase_start` | A segment starts. |
| `phase_complete` | An active segment becomes completed. |
| `pause_start` | A manual, idle, or suspend pause begins. |
| `pause_end` | An open pause is closed. |
| `idle_detected` | An idle pause is created. |
| `suspend_detected` | A suspend pause is created. |
| `skip_break` | The user skips the current or next break. |
| `extend_focus` | The user extends the current focus opportunity. |
| `reconfigure` | A run closes because the config changed. |
| `block_transition` | A run closes because control moved to another event. |
| `stop` | A run closes because the user stopped it. |
| `complete` | A run closes because the event window ended. |
| `crash_recovery` | Recovery closes a run left open by a crash. |

Focus extension updates the active focus segment's `planned_end` and writes an `extend_focus` event with the extension duration in seconds. This preserves both the visible plan change and the behavioral decision that caused it.

## Worked examples

### Clean session

Config: 25/5/15, `pomodoro_count=4`. Fresh session at 09:00.

| Time | Event |
|------|-------|
| 09:00 | Run created. Segment 1 created: focus, cycle 1, active. |
| 09:25 | Focus complete. Segment 1: completed. Segment 2: short break, cycle 1, active. |
| 09:30 | Break complete. Segment 2: completed. Segment 3: focus, cycle 2, active. |
| 09:55 | Focus complete. Segment 3: completed. Segment 4: short break, cycle 2, active. |
| 10:00 | Break complete. Segment 5: focus, cycle 3, active. |
| 10:25 | Focus complete. Segment 6: short break, cycle 3, active. |
| 10:30 | Break complete. Segment 7: focus, cycle 4, active. |
| 10:55 | Focus complete. Cycle 4 == pomodoro_count, so Segment 8: long break, cycle 4, active. |
| 11:10 | Long break complete. Cycle resets to 1. Segment 9: focus, cycle 1, active. |

Rows in `pomodoro_segments`: 9 so far, all but the last in `completed` state.

### Session with idle pause

Same config, fresh session at 10:00. Idle threshold = 5 minutes.

| Time | Event |
|------|-------|
| 10:00 | Run created. Segment 1 created: focus, cycle 1, active. |
| 10:15 | User steps away. No input. |
| 10:20 | Idle detected (5 minutes of inactivity). Pause 1 created: `segment_id = Segment 1`, `started_at = 10:20`, `ended_at = NULL`, `reason = idle`. Timer pauses. |
| 10:30 | User returns, clicks resume. Pause 1 updated: `ended_at = 10:30`. Timer resumes with the same remaining seconds (15 minutes). |
| 10:45 | Focus completes (10:00 + 25 + 10 minutes pause = 10:35, wait, let me recompute). |

Let me recompute. Focus duration is 25 minutes. The user worked 10:00-10:20 (20 min), paused 10:20-10:30, then resumed with 5 minutes of focus remaining. Focus completes at 10:35. The segment's `actual_end = 10:35`. Total elapsed time of the segment: 35 minutes. Total focus time: 25 minutes (5 of pause excluded).

Continuing:

| Time | Event |
|------|-------|
| 10:35 | Focus complete. Segment 1: completed, `actual_end = 10:35`. Segment 2: short break, cycle 1, active. |
| 10:40 | Break complete. Segment 2: completed. Segment 3: focus, cycle 2, active. |

The rail for Segment 1 shows green 10:00-10:20 and 10:30-10:35, with empty 10:20-10:30 (the pause).

### Session interrupted by event end

Config: 40/5/10. Event window: 14:00-15:00. Fresh session at 14:00.

| Time | Event |
|------|-------|
| 14:00 | Run created. Segment 1: focus, cycle 1, active, `planned_end = 14:40`. |
| 15:00 | Event window expires. The next event has no pomodoro config. Segment 1: interrupted, `actual_end = 15:00`. Run: ended, `end_reason = completed`. |

Notice that the focus segment is `interrupted` even though the run's `end_reason` is `completed`. The run completed (the event window ran out), but the segment was cut short. These are two different concerns.

### Two back-to-back events with inheritance

Event A: 09:00-11:00, config 40/5/10. Event B: 11:00-13:00, config 25/5/15. Fresh session on A at 09:00. Both have pomodoro and auto-start.

| Time | Event |
|------|-------|
| 09:00 | Run A created. Segment A1: focus, cycle 1, active, `planned_end = 09:40`. |
| 09:40 | Focus complete. Segment A1: completed. Segment A2: short break, cycle 1, active. |
| 09:45 | Break complete. Segment A3: focus, cycle 2, active. |
| 10:25 | Focus complete. Segment A3: completed. Segment A4: short break, cycle 2, active. |
| 10:30 | Break complete. Segment A5: focus, cycle 3, active, `planned_end = 11:10`. |
| 11:00 | Event A window expires. Block transition fires. Segment A5: interrupted, `actual_end = 11:00`. Run A: ended, `end_reason = block_transition`. Run B created with `inherited_focus_minutes = 30, inherited_cycle = 3, inherited_from_run_id = run_a_id`. |

Now derive Run B's first segment. `inherited_focus_minutes = 30 >= focus_duration_minutes = 25` of Run B's config, so the first phase is a break. Cycle 3 < pomodoro_count 4, so it is a short break.

| Time | Event |
|------|-------|
| 11:00 | Segment B1: short break, cycle 3, active. |
| 11:05 | Break complete. Segment B2: focus, cycle 4, active, `planned_end = 11:30`. |

The user got their earned break, then resumed focus at the new config's 25-minute cadence. The chain `Run A → Run B` is preserved via `inherited_from_run_id`.

### Reconfiguration mid-focus

Config: 40/5/10, fresh session at 09:00. At 09:28 the user changes config to 25/5/15.

| Time | Event |
|------|-------|
| 09:00 | Run 1 created. Segment 1: focus, cycle 1, active. |
| 09:28 | User reconfigures. Segment 1: completed, `actual_end = 09:28` (28 minutes elapsed). Run 1: ended, `end_reason = reconfigured`. Run 2 created with config 25/5/15, `inherited_focus_minutes = 28, inherited_cycle = 1, inherited_from_run_id = run_1_id`. |

Now derive Run 2's first segment. `inherited_focus_minutes = 28 >= focus_duration_minutes = 25`, so the first phase is a break (short break, cycle 1 < pomodoro_count 4). But wait: the user was mid-focus and expected to keep focusing on the same task. This is where the bridge segment idea applies: the bridge has the **same phase as the interrupted one**, with the remaining time from the old config.

So:

| Time | Event |
|------|-------|
| 09:28 | Segment 2 (bridge): focus, cycle 1, active, planned to last 12 minutes (40 - 28 = 12 from the old config). |
| 09:40 | Bridge focus complete. Segment 3: short break, cycle 1, active, 5 minutes (new config). |
| 09:45 | Break complete. Segment 4: focus, cycle 2, active, 25 minutes (new config). |

The user sees no interruption: the current focus continues for 12 more minutes (so they can finish their current train of thought), then the new 25/5 cadence kicks in. The reconfiguration is honored without losing the in-progress phase.

The bridge logic is what makes reconfiguration usable mid-session. Without it, the user would either lose 28 minutes of accumulated focus (if the reconfiguration started a fresh focus) or be sent into a break immediately (if the inherited state were applied without the bridge).

The same bridge logic applies if the user reconfigures during a break: the bridge is a break segment with the remaining minutes from the old config, then the new config takes over.

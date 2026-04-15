# Progress tracking

This document specifies the intended behavior for how GanbaruAI tracks and renders pomodoro progress. It is the source of truth for testing: if the code disagrees with this document, the code is wrong.

**Maintenance rule:** every section that describes behavior must include at least one practical example showing what the user does, what the app does in response, and what the user sees. When adding or editing a section, add or update examples to match the new behavior. Examples use concrete timestamps, event names, and config values. They describe the user's perspective, not internal function calls. If a section is particularly fragile or easy to misimplement, add multiple examples covering the common path and the edge cases.

## Cross-cutting hazards

This section lists the situations that are most likely to produce bugs, data corruption, or confusing UX. Every implementer, reviewer, and AI agent working on this system should internalize these before writing or modifying code. Each hazard describes what makes it dangerous, gives a concrete scenario, and points to which sections of this spec govern the correct behavior.

### 1. Event boundary timing

**Why it's dangerous:** block expiration, auto-start, and consecutive-event transitions all race for the same moment. If the expiration handler fires before the transition handler checks for the next event, inherited state is lost and the user sees a fresh session instead of a continuation.

**Scenario:** the user has "Deep Work" 09:00-11:00 and "Code Review" 11:00-13:00, both with pomodoro enabled. At 10:48 the user starts a 25-minute focus. At 11:00, "Deep Work" expires. The system must: (a) end the current run on "Deep Work" with `end_reason=block_transition`, (b) compute `inherited_focus_minutes=12` (the 12 minutes of focus done from 10:48 to 11:00), (c) create a new run on "Code Review" with those inherited values so the remaining 13 minutes carry over. If the expiration handler simply ends the run and a separate auto-start handler creates a fresh run, those 12 minutes vanish.

**Governed by:** session lifecycle (block expiration with transition), data model (inherited fields on runs), invariant 6.

**Variation: tiny gaps.** If "Code Review" starts at 11:02 instead of 11:00, there is a 2-minute gap. The system should still attempt inheritance if the gap is within a configurable threshold (e.g. 5 minutes). Outside that threshold, the next event auto-starts fresh.

**Variation: events shorter than one focus period.** A 15-minute event with 25-minute focus config will never complete a full cycle. The run starts, produces one focus segment, and the block expires before the focus period ends. The segment is marked `interrupted` with actual duration = 15 minutes. No break segment is created. The inherited focus for the next event is 15 minutes. If there is no next event, the run simply ends.

### 2. Concurrent user edits while a session is running

**Why it's dangerous:** the user can interact with the calendar while a pomodoro session is active. Dragging, resizing, deleting, converting, or reconfiguring an event that owns the active run can invalidate assumptions the timer is relying on.

**Scenario: resize while running.** The user has a session active on "Study" 14:00-16:00. At 14:45, they drag the end edge to 15:00, shortening the event by an hour. The active run's block now expires in 15 minutes instead of 75. The system must re-evaluate the block boundary and schedule an earlier expiration. If the resize is not propagated to the timer, the session continues past the event boundary.

**Scenario: delete while running.** The user tries to delete the active event. For a past or in-progress event, the system must refuse and offer archive instead (invariant 7). If the event is future-only (no tracking data), it can be deleted, but this case cannot arise if a session is currently running on it.

**Scenario: convert away from pomodoro.** The user disables the pomodoro toggle on the active event. The system must stop the session (end the run with `end_reason=stopped`), save all segment data, and remove the rail rendering. Re-enabling pomodoro later starts a fresh session, no inheritance.

**Scenario: reconfigure while running.** The user changes focus duration from 25 to 40 minutes while in a focus phase at minute 18. The system must: end the current run (`end_reason=reconfigured`), create a new run with the new config, carry `inherited_focus_minutes=18` and `inherited_cycle` from the old run, and create a bridge focus segment with remaining time computed under the new config (40-18=22 minutes).

**Governed by:** session lifecycle (reconfiguration), event lifecycle (active events), invariant 6.

### 3. Crash, suspend, or kill at critical moments

**Why it's dangerous:** the app can die at any point, including mid-transaction. The heartbeat mechanism (updated every ~30 seconds) is the recovery signal, but the window between last heartbeat and actual crash can contain important state changes. Phase transitions, pause writes, and reconfigurations are particularly vulnerable because they involve multiple table writes.

**Scenario: crash during phase transition.** The focus phase ends at 14:25. The system needs to: (a) update the focus segment to `completed`, (b) create the break segment. If the app crashes after (a) but before (b), recovery finds a completed focus segment with no following break. The system should not retroactively insert a break; instead, the missing break is treated as a skipped break.

**Scenario: laptop suspend during focus.** The user closes the laptop at 14:20 during a focus phase that started at 14:00. The last heartbeat is at 14:20. The user opens the laptop at 16:00. Recovery detects: last heartbeat (14:20) is far behind the current time. The active segment's actual end is set to 14:20 (the last heartbeat), status becomes `interrupted`. The idle gap from 14:20 to 16:00 is empty rail (gray). The user sees a prompt to start a new session.

**Scenario: crash during pause write.** The user triggers a pause at 14:30. The system needs to insert a row into `pomodoro_pauses`. If it crashes before the write commits, recovery finds no pause record. The segment's green fill extends to the last heartbeat, which is correct (the user was focusing up to that point, the pause hadn't been saved). No data is fabricated.

**Governed by:** crash resilience, data model (heartbeat, pause rows), invariant 5.

### 4. Overlapping events, containment, and auto-start tiebreakers

**Why it's dangerous:** overlapping pomodoro events interact in two ways that compound each other. First, the timeline band algorithm must decide which event's schedule owns each time slot, handling nested containment hierarchies when three or more events stack. Second, when multiple events could auto-start simultaneously (same start time, or app opened mid-overlap), the system must deterministically pick one. If the containment logic and the auto-start logic use different priority rules, the rail shows one event's schedule while the timer runs on another.

**Scenario: triple stack.** "Work Block" 09:00-17:00, "Sprint" 10:00-15:00, "Quick Task" 11:00-11:30. All have pomodoro enabled. The containment algorithm must: identify "Quick Task" as contained in "Sprint", "Sprint" as contained in "Work Block". The rail shows: "Work Block"'s schedule from 09:00-10:00, "Sprint"'s from 10:00-11:00, "Quick Task"'s from 11:00-11:30, "Sprint"'s from 11:30-15:00, "Work Block"'s from 15:00-17:00. If any of these three has an active session, that session's event takes priority regardless of containment.

**Scenario: active session on the contained event.** The user starts a session on "Quick Task" at 11:00. At 11:15, the rail shows "Quick Task"'s green fill from 11:00-11:15, not "Sprint"'s or "Work Block"'s schedule. "Quick Task" owns that time slot even though it's the shortest event. When "Quick Task" ends at 11:30, "Sprint" reclaims the rail.

**Scenario: two events at 09:00.** "Morning Standup" (09:00-09:30) and "Deep Work" (09:00-12:00) both have pomodoro enabled and auto-start on. The user opens the app at 09:00. Tiebreaker: the shorter event wins (it's more time-sensitive). "Morning Standup" auto-starts. When it ends at 09:30, "Deep Work" auto-starts for its remaining window. If two events have the same duration, fall back to creation order (earliest `created_at` wins). This ensures determinism without requiring the user to manually prioritize.

**Scenario: app opened mid-overlap.** The user opens the app at 09:15. "Morning Standup" (09:00-09:30) and "Deep Work" (09:00-12:00) are both in progress. Neither has an active session. The same tiebreaker applies: "Morning Standup" (shorter remaining duration) auto-starts if auto-start is enabled. If the user already had a session on "Deep Work" that was interrupted, the interrupted session takes priority (the user's last intent matters).

**Governed by:** timeline band computation (5-step algorithm), overlapping events, session lifecycle (auto-start).

### 5. DST transitions and timezone boundary cases

**Why it's dangerous:** all timestamps are stored in UTC, but the user sees local time. A DST transition can make a 60-minute event appear as 0 minutes or 120 minutes in local time. The 2 AM hour can repeat (fall back) or vanish (spring forward).

**Scenario: spring forward.** The user has an event from 01:30 to 03:30 local time. At 02:00, clocks jump to 03:00. In UTC, the event is still 2 hours. In the user's display, it looks like a 1-hour event (01:30-02:00, then 03:00-03:30). The rail must render based on UTC duration (2 hours of rail space), not local-time appearance. The pixel mapping uses UTC elapsed time.

**Scenario: fall back.** The user has an event from 01:00 to 03:00. At 02:00, clocks fall back to 01:00. The UTC duration is still 2 hours. The display might show 01:00-01:00-02:00-03:00 (the 01:00-02:00 hour appears twice). The rail must not duplicate bands for the repeated hour. UTC is the authority.

**Scenario: user travels.** The user creates an event in EST, flies to PST during the day. The event times are stored in UTC. The display shifts by 3 hours, but the data is intact. No recalculation needed.

**Assumption: the system clock is reasonably accurate.** UTC protects against timezone and DST issues, but all timestamps ultimately come from the OS clock. If the clock jumps (NTP correction after boot with a dead CMOS battery, VM resume drift, dual-boot clock mismatch), timestamps within an active session can become logically inconsistent (e.g. a heartbeat before the previous one). This does not corrupt the database at the SQLite level, but it produces bad data for that session. The system does not defend against this because the scenarios are rare, the drift is usually small, and reliable countermeasures (monotonic clocks) do not survive reboots. If a user notices wrong session data, a clock issue is the likely cause.

**Governed by:** data model (UTC timestamps), all rendering logic.

### 6. Sub-second and rapid-succession actions

**Why it's dangerous:** users can click quickly. Debouncing and idempotency guards must prevent duplicate runs, duplicate segments, or corrupted state.

**Scenario: double-click start.** The user double-clicks the "Start" button. Two `startSession` calls fire within 50ms. Without a guard, two runs are created on the same event. The system must check for an existing active run before creating a new one. If a run exists, the second call is a no-op.

**Scenario: rapid skip-skip.** The user presses "Skip Break" twice quickly during a break phase. The first skip ends the break segment and creates the next focus segment. The second skip finds no active break, so it's a no-op. The guard is: "skip break" only operates on an active break segment.

**Scenario: start-stop-start.** The user starts, immediately stops, then immediately starts again. Each action must fully commit before the next begins. After start-stop, the first run is closed (`end_reason=stopped`). The second start creates a fresh run with no inheritance (stop breaks concentration). If the stop hasn't committed when the second start arrives, the start must wait or fail gracefully.

**Governed by:** session lifecycle (all transitions), invariant 2.

### 7. Multiple runs on the same event

**Why it's dangerous:** a single calendar event can accumulate many runs across its lifetime (stop/restart, reconfigurations, crash recovery). Analytics queries that assume one run per event will produce wrong results. The rail rendering must stitch all runs together into a coherent visual.

**Scenario: four runs on one event.** "Deep Work" 09:00-13:00. The user starts at 09:00, stops at 10:30 (run 1, `stopped`). Starts again at 10:45 (run 2, fresh, no inheritance). App crashes at 11:20 (run 2, `interrupted`). Opens app at 11:40, starts again (run 3, fresh). Changes config at 12:00 (run 3 ends `reconfigured`, run 4 starts with inheritance). The rail shows: green 09:00-10:30 (run 1's segments), empty 10:30-10:45, green 10:45-11:20 (run 2's segments up to heartbeat), empty 11:20-11:40, green from 11:40 onward (runs 3 and 4's segments). Break marks come from each run's own config and schedule. All four runs share the same `event_id` and `event_date`.

**Governed by:** data model (runs table, segments by run_id), rail rendering, timeline band computation.

### 8. Pause edge cases

**Why it's dangerous:** pauses create holes in the green fill within a segment. Multiple pauses, pauses at phase boundaries, and zero-green segments are all valid states that rendering and analytics must handle.

**Scenario: multiple pauses in one segment.** Focus from 14:00-14:25. The user pauses at 14:05-14:08, again at 14:15-14:18. Total pause time: 6 minutes. Green fill: 14:00-14:05, 14:08-14:15, 14:18-14:25. The focus timer counts 19 minutes of actual focus. Each pause is its own row in `pomodoro_pauses`.

**Scenario: pause at phase boundary.** The user pauses at 14:24 during a focus phase that ends at 14:25. The pause is still within the focus segment. When the timer reaches 14:25 (or when the user resumes, whichever is later), the focus segment ends and the break begins. The pause does not extend the focus segment's planned end, but it does mean the user only focused for 24 minutes instead of 25. The actual end of the segment is when the phase transitions, not when the planned duration elapses.

**Scenario: zero-green segment.** The user starts a focus, immediately pauses, stays paused for the entire focus duration. The segment has `actualStart`, `actualEnd`, status `completed` (the timer ran out), but every second was paused. Green fill for this segment: nothing. The segment exists in the data model but produces no green on the rail. This is correct.

**Scenario: idle detection triggers pause.** The user stops interacting. After `idle_timeout_minutes`, the system inserts a pause starting at `idle_timeout_minutes` ago (the estimated moment the user became idle). If this retroactive start overlaps with previously rendered green, the green is shortened. The pause row's `started_at` is in the past, not at the detection moment.

**Governed by:** data model (pause rows), rail rendering (green fill rules), session lifecycle (pauses).

### 9. Reconfiguration chain integrity

**Why it's dangerous:** each reconfiguration ends one run and creates another with inherited state. A chain of reconfigurations (user changes config multiple times) creates a chain of runs. If any link in the chain miscalculates inherited values, every subsequent run's plan derivation is wrong.

**Scenario: triple reconfiguration.** Run 1: config 25/5/15, starts at 14:00, 18 minutes of focus done. User changes to 40/5/15 at 14:18. Run 2: `inherited_focus_minutes=18`, bridge focus has 22 minutes remaining. At 14:30, user changes to 30/5/15 (12 minutes into the bridge focus of run 2, so total focus = 18+12=30). Run 3: `inherited_focus_minutes=30`. Since 30 >= 30, run 3 starts with a break. If run 2 had miscalculated its inherited focus (e.g. forgot to add run 1's 18 minutes), run 3 would incorrectly start with focus instead of break.

**Key rule:** `inherited_focus_minutes` on the new run = focus already accumulated in the ending run's current cycle (including any focus inherited by the ending run itself). It is cumulative, not just the delta from the last run.

**Governed by:** data model (inherited fields), session lifecycle (reconfiguration), plan derivation.

## Overview

When a calendar event has pomodoro enabled, a thin vertical rail appears on the left edge of the day column in the **daily and weekly views** (not the monthly view). This rail visualizes the user's focus progress for the day.

The rail has exactly three visual states:

- **Filled (green)**: the user was actively focusing. Confirmed by a running timer with actual recorded start and end times.
- **Break (gray, prominent)**: a break period, whether upcoming, in progress, or already taken.
- **Empty (gray, faint rail background)**: no recorded activity. This could be because the event hasn't started yet, the user wasn't present, the user was idle/paused, or no session was ever started for that time window.

These are the only three colors. There are no sub-variations, no opacity gradients per status, no visual distinction between a completed break and a planned break. A break mark looks the same whether it already happened or is coming up. Simplicity here is intentional: the rail is 6px wide, nuance is invisible, and what matters is whether the data underneath is correct for stats and productivity tracking.

The rail is per-day-column, not per-event. Overlapping pomodoro events merge into a single contiguous rail, and the system decides which event's schedule takes priority at each point in time.

### Design philosophy

The tracking system exists to serve two equally important purposes:

1. **Real-time visual feedback.** The rail gives the user an immediate, glanceable picture of their day: where they worked, where they rested, and what's ahead.
2. **Historical data for AI-driven optimization.** The data model is designed so that an AI can analyze focus patterns, break adherence, idle behavior, and config effectiveness across weeks and months. This powers accurate task estimates, intelligent config recommendations, A/B testing of focus strategies, and eventually gamification.

Both purposes demand accurate, honest data. The system never fabricates focus time, never hides gaps, and never lets the user retroactively erase evidence of what happened. The user should feel that the app helps them understand and improve their habits, not that it judges them.

## Invariants

These must always hold. Any violation is a bug in the computation, not something the UI should mask.

1. **Green never appears after the current time.** A focus fill band can only exist for a segment with an `actualStart` in the past and real recorded work. If the system ever produces green beyond the current moment, the segment data or projection logic is wrong.

2. **Exactly one segment is `active` at a time.** Multiple active segments would mean the timer is running two things simultaneously.

3. **Break positions are stable within a session.** For a running session, break positions are deterministic from the run's `started_at`, config snapshot, and inherited state (`inherited_focus_minutes`, `inherited_cycle`). They do not shift while the session is active. For events without an active session, projected breaks are computed from "now" and naturally shift as time passes (this is intentional, see "Projected breaks" under rail rendering).

4. **No duplicate bands in the same time range.** The rail shows one coherent schedule at any point in time. Two overlapping events must never both contribute bands to the same minute range.

5. **Persisted data is the source of truth for the past.** The rail renders past time from segment records, never from re-computation of what "should have happened." If a session was interrupted, the green fill stops where it stopped. If a break was skipped, no break band appears for that slot. Future time is rendered from config-based projections derived from the run's `started_at`, config snapshot, and inherited state. The planned schedule is never stored as separate rows because it is fully deterministic from these fields (see "Why plan is not stored as rows" under data model).

6. **Past progress is never erased.** Once a segment has `actualStart` set and its status is `completed` or `interrupted`, no user action may delete, overwrite, or hide it. Skipping a break, stopping the session, dismissing the idle overlay, reconfiguring pomodoro settings, the app closing unexpectedly, or archiving the calendar event: none of these remove previously recorded work. There is no mechanism to delete individual segments. They are an append-mostly historical record.

7. **Past events are never deleted.** A calendar event whose end time is in the past can only be archived, never deleted. This applies regardless of whether the event has tracking data. An event where the user planned to focus but never opened the app is still valuable data: the absence of work on a planned block is a procrastination pattern the system can learn from. Only future events (start time entirely in the future, no tracking data) can be truly deleted.

## Data model

The tracking system uses three tables: `pomodoro_runs`, `pomodoro_segments`, and `pomodoro_pauses`. Together they record every session from start to finish with enough resolution for both real-time rendering and long-term analytics.

All timestamps in all three tables are stored in UTC (ISO 8601 with `Z` suffix). The UI converts to local time for display. This prevents data corruption from timezone changes, DST transitions, or user travel.

### Runs

A run represents one continuous session of pomodoro work. It is created when the timer starts and closed when the session ends. The run stores a config snapshot so that historical analysis can always correlate outcomes with the exact settings that produced them, even if the user later changes their config.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `event_id` | UUID or null | FK to `calendar_events` (SET NULL on delete). Null after the event is archived or deleted |
| `original_event_id` | UUID | The event ID at the time the run was created. Not a FK, just a value. Used to join to `calendar_events_archive` for analytics |
| `event_date` | `YYYY-MM-DD` | The calendar day this run belongs to |
| `user_id` | UUID | Identifies the user. Defaults to a local UUID in single-user mode. Required for future multi-user support |
| `started_at` | ISO datetime | When the session started |
| `ended_at` | ISO datetime or null | When the session ended. Null if still running |
| `end_reason` | enum or null | Why the run ended: `completed` (event time expired), `stopped` (user stopped manually), `interrupted` (app crash, process killed), `reconfigured` (settings changed mid-session), `block_transition` (timer moved to a different event). Null if still running |
| `focus_duration_minutes` | integer | Config snapshot: focus period length at the time of this run |
| `short_break_minutes` | integer | Config snapshot: short break length |
| `long_break_minutes` | integer | Config snapshot: long break length |
| `pomodoro_count` | integer | Config snapshot: cycles before long break |
| `idle_timeout_minutes` | integer or null | Config snapshot: idle threshold (null = disabled) |
| `last_heartbeat` | ISO datetime | Updated every ~30 seconds while the session is active. Used for crash recovery to determine the true end time |
| `event_title_snapshot` | text or null | The event's title at the time of the run. Preserved for analytics context after event archival |
| `inherited_focus_minutes` | integer | Focus minutes accumulated in the current cycle, carried from the preceding run. 0 for fresh sessions. Non-zero when created by block transition or reconfiguration, reflecting how much focus was done before the handoff. Combined with the config snapshot, this determines whether the first phase is focus (remaining) or break (threshold exceeded) |
| `inherited_cycle` | integer | Cycle number carried from the preceding run. 1 for fresh sessions. Determines whether the next break is short or long |
| `inherited_from_run_id` | UUID or null | FK to `pomodoro_runs`. The run from which state was inherited. Null for fresh sessions. Enables tracing transition chains in analytics |
| `experiment_id` | text or null | For A/B testing: which experiment this run belongs to |
| `variant` | text or null | For A/B testing: which variant was assigned |
| `created_at` | ISO datetime | Row creation time |

Config may be set per-event or inherited from project defaults. Regardless of where it originated, the run's config snapshot records exactly what was in force during that session. This makes A/B testing of configs straightforward: the system assigns a variant, the config snapshot captures it, and outcomes are measured from the run's segments.

#### Why plan is not stored as rows

Given a run's `started_at`, config snapshot, and inherited state (`inherited_focus_minutes`, `inherited_cycle`), the ideal planned schedule is fully deterministic:

- If `inherited_focus_minutes >= focus_duration_minutes`: the first phase is a break (short or long, determined by `inherited_cycle` vs `pomodoro_count`).
- If `inherited_focus_minutes > 0` but below the threshold: the first phase is focus, lasting `focus_duration_minutes - inherited_focus_minutes` minutes.
- If `inherited_focus_minutes == 0`: the first phase is a full-length focus period.
- After the first phase, standard cycle rules apply using the run's config.

This covers all run origins:

- **Fresh session** (`new_session`): inherited values are 0 and 1, so the first phase is full-length focus at cycle 1. This includes restarts after a stop (concentration is assumed broken).
- **Block transition**: inherited values carry the ending run's cycle position and accumulated focus. Example: run A (40/5/10, cycle 2) ends after 30 minutes of focus. Run B (25/5/15) starts with `inherited_focus_minutes=30`, `inherited_cycle=2`. Since 30 >= 25, B starts with a short break (cycle 2 < pomodoro_count), then proceeds with 25-minute focus cycles.
- **Reconfiguration**: inherited values carry the position within the reconfigured run. The bridge segment (same phase as the interrupted one, with remaining time from the old config) is the first actual segment of the new run, not a stored plan.

**Inherited focus during a break phase:** if a transition or reconfiguration happens while the user is on a break, `inherited_focus_minutes` is 0. The break already "resolved" the accumulated focus. The `inherited_cycle` carries the current cycle number. After the bridge break (if reconfiguring) or the immediate break (if transitioning), the next focus starts fresh at the new config's full duration.

Without `inherited_focus_minutes` and `inherited_cycle`, reconstructing the plan for transition and reconfiguration runs would require traversing the chain of previous runs and their segments, which is fragile (previous runs might reference archived events) and slow (unbounded chain length). Capturing the inherited state on the run itself makes each run self-contained.

Storing planned positions as separate rows would duplicate information derivable from these fields and create a synchronization problem: every transition or reconfiguration would have to update both the inherited fields and the planned rows, with the risk of them diverging.

Actual segments store what really happened. Comparing actuals to the derived ideal gives plan-vs-actual analysis: breaks shorter or longer than planned, focus extended or cut short, breaks skipped (detectable as missing break rows between consecutive focus segments).

**Example: plan-vs-actual for a single run.** A run starts at 14:00 with config 25/5/15, pomodoro_count=4, inherited values 0/1. The derived ideal plan is: focus 14:00-14:25, short break 14:25-14:30, focus 14:30-14:55, short break 14:55-15:00, and so on. The actual segments show: focus 14:00-14:25 (completed), no break segment (skipped), focus 14:25-14:52 (completed, 27 min instead of 25), short break 14:52-14:54 (completed, 2 min instead of 5). Analytics can compute: break 1 was skipped, focus 2 ran 2 minutes over plan, break 2 was 3 minutes shorter than planned. All derived from the run's config vs the segment timestamps, no stored plan needed.

### Segments

A segment is one uninterrupted stretch of either focus or break. A segment row is only created when its phase begins. The first focus segment is written when the session starts. The next segment (break or focus) is written only when the previous one ends and the next phase actually begins. A phase that never ran has no row.

If a break is skipped, no row is created for it. The skip is recorded as the absence of a break segment between two consecutive focus segments on the same run. Analytics detect skips from this gap pattern.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `run_id` | UUID | FK to `pomodoro_runs` (CASCADE delete) |
| `cycle_number` | integer | Which pomodoro cycle (1 to `pomodoroCount`) |
| `phase` | `focus`, `short_break`, `long_break` | What kind of segment |
| `planned_start` | ISO datetime | When the segment was scheduled to begin |
| `planned_end` | ISO datetime | When the segment was scheduled to end |
| `actual_start` | ISO datetime | When the segment actually started. Always set (rows only exist for phases that began) |
| `actual_end` | ISO datetime or null | When the segment ended. Null if still running |
| `status` | see below | Lifecycle state |
| `created_at` | ISO datetime | Row creation time |

`actual_start` is never null. A row existing implies the phase ran.

### Segment statuses

| Status | Meaning |
|--------|---------|
| `active` | Currently running (exactly one at a time globally) |
| `completed` | Finished normally (timer reached zero, user acknowledged break end) |
| `interrupted` | Started but cut short (app closed, session stopped, event time expired mid-segment) |

There are no `planned` or `skipped` statuses. Since a row is only written when the phase begins, a phase that never ran has no row. A break that was skipped is detectable from the gap between consecutive focus segments on the same run.

### Pauses

Each pause within a segment is its own row. This makes pauses individually queryable for analytics (e.g. "average idle duration by time of day across 6 months"), crash-safe (a crash leaves a row with `ended_at = NULL`, trivially fixable with a single UPDATE), and atomic (each write is one row, no multi-field serialization).

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `segment_id` | UUID | FK to `pomodoro_segments` (CASCADE delete) |
| `started_at` | ISO datetime | When the pause began |
| `ended_at` | ISO datetime or null | When the pause ended. Null if still paused |
| `reason` | `idle`, `suspend`, `manual` | Why the pause happened. `idle`: user was inactive beyond threshold. `suspend`: system sleep or tick gap > 15s. `manual`: user explicitly paused |
| `created_at` | ISO datetime | Row creation time |

### Pomodoro config (per-event)

| Field | Default | Description |
|-------|---------|-------------|
| `focusDurationMinutes` | 40 | Focus period length |
| `shortBreakMinutes` | 5 | Short break length |
| `longBreakMinutes` | 10 | Long break after N cycles |
| `pomodoroCount` | 4 | Cycles before a long break |
| `idleTimeoutMinutes` | null | Auto-pause threshold (null = disabled) |

Presets: automatic (40/5/10), deep focus (40/5/10), creative (25/5/15), extended (50/10/10), custom.

### Why pauses are rows, not JSON

Storing pauses as a JSON array inside the segment row (`[[startIso, endIsoOrNull], ...]`) would cause three problems:

1. **Crash recovery becomes fragile.** Closing open pauses in a JSON blob requires string manipulation in SQL (e.g. `REPLACE(..., 'null]', ...)`), which can corrupt data when multiple intervals exist or formatting varies. Individual rows need only `UPDATE WHERE ended_at IS NULL`.
2. **Analytics require JSON parsing.** Querying "average idle duration by time of day" means parsing JSON in every row. With individual rows, standard SQL aggregation applies directly.
3. **Writes are not atomic.** Updating a JSON pause means reading the full blob, deserializing, appending, re-serializing, and writing back. A crash during this sequence can produce corrupted JSON. A single row INSERT is atomic.

### Deprecated: pomodoro_sessions table

A `pomodoro_sessions` table exists in the current codebase, storing one row per completed focus period with `focus_score`, `app_switch_count`, `break_extended`. This table predates the segment-based model and should be deprecated. `focus_score` is derivable from segment and pause data. `app_switch_count` could become a field on segments or runs if the metric proves useful.

## Event lifecycle

### Past events (archive only)

An event whose end time is in the past can only be archived, never deleted. This is true regardless of whether the event has any tracking data. The user not showing up for a planned focus block is itself data worth preserving.

When a past event is archived:
1. The full event row is copied to `calendar_events_archive` (same schema plus `archived_at` timestamp).
2. The event is deleted from `calendar_events`.
3. The FK on `pomodoro_runs` uses SET NULL, so `event_id` becomes null. The `original_event_id` field (not a FK) preserves the link for analytics joins.
4. The `event_title_snapshot` on each run provides basic context without needing a join.

The calendar UI never queries `calendar_events_archive`. Archived events simply disappear from the calendar. Analytics and stats views can join to the archive table via `original_event_id` when full event context is needed.

### Active events

An event whose time window includes the current time cannot be deleted or archived while a session is running on it. The user must stop the session first. Stopping an active session follows the session stop procedure (see "Session stop and restart").

Once the session is stopped, the event still appears on the calendar for the remainder of its time window. It can be archived after its end time passes (it becomes a past event).

If the user edits the event's end time to be in the past while a session is running, the session is stopped as if the block expired (with transition-at-expiration check for consecutive events).

If the user edits the event's start time to be after the session's `started_at` while a session is running, this is a no-op for the running session. The session already started, segments already exist. The event's new start time only affects future rendering of the rail background.

### Future events

An event whose start time is entirely in the future and which has no tracking data (no runs, no segments) can be truly deleted. This is a normal calendar operation with no data preservation concerns.

### Recurring events

Recurring events are expanded from a template. Each instance gets a synthetic ID (`templateId::YYYY-MM-DD`). The template itself is also a valid first occurrence (using the base `templateId` without a date suffix). Each instance gets its own runs and segments, independent of other instances. There is no inheritance of pomodoro state across instances: Monday's session ending mid-cycle does not carry over to Tuesday. Each instance starts fresh.

#### Structural operations

Three operations change the structure of a recurring series. All of them can affect how past instances expand, how active sessions continue, and where run references point.

**Detach ("edit this").** A single instance is pulled out of the series into a standalone event with a new UUID. The template gains an exception for that date so the instance no longer expands from the rule. All runs whose `event_id` matches the synthetic ID (`templateId::date`) must have their `event_id` and `original_event_id` updated to the new standalone UUID. The standalone has no recurrence config.

**Example:** "Daily standup" recurs every weekday. The user edits Wednesday's instance with scope "this," changing the title to "Retro." Wednesday is detached: a new standalone event "Retro" is created. The template gains an exception for Wednesday's date. Any runs recorded on that Wednesday are transferred to the standalone's UUID. Thursday's instance continues expanding normally from the template.

**Split ("edit/delete following").** The template is capped with an UNTIL date (the day before the selected instance). A new template is created from the selected instance onward with the updated properties and a fresh recurrence config. Runs on past instances still reference the old template (which still exists, just capped). Runs on future instances will reference the new template's synthetic IDs.

**Example:** "Study session" recurs daily. The user selects Thursday and edits with scope "following," changing the time from 09:00 to 10:00. The old template gets UNTIL = Wednesday. A new template is created starting Thursday with the 10:00 time and the same recurrence rule. Monday through Wednesday's runs still reference the old template. Thursday onward generates instances from the new template.

**Template-wide edit ("edit all").** The template's properties are updated directly. Past instances that already expanded will now expand with the new properties. This creates a tension with data preservation (see below).

#### Invariant 7 enforcement for recurrence changes

Five operations can cause past instances to silently stop expanding from a recurring template:

1. Adding an exception for a past date
2. Moving UNTIL to before existing past instances
3. Reducing the occurrence count below the number of past instances
4. Changing the recurrence pattern so a past date no longer matches (e.g. "every weekday" to "every Monday" removes past Tuesday through Friday instances)
5. Removing recurrence entirely with scope "all"

Each of these violates invariant 7: a past instance disappears, and with it any tracking data (or the equally valuable absence of tracking data). The enforcement rule:

**Before any recurrence change takes effect, the system must identify every past instance that would stop expanding under the new configuration and detach each one into a standalone event first.** This means creating a standalone event for each affected date and transferring any run references. Only after all past instances are preserved does the recurrence change apply.

**Example: pattern change.** "Exercise" recurs every weekday (Mon-Fri). The user changes it to "every Monday" with scope "all." Before applying, the system computes which past dates matched the old pattern but not the new one. Past Tuesdays, Wednesdays, Thursdays, and Fridays would vanish. Each is detached into a standalone event. Runs on those dates (if any) are transferred. Dates with no runs still get a standalone event (the absence of work is data). Then the template's pattern is updated to "every Monday."

**Example: UNTIL moved backward.** "Morning routine" recurs daily, no end date. The user sets "end after April 5" with scope "all." Today is April 11. Instances from April 6 through April 10 are in the past and would stop expanding. Each is detached before the UNTIL is applied.

**Example: recurrence removed.** "Weekly review" recurs every Friday. The user removes recurrence with scope "all." Every past Friday instance is detached into a standalone event. The template becomes a non-recurring event (the original Friday). Future Fridays stop expanding.

This detach-before-change approach is expensive for series with many past instances. To keep it tractable: the system only needs to detach past instances within a reasonable historical window (e.g. the past 6 months, matching the expansion horizon). Instances beyond that window that were never expanded don't need detaching because they never generated visible events or tracking opportunities.

#### Active session during recurrence edits

When the user edits a recurring event's recurrence settings while a session is running on one of its instances, the active session must survive regardless of the scope or the nature of the change.

**Scope "this":** the active instance is detached into a standalone. The session transfers to the standalone's UUID. The recurrence change doesn't apply to it (it's no longer part of the series). This is the simplest case.

**Scope "following":** the series splits. If the active instance is at the split point, the split moves to the next day (the active instance stays on the old template, which is capped at today). The session continues uninterrupted. If the active instance is before the split point, it's unaffected.

**Scope "all":** the system must:
1. Detach all past instances that would vanish (invariant 7, as above).
2. Detach today's active instance into a standalone. The session transfers to the standalone.
3. Apply the recurrence change to the template.
4. The session continues on the standalone. When it ends, it does not transition to the next recurring instance (the standalone is independent).

**Example: removing recurrence while active.** "Daily focus" recurs every day. The user is mid-session on today's instance. They remove recurrence with scope "all." Past instances are detached. Today's instance is detached, session transfers to the standalone. The template becomes non-recurring (the original date). Future daily instances stop expanding. The active session finishes normally on the standalone.

**Example: changing pattern while active.** "Study" recurs Mon/Wed/Fri. Today is Wednesday, session is active. The user changes to "Mon/Thu" with scope "all." Wednesday is no longer in the new pattern, so today's instance would vanish. The system detaches today's instance first (session transfers), detaches past Wednesdays and Fridays, then applies the pattern change. The session continues on the standalone Wednesday.

**Example: adding recurrence to an active non-recurring event.** The user has "Project work" 14:00-16:00 with a running session. They add "repeat daily." The event becomes a template. The active run's `event_id` is the base UUID (the template ID), which is also the first occurrence. Tomorrow's instance will be `UUID::2026-04-12`. The session continues because the template's base ID is still a valid first occurrence. Code must not assume all recurring instances have `::date` suffixes; the template's own occurrence uses the base UUID.

#### Run reference integrity

After any structural operation, runs must point to valid, resolvable event IDs:

| Operation | What happens to run `event_id` |
|-----------|-------------------------------|
| Detach instance | Updated from `templateId::date` to the standalone's new UUID |
| Split series | Runs on old dates keep `templateId::date` (old template still exists, capped). Runs on new dates will reference `newTemplateId::date` |
| Delete template (future-only, no past instances) | Runs are deleted via CASCADE (no past data exists to preserve) |
| Archive template | `event_id` becomes null via SET NULL. `original_event_id` preserves the link |
| Add recurrence to existing event | Existing runs keep the base UUID. Future instance runs will use `UUID::date`. Both are valid |
| Remove recurrence (scope "all") | Past instances detached first (runs transferred). Template becomes non-recurring. Remaining runs on the base UUID are valid |

**The synthetic ID contract:** code that resolves an `event_id` on a run must handle three formats:
1. A plain UUID (non-recurring event, or the first occurrence of a template)
2. A synthetic `UUID::date` (recurring instance that still expands)
3. A null (archived event, join to `calendar_events_archive` via `original_event_id`)

If a synthetic ID no longer expands (e.g. after an UNTIL cap removed the instance, but detach failed or was skipped), the run is an orphan. Analytics should surface orphaned runs as a data integrity warning, not silently ignore them.

#### Time-shift disconnect

When a scope "all" edit changes the event's time (e.g. 09:00-10:00 becomes 14:00-15:00), past instances re-expand at the new time. But any runs recorded on those instances have segments with timestamps at the old time. The rail would show the event block at 14:00 but green fill at 09:00, outside the visible block.

The solution is the same as invariant 7 enforcement: past instances are detached before the time change applies. The standalone events preserve the original time. Only future instances get the new time.

**Example:** "Morning meeting" recurs daily at 09:00-09:30. The user changes it to 14:00-14:30 with scope "all." Past instances are detached at their original 09:00-09:30 time. The template updates to 14:00-14:30. Future instances expand at the new time. Past standalone events keep 09:00-09:30, and their runs align correctly.

This is not an additional rule. It's a natural consequence of the "detach past instances before any change" approach. If past instances are always detached before template-wide edits, their time, pattern, and config are frozen at the point of detachment.

## Enforcement of past-event protection

Invariant 7 (past events are never deleted) must be enforced at every programmatic boundary. The user owns their data files and can modify SQLite directly; GanbaruAI does not attempt to prevent that. But every code path within the system must refuse to delete past events.

### UI

No delete button or option is shown for events whose end time is in the past. The only available action is archive.

### CLI (`ganbaruai` command-line tool)

The CLI rejects delete commands for past events with a descriptive error explaining the archive-only policy and offering the archive command as an alternative. The rejection is logged with timestamp, command, and event ID.

### MCP tools (for external AI clients)

MCP handlers for event management refuse delete operations on past events at the handler level, returning a structured error with the reason. The response includes the alternative (archive) so the AI client can adjust.

### Internal APIs (Tauri commands, database layer)

All internal DELETE queries on `calendar_events` include a guard: the deletion proceeds only if `end_time > now()`. If the guard fails, the operation is rejected and logged. This is the last-resort protection in case a higher layer has a bug.

### AI agent integration

When agents interact with GanbaruAI (via CLI, MCP, or any future bridge), the system prompt or tool descriptions must communicate the policy clearly: past events can only be archived, not deleted. If an agent attempts deletion and is rejected, the error response includes enough context for the agent to understand why and adapt its behavior. Repeated rejection attempts are logged for diagnostic purposes (the agent may have a flawed understanding of the data model).

## Session lifecycle

### Auto-start

When the app opens (or every 30 seconds, or when calendar events change), the system looks for pomodoro events where the current time falls within the event window. Selection priority:

1. Keep the event the pomodoro is already running on, if still in window.
2. Otherwise pick the event with the most remaining time.

The selected event triggers a state machine decision:

| Decision | When | Effect |
|----------|------|--------|
| `noop` | Same block, same config, same end | Nothing |
| `update_end_only` | Same block, end time changed | Update stored end time |
| `reconfigure` | Same block, config changed | End current run (`reconfigured`), start new run with new config |
| `transition` | Different block | End current run (`block_transition`), start new run on new block |
| `new_session` | No existing session | Create new run, start first focus segment |

### Session start and segment creation

When a new session starts:

1. Create a new `pomodoro_runs` row with config snapshot, `started_at = now`, `last_heartbeat = now`.
2. Create the first segment: `phase = focus`, `status = active`, `actual_start = now`, `planned_start = now`, `planned_end = now + focusDurationMinutes`.
3. No other segments are created yet. Future phases are computed on-the-fly for rail rendering. The next segment is written only when the current one finishes and the next phase begins.

Sessions always start from the current time, never from the event's calendar start time. If the event was scheduled for 17:00 but the app opens at 18:15, the session covers 18:15 onward.

The first phase is always a full-length focus period. Even if the user is restarting after a stop (see "Session stop and restart"), the focus timer begins at the full configured duration because concentration is assumed broken.

### Timer tick

Every second, the system checks in priority order:

1. **Suspend detected** (tick gap > 15s): create a pause row (`reason = suspend`), show suspend dialog.
2. **Block expired** (event end time reached): check for a consecutive or overlapping event that starts at or before the expiring event's end time. If one exists, perform a transition with inheritance (see "Block transitions"). If none exists, mark the current segment `interrupted` and end the run (`end_reason = completed`). This ensures continuous focus across consecutive events produces proper inheritance instead of losing accumulated state.

   **Example:** "Morning Focus" (09:00-11:00, 40/5) is followed immediately by "Afternoon Sprint" (11:00-13:00, 25/5). The user has been focused on Morning Focus since 10:35 (25 minutes of focus in cycle 3). At 11:00, block expiration fires. The system finds Afternoon Sprint starting at 11:00. Instead of ending and restarting fresh, it transitions: the new run on Afternoon Sprint gets `inherited_focus_minutes=25, inherited_cycle=3`. Since 25 >= 25 (Sprint's focus threshold), Afternoon Sprint starts with a short break. The user gets their well-deserved break without losing the 25 minutes of focus context.

   Without this transition-at-expiration check, the system would end Morning Focus, then auto-start would create a fresh session on Afternoon Sprint with `inherited_focus_minutes=0`. The user would face a new 25-minute focus period immediately after 25 minutes of unbroken work, missing the break they earned.
3. **Break finished** (break timer at 0): start overtime accumulation (max 30 min), alert every 60s.
4. **Focus finished** (focus timer at 0): advance to next phase (see "Phase transitions").
5. **Notification** (60s remaining in focus): show system notification.
6. **Normal countdown**: decrement remaining seconds.

Every ~30 seconds, update `last_heartbeat` on the current run. This is a lightweight single-row UPDATE, not a performance concern.

### Phase transitions

When focus ends:
- Mark the current focus segment `completed` (set `actual_end = now`).
- If `skipNextBreak` is set: create the next focus segment immediately (no break segment is created; the skip is recorded as the absence of a break segment between two focus segments).
- If `cycle >= pomodoroCount`: create a long break segment (`status = active`, `actual_start = now`). After it completes, reset cycle to 1.
- Otherwise: create a short break segment (`status = active`, `actual_start = now`). Increment cycle.

When break ends (user acknowledges or overtime expires):
- Mark the break segment `completed` (set `actual_end = now`).
- Create the next focus segment (`status = active`, `actual_start = now`, full focus duration).

Each transition closes any open pause (set `ended_at = now` on any pause row with `ended_at = NULL` for the current segment).

**Example: full cycle progression.** Config: 25/5/15 with pomodoro_count=4. The user starts at 09:00.

- 09:00: focus segment created (cycle 1, active). Timer shows 25:00.
- 09:25: focus completed. Cycle 1 < 4, so short break segment created (cycle 1, active). Timer shows 5:00.
- 09:30: break completed. Focus segment created (cycle 2, active). Timer shows 25:00.
- 09:55: focus completed. Short break (cycle 2). Timer shows 5:00.
- 10:00: break completed. Focus (cycle 3). Timer shows 25:00.
- 10:25: focus completed. Short break (cycle 3). Timer shows 5:00.
- 10:30: break completed. Focus (cycle 4). Timer shows 25:00.
- 10:55: focus completed. Cycle 4 = pomodoro_count, so long break segment created (cycle 4, active). Timer shows 15:00.
- 11:10: long break completed. Cycle resets to 1. Focus (cycle 1). Timer shows 25:00.

If at 09:25 the user had set `skipNextBreak`, no break segment would be created. The next focus segment would start immediately at 09:25 (cycle 2), and the database would show two consecutive focus segments with no break between them.

**Example: break overtime.** At 09:25, focus ends and the break screen appears. The user doesn't acknowledge it. At 09:30 (break timer hits 0), overtime starts. The break mark on the rail keeps growing. At 09:35 the user finally clicks "start focus." The break segment is marked completed with `actual_end = 09:35` (10 minutes total instead of the planned 5). If the user still hasn't acknowledged by 10:00 (30 minutes of overtime), the system auto-advances to focus.

### Session stop and restart

A session can stop for any reason: user stops manually, user dismisses the idle overlay and chooses to stop, app crash, or process termination.

When a session stops:
1. The current segment is marked `interrupted` with `actual_end` set (for manual stop, `actual_end = now`; for crash recovery, `actual_end = last_heartbeat`).
2. Any open pause on the current segment is closed.
3. The run is ended (`ended_at = now` or `last_heartbeat`, `end_reason` set appropriately).
4. No future segments need cleanup because they were never created.

After a stop, the event still exists on the calendar with time remaining. The rail shows preserved progress from the stopped session plus projected break marks for the remaining time (see "Projected breaks" under rail rendering). Auto-start fires every 30 seconds and will detect the event, creating a new session.

On restart (whether via auto-start or user action):
1. A new run is created with a fresh config snapshot.
2. The first segment is focus with full configured duration. The user's concentration is assumed broken by the interruption, so remaining time from the previous session is not carried over.
3. Break positions are computed fresh from the new start point.
4. The previous run's segments are untouched (invariant 6). The rail shows the old green fill alongside the new session's progress.

**Example: stop and restart.** The user has a "Deep Work" event from 14:00-17:00 with 25/5 config. They open the app at 14:10 and focus until 14:45, completing one full cycle (focus 14:10-14:35, break 14:35-14:40, focus 14:40-14:45 interrupted). At 14:45 the user gets a phone call and stops the session.

What the user sees on the rail at 14:50 (during the gap):
- Green fill from 14:10-14:35 (first focus, completed).
- Gray break mark at 14:35-14:40 (break, completed).
- Green fill from 14:40-14:45 (second focus, interrupted).
- Empty from 14:45-14:50 (gap, no session).
- Projected gray break marks from 14:50 onward, positioned as if restarting now with a full 25-minute focus: first break at ~15:15, second at ~15:45, etc. These marks shift as each second passes.

At 14:55, the phone call ends. Auto-start fires, detects the event still has time, creates a new run. The user sees:
- Same green and break marks as before (invariant 6, nothing erased).
- Empty gap from 14:45-14:55 (honest, the user wasn't working).
- The timer shows 25:00, not the 20 minutes that were remaining. Full restart.
- New break marks lock in at their current positions: first break at ~15:20.
- As the user works, green fill grows from 14:55 onward.

### Pauses

- **Idle detection** (focus only): the system checks user activity every 15 seconds. If idle beyond the configured threshold, a pause row is created (`reason = idle`, `ended_at = NULL`), the timer pauses, and an overlay is shown. On resume, the pause's `ended_at` is set.
- **Suspend detection** (any phase): a tick gap > 15 seconds triggers a pause row (`reason = suspend`, `started_at = suspendStartIso`, `ended_at = suspendEndIso`) and a resume dialog.
- **Manual pause**: user explicitly pauses the timer. A pause row is created (`reason = manual`, `ended_at = NULL`). On resume, `ended_at` is set.

**Example: idle pause and green fill splitting.** The user starts focus at 10:00 with a 5-minute idle threshold. They work until 10:15, then step away without pausing. At 10:20 (5 minutes idle), the system detects inactivity, creates a pause row (`started_at = 10:20, reason = idle`), pauses the timer, and shows the idle overlay. The user returns at 10:30 and clicks "resume." The pause row gets `ended_at = 10:30`.

On the rail, the green fill for this segment shows two bands: 10:00-10:20 (working) and 10:30 onward (working again). The 10:20-10:30 gap is empty (faint gray), honestly reflecting that the user was away. The timer resumes where it paused, so if 15 minutes were remaining at 10:20, the timer still shows 15 minutes at 10:30.

**Example: laptop suspend.** The user is focused at 11:00. They close their laptop at 11:10 (or the OS sleeps). The timer tick loop stops. When the laptop wakes at 11:40, the next tick fires and detects a 30-minute gap (>> 15s threshold). A pause row is created with `started_at = 11:10, ended_at = 11:40, reason = suspend`. The suspend dialog appears, asking the user what they want to do: resume (timer continues from where it was), or stop (session ends). If they resume, green shows 11:00-11:10 and 11:40 onward, with a gap for 11:10-11:40.

### Session reconfiguration

If the user changes pomodoro settings mid-session:

1. Read the current cycle number and accumulated focus minutes in the current cycle.
2. Mark the current segment `completed` with `actual_end = now`.
3. Close any open pause.
4. End the current run with `end_reason = reconfigured`.
5. Create a new run with the new config snapshot and:
   - `inherited_focus_minutes` = accumulated focus from step 1.
   - `inherited_cycle` = cycle number from step 1.
   - `inherited_from_run_id` = the ending run's ID.
6. Create a bridge segment: same phase as the interrupted one, with the remaining time from the old config preserved. After the bridge completes, the new config's cycle rules take over.
7. Previously completed/interrupted segments from the old run are untouched (invariant 6). The rail continues to show all accumulated green fill.

**Example: reconfiguration during focus.** The user is 28 minutes into a 40-minute focus (cycle 2, 25/5/10 "creative" preset). They decide the sessions are too long and switch to 25/5/15 "extended" preset. The system:
- Completes the current focus segment at minute 28.
- Ends the old run (`end_reason = reconfigured`).
- Creates a new run with config 25/5/15, `inherited_focus_minutes=28, inherited_cycle=2`.
- Creates a bridge focus segment with 12 minutes remaining (40 - 28 = 12 from the old config).
- After the bridge, the new config takes over: next break is a short break (cycle 2 < 4, using 5 min from new config), then focus periods are 25 minutes.

The user sees: no interruption in the green fill. The current focus continues for 12 more minutes, then the new 25/5 cadence kicks in. All previously completed segments remain.

**Example: reconfiguration during a break.** The user is 3 minutes into a 5-minute break (cycle 2). They switch config. The system:
- Completes the break segment at minute 3.
- Creates a new run with `inherited_focus_minutes=0` (the break resolved the accumulated focus), `inherited_cycle=2`.
- Creates a bridge break segment with 2 minutes remaining (5 - 3 = 2).
- After the bridge break, the new config starts a fresh focus at the new duration.

### Block transitions

When the timer transitions to a different (adjacent or overlapping) pomodoro event:

1. Read the current run's cycle number and accumulated focus minutes in the current cycle (time since last break or session start, excluding pauses).
2. Mark the current segment `completed` with `actual_end = now`. End the current run with `end_reason = block_transition`.
3. Create a new run for the new event with:
   - Config snapshot from the new event's pomodoro settings.
   - `inherited_focus_minutes` = accumulated focus from step 1.
   - `inherited_cycle` = cycle number from step 1.
   - `inherited_from_run_id` = the ending run's ID.
4. Determine the first phase using the inherited state and the new config:
   - If `inherited_focus_minutes >= focus_duration_minutes`: start with a break (short or long based on `inherited_cycle` vs `pomodoro_count`).
   - Otherwise: start with focus lasting `focus_duration_minutes - inherited_focus_minutes` minutes.

Example: event A (40/5/10) is on cycle 2 with 30 minutes of focus done. Event B (25/5/15) begins. The new run gets `inherited_focus_minutes=30`, `inherited_cycle=2`. Since 30 >= 25 and cycle 2 < 4, B starts with a short break (5 min per B's config), then a full 25-minute focus.

### App close and reopen

On startup:
1. Find any runs with `ended_at = NULL` (indicating a crash or unclean shutdown).
2. For each, set `ended_at = last_heartbeat` and `end_reason = interrupted`.
3. Find any segments with `status = active` on those runs. Set `status = interrupted`, `actual_end = run.last_heartbeat`.
4. Find any pauses with `ended_at = NULL`. Set `ended_at` to the parent segment's `actual_end`.
5. Look for current pomodoro events and start a fresh session via auto-start.

## Crash resilience

### Heartbeat

The `last_heartbeat` field on `pomodoro_runs` is updated every ~30 seconds while the session is active. If the app crashes at 14:30 and reopens at 17:00, the recovery procedure uses `last_heartbeat` (approximately 14:30) as the true end time, not the current time (17:00). Without this, a crash would produce phantom focus time for the entire gap.

### Recovery procedure

On startup, the system checks for unclean shutdowns by looking for runs with `ended_at = NULL`. For each:

1. Set `ended_at = last_heartbeat`, `end_reason = interrupted`.
2. Mark the active segment as `interrupted` with `actual_end = last_heartbeat`.
3. Close any open pauses with `ended_at = last_heartbeat`.

This is safe because:
- Each field update is an independent SQL UPDATE (atomic).
- Pauses are individual rows, not JSON blobs. No string surgery is needed to close an open pause.
- The worst-case data loss is ~30 seconds (one heartbeat interval).

**Example: crash recovery.** The user is focused on a "Study" event (09:00-12:00, 40/5 config). At 10:15, the power goes out. The last heartbeat was at 10:14:48.

The database contains:
- Run: `started_at = 09:05, ended_at = NULL, last_heartbeat = 10:14:48`.
- Active segment: `phase = focus, actual_start = 09:50, actual_end = NULL, status = active` (third focus period).
- Completed segments: focus 09:05-09:45, break 09:45-09:50 (from earlier in the session).

The user reopens the app at 14:00 (4 hours later). Recovery runs:
1. Run gets `ended_at = 10:14:48, end_reason = interrupted`.
2. Active segment gets `status = interrupted, actual_end = 10:14:48`.
3. Any open pauses get `ended_at = 10:14:48`.

The rail now shows: green 09:05-09:45, gray 09:45-09:50, green 09:50-10:15 (approximately, using heartbeat). Empty from 10:15 onward. The "Study" event ended at 12:00, so it's now a past event (archive only). No new session starts because the event is over.

Without the heartbeat, the system would have set `actual_end = 14:00`, showing 3 hours and 45 minutes of phantom green fill. The heartbeat limits the error to ~30 seconds.

See "Why pauses are rows, not JSON" under the data model section for the rationale behind this design.

### External tools reading the database

If an analytics script, CLI export, or backup tool reads the database while the app is not running (or after a crash), it may encounter dirty state: runs with `ended_at = NULL` and segments with `status = active`. External readers should treat any run where `ended_at IS NULL` and `last_heartbeat` is older than 60 seconds as a crashed session, and apply the same recovery logic (use `last_heartbeat` as the true end time) before computing analytics. The `ganbaruai` CLI should handle this automatically when exporting data.

## Rail rendering

### Where it appears

The rail appears in the **daily view** and **weekly view** only. The monthly view does not show the rail.

### Visual structure

The rail is a narrow vertical strip on the left edge of the day column. When multiple pomodoro events exist on the same day, their time ranges are merged (union of overlapping ranges) into contiguous rail containers.

### Three colors

The rail renders exactly three visual states, with no sub-variations:

| State | Color | When shown |
|-------|-------|------------|
| **Filled** | Green | Persisted focus segments covering only the time the user was actually working (paused intervals excluded). Always in the past relative to the current time. |
| **Break** | Gray (prominent) | Any break segment that actually ran (completed or active), plus projected future breaks. One uniform appearance regardless of whether the break is past, current, or projected. |
| **Empty** | Rail background (faint gray) | Everything else: future focus time, past time with no session, pause gaps, idle time. |

### Green fill rules

Green bands are rendered only when ALL of the following are true:
- The segment's phase is `focus`.
- The segment's status is `completed`, `interrupted`, or `active`.
- For the `active` segment, green extends from `actualStart` to now (not beyond).
- Paused intervals within the segment are excluded (green is split around pause gaps, read from the `pomodoro_pauses` table for that segment).

If any of these conditions are not met, no green is rendered for that time range.

### Break mark rules

Break bands come from two sources:

1. **Persisted break segments** (status `completed` or `active`): rendered from `actualStart` to `actualEnd` (or to now for active breaks). These represent breaks that actually happened.
2. **Projected breaks**: computed from the run's config and current cycle position for future time within the event window. These represent where breaks will occur if the session continues.

Breaks that were skipped have no segment row and produce no break band. This is correct: the user chose to skip, nothing happened there.

### Projected breaks (stopped but in window)

When a session has stopped but the event still has remaining time (no active session, event end time is in the future), the rail continues to show projected break marks for the remaining time. These are computed as if a new session were starting right now, with a full focus period followed by breaks per the event's config.

As time passes during the gap (before restart), these projected break positions shift because "now" changes. The projections are recomputed every ~30 seconds, aligned with the auto-start check cycle.

When the user restarts (via auto-start or manually), the projected breaks become the actual plan and lock in place.

**Why projected breaks are shown during a gap:** break marks are a visual incentive. They tell the user "it's not too late, you can keep going, your next break is right there." Removing break marks after a stop sends the message "your session is over, you failed, close the app." Showing them says "come back, it's not a big deal, just keep going." This is a deliberate product decision aligned with the anti-procrastination philosophy.

**Why projected breaks are not stored:** projected breaks during a gap are ephemeral. They shift every moment as "now" changes, and if the user never restarts, they never correspond to any run. Storing them would mean recording predictions for every possible restart time, which is unbounded data for zero analytical value. The gap itself (between the stopped run's `ended_at` and the next run's `started_at`) is fully preserved and analyzable from the runs table.

### Past overlay

A semi-transparent overlay covers the column from midnight to the current time. This naturally dims both green fills and break marks that are in the past. The overlay is behind the rail (lower z-index), so it affects everything.

## Timeline band computation

### How bands are produced

The system takes all pomodoro events for a given day and produces a flat list of bands (green fills + break marks) to render on the rail.

**Step 1: identify the active event.** If a session is running, note which event it belongs to. This event is exempt from containment filtering (step 2) and takes priority in all overlap situations.

**Step 2: filter contained events.** If event B is fully enclosed by event A (A starts at or before B, A ends at or after B, and A is longer), B is removed. Exception: the active event is never removed, even if fully enclosed. If the enclosed event is active, the enclosing event is suppressed in the overlap region instead. For events with identical time windows, the active event wins; if neither is active, the one created first is kept (creation timestamp as tiebreaker).

**Step 3: sort by start minute.**

**Step 4: note the active event's time range.** This is used to suppress projected bands from overlapping non-active events (invariant 4).

**Step 5: cursor walk.** Process events chronologically, tracking where the previous event's coverage ended and what the inherited focus/cycle state is. The inherited state for rendering follows the same derivation as the `inherited_focus_minutes` and `inherited_cycle` fields on runs (see "Why plan is not stored as rows").

For each event:

**If active** (timer running on this event):
- Render green fill from persisted focus segments (split around pauses).
- Render break marks from persisted break segments.
- Compute projected breaks for future time from the current cycle position and config.

**If not active, with persisted segments** (past session that ended):
- Render green fill and break marks from completed/interrupted segments.
- If the event still has remaining time, render projected breaks for future time (the "come back" incentive). These are computed as if restarting now with full focus duration.

**If not active, no persisted segments** (no session ever started):
- Compute projected breaks starting from `max(now, effectiveStart)`.
- Adjust for elapsed time since the event start so break positions align with the original schedule (invariant 3 applies here because no session has started to anchor positions differently).
- Emit break marks only (no green for events without sessions, by definition).
- Suppress any band that overlaps with the active event's time range (invariant 4).

After each event, compute trailing focus/cycle state for inheritance to the next event.

## Overlapping events

### Fully contained

If one event fully encloses another, the enclosed event is filtered out, unless the enclosed event has the active session. In that case, the enclosed event takes priority in the overlap region, and the enclosing event only contributes bands outside it. For events with identical time windows and no active session, the one created first takes priority.

**Example:** The user has a long "Work" block from 09:00-17:00 (40/5 config) and creates a shorter "Sprint" block from 14:00-15:00 (25/5 config) inside it. "Sprint" is fully contained in "Work."

- If neither has an active session: "Sprint" is filtered out. The rail shows break marks based on the 40/5 config across the whole day.
- If the user starts a session on "Sprint" at 14:00: "Sprint" takes priority from 14:00-15:00 (25/5 break marks). "Work" contributes break marks from 09:00-14:00 and 15:00-17:00 (40/5 break marks). The user sees the Sprint's faster break cadence during that hour.

### Partially overlapping (no active session)

The earlier-starting event takes priority for the overlapping portion. The later event only contributes bands after the earlier event ends.

**Example:** "Morning Focus" runs 09:00-11:00 (40/5) and "Team Project" runs 10:00-12:00 (25/5). They overlap from 10:00-11:00. No session is running. The rail shows: 40/5 break marks from 09:00-11:00 (Morning Focus takes priority for the entire overlap), then 25/5 break marks from 11:00-12:00 (Team Project takes over after Morning Focus ends).

### Partially overlapping (with active session)

The active session takes priority. Projected bands from all other overlapping events are suppressed for the active event's entire time range.

**Example:** Same events as above, but the user starts a session on "Team Project" at 10:15. Now Team Project is active from 10:00-12:00. Morning Focus's break marks from 10:00-11:00 are suppressed (they would conflict with Team Project's 25/5 cadence). The rail shows: 40/5 break marks from 09:00-10:00 (Morning Focus alone), green fill and 25/5 break marks from 10:15-12:00 (Team Project active), empty from 10:00-10:15 (overlap, but Team Project's session started at 10:15).

### Result for the user

The rail always shows one coherent schedule at any given time. Never a mix of two configs. The user never sees break marks from two different pomodoro settings in the same time slice.

## Edge cases

### App opened after event started

The session starts from now, not from the event's calendar start. The time between the event start and the session start has no green fill (the user wasn't working). Projected break marks for events without a session are positioned as if the schedule started at the event start (via elapsed-time adjustment), so the first visible break may be closer than a full focus period.

**Example:** The user scheduled a "Study" block from 14:00-16:00 with 25/5 config but didn't open the app until 14:40. Before the session starts, the rail shows projected breaks as if the pomodoro cycle had been running since 14:00: the first break would have been at 14:25-14:30 (already past), so the next visible break is at 14:50-14:55, only 10 minutes away. This gives the user an accurate picture of where they are in the cycle relative to the event's planned schedule.

When the session starts at 14:40, the run gets `inherited_focus_minutes = 0, inherited_cycle = 1` (fresh session). The timer shows 25:00. The rail shows: empty from 14:00-14:40 (the user wasn't there), green growing from 14:40, with break marks at 15:05, 15:35, etc. The break positions are now anchored to the actual session start, not the event start.

The 14:00-14:40 gap is honest. It tells the user (and the AI) that they started 40 minutes late. If this pattern repeats, the system can learn from it.

### Multi-day events

Multi-day events with pomodoro enabled are clipped to the current day for rendering. Segments use absolute timestamps, so they map correctly regardless of which day the rail is rendering.

Each calendar day within a multi-day event is treated as an independent session window. A session does not carry over across midnight. When the clock crosses midnight, the active session is ended (`end_reason=completed`, the day's window expired) and a new session auto-starts for the next day if auto-start is enabled. There is no inheritance across days within the same multi-day event: each day starts fresh. This is consistent with recurring events (no cross-instance inheritance) and avoids the complexity of a single session spanning midnight with different day columns needing to render parts of it.

**Example:** "Hackathon" spans Friday 09:00 to Sunday 18:00 with pomodoro enabled. On Friday, the user works from 10:00 to 23:45. At midnight, the session ends. Saturday auto-starts a fresh session. Friday's rail shows green from 10:00-23:45 with breaks. Saturday's rail starts empty until the new session begins. The runs are separate, each with `event_date` matching their calendar day.

### All-day toggle on a pomodoro event

A timed event with pomodoro enabled can be converted to all-day. Pomodoro is fundamentally time-based (focus periods, breaks, segment timestamps), so converting to all-day is incompatible with an active or historical pomodoro session.

**If no session has ever run on the event:** the toggle removes the pomodoro config. The event becomes a plain all-day event with no rail, no tracking data. This is a clean conversion.

**If a session is currently active:** the system must stop the session first (`end_reason=stopped`), then proceed as below.

**If past sessions exist (runs and segments recorded):** the pomodoro config is removed from the event, but all existing runs and segments are preserved. The event no longer shows a rail (it's all-day, no time-based rendering), but analytics can still query the historical data via `original_event_id`. The runs' config snapshots preserve the settings that were in effect.

Converting back from all-day to timed restores the time pickers but does not restore the pomodoro config. The user must re-enable pomodoro manually. A new session starts fresh with no inheritance from the pre-conversion sessions.

**Example:** "Sprint planning" is a timed event 09:00-12:00 with pomodoro, two completed focus segments recorded. The user toggles it to all-day. The pomodoro config is removed. The two segments remain in the database. The rail disappears. If the user later converts it back to timed (say, 10:00-11:00) and re-enables pomodoro, the rail reappears showing the old segments (which were at 09:00-10:50) as historical data at their original timestamps, even though the event now starts at 10:00. The pre-10:00 segment data renders outside the current event block but is still valid historical data.

### Undo/redo interaction with pomodoro

Undo and redo operate on calendar event properties (time, title, recurrence), not on pomodoro session state. When a user undoes an event change that triggered a session stop or reconfiguration, the event reverts but the session does not.

**Example: undo after resize stops session.** The user resizes an active event from 16:00 to 15:00 (shortening it). The system stops the session (block expired). The user hits Ctrl+Z. The event reverts to 16:00. But the session is already stopped, segments recorded, run closed. Undo does not restart the session. The user sees the event back at its original time with the recorded progress, and can manually start a new session.

This is intentional. Session state changes (segments written, runs closed, pauses recorded) are append-only historical data. Reverting them would violate invariant 6 (past progress never erased). Undo is a calendar operation, not a time machine for tracking data.

**Example: undo after delete.** The user deletes a future event (no tracking data). Undo restores the event. This is clean because no tracking data existed.

**Example: undo after delete with tracking data.** The user deletes an event that had past tracking data (which means it was archived, not deleted, per invariant 7). Undo should restore the event from the archive back to the active calendar. The runs' `event_id` (which became null on archive) must be restored to the event's ID.

### Recurring events

Each instance gets its own runs and segments, independent of other instances (no cross-instance inheritance). Structural operations (detach, split, template-wide edit) follow the rules in "Recurring events" under event lifecycle. The key rendering implication: after a detach, the standalone event's segments and the remaining template's projected schedule must not overlap on the rail. The detached date has an exception on the template, so only the standalone's data renders for that time slot.

### Break overtime

After a break timer reaches 0, overtime accumulates for up to 30 minutes. The break mark grows in real-time (the active break segment's `actual_end` is not set until the break truly ends). After 30 minutes, the system auto-advances to focus.

### Session stop

Stopping a session (manually, from idle overlay, or any other trigger) marks the current segment `interrupted` and ends the run. No future segments exist to clean up because each segment is only written when its phase begins. The event remains on the calendar. Auto-start will create a new session within 30 seconds if the event still has remaining time.

On restart, the focus timer begins at the full configured duration. The user's concentration is assumed broken by any interruption. Remaining time from the previous session is not carried over.

### Event archival

Archiving a past event removes it from the calendar but preserves all tracking data. Runs retain their `original_event_id` and `event_title_snapshot`. Segments and pauses are unaffected because they cascade from runs, not from events.

**Example:** The user had a "Deep Work" event yesterday from 09:00-12:00 and completed two full pomodoro cycles (2 focus segments, 2 break segments, various pauses). Today they decide to archive it to clean up their calendar.

What happens:
1. The event row is copied to `calendar_events_archive`.
2. The event is deleted from `calendar_events`.
3. The run's `event_id` becomes NULL (SET NULL FK). But `original_event_id` still holds the old event ID, and `event_title_snapshot` still says "Deep Work."
4. All segments and pauses remain exactly as they were.

What the user sees: the event disappears from the calendar. But when they open the stats page and look at yesterday's productivity, they see "Deep Work, 2 hours 15 minutes of focus." The data is intact. The analytics page joins to `calendar_events_archive` via `original_event_id` to get the full event context (color, description, project link) if needed.

## Multi-user considerations

Pomodoro tracking is always per-user. The `user_id` field on `pomodoro_runs` scopes all tracking data to an individual. In the current single-user Tauri app, this defaults to a local UUID. When multi-user features arrive (sync, shared calendars, team workspaces), the separation is already in place.

Key principles:

- Each user sees only their own rail on any event, including shared events.
- One user stopping, pausing, or reconfiguring their session has zero effect on other users' sessions or on the event itself.
- Personal tracking data (segments, pauses, focus patterns) is private by default.
- No mechanism exists for one user to view another user's tracking data unless explicitly shared.

## Team estimates and AI mediation

### The problem

Accurate task estimates require individual-level data: how long does this type of task take, what are the user's focus patterns, how do break habits affect throughput. But exposing this data to managers or team leads is surveillance, which contradicts the app's philosophy.

Aggregate data (team averages) loses the individual signal that makes estimates accurate. A team average of 6 hours per task is useless if person A typically takes 3 hours and person B takes 9.

### The approach: AI as data fiduciary

The AI acts as a trusted intermediary, conceptually similar to how a doctor sees a patient's full medical records but only tells an employer "fit for work" or "not fit for work." The AI has access to individual tracking data and produces task-level recommendations without exposing the underlying personal metrics.

What the team-facing AI outputs:
- "Assign task X to person A, estimated 3 days."
- "This reassignment would delay project B by approximately 2 days."
- "The suggested timeline accounts for existing workload."

What the team-facing AI never outputs:
- Individual focus hours, break patterns, idle time, or pause frequency.
- Comparative statements between people ("person A is faster than person B").
- Rankings or leaderboards of any kind.
- Explanations that reveal individual habits ("because person A only focuses 4 hours per day").

### Prompt injection and data leakage risks

A determined manager could attempt to extract individual data through creative questioning. Mitigations:

- **Hard architectural boundary**: the team-facing AI does not receive raw segments or pauses. It receives pre-computed, privacy-safe signals: "user X has N hours of available capacity this week" (a single number, no breakdown), "user X's historical accuracy for this task type is within the team norm" (relative, never absolute).
- **Output filtering**: responses are checked for individual identifiers adjacent to any metric.
- **Refusal policy**: the AI refuses comparison questions, individual performance queries, and any request for per-person breakdowns.
- **Response granularity cap**: estimates use days (not hours), "this week" (not "Tuesday afternoon").
- **Transparency log**: each user can see every AI response that involved their data. Opt-out is available: a user's data simply becomes unavailable to the team AI, and the AI adjusts its confidence intervals accordingly.

### Design principle

The app should make users feel empowered for fighting their procrastination, not surveilled. Team features focus on project coordination (task status, deadlines, shared calendars, accurate estimates) not individual monitoring (who worked how many hours). Tracking is a personal self-improvement tool. Team value comes from better planning, not from watching people.

## Future: productivity stats

The segment and pause data model is designed to support detailed productivity analytics. From the persisted data, we can derive:

- **Focus score**: ratio of actual focus time to total elapsed time within focus segments (excluding pauses).
- **Completion rate**: how many focus segments were completed vs interrupted.
- **Break adherence**: whether the user takes breaks on schedule or skips them (detected from gaps between consecutive focus segments).
- **Idle patterns**: frequency and duration of idle pauses, time-of-day trends (queryable directly from the `pomodoro_pauses` table by reason).
- **Daily/weekly totals**: sum of actual focus time across all segments.
- **Config effectiveness**: correlating run configs (via the config snapshot on runs) with focus scores and completion rates. This enables A/B testing of focus strategies.
- **Procrastination patterns**: events where no session was ever started, detected from runs (or lack thereof) for past events.
- **Estimate accuracy**: comparing AI-predicted task durations with actual focus time, improving models over time.

This is why accurate tracking matters even when the rail itself is simple: the 3-color rail is the user-facing summary, but the underlying tables are the detailed record that powers stats, trends, intelligent config recommendations, and gamification features.

## Source files

These reference the current implementation, which may not yet match this specification in all details.

| Component | File |
|-----------|------|
| Segment types, band types | `apps/client/src/lib/components/calendar/types.ts` |
| Segment computation, band computation | `apps/client/src/lib/utils/pomodoro-segments.ts` |
| Segment computation tests | `apps/client/src/lib/utils/pomodoro-segments.test.ts` |
| Pomodoro store (session lifecycle) | `apps/client/src/lib/stores/pomodoro.svelte.ts` |
| State machine (tick/transition decisions) | `apps/client/src/lib/stores/pomodoro-machine.ts` |
| Auto-start, block tracking | `apps/client/src/App.svelte` |
| Rail rendering | `apps/client/src/lib/components/calendar/DayColumn.svelte` |
| DB schema | `apps/client/src-tauri/src/db.rs` |
| Theme colors | `apps/client/src/app.css` |

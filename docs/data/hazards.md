# Cross-cutting hazards

Situations most likely to produce bugs, data corruption, or confusing UX. Every implementer, reviewer, and AI agent working on this system should internalize these before writing or modifying code in the affected areas. Each hazard names the danger, gives a concrete scenario, and points to the docs that govern the correct behavior.

## 1. Event boundary timing

**Why it's dangerous:** block expiration, auto-start, and consecutive-event transitions all race for the same moment. If the expiration handler fires before the transition handler checks for the next event, inherited state is lost and the user sees a fresh session instead of a continuation.

**Scenario:** the user has "Deep Work" 09:00-11:00 and "Code Review" 11:00-13:00, both with pomodoro enabled. At 10:48 the user starts a 25-minute focus. At 11:00, "Deep Work" expires. The system must (a) end the current run on "Deep Work" with `end_reason = block_transition`, (b) compute `inherited_focus_minutes = 12` (the 12 minutes of focus done from 10:48 to 11:00), (c) create a new run on "Code Review" with those inherited values so the remaining 13 minutes carry over. If the expiration handler simply ends the run and a separate auto-start handler creates a fresh run, those 12 minutes vanish.

**Variation, tiny gaps.** If "Code Review" starts at 11:02 instead of 11:00, there is a 2-minute gap. The system should still attempt inheritance if the gap is within a configurable threshold (e.g. 5 minutes). Outside that threshold, the next event auto-starts fresh.

**Variation, events shorter than one focus period.** A 15-minute event with 25-minute focus config will never complete a full cycle. The run starts, produces one focus segment, and the block expires before the focus period ends. The segment is marked `interrupted` with actual duration of 15 minutes. No break segment is created. Inherited focus for the next event is 15 minutes. If there is no next event, the run simply ends.

**Governed by:** `algorithms/pomodoro-state-machine.md` (block expiration with transition), `data/schema.md` (inherited fields on runs), invariant 6.

## 2. Concurrent user edits while a session is running

**Why it's dangerous:** the user can interact with the calendar while a pomodoro session is active. Dragging, resizing, deleting, converting, or reconfiguring an event that owns the active run can invalidate assumptions the timer is relying on.

**Scenario, resize while running.** The user has a session active on "Study" 14:00-16:00. At 14:45, they drag the end edge to 15:00, shortening the event by an hour. The active run's block now expires in 15 minutes instead of 75. The system must re-evaluate the block boundary and schedule an earlier expiration. If the resize is not propagated to the timer, the session continues past the event boundary.

**Scenario, end while running.** The user wants to stop the active event now. The calendar panel offers End event instead of delete or archive. The system sets the event end time to now, closes the active run with `end_reason = completed`, interrupts the active segment with `end_reason = event_expired`, closes open pauses, and leaves the ended event visible as a past protected row. If the user archives that row afterward, the pomodoro history survives with nullable live `event_id` links and immutable run snapshots.

**Scenario, convert away from pomodoro.** The user disables the pomodoro toggle on the active event. The system must stop the session (`end_reason = stopped`), save all segment data, and remove the rail rendering. Re-enabling pomodoro later starts a fresh session, no inheritance.

**Scenario, reconfigure while running.** The user changes focus duration from 25 to 40 minutes while in a focus phase at minute 18. The system must end the current run (`end_reason = reconfigured`), create a new run with the new config, carry `inherited_focus_minutes = 18` and `inherited_cycle` from the old run, and create a bridge focus segment with remaining time computed under the new config (40 - 18 = 22 minutes).

**Governed by:** `algorithms/pomodoro-state-machine.md` (reconfiguration), `features/calendar.md` (active event protection), invariant 6.

## 3. Crash, suspend, or kill at critical moments

**Why it's dangerous:** the app can die at any point, including mid-transaction. The heartbeat (updated every ~30 seconds) is the recovery signal, but the window between last heartbeat and actual crash can contain important state changes. Phase transitions, pause writes, and reconfigurations are particularly vulnerable because they involve multiple table writes.

**Scenario, crash during phase transition.** The focus phase ends at 14:25. The system needs to (a) update the focus segment to `completed`, (b) create the break segment. If the app crashes after (a) but before (b), recovery finds a completed focus segment with no following break. The system does not retroactively insert a break; the missing break is treated as a skipped break.

**Scenario, laptop suspend during focus.** The user closes the laptop at 14:20 during a focus phase that started at 14:00. The last heartbeat is at 14:20. The user opens the laptop at 16:00. Recovery detects the last heartbeat is far behind current time. The active segment's actual end is set to 14:20 (the last heartbeat), status becomes `interrupted`. The idle gap from 14:20 to 16:00 is empty rail (gray). The user sees a prompt to start a new session.

**Scenario, crash during pause write.** The user triggers a pause at 14:30. The system needs to insert a row into `pomodoro_pauses`. If it crashes before the write commits, recovery finds no pause record. The segment's green fill extends to the last heartbeat, which is correct (the user was focusing up to that point, the pause had not been saved). No data is fabricated.

**Governed by:** `algorithms/pomodoro-state-machine.md` (recovery), `data/schema.md` (heartbeat, pause rows), invariant 5.

## 4. Overlapping events, containment, and auto-start tiebreakers

**Why it's dangerous:** overlapping pomodoro events interact in two compounding ways. First, the timeline band algorithm must decide which event's schedule owns each time slot, handling nested containment when three or more events stack. Second, when multiple events could auto-start simultaneously (same start time, or app opened mid-overlap), the system must deterministically pick one. If containment logic and auto-start logic use different priority rules, the rail shows one event's schedule while the timer runs on another.

**Scenario, triple stack.** "Work Block" 09:00-17:00, "Sprint" 10:00-15:00, "Quick Task" 11:00-11:30. All have pomodoro enabled. The containment algorithm must identify "Quick Task" as contained in "Sprint", and "Sprint" as contained in "Work Block". The rail shows: Work Block's schedule from 09:00-10:00, Sprint's from 10:00-11:00, Quick Task's from 11:00-11:30, Sprint's from 11:30-15:00, Work Block's from 15:00-17:00. If any of these three has an active session, that session's event takes priority regardless of containment.

**Scenario, active session on the contained event.** The user starts a session on "Quick Task" at 11:00. At 11:15, the rail shows "Quick Task"'s green fill from 11:00-11:15, not Sprint's or Work Block's schedule. "Quick Task" owns that time slot even though it's the shortest event. When "Quick Task" ends at 11:30, "Sprint" reclaims the rail.

**Scenario, two events at 09:00.** "Morning Standup" (09:00-09:30) and "Deep Work" (09:00-12:00) both have pomodoro and auto-start. The user opens the app at 09:00. Tiebreaker: the shorter event wins (more time-sensitive). "Morning Standup" auto-starts. When it ends at 09:30, "Deep Work" auto-starts for its remaining window. If two events have the same duration, fall back to creation order (earliest `created_at` wins). This ensures determinism without requiring manual prioritization.

**Scenario, app opened mid-overlap.** The user opens the app at 09:15. Both events above are in progress. Neither has an active session. Same tiebreaker: "Morning Standup" (shorter remaining duration) auto-starts. If the user already had an interrupted session on "Deep Work", the interrupted session takes priority (last user intent matters).

**Governed by:** `algorithms/time-conflict-detection.md`, `features/pomodoro-progress-displays.md` (band computation), `algorithms/pomodoro-state-machine.md` (auto-start).

## 5. DST transitions and timezone boundary cases

**Why it's dangerous:** all timestamps are stored in UTC, but the user sees local time. A DST transition can make a 60-minute event appear as 0 minutes or 120 minutes in local time. The 2 AM hour can repeat (fall back) or vanish (spring forward). A recurring "9 AM daily" event must keep firing at 9 AM local even though its UTC offset shifts by an hour.

**Mitigation.** Storage is UTC ISO 8601 plus an IANA home zone per event. Recurrence walks dates in zone-free `Temporal.PlainDate` arithmetic anchored to the home zone, then reattaches the original wall-clock time, so the wall clock survives DST without drift. Render zone tracks the device's current IANA zone via visibility, focus, and a 60s sanity poll, refreshing without app restart. Notifications schedule against UTC instants, so they fire correctly even if the user's zone changes between scheduling and firing. Ambiguous wall-clock cases (the second 1:30 AM during fall-back) resolve via Temporal's `compatible` disambiguation, matching RFC 5545 expectations.

**Scenario, spring forward.** The user has an event from 01:30 to 03:30 local time. At 02:00, clocks jump to 03:00. In UTC, the event is still 2 hours. In local display, it looks like a 1-hour event (01:30-02:00, then 03:00-03:30). The rail renders based on UTC duration (2 hours of rail space), not local-time appearance. The pixel mapping uses UTC elapsed time.

**Scenario, fall back.** The user has an event from 01:00 to 03:00. At 02:00, clocks fall back to 01:00. The UTC duration is still 2 hours. Display might show 01:00-01:00-02:00-03:00 (the 01:00-02:00 hour appears twice). The rail must not duplicate bands for the repeated hour. UTC is the authority.

**Scenario, recurring 9 AM through spring-forward.** A daily 09:00 event in `America/New_York` starting 2026-03-07 (the day before DST starts). On 2026-03-08 the rendered time stays 09:00; the UTC instant shifts from 14:00Z to 13:00Z. The expansion engine walks `PlainDate` in the home zone and reattaches `09:00`, so no occurrence is skipped or duplicated.

**Scenario, user travels.** The user creates an event in EST, flies to PST during the day. The event times are stored in UTC. Within 60s of opening the laptop in PST (or instantly on focus), the display shifts by 3 hours, but the data is intact. No reload, no recalculation needed.

**Assumption: the system clock is reasonably accurate.** UTC protects against timezone and DST issues, but all timestamps ultimately come from the OS clock. If the clock jumps (NTP correction after boot with a dead CMOS battery, VM resume drift, dual-boot clock mismatch), timestamps within an active session can become logically inconsistent (e.g. a heartbeat before the previous one). This does not corrupt the database at the SQLite level, but it produces bad data for that session. The system does not defend against this because the scenarios are rare, the drift is usually small, and reliable countermeasures (monotonic clocks) do not survive reboots. If a user notices wrong session data, a clock issue is the likely cause.

**Governed by:** `data/schema.md` (UTC timestamps + home zone), `algorithms/recurrence-expansion.md` (home-zone walk), all rendering logic.

## 6. Sub-second and rapid-succession actions

**Why it's dangerous:** users can click quickly. Debouncing and idempotency guards must prevent duplicate runs, duplicate segments, or corrupted state.

**Scenario, double-click start.** The user double-clicks the "Start" button. Two `startSession` calls fire within 50ms. Without a guard, two runs are created on the same event. The system must check for an existing active run before creating a new one. If a run exists, the second call is a no-op.

**Scenario, rapid skip-skip.** The user presses "Skip Break" twice quickly during a break phase. The first skip ends the break segment and creates the next focus segment. The second skip finds no active break, so it's a no-op. The guard: "skip break" only operates on an active break segment.

**Scenario, start-stop-start.** The user starts, immediately stops, then immediately starts again. Each action must fully commit before the next begins. After start-stop, the first run is closed (`end_reason = stopped`). The second start creates a fresh run with no inheritance (stop breaks concentration). If the stop has not committed when the second start arrives, the start must wait or fail gracefully.

**Governed by:** `algorithms/pomodoro-state-machine.md` (all transitions), invariant 2.

## 7. Multiple runs on the same event

**Why it's dangerous:** a single calendar event can accumulate many runs across its lifetime (stop/restart, reconfigurations, crash recovery). Analytics queries that assume one run per event will produce wrong results. Rail rendering must stitch all runs together into a coherent visual.

**Scenario, four runs on one event.** "Deep Work" 09:00-13:00. The user starts at 09:00, stops at 10:30 (run 1, `stopped`). Starts again at 10:45 (run 2, fresh, no inheritance). App crashes at 11:20 (run 2, `interrupted`). Opens app at 11:40, starts again (run 3, fresh). Changes config at 12:00 (run 3 ends `reconfigured`, run 4 starts with inheritance). The rail shows: green 09:00-10:30 (run 1), empty 10:30-10:45, green 10:45-11:20 (run 2 up to heartbeat), empty 11:20-11:40, green from 11:40 onward (runs 3 and 4). Break marks come from each run's own config and schedule. All four runs share the same `event_id` and `event_date`.

**Governed by:** `data/schema.md` (runs and segments by `run_id`), `features/pomodoro-progress-displays.md` (rail rendering and band computation).

## 8. Pause edge cases

**Why it's dangerous:** pauses create holes in the green fill within a segment. Multiple pauses, pauses at phase boundaries, and zero-green segments are all valid states that rendering and analytics must handle.

**Scenario, multiple pauses in one segment.** Focus from 14:00-14:25. The user pauses at 14:05-14:08, again at 14:15-14:18. Total pause time: 6 minutes. Green fill: 14:00-14:05, 14:08-14:15, 14:18-14:25. The focus timer counts 19 minutes of actual focus. Each pause is its own row.

**Scenario, pause at phase boundary.** The user pauses at 14:24 during a focus phase that ends at 14:25. The pause is still within the focus segment. When the timer reaches 14:25 (or when the user resumes, whichever is later), the focus segment ends and the break begins. The pause does not extend the focus segment's planned end, but it does mean the user only focused for 24 minutes. The actual end of the segment is when the phase transitions, not when the planned duration elapses.

**Scenario, zero-green segment.** The user starts a focus, immediately pauses, stays paused for the entire focus duration. The segment has `actual_start`, `actual_end`, status `completed` (the timer ran out), but every second was paused. Green fill: nothing. The segment exists in the data model but produces no green on the rail. This is correct.

**Scenario, idle detection triggers pause.** The user stops interacting. After `idle_timeout_minutes`, the system inserts a pause starting at `idle_timeout_minutes` ago (the estimated moment the user became idle). If this retroactive start overlaps with previously rendered green, the green is shortened. The pause row's `started_at` is in the past, not at the detection moment.

**Governed by:** `data/schema.md` (pause rows), `features/pomodoro-progress-displays.md` (green-fill rules), `algorithms/idle-detection.md`.

## 9. Reconfiguration chain integrity

**Why it's dangerous:** each reconfiguration ends one run and creates another with inherited state. A chain of reconfigurations creates a chain of runs. If any link miscalculates inherited values, every subsequent run's plan derivation is wrong.

**Scenario, triple reconfiguration.** Run 1: config 25/5/15, starts at 14:00, 18 minutes of focus done. User changes to 40/5/15 at 14:18. Run 2: `inherited_focus_minutes = 18`, bridge focus has 22 minutes remaining. At 14:30, user changes to 30/5/15 (12 minutes into run 2's bridge focus, so total focus = 18 + 12 = 30). Run 3: `inherited_focus_minutes = 30`. Since 30 >= 30, run 3 starts with a break. If run 2 had miscalculated its inherited focus (e.g. forgot to add run 1's 18 minutes), run 3 would incorrectly start with focus instead of break.

**Key rule:** `inherited_focus_minutes` on the new run equals focus already accumulated in the ending run's current cycle, including any focus inherited by the ending run itself. It is cumulative, not just the delta from the last run.

**Governed by:** `data/schema.md` (inherited fields), `algorithms/pomodoro-state-machine.md` (reconfiguration), `algorithms/pomodoro-segments-and-plan.md` (plan derivation).

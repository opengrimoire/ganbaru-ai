# Progress tracking

This document specifies the intended behavior for how GanbaruAI tracks and renders pomodoro progress. It is the source of truth for testing: if the code disagrees with this document, the code is wrong.

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

3. **Break positions are stable within a session.** For a running session, break positions are deterministic from the run's start point, config, and cycle state. They do not shift while the session is active. For events without an active session, projected breaks are computed from "now" and naturally shift as time passes (this is intentional, see "Projected breaks" under rail rendering).

4. **No duplicate bands in the same time range.** The rail shows one coherent schedule at any point in time. Two overlapping events must never both contribute bands to the same minute range.

5. **Persisted data is the source of truth for the past.** The rail renders past time from segment records, never from re-computation of what "should have happened." If a session was interrupted, the green fill stops where it stopped. If a break was skipped, no break band appears for that slot. Future time is rendered from config-based projections, not persisted data.

6. **Past progress is never erased.** Once a segment has `actualStart` set and its status is `completed` or `interrupted`, no user action may delete, overwrite, or hide it. Skipping a break, stopping the session, dismissing the idle overlay, reconfiguring pomodoro settings, the app closing unexpectedly, or archiving the calendar event: none of these remove previously recorded work. There is no mechanism to delete individual segments. They are an append-mostly historical record.

7. **Past events are never deleted.** A calendar event whose end time is in the past can only be archived, never deleted. This applies regardless of whether the event has tracking data. An event where the user planned to focus but never opened the app is still valuable data: the absence of work on a planned block is a procrastination pattern the system can learn from. Only future events (start time entirely in the future, no tracking data) can be truly deleted.

## Data model

The tracking system uses three tables. This replaces the earlier single-table design where `pause_log` was a JSON blob inside `pomodoro_segments`.

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
| `experiment_id` | text or null | For A/B testing: which experiment this run belongs to |
| `variant` | text or null | For A/B testing: which variant was assigned |
| `created_at` | ISO datetime | Row creation time |

Config is currently per-event, but may be inherited from project defaults in the future. The run's config snapshot always records what was actually used, regardless of where it originated. This means A/B testing of configs works naturally: the system assigns a variant, the config snapshot captures it, and outcomes are measured from the run's segments.

### Segments

A segment is one uninterrupted stretch of either focus or break. Segments are created lazily: a new segment is persisted only when its phase actually begins, not when the session starts. This avoids accumulating dead "planned" rows that would need cleanup on every restart or reconfiguration.

The system does not persist segments for phases that never started. If a break is skipped, no segment is created for it. The absence of a break segment between two consecutive focus segments is how a skipped break is recorded. Analytics can detect this from the gap pattern.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `run_id` | UUID | FK to `pomodoro_runs` (CASCADE delete) |
| `cycle_number` | integer | Which pomodoro cycle (1 to `pomodoroCount`) |
| `phase` | `focus`, `short_break`, `long_break` | What kind of segment |
| `planned_start` | ISO datetime | When the segment was scheduled to begin |
| `planned_end` | ISO datetime | When the segment was scheduled to end |
| `actual_start` | ISO datetime | When the segment actually started. Always set because segments are only created when they begin |
| `actual_end` | ISO datetime or null | When the segment ended. Null if still running |
| `status` | see below | Lifecycle state |
| `created_at` | ISO datetime | Row creation time |

Note: `actual_start` is never null in this model because segments are only persisted when they begin. This is a change from the earlier model where planned segments were pre-created with `actual_start = null`.

### Segment statuses

| Status | Meaning |
|--------|---------|
| `active` | Currently running (exactly one at a time globally) |
| `completed` | Finished normally (timer reached zero, user acknowledged break end) |
| `interrupted` | Started but cut short (app closed, session stopped, event time expired mid-segment) |

The earlier `planned` and `skipped` statuses are removed because segments are no longer pre-created. A phase that never started simply has no segment row. A break that was skipped has no segment row (detectable from the gap between consecutive focus segments).

### Pauses

Each pause within a segment is its own row, replacing the JSON `pause_log` blob. This makes pauses individually queryable for analytics (e.g. "average idle duration by time of day across 6 months"), crash-safe (a crash leaves a row with `ended_at = NULL`, trivially fixable without JSON string surgery), and atomic (each write is one row, not a full JSON re-serialization).

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

### Legacy tables

The `pomodoro_sessions` table (which stores one row per completed focus period with `focus_score`, `app_switch_count`, `break_extended`) predates the segment system. It should be deprecated and its useful fields migrated: `focus_score` can be computed from segment and pause data, `app_switch_count` could become a field on segments or runs if needed in the future.

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

If the user edits the event's end time to be in the past while a session is running, the session is stopped as if the block expired.

### Future events

An event whose start time is entirely in the future and which has no tracking data (no runs, no segments) can be truly deleted. This is a normal calendar operation with no data preservation concerns.

### Recurring events

Each instance of a recurring event gets its own runs and segments. Modifying or deleting a future instance in a recurrence chain has zero effect on past instances' tracking data. When a recurring instance is detached into a standalone event, run references are transferred (the `event_id` and `original_event_id` on existing runs are updated to the new standalone event ID).

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
3. No other segments are created. Future phases are computed on-the-fly for rail rendering and created lazily when they actually begin.

Sessions always start from the current time, never from the event's calendar start time. If the event was scheduled for 17:00 but the app opens at 18:15, the session covers 18:15 onward.

The first phase is always a full-length focus period. Even if the user is restarting after a stop (see "Session stop and restart"), the focus timer begins at the full configured duration because concentration is assumed broken.

### Timer tick

Every second, the system checks in priority order:

1. **Suspend detected** (tick gap > 15s): create a pause row (`reason = suspend`), show suspend dialog.
2. **Block expired** (event end time reached): mark current segment `interrupted`, end the run (`completed`).
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

### Session stop and restart

A session can stop for any reason: user stops manually, user dismisses the idle overlay and chooses to stop, app crash, or process termination.

When a session stops:
1. The current segment is marked `interrupted` with `actual_end` set (for manual stop, `actual_end = now`; for crash recovery, `actual_end = last_heartbeat`).
2. Any open pause on the current segment is closed.
3. The run is ended (`ended_at = now` or `last_heartbeat`, `end_reason` set appropriately).
4. No other segments are affected because future segments were never created.

After a stop, the event still exists on the calendar with time remaining. The rail shows preserved progress from the stopped session plus projected break marks for the remaining time (see "Projected breaks" under rail rendering). Auto-start fires every 30 seconds and will detect the event, creating a new session.

On restart (whether via auto-start or user action):
1. A new run is created with a fresh config snapshot.
2. The first segment is focus with full configured duration. The user's concentration is assumed broken by the interruption, so remaining time from the previous session is not carried over.
3. Break positions are computed fresh from the new start point.
4. The previous run's segments are untouched (invariant 6). The rail shows the old green fill alongside the new session's progress.

### Pauses

- **Idle detection** (focus only): the system checks user activity every 15 seconds. If idle beyond the configured threshold, a pause row is created (`reason = idle`, `ended_at = NULL`), the timer pauses, and an overlay is shown. On resume, the pause's `ended_at` is set.
- **Suspend detection** (any phase): a tick gap > 15 seconds triggers a pause row (`reason = suspend`, `started_at = suspendStartIso`, `ended_at = suspendEndIso`) and a resume dialog.
- **Manual pause**: user explicitly pauses the timer. A pause row is created (`reason = manual`, `ended_at = NULL`). On resume, `ended_at` is set.

### Session reconfiguration

If the user changes pomodoro settings mid-session:
1. Mark the current segment `completed` with `actual_end = now`.
2. Close any open pause.
3. End the current run with `end_reason = reconfigured`.
4. Create a new run with the new config snapshot.
5. Create a bridge segment: same phase as the interrupted one, with the remaining time preserved. For example, if 12 minutes of focus remained, the bridge segment has `planned_end = now + 12min`.
6. Future break positions are computed from the new config.
7. Previously completed/interrupted segments from the old run are untouched (invariant 6). The rail continues to show all accumulated green fill.

### Block transitions

When the timer transitions to a different (adjacent or overlapping) pomodoro event:
1. End the current run with `end_reason = block_transition`.
2. Compute whether accumulated focus time exceeds the new event's focus duration threshold.
3. If so, trigger a break on the new event's run. If not, continue focus with adjusted remaining time.
4. Create a new run for the new event with its config snapshot.

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

### Why pauses are rows, not JSON

In the earlier design, pauses were stored as a JSON array (`[[startIso, endIsoOrNull], ...]`) inside the segment row. This had three problems:

1. **Crash recovery required JSON string manipulation in SQL.** The cleanup query used `REPLACE(pause_log, 'null]', ...)` which is fragile and can corrupt data if there are multiple open intervals or unexpected formatting.
2. **Not queryable for analytics.** Answering "what is the average idle duration by time of day" required parsing JSON in every row.
3. **Not atomic.** Updating a pause meant reading the full JSON, appending to the array, serializing, and writing the full blob. A crash during this sequence could produce corrupted JSON.

Individual rows solve all three: recovery is a simple `UPDATE WHERE ended_at IS NULL`, analytics uses normal SQL aggregation, and each pause write is atomic.

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

### Past overlay

A semi-transparent overlay covers the column from midnight to the current time. This naturally dims both green fills and break marks that are in the past. The overlay is behind the rail (lower z-index), so it affects everything.

## Timeline band computation

### How bands are produced

The system takes all pomodoro events for a given day and produces a flat list of bands (green fills + break marks) to render on the rail.

**Step 1: filter contained events.** If event B is fully enclosed by event A (A starts at or before B, A ends at or after B, and A is longer), B is removed. This prevents duplicate bands.

**Step 2: sort by start minute.**

**Step 3: identify the active event.** If a session is running, note which event it belongs to. Its time range is used to suppress projected bands from overlapping non-active events (invariant 4).

**Step 4: cursor walk.** Process events chronologically, tracking where the previous event's coverage ended and what the inherited focus/cycle state is.

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

If one event fully encloses another, the enclosed event is filtered out. Only the enclosing event's config drives the rail.

### Partially overlapping (no active session)

The earlier-starting event takes priority for the overlapping portion. The later event only contributes bands after the earlier event ends.

### Partially overlapping (with active session)

The active session takes priority. Projected bands from all other overlapping events are suppressed for the active event's entire time range.

### Result for the user

The rail always shows one coherent schedule at any given time. Never a mix of two configs.

## Edge cases

### App opened after event started

The session starts from now, not from the event's calendar start. The time between the event start and the session start has no green fill (the user wasn't working). Projected break marks for events without a session are positioned as if the schedule started at the event start (via elapsed-time adjustment), so the first visible break may be closer than a full focus period.

### Multi-day events

Clipped to the current day for rendering. Segments use absolute timestamps, so they map correctly regardless of which day the rail is rendering.

### Recurring events

Each instance gets its own runs and segments. When a recurring instance is detached into a standalone event, run references are transferred. Modifying or deleting future instances in a chain has zero effect on past instances' data.

### Break overtime

After a break timer reaches 0, overtime accumulates for up to 30 minutes. The break mark grows in real-time (the active break segment's `actual_end` is not set until the break truly ends). After 30 minutes, the system auto-advances to focus.

### Session stop

Stopping a session (manually, from idle overlay, or any other trigger) marks the current segment `interrupted` and ends the run. No future segments exist to clean up because segments are created lazily. The event remains on the calendar. Auto-start will create a new session within 30 seconds if the event still has remaining time.

On restart, the focus timer begins at the full configured duration. The user's concentration is assumed broken by any interruption. Remaining time from the previous session is not carried over.

### Event archival

Archiving a past event removes it from the calendar but preserves all tracking data. Runs retain their `original_event_id` and `event_title_snapshot`. Segments and pauses are unaffected because they cascade from runs, not from events.

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

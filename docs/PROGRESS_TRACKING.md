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

## Invariants

These must always hold. Any violation is a bug in the computation, not something the UI should mask.

1. **Green never appears after the current time.** A focus fill band can only exist for a segment with an `actualStart` in the past and real recorded work. If the system ever produces green beyond the current moment, the segment data or projection logic is wrong.

2. **Exactly one segment is `active` at a time.** Multiple active segments would mean the timer is running two things simultaneously.

3. **Break positions are stable.** For a given event with a given config, the planned break positions relative to the event start are deterministic. Opening the app at different times must not shift where future breaks appear (the elapsed-time adjustment must derive the correct cycle position from the event start).

4. **No duplicate bands in the same time range.** The rail shows one coherent schedule at any point in time. Two overlapping events must never both contribute bands to the same minute range.

5. **Persisted data is the source of truth.** The rail must render from segment records (persisted or in-memory for the active session), never from re-computation of what "should have happened." If a session was interrupted, the green fill stops where it stopped. If a break was skipped, no break band appears for that slot.

6. **Past progress is never erased.** Once a segment has `actualStart` set and its status is `completed` or `interrupted`, no user action may delete, overwrite, or hide it. Skipping a break, stopping the session, dismissing the idle overlay, reconfiguring pomodoro settings, or the app closing unexpectedly: none of these remove previously recorded work. The only operation that deletes segments is deleting the calendar event itself (cascade delete).

## Data model

### Segment

A segment is one uninterrupted stretch of either focus or break. Every running or completed session is broken into segments persisted in the `pomodoro_segments` SQLite table.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `event_id` | UUID | FK to `calendar_events` (cascade delete) |
| `event_date` | `YYYY-MM-DD` | The calendar day this segment belongs to |
| `run_id` | UUID | Groups segments from the same session start |
| `cycle_number` | integer | Which pomodoro cycle (1 to `pomodoroCount`) |
| `phase` | `focus`, `short_break`, `long_break` | What kind of segment |
| `planned_start` | ISO datetime | When the segment was scheduled to begin |
| `planned_end` | ISO datetime | When the segment was scheduled to end |
| `actual_start` | ISO datetime or null | When the segment actually started (null if never started) |
| `actual_end` | ISO datetime or null | When the segment actually ended (null if still running or never started) |
| `pause_log` | JSON `[[startIso, endIsoOrNull], ...]` | Pause intervals within this segment |
| `status` | see below | Lifecycle state |

### Segment statuses

| Status | Meaning |
|--------|---------|
| `planned` | Scheduled but not yet started |
| `active` | Currently running (exactly one at a time globally) |
| `completed` | Finished normally |
| `skipped` | Never ran (user skipped break, session reconfigured, orphan cleanup) |
| `interrupted` | Started but cut short (app closed, event deleted, session stopped) |

### Pomodoro config (per-event)

| Field | Default | Description |
|-------|---------|-------------|
| `focusDurationMinutes` | 40 | Focus period length |
| `shortBreakMinutes` | 5 | Short break length |
| `longBreakMinutes` | 10 | Long break after N cycles |
| `pomodoroCount` | 4 | Cycles before a long break |
| `idleTimeoutMinutes` | null | Auto-pause threshold (null = disabled) |

Presets: automatic (40/5/10), deep focus (40/5/10), creative (25/5/15), extended (50/10/10), custom.

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
| `reconfigure` | Same block, config changed | Rebuild segments with new config |
| `rebuild_segments` | Same block, segments need refresh | Mark old, create new plan |
| `transition` | Different block | Carry over focus inheritance, new segments |
| `new_session` | No existing session | Fresh start from cycle 1 |

### Segment creation

When a new session starts:

1. Clean up any orphaned segments from previous sessions on this event (active to interrupted, planned to skipped).
2. Compute the full planned schedule from NOW to the event end.
3. Persist all segments. First segment: `status=active, actualStart=now`. Rest: `status=planned`.

Segments are always computed from the moment the session starts, never from the event's calendar start time. If the event was scheduled for 17:00 but the app opens at 18:15, the segments cover 18:15 to the event end.

### Timer tick

Every second, the system checks in priority order:

1. **Suspend detected** (tick gap > 15s): record pause interval, show suspend dialog.
2. **Block expired** (event end time reached): complete current segment, skip remaining, save session.
3. **Break finished** (break timer at 0): start overtime accumulation (max 30 min), alert every 60s.
4. **Focus finished** (focus timer at 0): advance to next phase.
5. **Notification** (60s remaining in focus): show system notification.
6. **Normal countdown**: decrement remaining seconds.

### Phase transitions

Focus ends:
- `skipNextBreak` set: skip the break segment, go directly to next focus.
- `cycle >= pomodoroCount`: long break, then reset cycle to 1.
- Otherwise: short break, increment cycle.

Break ends (user acknowledges or overtime expires): transition to next focus.

Each transition marks the current segment `completed`, closes any open pause, activates the next segment, and bumps `segmentVersion` so the UI re-fetches.

### Pauses

- **Idle detection** (focus only): checks activity every 15s. If idle beyond threshold, records a pause entry `[idleStartIso, null]`, pauses timer, shows overlay. On resume, the pause entry is closed.
- **Suspend detection** (any phase): tick gap > 15s triggers `[suspendStartIso, suspendEndIso]` pause and a resume dialog.

### App close and reopen

On startup:
1. Mark any `active` segments as `interrupted` (set `actual_end`).
2. Mark any `planned` segments from the same run as `skipped`.
3. Close any open pause intervals.
4. Find the current pomodoro event and start a fresh session from now.

### Session reconfiguration

If the user changes pomodoro settings mid-session:
1. Mark current segment `completed`.
2. Mark remaining planned segments `skipped`.
3. Build new segment plan from now, with a bridge segment preserving the current phase's remaining time.
4. Previously completed/interrupted segments are preserved (green fill does not disappear on reconfigure).

### Block transitions

When the timer transitions to a different (adjacent or overlapping) pomodoro event:
- Compute whether accumulated focus exceeds the new event's focus threshold.
- If so, trigger a break. If not, continue focus with adjusted remaining time.
- Rebuild segments for the new block.

## Rail rendering

### Where it appears

The rail appears in the **daily view** and **weekly view** only. The monthly view does not show the rail.

### Visual structure

The rail is a narrow vertical strip on the left edge of the day column. When multiple pomodoro events exist on the same day, their time ranges are merged (union of overlapping ranges) into contiguous rail containers.

### Three colors

The rail renders exactly three visual states, with no sub-variations:

| State | Color | When shown |
|-------|-------|------------|
| **Filled** | Green | Persisted focus segments with `actualStart` set, covering only the time the user was actually working (paused intervals excluded). Always in the past relative to the current time. |
| **Break** | Gray (prominent) | Any break segment (short or long), whether planned, active, completed, or skipped. One uniform appearance. |
| **Empty** | Rail background (faint gray) | Everything else: future time, past time with no session, pause gaps, idle time. |

### Green fill rules

Green bands are rendered only when ALL of the following are true:
- The segment's phase is `focus`.
- The segment has an `actualStart` timestamp.
- The segment's status is `completed`, `interrupted`, or `active`.
- For the `active` segment, green extends from `actualStart` to now (not beyond).
- Paused intervals within the segment are excluded (green is split around pause gaps).

If any of these conditions are not met, no green is rendered for that time range.

### Break mark rules

A break band is rendered for every segment where the phase is `short_break` or `long_break`, regardless of status. The band covers `plannedStart` to `plannedEnd` (or `actualStart` to `actualEnd` for persisted segments that have actual timestamps).

### Past overlay

A semi-transparent overlay covers the column from midnight to the current time. This naturally dims both green fills and break marks that are in the past. The overlay is behind the rail (lower z-index), so it affects everything.

## Timeline band computation

### How bands are produced

The system takes all pomodoro events for a given day and produces a flat list of bands (green fills + break marks) to render on the rail.

**Step 1: filter contained events.** If event B is fully enclosed by event A (A starts at or before B, A ends at or after B, and A is longer), B is removed. This prevents duplicate bands.

**Step 2: sort by start minute.**

**Step 3: identify the active event.** If a session is running, note which event it belongs to. Its time range is used to suppress planned bands from overlapping non-active events (invariant 4).

**Step 4: cursor walk.** Process events chronologically, tracking where the previous event's coverage ended and what the inherited focus/cycle state is.

For each event:

**If active** (timer running):
- Project bands from persisted segments. Completed focus produces green fill (split around pauses). Breaks produce break marks. Future planned segments produce break marks.

**If not active, with persisted segments** (past session):
- Project green fill and break marks from completed segments only.

**If not active, planned only** (no session ever started):
- Compute the planned schedule starting from `max(now, effectiveStart)`.
- Adjust for elapsed time since the event start so break positions align with the original schedule (invariant 3).
- Emit break marks only (no green for planned events, by definition).
- Suppress any band that overlaps with the active event's time range (invariant 4).

After each event, compute trailing focus/cycle state for inheritance to the next event.

## Overlapping events

### Fully contained

If one event fully encloses another, the enclosed event is filtered out. Only the enclosing event's config drives the rail.

### Partially overlapping (no active session)

The earlier-starting event takes priority for the overlapping portion. The later event only contributes bands after the earlier event ends.

### Partially overlapping (with active session)

The active session takes priority. Planned bands from all other overlapping events are suppressed for the active event's entire time range.

### Result for the user

The rail always shows one coherent schedule at any given time. Never a mix of two configs.

## Edge cases

### App opened after event started

The session starts from now, not from the event's calendar start. The time between the event start and the session start has no green fill (the user wasn't working). Planned break marks for events without a session are positioned as if the schedule started at the event start (via elapsed-time adjustment), so the first visible break may be closer than a full focus period.

### Multi-day events

Clipped to the current day for rendering. Segments use absolute timestamps, so they map correctly regardless of which day the rail is rendering.

### Recurring events

Each instance gets its own segments. When a recurring instance is detached into a standalone event, segment references are transferred.

### Break overtime

After a break timer reaches 0, overtime accumulates for up to 30 minutes. The break mark grows in real-time. After 30 minutes, the system auto-advances to focus.

### Session stop or event deletion

Stopping a session marks the current segment `interrupted` and remaining planned segments `skipped`. Deleting the event cascades to delete all its segments.

## Future: productivity stats

The segment data model is designed to support detailed productivity analytics later. From the persisted segments, we can derive:

- **Focus score**: ratio of actual focus time to total elapsed time within focus segments (excluding pauses).
- **Completion rate**: how many planned focus segments were completed vs skipped/interrupted.
- **Break adherence**: whether the user takes breaks on schedule or skips them.
- **Idle patterns**: frequency and duration of idle pauses, time-of-day trends.
- **Daily/weekly totals**: sum of actual focus time across all segments.

This is why accurate tracking matters even when the rail itself is simple: the 3-color rail is the user-facing summary, but the segment table is the detailed record that powers stats, trends, and gamification features.

## Source files

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

# Time conflict detection

When two or more events share the same time slot, the calendar must decide what to render and what to auto-start. The decision is governed by a small set of definitions and tiebreakers, applied consistently across rail rendering, auto-start, and overlap visualization.

The user-visible behavior is described in `features/calendar.md` (active session protection) and `features/pomodoro-progress-displays.md` (band computation). This doc defines the underlying math.

## Definitions

Two events with start `aStart`, end `aEnd` and `bStart`, `bEnd`:

- **Disjoint:** `aEnd <= bStart` or `bEnd <= aStart`. No interaction.
- **Adjacent:** `aEnd == bStart` or `bEnd == aStart`. Touching but not overlapping. The boundary moment belongs to the later event.
- **Overlapping:** otherwise. The intersection `[max(aStart, bStart), min(aEnd, bEnd)]` is non-empty.
- **Containment:** A contains B if `aStart <= bStart` and `aEnd >= bEnd` and the durations differ. Equal-duration overlapping events are treated as identical-window, not contained.
- **Identical window:** `aStart == bStart` and `aEnd == bEnd`. Tiebreakers apply.

Containment is the strict case (one event is strictly larger and fully encloses the other). It is the most common pattern in real calendars: a long "Work" block with shorter focused blocks inside.

## Auto-start tiebreakers

When the system needs to pick which event auto-starts at a given moment (app open, current event ended, no manual selection), it considers all pomodoro events that include that moment and applies these rules in order:

1. **Active session takes priority.** If a session is already running on one of the candidates, that event wins. The user's active intent overrides any other rule.
2. **Interrupted session takes priority over fresh.** If no session is running but one of the candidates has a recently interrupted session (within an idle-tolerance window), the user's last intent is restored.
3. **Shorter remaining duration wins.** Of the remaining candidates, pick the one with the least time left. A 30-minute event that is half over has 15 minutes remaining; a 4-hour event has more. The shorter remaining is more time-sensitive.
4. **Earliest creation order wins.** If two candidates have identical remaining durations, the one with the earlier `created_at` wins. This makes the choice deterministic without requiring the user to set a manual priority.

The same rules apply when the user has just stopped a session and auto-start fires within 30 seconds: the system picks the next candidate using the same logic, including any other event that may have started during the gap.

**Example, two events at 09:00.** "Morning Standup" (09:00-09:30) and "Deep Work" (09:00-12:00). Both have pomodoro and auto-start. The user opens the app at 09:00. Rule 3 picks Standup (30 minutes remaining beats 3 hours remaining). When Standup ends at 09:30, the system re-evaluates: Deep Work is now the only candidate, so it auto-starts.

**Example, app opened mid-overlap with an interrupted session.** Standup (09:00-09:30) and Deep Work (09:00-12:00). The user had an interrupted session on Deep Work yesterday morning that auto-recovery restored from heartbeat. Today they open the app at 09:15. Rule 2 picks Deep Work (interrupted session takes priority over fresh).

## Containment in band rendering

When containment is present in the rail's day, the band algorithm ensures one event's schedule owns each minute. The rules:

- **Innermost active wins.** If any contained event has an active session, that event takes priority in the overlap region; the enclosing event contributes bands only outside.
- **Otherwise, outermost wins.** With no active session, the outer event's schedule governs the rail. This matches the user's mental model: the long Work block sets the cadence, the short Sprint block is a finer-grained intent that hasn't been activated yet.
- **Identical-window tie.** When two events share the exact same window, the active one wins. With neither active, the earlier-created one wins.

**Example, triple stack.** "Work Block" 09:00-17:00, "Sprint" 10:00-15:00, "Quick Task" 11:00-11:30. All have pomodoro. With no active session, the outer event (Work Block) governs the rail throughout. If the user starts a session on Sprint, the rail switches to Sprint's cadence from 10:00-15:00 (Sprint is active, takes priority over the enclosing Work Block). If the user instead starts a session on Quick Task, the rail switches to Quick Task's cadence from 11:00-11:30, and Sprint reclaims 10:00-11:00 and 11:30-15:00.

## Partial overlap rules

Two events overlap without one fully containing the other.

**No active session.** The earlier-starting event takes priority for the overlapping portion. The later event contributes bands only after the earlier event ends.

**Example.** "Morning Focus" 09:00-11:00 (40/5) and "Team Project" 10:00-12:00 (25/5). They overlap from 10:00-11:00. No session is running. The rail shows 40/5 break marks from 09:00-11:00 (Morning Focus governs the entire overlap), then 25/5 break marks from 11:00-12:00 (Team Project takes over after Morning Focus ends).

**With an active session.** The active session takes priority for its entire window. Other events' projected bands are suppressed within the active event's range, even if they extend beyond it.

**Example.** Same events, but the user starts a session on Team Project at 10:15. Team Project is active from 10:00-12:00. Morning Focus's break marks from 10:00-11:00 are suppressed (they would conflict with Team Project's 25/5 cadence). The rail shows: 40/5 break marks from 09:00-10:00 (Morning Focus alone), green fill and 25/5 break marks from 10:15-12:00 (Team Project active), empty from 10:00-10:15 (overlap region but Team Project's session has not started yet).

## Why deterministic tiebreakers

Across rail rendering and auto-start, the same tiebreaker rules are used. If they diverged (rail picks the longer event, auto-start picks the shorter), the rail would show one event's schedule while the timer ran on another. The user would see a green fill that does not match the visible block.

The rules are deterministic and depend only on event properties (start, end, created_at, active state, recent interrupted state). No randomness, no implicit user preference, no hidden state. The same input always produces the same answer.

## Worked example: full day with overlaps

The user has four events on Monday:

- "Morning Standup" 09:00-09:30 (no pomodoro).
- "Deep Work" 09:00-12:00 (40/5/10 pomodoro, auto-start on).
- "Lunch" 12:00-13:00 (no pomodoro).
- "Sprint" 13:00-14:00 (25/5/15 pomodoro, auto-start on).

The user opens the app at 09:00.

- 09:00: candidates for auto-start are Deep Work (Standup has no pomodoro). Rule 1 does not apply (no active). Rule 2 does not apply. Rule 3 picks Deep Work as the only candidate. Session starts on Deep Work.
- 09:00-09:30: rail shows Deep Work's green fill (active) and break marks. Standup is rendered as a normal event block at the top of the day column but contributes nothing to the rail (no pomodoro).
- 09:30: Standup ends. No effect on Deep Work's session.
- 12:00: Deep Work block expires. The system looks for a transition target. Lunch has no pomodoro, so no inheritance. Sprint starts at 13:00, outside the inheritance window. Deep Work's run ends with `end_reason = completed`.
- 12:00-13:00: rail shows past Deep Work segments (frozen). No active session. No projected breaks (no pomodoro on Lunch).
- 13:00: Sprint begins. Auto-start fires. Sprint is the only candidate, starts a session. Rail shows Sprint's green fill and 25/5/15 break marks.
- 14:00: Sprint ends, run closes.

# Data invariants

These hold across the whole app. Any operation that can break one is wrong, regardless of which feature it belongs to. The list is numbered for cross-referencing from feature and algorithm docs; the numbers are stable.

A violation is a bug in whatever code produced it: the data layer, the derivation logic, or the renderer's visual math. The renderer must not paper over bad data with cosmetic clamps, and the data layer must not lean on the renderer to hide impossible state. Each side has to be correct on its own.

## 1. Green never appears after the current time

A focus fill band on the rail can only exist for a segment with `actual_start` in the past and recorded work. Any time the rail shows green beyond the current moment, something is wrong: the segment data, the projection logic, or the visual math that maps time to pixels under the current scroll position, calendar zoom, or app scaling.

**Why:** the rail is a record of what happened, not a forecast. Green ahead of "now" would suggest progress the user has not actually made, undermining the trust the rail builds.

**What would break:** the user could be misled into thinking they have already focused, leading them to skip a session they meant to do. Analytics derived from green time would inflate.

**Enforced by:** segment fetch (no future timestamps from the database), the active-segment renderer (clamps to `now`), the projected-band renderer (emits break marks only, never green), and a single time-to-pixel transform shared by the `now` indicator and any green band. That transform must stay correct under every viewport state: scroll position, calendar zoom (25 to 200 px/hour), and app or OS scaling. A green pixel past the `now` line under any zoom or scroll combination is a real violation, not a rounding artifact to ignore.

## 2. Exactly one segment is `active` at a time

Across all runs in the database, at most one segment row carries `status = active`. Two would mean the timer is running two things simultaneously.

**Why:** the timer state machine assumes a single active phase. Pauses, transitions, reconfigurations, and crash recovery all key off the active segment.

**What would break:** double pauses on the wrong segment, transitions that end the wrong run, recovery picking the wrong segment to mark interrupted.

**Enforced by:** session start/transition/reconfigure code paths (always close the previous active segment before creating a new one), and crash recovery (closes any stale active segments on startup).

## 3. Break positions are stable within a session

For a running session, the planned positions of upcoming breaks are deterministic from the run's `started_at`, config snapshot, and inherited state (`inherited_focus_minutes`, `inherited_cycle`). Once the session is running, these positions do not shift.

For events without an active session, projected break marks are computed from "now" and naturally shift each tick. This is a different surface, see `features/pomodoro-progress-displays.md`.

**Why:** if break positions slid around while the user was working, the rail would feel unreliable; the user would not know whether the break mark in front of them was a real commitment or a moving target.

**What would break:** users would lose trust in the schedule. The state machine's assumption that "next break is at minute X" would be invalidated mid-session.

**Enforced by:** plan derivation reads only the run's snapshot fields, never "now," for active sessions.

## 4. No duplicate bands in the same time range

The rail shows one coherent schedule at any point in time. Two overlapping events must never both contribute bands (green or break) to the same minute range.

**Why:** the user must not see, for example, a 25/5 break cadence and a 40/5 break cadence interleaved over the same hour. That makes the rail unreadable.

**What would break:** visual ambiguity, conflicting break notifications, double-counting in analytics.

**Enforced by:** timeline band computation (containment filter and active-event suppression, see `features/pomodoro-progress-displays.md`).

## 5. Persisted data is the source of truth for the past

The rail renders past time from segment records, never from re-computation of what "should have happened." If a session was interrupted, the green stops where it stopped. If a break was skipped, no break band appears for that slot.

Future time is rendered from config-based projections derived from the run's `started_at`, config snapshot, and inherited state. The planned schedule is never stored as separate rows because it is fully deterministic from these fields. See `algorithms/pomodoro-segments-and-plan.md` for the derivation.

**Why:** treating the past as truth is the foundation for honest analytics. Rebuilding it from "what should have happened" would mask gaps and inflate focus time.

**What would break:** AI suggestions and stats would optimize for the imagined ideal instead of the user's real patterns.

**Enforced by:** rail rendering reads segments for past time and pauses for green-fill splitting; never recomputes.

## 6. Past progress is never erased

Once a segment has `actual_start` set and its status is `completed` or `interrupted`, no user action may delete, overwrite, or hide it. Skipping a break, stopping the session, dismissing the idle overlay, reconfiguring pomodoro settings, the app closing unexpectedly, deleting a calendar event, or archiving the calendar event: none of these remove previously recorded work. There is no mechanism to delete individual segments.

**Why:** the system is honest with the user about their patterns. Letting users (or operations) wipe out evidence breaks the contract that the app is a record, not a manipulable narrative.

**What would break:** users would learn to "clean up" sessions they regret, defeating the anti-procrastination feedback loop.

**Enforced by:** absence of any delete-segment API. Even structural calendar operations (detach, split, template-wide edit) preserve segments by transferring run references rather than dropping them.

## 7. Past events are never deleted

A calendar event whose end time is in the past can only be archived, never deleted. This applies regardless of whether the event has tracking data. An event where the user planned to focus but never opened the app is still valuable: the absence of work on a planned block is itself a procrastination pattern. Only future events (entirely in the future, no tracking data) can be truly deleted.

**Why:** this is invariant 6 generalized to events. The shape of the user's schedule is part of the historical record; deleting past blocks rewrites the past.

**What would break:** analytics would lose context (what was planned versus what happened). AI estimates would mistake the absence of an event for the absence of an attempt.

**Enforced by every programmatic boundary:**

- **UI:** no delete button is rendered on a past event. The only available action is archive.
- **CLI (`ganbaruai`):** delete commands on past events are rejected with a descriptive error pointing to archive. The rejection is logged with timestamp, command, and event ID.
- **MCP handlers:** event deletion handlers refuse past events at the handler level and return a structured error including the archive alternative.
- **Internal Tauri commands and database layer:** every DELETE on `calendar_events` is guarded by `end_time > now()`. The guard is the last-resort protection in case a higher layer has a bug.
- **AI agent integration:** system prompts and tool descriptions communicate the policy. Repeated rejection attempts by an agent are logged for diagnostic purposes.

The user owns the SQLite file and can modify it directly with a third-party tool. The app does not attempt to prevent that. But every code path inside the app must refuse.

Recurring events have additional protection: structural changes that would cause protected occurrences to silently stop expanding (an EXDATE on a protected date, an UNTIL moved earlier, a pattern change that excludes protected dates) must preserve those occurrences first. This is not a visible-window-only rule. For supported recurrence rules, structural edit code must reason over all affected occurrences from the template start through the captured edit time, using each occurrence's end time rather than only its date. Same-day occurrences that already ended are protected; same-day occurrences that have not ended remain mutable. A capped historical template is preferred when it can preserve the protected range without changing its meaning. Detached standalone events are required when an occurrence needs its own event ID or cannot be represented safely by the capped template. Occurrences with runs, segments, overrides, exceptions, active sessions, or persisted references are always protected. See `features/calendar-recurrence.md`.

## Adding new invariants

When an operation reveals a constraint the system depends on but had not stated explicitly, add it here as the next number. Number reuse is forbidden; numbers may be marked deprecated but never recycled. Each new invariant gets the same five fields: statement, why, what would break, enforced by, plus any cross-doc links.

Operations are not invariants. "We always validate input" is a practice; "no segment may exist without a parent run" is an invariant. The test is whether the property must hold across every state of the database, regardless of which code path produced that state.

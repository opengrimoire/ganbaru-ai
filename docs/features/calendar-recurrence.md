# Calendar recurrence

Recurring events let the user describe a schedule once ("daily", "every Monday and Wednesday", "first Tuesday of each month") and have the calendar generate instances over time. The model balances two requirements that pull in opposite directions: efficient storage (one row per pattern, not one row per occurrence) and faithful preservation of the past (existing instances must not silently disappear when the user edits the rule).

This doc covers the user-facing model and the recurring-event structural operations. The detailed event panel preview, scope switching, and save semantics are in `features/calendar-recurrence-editing.md`; when this doc summarizes an edit flow, that focused editing spec is the source of truth for edge cases. The expansion math is in `algorithms/recurrence-expansion.md`. The invariants that protect past instances are in `data/invariants.md` (invariant 7).

## Supported RRULE subset

The app implements a practical subset of RFC 5545:

- **FREQ:** `daily`, `weekly`, `monthly`, `yearly`.
- **INTERVAL:** any positive integer (`every 2 weeks`, `every 3 months`).
- **BYDAY:** weekday membership for weekly recurrence (`MO`, `TU`, ...) and ordinal-prefixed days for monthly/yearly (`2TU` for second Tuesday, `-1FR` for last Friday).
- **BYMONTHDAY:** day-of-month numbers for monthly recurrence, supporting negative values for end-of-month (`-1` for last day).
- **BYMONTH:** month numbers for yearly recurrence.
- **BYSETPOS, BYWEEKNO, BYYEARDAY, WKST:** supported for advanced patterns.
- **COUNT:** total number of occurrences (`5 times then stop`).
- **UNTIL:** end date (`stop after 2026-12-31`).
- **EXDATE:** exception dates that should not expand (`every weekday except 2026-04-15`).

These cover the common cases (workout schedules, weekly meetings, monthly invoices) and the advanced ones (last business day of each quarter). Unsupported parts of RFC 5545 (free-form RDATE rules with timezones-per-date, full BY* combinations beyond the above) round-trip on import as opaque strings so external sources are not corrupted, but the editor will not produce them.

The UI offers presets (none, daily, weekdays, weekly, monthly, yearly) and an advanced editor for everything else. Power users rarely touch the advanced editor; preset buttons cover the bulk.

## Template plus instance model

A recurring event lives as a single row in `calendar_events` with a non-null `recurrence_rule`. Instances are derived on read by expanding the rule against a window. Each derived instance has a synthetic ID:

```
<templateId>::YYYY-MM-DD
```

For example, a daily event with template ID `7f2c...` produces instances `7f2c...::2026-04-16`, `7f2c...::2026-04-17`, and so on.

The template itself is also a valid first occurrence. Its ID is the plain template UUID (no `::date` suffix). Code that resolves event IDs must accept three formats:

1. A plain UUID for non-recurring events or the template's first occurrence.
2. A synthetic `UUID::date` for derived instances.
3. A null reference, joined back to `calendar_events_archive` (for archived events).

This three-format contract is also documented in `data/schema.md` because it affects every join that touches `pomodoro_runs.event_id`.

Each instance gets its own runs and segments, independent of other instances. There is no inheritance of pomodoro state across instances: Monday's session ending mid-cycle does not carry over to Tuesday. Each new day starts fresh. This matches the user's mental model (Monday's deep work and Tuesday's deep work are separate blocks of time) and avoids cross-instance dependencies that would compound over a long-running series.

## Structural operations

When a user edits an event that was already part of a saved recurring series, the scope picker offers three choices: this, following, all. Each maps to a structural operation. Adding repeat to a saved non-recurring event does not show this picker because there is no existing series to scope.

### Detach ("edit this")

A single instance is pulled out of the source series. The template gains an exception (EXDATE) for that date so the instance no longer expands from the source rule.

If repeat is unchanged or cleared, the detached result is a standalone non-recurring event with a new UUID. All runs whose `event_id` matches the synthetic ID `templateId::date` are updated: their `event_id` and `original_event_id` move to the standalone UUID.

If repeat is set or changed while using scope "this," the detached result becomes an independent recurring template anchored on the selected occurrence. The source template still only receives the exception date for the selected occurrence; later source-series occurrences continue unchanged.

**Example.** "Daily standup" recurs every weekday. The user edits Wednesday's instance with scope "this," changing the title to "Retro." Wednesday is detached: a new standalone event "Retro" is created. The template gains EXDATE = Wednesday's date. Any runs recorded on that Wednesday are transferred to the standalone's UUID. Thursday's instance continues expanding normally from the template.

**Example, independent repeat.** "Daily standup" recurs every weekday. The user selects Wednesday, chooses scope "this," and changes it to repeat monthly. Wednesday is detached from the weekday source series and becomes a new monthly template. Thursday still expands from the original weekday source series.

When to choose detach: a one-off variation that should not affect the series.

### Split ("edit/delete following")

The template is capped with an UNTIL date set to the day before the selected instance. If repeat remains set, a new template is created starting from the selected instance with the updated properties and recurrence config. If repeat is cleared, the selected instance becomes one non-recurring survivor and later instances stop expanding.

Runs on past instances still reference the old template, which still exists, just capped. Runs on new recurring future instances reference the new template's synthetic IDs. When repeat is cleared, runs on the selected synthetic instance transfer to the selected survivor.

**Example.** "Study session" recurs daily at 09:00. The user selects Thursday and edits with scope "following," changing the time to 10:00. The old template gets UNTIL = Wednesday. A new template starts Thursday at 10:00 with the same recurrence rule. Monday through Wednesday's runs still reference the old template. Thursday onward generates instances from the new template.

**Example, clearing repeat.** "Study session" recurs daily at 09:00. The user selects Thursday, chooses scope "following," and turns repeat off. The old template gets UNTIL = Wednesday. Thursday becomes one non-recurring survivor. Friday and later daily instances disappear.

When to choose split: a permanent change that should apply going forward but not retroactively.

### Template-wide edit ("edit all")

For a normal template-wide edit where repeat remains set, the template's properties are updated directly after any protected past instances are materialized. Past instances that would otherwise move, vanish, or change in a way that rewrites history are detached first to preserve invariant 7.

**Example.** "Weekly review" recurs every Friday at 16:00. The user changes it to 15:00 with scope "all." Past Friday instances would now expand at 15:00, but their tracking data was recorded at 16:00. The system detaches every past Friday into a standalone event at 16:00 first, then updates the template to 15:00. Future Fridays expand at 15:00.

If repeat is cleared with scope "all," the series collapses. The selected occurrence becomes the single non-recurring survivor for the series identity, even when that occurrence is synthetic and not the original template date. Protected past occurrences are materialized first, active-session protection may materialize an additional standalone when the active occurrence is different from the selected survivor, and future occurrences stop expanding.

When to choose all: a change that the user wants applied to the whole series from the selected edit perspective, while the app protects historical data automatically.

## Recurring scope selector UX

The scope picker appears when the event being edited was already part of a saved recurring series when the panel opened. It appears for both the template's first occurrence and synthetic occurrences. It does not appear merely because the user adds repeat to a saved non-recurring event during the edit.

Default selection:

- For a one-off cosmetic change (color, title, description on a single instance), default is "this."
- For a structural change (time shift, recurrence rule change, deletion), default is "following."
- For a config-only change (pomodoro settings, notification offsets) the user explicitly initiated on the template, default is "all."

The defaults are hints. The user can pick any scope.

## Five invariant 7 enforcement scenarios

Five operations can cause past instances to silently stop expanding from a recurring template. Each one would violate invariant 7 by removing past records from the calendar's surface (and with them, the analytical signal of those dates). Before any of these takes effect, the system identifies every affected past instance and detaches each into a standalone event first.

1. **Adding an exception (EXDATE) for a past date.** The standalone preserves the date in the calendar.

2. **Moving UNTIL to before existing past instances.** All past instances beyond the new UNTIL are detached.

   **Example.** "Morning routine" recurs daily, no end date. Today is April 11. The user sets "end after April 5" with scope "all." Instances from April 6 through April 10 are in the past and would stop expanding. Each is detached before the UNTIL is applied.

3. **Reducing the occurrence count below the number of past instances.** All past instances beyond the new count are detached.

4. **Changing the recurrence pattern so a past date no longer matches.** Example: switching "every weekday" to "every Monday" removes past Tuesday through Friday instances. Each affected past instance is detached.

   **Example, pattern change.** "Exercise" recurs every weekday. The user changes it to "every Monday" with scope "all." Before applying, the system computes which past dates matched the old pattern but not the new one. Past Tuesdays, Wednesdays, Thursdays, and Fridays would vanish. Each is detached into a standalone event. Runs on those dates (if any) are transferred. Dates with no runs still get a standalone event (the absence of work is data). Then the template's pattern updates to "every Monday."

5. **Removing recurrence entirely with scope "all."** Every affected past instance is detached. The selected occurrence becomes the single non-recurring survivor, even when that selected occurrence is synthetic and not the original template date. Future occurrences stop expanding.

   **Example.** "Weekly review" recurs every Friday. The user selects the next Friday occurrence and removes recurrence with scope "all." Past Friday instances are detached into standalone events as needed. The selected next Friday becomes the non-recurring survivor. Future Fridays stop expanding.

For supported recurrence frequencies, this protection is exact for all affected past dates from the template start through the edit time. It is not tied to the visible window. The planner may use fast-forwarded recurrence math, but it must still protect any date with runs, segments, overrides, exceptions, an active session, or another persisted reference. If an imported malformed rule cannot be enumerated safely, the import or edit path must stop with a diagnostic or apply an explicit documented safety policy before changing the template; it must not silently rewrite history.

## Active session continuity during recurrence edits

When the user edits a recurring event's recurrence settings while a session is running on one of its instances, the active session must survive regardless of the scope or the nature of the change.

**Scope "this":** if the selected occurrence is active, it is detached. If repeat is unchanged or cleared, the active session transfers to the standalone's UUID. If repeat is set or changed, the active session transfers to the detached independent template's first occurrence. If another occurrence in the same source series is active, it is unaffected.

**Scope "following":** the series splits. If the active instance is at the requested split point, active-session protection wins and the effective split moves to the next occurrence. The active instance stays on the old template, which is capped at the active occurrence. If repeat was cleared, no new future template is created and later occurrences stop. If the active instance is before the split point, it is unaffected. If the active instance is after the split point, it moves to the corresponding occurrence in the new template when repeat remains set, or is materialized as a standalone when repeat is cleared.

**Scope "all":** four steps in order:

1. Materialize every protected past occurrence that would vanish, move, or change meaning (invariant 7, as above).
2. Materialize or reuse the selected occurrence as the save operation requires.
3. Transfer the active session if the active occurrence is materialized, moves to a new template, or becomes the selected survivor.
4. Apply the template-wide change or collapse. The session continues on the materialized occurrence, new-template occurrence, or survivor and does not transition to an unrelated recurring instance.

**Example, removing recurrence while active.** "Daily focus" recurs every day. The user is mid-session on today's instance and removes recurrence with scope "all." Past protected instances are detached. Today's selected occurrence becomes the non-recurring survivor, and the active session transfers to that survivor if needed. Future daily instances stop expanding. The active session finishes normally on the survivor.

**Example, changing pattern while active.** "Study" recurs Mon/Wed/Fri. Today is Wednesday, session is active. The user changes to "Mon/Thu" with scope "all." Wednesday is no longer in the new pattern, so today's instance would vanish. The system detaches today's instance first (session transfers), detaches past Wednesdays and Fridays, then applies the pattern change. The session continues on the standalone Wednesday.

**Example, adding recurrence to an active non-recurring event.** The user has "Project work" 14:00-16:00 with a running session. They add "repeat daily." The event becomes a template. The active run's `event_id` is the base UUID (the template ID), which is also the first occurrence. Tomorrow's instance will be `UUID::2026-04-17`. The session continues because the template's base ID is still a valid first occurrence. Code must not assume all recurring instances have `::date` suffixes; the template's own occurrence uses the base UUID.

## Time-shift disconnect

When a scope "all" edit changes the event's time (e.g. 09:00-10:00 becomes 14:00-15:00), past instances would re-expand at the new time. Any runs recorded on those instances have segments with timestamps at the old time. The rail would show the event block at 14:00 but green fill at 09:00, outside the visible block.

The detach-past behavior described above resolves this naturally: past instances are detached at their original time. The standalone events preserve the original 09:00-10:00 schedule. Only future instances get the new 14:00-15:00 time.

This is not an additional rule. It is a natural consequence of the "detach past instances before any change" approach. If past instances are always detached before template-wide edits, their time, pattern, and config are frozen at the point of detachment.

**Example.** "Morning meeting" recurs daily at 09:00-09:30. The user changes it to 14:00-14:30 with scope "all." Past instances are detached at their original 09:00-09:30 time. The template updates to 14:00-14:30. Future instances expand at the new time. Past standalone events keep 09:00-09:30, and their runs align correctly.

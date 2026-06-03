# Calendar recurrence

Recurring events let the user describe a schedule once ("daily", "every Monday and Wednesday", "first Tuesday of each month") and have the calendar generate instances over time. The model balances two requirements that pull in opposite directions: efficient storage (one row per pattern, not one row per occurrence) and faithful preservation of the past (existing instances must not silently disappear when the user edits the rule).

This doc covers the user-facing model and the recurring-event structural operations. The detailed event panel preview, scope switching, and save semantics are in `features/calendar-recurrence-editing.md`; when this doc summarizes an edit flow, that focused editing spec is the source of truth for edge cases. The expansion math is in `algorithms/recurrence-expansion.md`. The invariants that protect historical instances are in `data/invariants.md` (invariant 7).

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

The template itself is also a valid first occurrence. Its ID is the plain template UUID (no `::date` suffix). Pomodoro history stores two event identities:

1. `pomodoro_runs.event_id` and `pomodoro_segments.event_id` are nullable live FKs to the canonical calendar row. For generated occurrences, this is the parent template UUID while the occurrence is live.
2. `pomodoro_runs.original_event_id` preserves the exact occurrence identity. For generated occurrences, this is the synthetic `UUID::date`.
3. When a protected occurrence or template is archived, live FKs become null and analytics joins through `calendar_events_archive.id = original_event_id`.

This two-field contract is also documented in `data/schema.md` because it affects every join that touches pomodoro history.

Each instance gets its own runs and segments, independent of other instances. There is no inheritance of pomodoro state across instances: Monday's session ending mid-cycle does not carry over to Tuesday. Each new day starts fresh. This matches the user's mental model (Monday's deep work and Tuesday's deep work are separate blocks of time) and avoids cross-instance dependencies that would compound over a long-running series.

## Structural operations

When a user edits an event that was already part of a saved recurring series, the scope picker offers three choices: this, following, all. Each maps to a structural operation. Adding repeat to a saved non-recurring event does not show this picker because there is no existing series to scope. If the selected recurring occurrence is active, the picker is hidden and the edit is treated as `Only this`.

### Detach ("edit this")

A single instance is pulled out of the source series. The template gains an exception (EXDATE) for that date so the instance no longer expands from the source rule.

If repeat is unchanged or cleared, the detached result is a standalone non-recurring event with a new UUID. Matching runs and segments move together: `pomodoro_runs.event_id`, `pomodoro_runs.original_event_id`, and `pomodoro_segments.event_id` all move from the template occurrence to the standalone UUID in the same transaction.

If repeat is set or changed while using scope "this," the detached result becomes an independent recurring template anchored on the selected occurrence. The source template still only receives the exception date for the selected occurrence; later source-series occurrences continue unchanged.

**Example.** "Daily standup" recurs every weekday. The user edits Wednesday's instance with scope "this," changing the title to "Retro." Wednesday is detached: a new standalone event "Retro" is created. The template gains EXDATE = Wednesday's date. Any runs recorded on that Wednesday are transferred to the standalone's UUID. Thursday's instance continues expanding normally from the template.

**Example, independent repeat.** "Daily standup" recurs every weekday. The user selects Wednesday, chooses scope "this," and changes it to repeat monthly. Wednesday is detached from the weekday source series and becomes a new monthly template. Thursday still expands from the original weekday source series.

When to choose detach: a one-off variation that should not affect the series.

### Split ("edit/delete following")

The template is capped with an UNTIL date set to the day before the selected instance. If repeat remains set, a new template is created starting from the selected instance with the updated properties and recurrence config. If repeat is cleared, the selected instance becomes one non-recurring survivor and later instances stop expanding.

Runs and segments on past instances still reference the old template through the live canonical FK, while `original_event_id` keeps the exact synthetic occurrence. Runs on new recurring future instances use the new template UUID for live FKs and the new synthetic ID for `original_event_id`. When repeat is cleared, runs and segments on the selected synthetic instance transfer to the selected survivor.

**Example.** "Study session" recurs daily at 09:00. The user selects Thursday and edits with scope "following," changing the time to 10:00. The old template gets UNTIL = Wednesday. A new template starts Thursday at 10:00 with the same recurrence rule. Monday through Wednesday's runs still reference the old template. Thursday onward generates instances from the new template.

**Example, clearing repeat.** "Study session" recurs daily at 09:00. The user selects Thursday, chooses scope "following," and turns repeat off. The old template gets UNTIL = Wednesday. Thursday becomes one non-recurring survivor. Friday and later daily instances disappear.

When to choose split: a permanent change that should apply going forward but not retroactively.

For delete or archive with scope "following," selecting a started occurrence is a history-only operation: one semantic plan archives started affected occurrences from the selected occurrence through the captured edit time and leaves later mutable occurrences in the repeat chain. Selecting a future occurrence keeps the structural delete behavior: protected occurrences in range archive first, then the template is capped before the selected occurrence so unprotected future occurrences disappear instead of being archived. The backend applies each plan atomically.

### Template-wide edit ("edit all")

For a template-wide edit where repeat remains set, the system first finds the protected history boundary. A protected occurrence is any occurrence that has already started by the captured edit time, plus any occurrence with runs, segments, overrides, exceptions, an active session, or another persisted reference that must not lose identity.

If no protected occurrence exists, the template can be updated directly. If protected occurrences exist, the preferred operation is to cap the old template at the last protected occurrence and create a new mutable template beginning at the first occurrence after that boundary. Detached standalones are reserved for occurrences that need their own event ID or cannot be represented safely by the capped historical template.

**Example.** "Weekly review" recurs every Friday at 16:00. The user changes it to 15:00 with scope "all" after several Fridays have already started. The old template is capped at the last protected Friday, preserving those 16:00 historical blocks. A new template starts at the first mutable Friday and expands at 15:00.

If repeat is cleared with scope "all," the mutable side collapses. The selected occurrence becomes the single non-recurring survivor for the mutable side, even when that occurrence is synthetic and not the original template date. Protected history remains visible through the capped old template or detached standalones. Future mutable occurrences other than the selected survivor stop expanding.

When to choose all: a change that the user wants applied to the whole series from the selected edit perspective, while the app protects historical data automatically.

For delete or archive with scope "all," selecting a started occurrence archives started occurrences from the template start through the captured edit time and leaves later mutable occurrences in the repeat chain. A future-only untracked series can still be hard deleted. When the selected occurrence is future and protected history exists, the protected history remains on the original template and the plan caps the series at the last started occurrence, or at the captured edit date when the protected generated occurrences were already removed as exceptions. Future protected occurrences inside the removed mutable side archive before the cap. The backend applies each plan atomically.

## Recurring scope selector UX

The scope picker appears when the event being edited was already part of a saved recurring series when the panel opened. It appears for both the template's first occurrence and synthetic occurrences. It does not appear merely because the user adds repeat to a saved non-recurring event during the edit, and it does not appear for the selected occurrence when that occurrence is the active pomodoro event. Active selected recurring occurrences save as `Only this`.

When only the scope changes and no event fields have changed, the preview is an affected-scope preview. It keeps the current window's occurrences in place and draws the preview contour on the occurrences that would be affected by `Only this`, `Following`, or `All`. For a started selected occurrence, `Following` and `All` contour only started occurrences because delete and archive from history do not touch future rows. For a future selected occurrence with protected history, `All` contours only the mutable future rows that would disappear. Field-change previews use the same affected-set rule for the contour: protected occurrences may keep their current geometry and content because history is immutable, but they still get the contour when the chosen scope will touch them. The delete/archive planner decides per occurrence whether the result is archive or hard delete. Delete and archive confirmation apply one final visible projection before the atomic backend batch runs, so affected visible occurrences disappear together rather than one archived occurrence at a time.

Default selection:

- For a one-off cosmetic change (color, title, description on a single instance), default is "this."
- For a structural change (time shift, recurrence rule change, deletion), default is "following."
- For a config-only change (pomodoro settings, notification offsets) the user explicitly initiated on the template, default is "all."

The defaults are hints. The user can pick any scope.

## Invariant 7 enforcement scenarios

Several operations can cause protected occurrences to silently stop expanding from a recurring template. Each one would violate invariant 7 by removing records from the calendar's surface, including the analytical signal of planned dates with no completed work. Before any of these takes effect, the system identifies every affected protected occurrence and preserves it.

A capped historical template is the preferred preservation mechanism when one rule can still represent the protected range without changing its meaning. Detached standalones are required for isolated exceptions, active occurrences that need their own identity, selected survivors, and imported or overridden instances that cannot be safely represented by the capped historical template.

1. **Adding an exception (EXDATE) for a protected occurrence.** The affected occurrence is archived or detached first so the exception does not erase it from history. Future untracked synthetic occurrence deletion only adds an EXDATE to the parent template.

   If a later `Following` split creates a new mutable template, exception dates at or after that new template's start are copied forward so detached, archived, or deleted occurrences do not regenerate as part of the new chain.

2. **Moving UNTIL to before protected occurrences.** Protected occurrences beyond the new UNTIL remain visible through the old capped template when possible, or through detached standalones when the old template cannot represent them safely.

   **Example.** "Morning routine" recurs daily, no end date. It is April 11 at 21:00. The user sets the mutable side to end after April 15. Instances through April 11 remain on the historical template. April 12 through April 15 remain on the mutable side. Later instances stop.

3. **Reducing the occurrence count below protected occurrences.** Protected occurrences beyond the new count remain visible before the count reduction applies to the mutable side.

4. **Changing the recurrence pattern so protected dates no longer match.** A capped historical template preserves the old pattern through the protected boundary. The new pattern starts at the first mutable occurrence.

   **Example, pattern change.** "Exercise" recurs every weekday. The user changes it to every Monday with scope "all" after Friday's 08:00 occurrence has already started. The historical template remains capped through Friday, so past Tuesday through Friday occurrences still exist even when they had no runs. The mutable template starts after the boundary and only expands Mondays.

5. **Removing recurrence entirely with scope "all."** Protected history remains visible through a capped historical template or detached standalones. The selected mutable occurrence becomes the single non-recurring survivor, even when that selected occurrence is synthetic and not the original template date. Other mutable occurrences stop expanding.

   **Example.** "Daily focus" starts Monday 08:00 to 09:00 and repeats daily. On Friday at 21:00, the user selects Sunday's occurrence and removes recurrence with scope "all." Monday through Friday remain on the historical template because their start times are protected. Saturday is mutable and disappears. Sunday becomes the non-recurring survivor. Later daily instances stop expanding.

For supported recurrence frequencies, this protection is exact for all affected protected occurrences from the template start through the captured edit time. It is not tied to the visible window, and it is based on each occurrence's start time, not only on the calendar date. Same-day occurrences that already started are protected; same-day occurrences that have not started and have no tracking remain mutable. If an imported malformed rule cannot be enumerated safely, the import or edit path must stop with a diagnostic or apply an explicit documented safety policy before changing the template; it must not silently rewrite history.

## Active session continuity during recurrence edits

When the user edits a recurring event while a session is running on one of its instances, the active session must survive, but the active selected occurrence cannot edit the repeat chain.

**Scope "this":** if the selected occurrence is active, it is detached. If repeat is unchanged or cleared, the active session transfers to the standalone's UUID. If repeat is set or changed, the active session transfers to the detached independent template's first occurrence. If another occurrence in the same source series is active, it is unaffected.

**Selected active occurrence:** the scope picker is hidden and Save uses `Only this`, even if the previous panel scope was `Following` or `All`. Direct manipulation can only resize the bottom edge to change the end time. Moving the block or resizing its top edge is disabled because the start time already has pomodoro history.

**Scope "following":** if the active occurrence is before the selected split point, it is unaffected. If the active occurrence is after the selected split point, Save materializes that active occurrence unchanged as a standalone event before splitting the series, then transfers the active run there. The new following chain does not move, retime, or otherwise rewrite the active occurrence.

**Scope "all":** protected history remains unchanged through the normal invariant 7 boundary. A protected active occurrence is part of that preserved side and is not moved or retimed by a template-wide edit started from another occurrence. Mutable future occurrences use the edited chain.

**Example, changing future times while today is active.** "Daily focus" recurs every day from 09:00 to 13:00. Monday's occurrence is active at 10:30. The user edits Tuesday and chooses `All`, changing the time to 14:00 to 18:00. Monday remains 09:00 to 13:00 with its active session intact. Tuesday and later mutable occurrences move to 14:00 to 18:00.

**Example, following edit across an active later occurrence.** "Daily focus" recurs every day. The user selects Monday and chooses `Following` while Wednesday is active. Save materializes Wednesday unchanged as a standalone event, transfers the active run there, and applies the following edit to the rest of the chain without moving Wednesday.

**Example, adding recurrence to an active non-recurring event.** The user has "Project work" 14:00-16:00 with a running session. They add "repeat daily." The event becomes a template. The active run's `event_id` is the base UUID (the template ID), which is also the first occurrence. Tomorrow's instance will be `UUID::2026-04-17`. The session continues because the template's base ID is still a valid first occurrence. Code must not assume all recurring instances have `::date` suffixes; the template's own occurrence uses the base UUID.

## Time-shift disconnect

When a scope "all" edit changes the event's time (e.g. 09:00-10:00 becomes 14:00-15:00), protected instances would re-expand at the new time if the old template were updated directly. Any runs recorded on those instances have segments with timestamps at the old time. The rail would show the event block at 14:00 but green fill at 09:00, outside the visible block.

The protected-history behavior described above resolves this naturally: protected instances keep their original 09:00-10:00 schedule through a capped historical template or, when needed, detached standalones. Only mutable instances get the new 14:00-15:00 time.

This is not an additional rule. It is a natural consequence of separating protected history from mutable future instances before applying template-wide edits.

**Example.** "Morning meeting" recurs daily at 09:00-09:30. The user changes it to 14:00-14:30 with scope "all" after today's meeting has started. Today's protected 09:00-09:30 occurrence remains unchanged. The mutable template starts at the first later mutable occurrence and expands at 14:00-14:30. Historical runs align with their original event blocks, and the active occurrence is not split.

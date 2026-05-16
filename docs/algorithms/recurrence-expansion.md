# Recurrence expansion

Given a calendar event with a recurrence rule, expansion produces the list of concrete instances that fall within a time window. The output is what the calendar renders; the input is what the user typed (or what an import populated).

The user-facing model and recurrence structural operations are in `features/calendar-recurrence.md`. This doc covers the math.

## Inputs

- **Template event.** A `CalendarEvent` row with `recurrence_rule` non-null. The rule encodes FREQ, INTERVAL, and any BY* refinements (see the supported subset in `features/calendar-recurrence.md`).
- **DTSTART.** The template's `start_time`. Expansion always anchors to this.
- **Window.** A `[from, to]` pair. The expander returns only instances whose start falls within this window.
- **Exceptions (EXDATE).** A list of `YYYY-MM-DD` dates that should be excluded from the expansion.
- **Capping rules.** A requested window bound plus the cursor guard described below.

## Outputs

A list of expanded `CalendarEvent` objects. Non-first generated occurrences have:

- `id` set to `templateId::YYYY-MM-DD`.
- `start_time` and `end_time` shifted to the instance's date, preserving the time of day from the template.
- All other fields (color, pomodoro config, recurrence rule, etc.) inherited from the template.
- `recurringParentId` set to the template's UUID for traceability.

The first occurrence (the date of DTSTART) uses the template's plain UUID as its `id`, not a synthetic one. This means a non-detached, never-edited recurring event has its first occurrence indistinguishable from a non-recurring event by ID format. Downstream code that needs to know whether an event participates in recurrence must use the template's recurrence state and `recurringParentId`; it must not rely only on a `::date` suffix.

## Window bound and guard

Expansion is bounded by the requested window. The expander may fast-forward over occurrences before the window, emits only occurrences that overlap the window, and stops once the recurrence cursor is past the window end.

The implementation also keeps a guard on cursor iterations per template:

```ts
MAX_INSTANCES = 10000
```

This is a runaway guard, not the normal expansion bound. A daily recurrence would need roughly 27 years of cursor steps to hit it. Normal day, week, and month views terminate by the requested window before the guard matters.

If a rule has an explicit COUNT, expansion respects the count unless the cursor guard fires first. UNTIL caps in the natural way: expansion stops at the UNTIL date.

## Algorithm

1. **Parse the rule.** Decompose FREQ, INTERVAL, BY* fields, COUNT, UNTIL, WKST.
2. **Walk forward from DTSTART.** At each step, advance by INTERVAL units of FREQ (one day for daily, seven days for weekly, one month for monthly, one year for yearly).
3. **Apply BY* filters.** For each candidate date produced by the walk, check whether it satisfies the BY* constraints. BYDAY filters by weekday (with optional ordinal). BYMONTHDAY filters by day of month. BYMONTH filters by month. BYSETPOS picks specific positions from the candidate set within the FREQ unit.
4. **Skip EXDATEs.** Drop any candidate whose date matches an exception.
5. **Stop conditions.** Halt if any of these fire: candidate date is past UNTIL, total generated instances reach COUNT, cursor iteration reaches the 10,000 guard, or candidate date is past the requested window end.
6. **Filter to the window.** Keep only instances whose start falls within `[windowStart, windowEnd]`. Earlier instances are produced for completeness (so the COUNT/UNTIL semantics are correct) but not returned.

## EXDATE handling

Exceptions are stored on the template as a comma-separated list of `YYYY-MM-DD` strings. They are membership-only: an EXDATE removes the instance, it does not modify it. To modify a single instance, the user uses the detach operation (see `features/calendar-recurrence.md`), which both adds an EXDATE and creates a standalone event.

EXDATEs are absolute dates, not pattern-based. "Skip every December 25th" is not expressible as a single EXDATE; it would require one EXDATE per year. The advanced RRULE editor can express this via BY* refinements instead.

## Performance considerations

Expansion runs on every calendar read for the visible range. For a typical user (a few dozen recurring events, each with simple rules), expansion is fast: well under a millisecond per template.

Two strategies keep performance acceptable as the user's library grows:

**Incremental on edit.** When a recurring event changes, only that template's instances need to be re-expanded for the visible range. Other templates are untouched.

**Window-bound expansion.** The expander never speculatively produces instances beyond the requested visible range. A user looking at this week pays for one week's worth of emitted instances per template. Fast-forward helpers avoid walking every old occurrence for common daily, weekly, monthly, and yearly rules whose template starts far before the current window.

If a future profile shows expansion as a hot path, a per-template instance cache keyed on `(templateId, windowStart, windowEnd)` is a straightforward addition. It is not implemented now because no profile has shown the need.

## Edge cases

**DST transitions.** Times are stored in UTC, but recurrence "every day at 09:00 local" must respect local time across DST changes. The expander walks dates as zone-free `Temporal.PlainDate` values anchored to the template's home zone, then reattaches the template's original wall clock when materializing each instance. Since `PlainDate` arithmetic has no hours, days, or zones, the walk cannot drift through a DST transition. The instance's UTC instant is reconstructed at the boundary (display, comparisons, EXDATE matches) by combining the date plus wall clock plus home zone via `Temporal.PlainDateTime.from(...).toZonedDateTime(homeZone, "compatible")`. This means a daily 09:00 event in `America/Los_Angeles` produces instances at 09:00 local on every day, with UTC instants that shift by an hour across spring-forward and fall-back transitions. Ambiguous wall clocks (the second 1:30 AM during fall-back) resolve via the `compatible` disambiguation, picking the earlier instant per RFC 5545.

**Leap year and February 29.** A yearly recurrence anchored on February 29 only produces instances in leap years. A monthly recurrence with `BYMONTHDAY=29` skips February in non-leap years and skips it always when February has fewer than 29 days. The expander does not "round to the 28th" or fall through to March 1; the day simply does not match. The user can use `BYMONTHDAY=-1` (last day of the month) if they want February to participate.

**BYMONTHDAY=31 in 30-day months.** Same principle: the date does not match, the instance is skipped. This is RFC 5545-compliant behavior.

**Crossing midnight.** A 23:00-01:00 event recurs by start time. Each instance covers 23:00 to 01:00 the next day, regardless of expansion direction.

## Worked examples

**Daily, no end.**
Rule: `FREQ=DAILY`. DTSTART: 2026-04-16 09:00. Window: 2026-04-16 to 2026-04-22.
Output: 7 instances, one per day, each at 09:00. IDs: `<template>` (April 16, the template's own first occurrence), `<template>::2026-04-17`, ..., `<template>::2026-04-22`.

**Weekly on weekdays.**
Rule: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`. DTSTART: 2026-04-13 09:00 (Monday). Window: 2026-04-13 to 2026-04-26.
Output: 10 instances, weekday dates only. April 13, 14, 15, 16, 17, 20, 21, 22, 23, 24.

**Monthly with BYMONTHDAY=-1 (last day).**
Rule: `FREQ=MONTHLY;BYMONTHDAY=-1`. DTSTART: 2026-04-30. Window: 2026-04-01 to 2027-03-31.
Output: 12 instances, one per month, on each month's last day (April 30, May 31, June 30, July 31, August 31, ..., March 31).

**Bi-weekly with COUNT.**
Rule: `FREQ=WEEKLY;INTERVAL=2;COUNT=5`. DTSTART: 2026-04-16. Window: any.
Output: exactly 5 instances. April 16, April 30, May 14, May 28, June 11. Even if the window extends further, COUNT caps the output.

**Daily with EXDATE.**
Rule: `FREQ=DAILY`. DTSTART: 2026-04-16. EXDATE: `2026-04-18`. Window: April 16 to April 20.
Output: 4 instances. April 16, 17, 19, 20. April 18 is excluded.

**Pathological: huge count from a bad import.**
Rule: `FREQ=DAILY;COUNT=9999999`. DTSTART: 2000-01-01. Window: 2026-04-16 to 2026-04-22.
Output: only the seven overlapping daily instances in the requested window, unless malformed data prevents safe fast-forwarding and hits the cursor guard first. The system does not attempt to expand the full multi-million-instance set.

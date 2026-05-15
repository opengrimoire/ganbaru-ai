# Recurrence and timezones

Recurrence and timezones are the highest-risk part of iCalendar compatibility. The implementation must preserve exact source data and project only what it can expand correctly.

## Time value categories

GanbaruAI must distinguish:

- date-only values, such as `DTSTART;VALUE=DATE:20260513`
- UTC date-time values, such as `DTSTART:20260513T150000Z`
- `TZID` date-time values, such as `DTSTART;TZID=America/New_York:20260513T090000`
- floating date-time values, such as `DTSTART:20260513T090000`
- duration values, such as `DURATION:PT1H`
- period values, such as `FREEBUSY:20260513T090000Z/20260513T100000Z`

Projection can convert these to app row fields, but preservation must retain the original value type and parameters.

## All-day events

All-day iCalendar `DTEND;VALUE=DATE` is exclusive. GanbaruAI's internal all-day visible end date is inclusive.

Required conversions:

- import `DTSTART:20260513`, `DTEND:20260514` as visible May 13 only
- export visible May 13 only as `DTSTART:20260513`, `DTEND:20260514`
- preserve missing `DTEND` as one visible day unless a `DURATION` says otherwise
- keep `RECURRENCE-ID`, `EXDATE`, and `RDATE` date-only for all-day recurrences

## Floating timed events

Floating date-times have no UTC marker and no `TZID`. They are not the same as device-zone events.

Initial behavior:

- preserve floating status exactly in the lossless layer.
- project into the current render zone for display only.
- mark as partial if editing would convert it to a specific timezone.
- export as floating if the user did not make a timezone-changing edit.

Future behavior:

- add a projection flag for floating timed events if they become common in fixtures.

## Timezone strategy

For `TZID` values:

- if `TZID` is an IANA name, use it for projection and recurrence expansion.
- if `TZID` is a known Windows name, map to IANA for projection and preserve original `TZID`.
- if `TZID` has a custom `VTIMEZONE`, preserve the full definition.
- if custom rules can be matched to IANA confidently, use IANA for projection and preserve custom rules for export.
- if custom rules cannot be interpreted, preserve the component and warn before projection or export.

The app must not discard foreign `VTIMEZONE` definitions just because the current projection uses IANA zones.

## Recurrence storage

Preserve raw structured recurrence properties:

- `RRULE`
- `RDATE`
- `EXDATE`
- `RECURRENCE-ID`
- `RANGE=THISANDFUTURE`

Projection may continue to store normalized recurrence config for rendering, but the original recurrence property and value types remain in preserved data.

## RRULE completeness

Track all rule parts:

- `FREQ`
- `UNTIL`
- `COUNT`
- `INTERVAL`
- `BYSECOND`
- `BYMINUTE`
- `BYHOUR`
- `BYDAY`
- `BYMONTHDAY`
- `BYYEARDAY`
- `BYWEEKNO`
- `BYMONTH`
- `BYSETPOS`
- `WKST`

Projection can support these incrementally, but preservation must retain all legal parts.

## RDATE and EXDATE

Rules:

- Preserve value type per property.
- Preserve timezone parameters.
- For projected event exceptions, store recurrence local dates when the current recurrence engine needs date keys.
- On export from projection, emit exclusions at the master event's original start time.
- Do not use midnight for timed recurrence exclusions unless the master itself starts at midnight.

## RECURRENCE-ID

Rules:

- Value type must match the master `DTSTART` type.
- Zoned master events should export zoned recurrence IDs.
- UTC master events should export UTC recurrence IDs.
- All-day master events should export date-only recurrence IDs.
- Preserve `RANGE=THISANDFUTURE` even before full edit support exists.
- Imported cancelled recurrence overrides with `RANGE=THISANDFUTURE` suppress that occurrence and later generated occurrences during expansion.

## Expansion

Expansion must remain window-bounded:

- Generate only instances needed for the visible window plus any small prefetch window.
- Cap instance generation for pathological recurrence rules.
- Emit diagnostics when a cap is reached.
- Avoid expanding preserved-only unsupported recurrences during startup.
- Prefer a deterministic library or well-tested local algorithm over ad hoc recurrence logic.

## DST rules

Tests must cover:

- daily recurrence through spring-forward gaps
- daily recurrence through fall-back repeated hours
- weekly recurrence across DST transitions
- all-day recurrence across DST transitions
- custom `VTIMEZONE` transitions
- events whose local time exists in one zone but not another

For user-facing recurrence, wall-clock intent wins: a 9 AM daily zoned event stays at 9 AM local time.

## Semantic equivalence

Recurrence tests should compare occurrence sets in bounded windows, not only raw serialized strings.

For each recurrence fixture:

- parse source
- preserve source component
- project if supported
- expand a bounded window
- export
- parse export
- expand the same bounded window
- compare occurrence start/end pairs and value-type expectations

Unsupported recurrence data can pass preservation tests even before it passes projection tests.

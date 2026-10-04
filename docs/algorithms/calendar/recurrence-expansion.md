# Recurrence expansion

Recurrence expansion converts one normalized calendar template into bounded concrete occurrences for an inclusive civil-date window. TypeScript uses the result for calendar projection. Rust uses the same domain contract for backend reads and commands. Both consumers must produce equivalent identities and dates for the supported rule subset.

## Inputs and output

Inputs are:

- a template event with stable identity, start, end, and optional home zone;
- an optional normalized recurrence rule;
- exception dates, additional dates, and occurrence overrides;
- an inclusive window start and end as civil dates.

The output contains concrete events whose date span overlaps the requested window. An event may begin before the window and still be returned when its end reaches the window.

Non-recurring events pass through unchanged when they overlap. A template with additional dates but no recurrence rule produces its original occurrence plus eligible additional occurrences.

## Supported normalized rules

Current expansion applies:

- daily, weekly, monthly, and yearly frequency;
- positive interval;
- weekday selection for weekly rules;
- ordinal weekday selection for supported monthly and yearly rules;
- month-day and month selection for supported monthly and yearly rules;
- count or until termination;
- exception dates;
- additional dates;
- occurrence overrides and cancellation from a recurrence date.

Import may preserve more iCalendar properties than the expander applies. Preservation is not support. Current conformance gaps are listed below and should remain visible until interoperability fixtures and both expanders agree.

## Civil dates and instants

Recurrence walks local civil dates, not fixed UTC durations. TypeScript uses Temporal.PlainDate. Rust uses chrono's date-only representation. This keeps a weekly 09:00 event at 09:00 in its home zone across offset changes.

After selecting a civil occurrence date, the application combines it with the stored local time and home-zone policy to obtain instants where an instant is needed. Duration across a DST transition follows those instants. The recurrence date itself remains the local identity.

All-day occurrences use date spans directly. Timed multi-day occurrences preserve the template's civil day span and local time components. A positive stored interval can cross a repeated-hour boundary with its end wall clock earlier than its start wall clock. Native expansion preserves that original interval and uses its positive elapsed duration for later occurrences, where those reversed civil endpoints would be invalid.

## Window semantics

Both window bounds are inclusive civil dates. An occurrence overlaps when:

- its end date is on or after the window start; and
- its start date is on or before the window end.

Generation may fast-forward to the first date that could overlap, but it must preserve the same logical occurrence count as walking from the template. Fast-forward is an optimization, not a different recurrence rule.

## Expansion order

For one template:

1. Validate the date range, recurrence shape, positive interval, and bounds.
2. Preserve the original template ID for its first occurrence. Emit it when it overlaps and is not excluded or cancelled.
3. Walk or fast-forward the recurrence cursor according to the supported normalized rule.
4. Stop at the count limit, until date, cancellation-from boundary, window end, or hard iteration guard.
5. For each eligible recurrence date, apply exclusion and cancellation, preserve the template day span, then apply an exact-date override.
6. Add distinct additional dates that are not already generated, excluded, or cancelled.
7. Return deterministic concrete events. Callers apply their required display ordering.

An override changes the concrete occurrence fields while retaining original-series and recurrence-date provenance. A moved override remains associated with the recurrence instant it replaced.

## Concrete identity

The original occurrence keeps the template ID. A generated occurrence uses a deterministic identity derived from template ID and recurrence civil date. It also records the template as its recurring parent.

Identity does not depend on title, display time, current device zone, or expansion window. Expanding the same occurrence through a different window yields the same ID.

Persisted override rows have their own durable storage identity, but projections retain the generated occurrence and original-series relationships required by edits, project links, and Pomodoro history.

## Invalid dates

Rules such as day 31 do not silently clamp to day 30 in a month that has no 31st. The supported normalized rule either skips that candidate or advances according to its explicit ordinal logic. Leap-day behavior follows the same principle.

An ordinal weekday is calculated within its requested month. If the requested ordinal does not exist, that month contributes no occurrence.

Parser normalization and expander behavior must agree. A parser must not normalize an unsupported form into a superficially similar rule with different meaning.

## Exceptions, additional dates, and overrides

Exception dates remove an occurrence by recurrence civil date. Additional dates add an occurrence with the template's time and day span unless an override replaces its fields.

The same civil date appears at most once. A normal recurrence date and an additional date deduplicate. Exclusion or cancellation wins over ordinary emission.

An exact override is applied after base occurrence construction. A series cancellation-from boundary stops later generation. These precedence rules must be identical in TypeScript and Rust.

## Bounds and failure behavior

Expansion is bounded by the requested window and a hard 10,000-iteration guard per template. Imports and reads also bound the number of input events and recurrence data before expansion.

Invalid normalized data returns a controlled error in Rust or is rejected before frontend use. It must not hang, allocate without bound, or generate occurrences outside the requested window merely to satisfy a malformed count.

Do not document sub-millisecond performance without a benchmark. The durable requirement is bounded work proportional to the relevant window, with fast-forward for common long-running rules.

## Examples

### Daily count

A template beginning June 1 with a daily interval and count 3 has recurrence dates June 1, June 2, and June 3 before exclusions. A June 2 exception leaves June 1 and June 3. It does not create a June 4 replacement.

### Multi-day overlap

An occurrence spanning June 1 through June 3 overlaps a June 3 through June 7 window even though its start is before the window. It is returned.

### Weekly DST change

A 09:00 event in America/New_York remains at 09:00 on each selected weekday. Its UTC instant changes when the home-zone offset changes.

### Generated identity

If template event-1 produces June 8, the concrete projection uses the deterministic event-1 plus June 8 identity regardless of whether the caller expanded June alone or the entire quarter.

## Native implementation and preservation limits

### Preserved but unsupported rule parts

The native engine applies BYSETPOS, BYWEEKNO, BYYEARDAY and WKST, as described below. The superseded frontend and flattened DTO expanders did not apply these selectors and are removed. The frontend retains date-picker helpers and the iCalendar codec. Import/export preservation alone does not establish projection support; unsupported rules must retain their data and report a projection diagnostic.

The current weekly walk effectively uses its built-in week convention rather than an imported WKST value.

### COUNT and EXDATE

COUNT limits the RRULE set before EXDATE subtraction, including an excluded original. Direct canonical shared fixtures cover an excluded original, excluded later occurrences, all limited occurrences excluded, and navigation after earlier exclusions. Nonexistent home-zone wall times are omitted before COUNT.

### RDATE and RRULE termination

RDATE is an independent inclusion after RRULE COUNT or UNTIL. The canonical engine retains distinct additional dates past the rule's termination, deduplicates them, and lets EXDATE remove them. Shared fixtures cover these combinations.

### Native migration status

A native period-based engine now applies BYSETPOS, BYYEARDAY, BYWEEKNO, WKST, ordinal weekdays, and intersections of the supported date selectors. It skips invalid month/leap dates without drifting the original anchor, compares UTC UNTIL against instants, and expands in the event's home zone through native timezone data. Generated nonexistent wall times are skipped; repeated times use the first occurrence. Exact moved overrides are filtered after application and retain their original recurrence identity.

Main Calendar windows, Pomodoro scheduler reads, and Android reminder preparation now consume bounded canonical native reads. The frontend caches concrete occurrences and filters covering windows without recurrence generation. Committed mutations refresh the native snapshot; invalidated in-flight reads cannot replace newer state. Focus admission reads canonical ownership and day-plan context inside its accepted transaction. Existing-event editing uses native semantic previews and Save; the TypeScript scoped planner and executor have been removed. Creation preview and parts of delete/archive interaction retain frontend recurrence helpers. Those helpers do not acquire support for the additional rule parts merely because the native engine implements them. Complete interoperability conformance and physical acceptance remain open.

### Native recurrence partitions

The read-only native scope planner now derives both source recurrence sets for a split before applying draft changes. Partition membership uses original recurrence dates, including when an override moves the displayed occurrence. Override references select complete original rows so later persistence can preserve their metadata.

The historical side uses the generated prefix's COUNT, measured before exclusions and cancellation. This avoids an UNTIL rounding error for fractional stored timestamps. The following side preserves the original finite termination or unlimited rule. When a generated boundary can become the new anchor without changing period selection or civil duration, its COUNT subtracts the consumed prefix. Existing future exclusions and additional dates transfer to that side.

An off-pattern RDATE, a week-number rule near a year boundary, or a fold/gap-sensitive interval can require retaining the original anchor. The following side can then retain an earlier DTSTART while prefix exceptions make the split boundary its first visible occurrence. Those exceptions cover cancelled and excluded generated members as well, preventing them from reappearing when earlier overrides stay with the historical side. Explicit RDATE gaps retain their civil date; later-fold RDATEs retain their selected instant.

Both sides must reload through canonical expansion to reproduce exactly the original occurrence dates and geometry, with no overlap between sides. Prefix enumeration shares the request's work allowance and fails explicitly when it exceeds that allowance. Native scope analysis, visible edit preview, and reviewed Save use this partition implementation.

### Native scoped draft geometry

Native preparation now applies timing and recurrence intent to concrete source and edited sets. Metadata-only drafts retain the source geometry. An explicit endpoint edit uses the resolved selected interval, including its unchanged endpoint and complete civil day span, at the edited anchor. The anchor shifts by the selected start's civil-date difference. RRULE selectors remain as requested; changing DTSTART does not silently rewrite BYDAY or other selectors.

An unchanged rule retains the partition's cadence and finite termination when possible. A date, home-zone, or rule change can require a new anchor. The new side then consumes the original generated prefix exactly once. Promoting an off-pattern RDATE to DTSTART accounts for its new explicit COUNT slot and removes its old additional-date entry, while other additional dates remain independent. Prefix exclusions used only to retain the old cadence are removed when that cadence is replaced; authored exclusions remain.

EXDATE and retained override identities remain civil-date identities. Independent RDATEs retain their dates and adopt a changed shared clock. Explicit later-fold instants remain explicit when that clock and zone are unchanged. A reanchored selected override retains its original metadata reference while moving its recurrence identity to the new anchor. Date-kind and home-zone conversions preserve the authored meaning of other explicit override endpoints. Converting a timed rule to floating dates converts a timed UNTIL to the last admitted source home date, including a cutoff earlier than the source's daily time.

The concrete result is decoded with the canonical engine. A changed rule cannot activate malformed override geometry. Scope analysis, partitioning, and these exact override checks share one work allowance. Native prepared metadata rows feed both visible preview and reviewed atomic Save. Existing-event frontend actions use this boundary; complete recurrence-family conformance remains a separate acceptance requirement.

### Conformance and consumer boundaries

Canonical geometry and native window/scoped transaction tests cover fast-forward, multi-day overlap, exceptions, additional dates, moved overrides, cancellation, invalid month days, DST boundaries and explicit work exhaustion. The retained shared recurrence-set fixture is consumed directly by the canonical engine. Frontend tests validate native identity/projection contracts and import parsing without retaining another expansion authority. Matching isolated CPU diagnostics were captured before retirement; see [Calendar migration measurements](../../performance/calendar-migration.md). Final broader gates and installed-app desktop/Android acceptance remain required.

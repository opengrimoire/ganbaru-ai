# Performance budget

Full iCalendar compatibility must not make normal calendar use heavy. Compatibility work belongs mostly in import, export, preservation storage, and lazy detail loading.

## Startup budget

Startup must not:

- parse preserved iCalendar JSON for every imported component
- read raw `.ics` text for calendars
- load unsupported components
- expand all recurrence instances for all time
- hydrate full attendees, alarms, attachments, or diagnostics for every event

Startup may:

- load projected event rows for the initial visible window
- load slim recurrence and override data needed for expansion
- use existing indexed date queries

## Visible-window load budget

Visible-window load must:

- query projected rows only
- filter all-day rows by date portion
- use UTC indexed ranges for timed rows
- load only slim override rows needed for expansion
- keep recurrence expansion bounded to the requested window

Visible-window load must not join preservation JSON tables unless a debug mode explicitly requests it.

## Import budget

Import can be heavier than startup, but it must stay bounded:

- keep current plain `.ics` size caps
- keep zip entry, aggregate, and path-safety caps
- cap component count
- cap property count per component
- cap nesting depth
- cap line length after unfolding
- cap attachment size when inline binary values are accepted
- cap recurrence expansion during validation

Large imports should stream or batch where practical. The UI should report progress for slow imports once this becomes user-visible.

## Export budget

Export may load preserved components for the selected calendar, but should:

- avoid loading unrelated calendars
- batch component reads
- avoid expanding recurrence except for validation cases that require bounded checks
- generate output from structured data
- write atomically through the existing Rust save path

Export diagnostics should identify the component that caused a slowdown or warning.

## Recurrence budget

Recurrence expansion must be protected by:

- visible-window bounds
- maximum generated instance count
- maximum loop count
- date cutoffs for impossible or malformed rules
- warnings when caps are hit

Expansion should be measurable independently from import and export.

## Database size

Preservation storage will increase database size. This is acceptable because it buys lossless compatibility, but growth should be visible and bounded.

Track:

- bytes per preserved component
- bytes per projected event
- total bytes per imported calendar
- attachment size contribution
- diagnostic JSON size

Future maintenance tools can show storage cost per imported calendar.

## Measurement points

Add benchmarks for:

- startup with no imports
- startup with many imported preserved components
- visible week load with many projected events
- import of a large Google export zip
- import of a mixed standards fixture
- export of a large calendar
- recurrence expansion for complex `BY*` rules
- preservation JSON load for one full event

## Success targets

Initial targets:

- No preserved component parsing during normal startup.
- No measurable startup regression from preservation tables when the visible window has the same projected rows.
- Visible-window queries remain bounded by projected rows and required recurrence templates.
- Import and export can be slower, but must provide diagnostics and avoid unbounded loops.

Exact millisecond targets should be recorded in `docs/PERFORMANCE.md` after benchmark methodology is stable.

# Apple Calendar

Apple Calendar is a practical compatibility target, not the source of truth for iCalendar behavior. Test macOS Calendar first because it supports direct calendar file import and export.

## Source notes

- Apple documents exporting an individual calendar's events to a calendar `.ics` file.
- Apple documents importing events from a calendar `.ics` file.
- Apple calendar archives use `.icbu`; those are outside the base `.ics` compatibility goal.

Source:

- <https://support.apple.com/en-afri/guide/calendar/icl1023>

## Known fixture priorities

- `.ics` calendar event export from macOS Calendar
- all-day single and multi-day events
- recurring events with moved instances
- alarms
- attachments or URL fields
- non-ASCII text
- custom timezone export
- private events

## Import into GanbaruAI

Expected handling:

- Preserve Apple-specific `X-*` fields.
- Preserve alarms even when only basic alarm projection is available.
- Preserve any custom timezone definitions.
- Keep all-day and recurring override dates correct.

## Export from GanbaruAI into Apple Calendar

Manual checks:

1. Create a local disposable calendar in Apple Calendar.
2. Import GanbaruAI-generated fixtures.
3. Verify all-day date spans.
4. Verify recurrence and moved instances.
5. Verify alarms.
6. Export that calendar from Apple Calendar as `.ics`.
7. Import the export into GanbaruAI.
8. Compare semantic results and preserved fields.

## Behavior to verify

- Whether Apple Calendar preserves unknown `X-*` fields.
- Whether Apple Calendar rewrites line folding or parameter escaping.
- Whether Apple Calendar exports custom `VTIMEZONE` definitions.
- Whether Apple Calendar preserves `VTODO`, `VJOURNAL`, or only events.
- Whether Apple Calendar stores attachments as URI values or inline data.

## Observed behavior log

No manual GanbaruAI compatibility run recorded yet.

Record:

- macOS version
- Calendar app version if visible
- calendar timezone
- import fixture
- export fixture
- differences after round-trip

# Fastmail

Fastmail is a practical compatibility target and a useful provider because it supports standard calendar import/export and CalDAV.

## Source notes

- Fastmail documents importing events from `.ics` files by drag and drop or import tool.
- Fastmail documents exporting calendars in industry-standard iCalendar `.ics` format.
- Fastmail notes that notification preferences or alarms are not imported to or exported from Fastmail.
- Fastmail replaces existing event details when an uploaded file contains an event that already exists.

Source:

- <https://www.fastmail.help/hc/en-us/articles/360060590773-Import-export-your-calendars>

## Known fixture priorities

- event import and export
- duplicate `UID` replacement behavior
- all-day single and multi-day events
- recurring event with exceptions
- recurring override
- attendee and organizer fields
- alarm fixture to verify documented alarm loss
- non-ASCII text
- custom `X-*` fields

## Import into GanbaruAI

Expected handling:

- Preserve Fastmail-exported events.
- Preserve missing alarm behavior as a client observation, not a GanbaruAI rule.
- Project supported `VEVENT` rows.
- Preserve attendees, organizer, and recurrence data.

## Export from GanbaruAI into Fastmail

Manual checks:

1. Create a disposable Fastmail calendar.
2. Import GanbaruAI-generated fixtures.
3. Verify all-day and timed date behavior.
4. Verify recurrence and exceptions.
5. Verify whether alarms are dropped as documented.
6. Export the Fastmail calendar.
7. Import back into GanbaruAI.
8. Compare semantic results and note any alarm loss.

## Behavior to verify

- Whether Fastmail preserves unknown `X-*` fields.
- Whether Fastmail rewrites timezones.
- Whether Fastmail imports mixed-component calendars.
- Whether duplicate `UID` import replaces details as documented.
- Whether attendee participation fields round-trip.

## Observed behavior log

No manual GanbaruAI compatibility run recorded yet.

Record:

- Fastmail web version if visible
- timezone
- fixture name
- import result
- export result
- alarm behavior

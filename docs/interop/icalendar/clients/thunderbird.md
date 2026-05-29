# Thunderbird

Thunderbird is both a practical compatibility target and a useful reference because its calendar model is built around iCalendar concepts.

## Source notes

- Thunderbird source documentation says its calendar item model leans heavily on iCalendar.
- Thunderbird implements `VEVENT` events and `VTODO` tasks, but not `VJOURNAL`.
- Thunderbird uses `ical.js` beneath the surface, which is relevant because Ganbaru AI currently also uses `ical.js` for parsing.
- Thunderbird Help documents exporting calendars in iCalendar `.ics` format.

Sources:

- <https://source-docs.thunderbird.net/en/latest/calendar/item_model.html>
- <https://support.mozilla.org/gu-IN/kb/exporting-and-sharing-a-calendar>

## Known fixture priorities

- `VEVENT` event export
- `VTODO` task export
- recurring task
- task alarms
- mixed event and task calendar
- attendee and organizer fields
- custom properties from Thunderbird
- calendar export with non-ASCII values

## Import into Ganbaru AI

Expected handling:

- Project `VEVENT` rows.
- Preserve `VTODO` rows even before task projection exists.
- Preserve alarms and custom fields.
- Preserve unsupported task fields for later kanban or task integration.

## Export from Ganbaru AI into Thunderbird

Manual checks:

1. Create a disposable Thunderbird calendar.
2. Import Ganbaru AI-generated event fixtures from `apps/client/test-fixtures/ics/rfc5545/`.
3. Verify event time, all-day, recurrence, alarms, and attendees.
4. Add Thunderbird tasks and export a mixed calendar.
5. Import the mixed calendar into Ganbaru AI.
6. Confirm tasks are preserved even if not rendered.
7. Re-export from Ganbaru AI and import back into Thunderbird.

## Behavior to verify

- Exact `VTODO` shape Thunderbird exports.
- Whether Thunderbird preserves unknown `X-*` fields.
- Whether Thunderbird accepts Ganbaru AI-generated `VTODO` after future task support.
- How Thunderbird handles custom `VTIMEZONE`.
- Whether Thunderbird preserves `VALARM` repeat and duration.

## Observed behavior log

No manual Ganbaru AI compatibility run recorded yet.

Record:

- Thunderbird version
- operating system
- calendar storage type
- task mode availability
- fixture names
- round-trip differences

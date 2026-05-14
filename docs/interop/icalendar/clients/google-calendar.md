# Google Calendar

Google Calendar is a practical compatibility target, not the source of truth for iCalendar behavior. Standards behavior is defined in [Standards scope](../standards-scope.md).

## Source notes

- Google Calendar Help documents importing `.ics` files on desktop and notes that imported events do not stay synced between accounts.
- Google Calendar Help states that guests and conference data are not imported when importing an event file.
- The Google Calendar API event resource documents event `end` as exclusive, matching RFC 5545 all-day behavior.
- Google exports can arrive as a zip with one `.ics` file per calendar.

Sources:

- <https://support.google.com/calendar/answer/37118?hl=EN>
- <https://developers.google.com/workspace/calendar/api/v3/reference/events>

## Known fixture priorities

- single-day all-day event, verifying exclusive `DTEND`
- yearly all-day birthday or anniversary
- multi-day all-day event
- timed recurring event with `EXDATE`
- recurring override with zoned `RECURRENCE-ID`
- event with guests and guest permissions
- event with Google Meet or conference data
- free event with `TRANSP:TRANSPARENT`
- private event with `CLASS:PRIVATE`
- non-ASCII title and description
- exported calendar zip with multiple `.ics` files

## Import into GanbaruAI

Expected handling:

- Preserve Google `X-*` properties.
- Project normal `VEVENT` rows.
- Keep all-day dates correct with exclusive `DTEND`.
- Keep `TRANSP` as scheduling metadata, not a color modifier.
- Preserve attendees and organizer as data.
- Treat guest RSVP data as read-only unless future identity support proves the attendee is the current user.

## Export from GanbaruAI into Google

Manual checks:

1. Create a disposable Google calendar.
2. Export a GanbaruAI calendar with the fixture set in `apps/client/test-fixtures/ics/rfc5545/`.
3. Import the file into the disposable Google calendar.
4. Confirm all-day events show on the intended days.
5. Confirm timed recurring events keep their wall-clock time.
6. Confirm exceptions are missing on the intended dates.
7. Confirm overrides appear on the intended dates and times.
8. Confirm private, tentative, cancelled, and free/busy metadata are interpreted acceptably.
9. Export from Google again and import back into GanbaruAI.
10. Compare semantic results against the original fixture.

## Behavior to verify

- Whether Google preserves unknown `X-*` properties on import/export.
- Whether Google rewrites organizer and attendee fields on import.
- Whether Google drops conference data from imported files.
- Whether Google imports `VTODO`, `VJOURNAL`, or `VFREEBUSY`, or ignores them.
- Whether Google rewrites custom `VTIMEZONE` definitions.
- Whether Google accepts binary attachments or only URI attachments.

## Observed behavior log

No manual GanbaruAI compatibility run recorded yet.

When testing, record:

- test date
- Google Calendar web version if visible
- account type
- calendar timezone
- import source fixture
- import result
- export result
- warnings or visual differences

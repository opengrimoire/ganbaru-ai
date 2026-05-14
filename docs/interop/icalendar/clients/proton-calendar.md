# Proton Calendar

Proton Calendar is a practical compatibility target. Its encryption and product model may affect what it imports, exports, or rewrites, so behavior must be tested from real fixtures.

## Source notes

- Proton documents importing calendars from other services.
- Proton documents exporting a calendar as an iCalendar `.ics` file.
- Proton's import/export flow is account-based, but GanbaruAI's base `.ics` compatibility does not depend on Proton account access.

Sources:

- <https://proton.me/support/protoncalendar-calendars>
- <https://proton.me/support/easy-switch-calendars>

## Known fixture priorities

- Proton-exported calendar with simple events
- all-day single and multi-day events
- recurring event with exceptions
- moved recurring instance
- reminders
- attendees if exported
- imported calendar exported again from Proton
- non-ASCII text

## Import into GanbaruAI

Expected handling:

- Preserve Proton-specific `X-*` fields.
- Project supported `VEVENT` rows.
- Preserve recurrence and timezone data.
- Preserve alarms even if Proton has limited alarm import/export behavior.

## Export from GanbaruAI into Proton Calendar

Manual checks:

1. Create a disposable Proton calendar.
2. Import GanbaruAI-generated fixtures from `apps/client/test-fixtures/ics/rfc5545/` through Proton's import/export screen.
3. Verify all-day and timed event dates.
4. Verify recurrence, exceptions, and overrides.
5. Export the Proton calendar as `.ics`.
6. Import back into GanbaruAI.
7. Compare semantic results.

## Behavior to verify

- Whether Proton imports multi-event `.ics` files reliably on web and desktop.
- Whether Proton preserves unknown `X-*` fields.
- Whether Proton preserves or rewrites timezones.
- Whether Proton exports attendees.
- Whether Proton exports alarms.
- Whether Proton accepts custom `VTIMEZONE`.

## Observed behavior log

No manual GanbaruAI compatibility run recorded yet.

Record:

- Proton web or desktop version if visible
- plan type if it affects calendar count
- timezone
- fixture name
- import result
- export result
- unsupported or skipped fields

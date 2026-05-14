# Nextcloud

Nextcloud Calendar is a practical compatibility target and a CalDAV-adjacent source of real-world iCalendar files.

## Source notes

- Nextcloud user documentation says the Calendar application supports iCalendar-compatible `.ics` files defined in RFC 5545.
- Nextcloud supports importing one or more calendar files through Calendar settings.
- Nextcloud can export event data from the event editor, unless disabled by an administrator.
- Nextcloud administration docs describe CalDAV-backed calendar behavior and export controls.

Sources:

- <https://docs.nextcloud.com/server/stable/user_manual/en/groupware/calendar.html>
- <https://docs.nextcloud.com/server/latest/admin_manual/groupware/calendar.html>

## Known fixture priorities

- event export from Nextcloud
- event import into Nextcloud
- CalDAV-style recurrence and overrides
- `VTODO` if the Tasks app is available
- attendee and organizer fields
- alarms
- shared calendar export
- custom `X-*` properties
- timezone definitions from a self-hosted server

## Import into GanbaruAI

Expected handling:

- Treat Nextcloud `.ics` as standards-oriented input.
- Preserve CalDAV-related extension fields.
- Preserve unsupported components.
- Project supported `VEVENT` rows.
- Keep scheduling metadata inert unless future transport is configured.

## Export from GanbaruAI into Nextcloud

Manual checks:

1. Create a disposable Nextcloud calendar.
2. Import GanbaruAI-generated fixtures from `apps/client/test-fixtures/ics/rfc5545/`.
3. Verify all-day, timed, recurrence, alarms, and attendees.
4. Export events or the calendar from Nextcloud.
5. Import back into GanbaruAI.
6. Compare semantic results and preserved fields.

## Behavior to verify

- Whether Nextcloud preserves unknown `X-*` fields.
- Whether Nextcloud accepts mixed `VEVENT` and `VTODO` calendars.
- Whether Nextcloud rewrites `VTIMEZONE`.
- Whether Nextcloud imports `RANGE=THISANDFUTURE`.
- Whether Nextcloud preserves `VALARM` repeat and duration.
- Differences between hosted Nextcloud versions.

## Observed behavior log

No manual GanbaruAI compatibility run recorded yet.

Record:

- Nextcloud server version
- Calendar app version
- Tasks app version if relevant
- timezone
- fixture name
- import result
- export result

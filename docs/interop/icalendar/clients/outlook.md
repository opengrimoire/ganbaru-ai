# Outlook

Outlook is a practical compatibility target, not the source of truth for iCalendar behavior. Test both Outlook on the web and desktop Outlook when possible because their import/export behavior can differ.

## Source notes

- Microsoft documents importing `.ics` files into Outlook calendars and subscribing to iCalendar feeds.
- Microsoft notes that an imported `.ics` file does not refresh if the source calendar later changes.
- Outlook desktop can export an iCalendar file through calendar sharing APIs, with detail controlled by sharing settings.
- Outlook commonly emits Windows timezone names, which GanbaruAI currently maps to IANA names for projection.

Sources:

- <https://support.microsoft.com/en-us/office/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web-cff1429c-5af6-41ec-a5b4-74f2c278e98c>
- <https://learn.microsoft.com/en-us/office/vba/api/outlook.calendarsharing.saveasical>

## Known fixture priorities

- Windows `TZID` values such as `Pacific Standard Time`
- recurring timed event across DST
- recurring override with Windows `TZID`
- event with attachments
- event with private details hidden by sharing settings
- meeting invitation with attendees
- cancellation and update messages
- all-day single and multi-day events

## Import into GanbaruAI

Expected handling:

- Preserve original Windows `TZID` values in the lossless layer.
- Map recognized Windows timezones to IANA zones for projection.
- Preserve full `VTIMEZONE` blocks when present.
- Preserve organizer, attendees, and scheduling metadata.
- Preserve attachments as inert data until the user explicitly opens them.

## Export from GanbaruAI into Outlook

Manual checks:

1. Create a disposable Outlook calendar.
2. Import GanbaruAI-generated fixtures from `apps/client/test-fixtures/ics/rfc5545/`.
3. Verify all-day date spans.
4. Verify zoned recurrence across DST.
5. Verify reminders and attachments.
6. Verify attendee fields display without implying sent invitations.
7. Export or save as iCalendar from Outlook when possible.
8. Re-import into GanbaruAI and compare semantic results.

## Behavior to verify

- Whether Outlook accepts IANA `TZID` without a full `VTIMEZONE`.
- Whether Outlook rewrites IANA timezones into Windows timezones.
- Whether Outlook strips unknown `X-*` properties.
- Whether Outlook preserves `VTODO` items in `.ics` files.
- Whether Outlook imports `VALARM` repeat and duration.
- Whether Outlook handles `RANGE=THISANDFUTURE`.

## Observed behavior log

No manual GanbaruAI compatibility run recorded yet.

Record separate results for:

- Outlook on the web
- Outlook for Windows
- Outlook for macOS
- account type
- timezone
- import and export dates

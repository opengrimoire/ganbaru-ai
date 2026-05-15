# Google Calendar

Google Calendar is a practical compatibility target, not the source of truth for iCalendar behavior. Standards behavior is defined in [Standards scope](../standards-scope.md).

## Source notes

- Google Calendar Help documents importing `.ics` files on desktop and notes that imported events do not stay synced between accounts.
- Google Calendar Help states that guests and conference data are not imported when importing an event file.
- Google Calendar export Help lists the iCalendar fields included in downloads: event start and end time, recurrence frequency data, invitees and response statuses, title, description, location, creation time, and last modification time. It does not promise event colors, Google Meet state, or every Google Calendar API field.
- The Google Calendar API event resource documents event `end` as exclusive, matching RFC 5545 all-day behavior.
- Google exports can arrive as a zip with one `.ics` file per calendar.

Sources:

- <https://support.google.com/calendar/answer/37118?hl=EN>
- <https://support.google.com/calendar/answer/10041132?hl=en>
- <https://developers.google.com/workspace/calendar/api/v3/reference/events>

## Known Google file quirks

These are client-compatibility notes, not standards rules. GanbaruAI should stay standards-first and use these notes to decide warnings, repair prompts, and fixture priorities.

- **Stale unbounded recurrences can appear in exports.** A Google export can contain old recurring master `VEVENT`s that no longer appear in the Google Calendar UI. The problematic shape is a confirmed master event with `RRULE:FREQ=DAILY` or similar, no `UNTIL`, no `COUNT`, no `EXDATE` covering the future, no `STATUS:CANCELLED`, and no `RECURRENCE-ID;RANGE=THISANDFUTURE` cancellation. Per iCalendar semantics, that file says the event repeats forever. GanbaruAI must not silently invent an end date, but a future import review should warn about old unbounded recurring events and let the user exclude them.
- **Google can mix UTC and `TZID` event times in the same export.** For example, one event may use `DTSTART;TZID=America/Mexico_City:20210510T080000` while another uses `DTSTART:20260515T204500Z`. Both are legal. Import must treat `Z` values as UTC, `TZID` values as local to the given zone, and persist the projected wall clock without applying the timezone offset twice.
- **"This and following" deletion is not always exported as a future cancellation.** When the file contains a capped `RRULE` with `UNTIL`, GanbaruAI should respect it. When the file contains `RECURRENCE-ID;RANGE=THISANDFUTURE` with `STATUS:CANCELLED`, GanbaruAI should suppress that occurrence and later occurrences. When Google exports neither shape and leaves an unbounded confirmed master event, the file is incomplete relative to the Google UI state.
- **Duplicate master revisions may appear.** If two master `VEVENT`s share a `UID`, GanbaruAI projects the newest revision by `SEQUENCE`, then `LAST-MODIFIED`, `DTSTAMP`, or `CREATED`. This handles files where a newer capped recurrence appears next to an older uncapped revision.
- **Colors are not reliable through `.ics`.** Google Calendar API resources expose color IDs, but Google `.ics` exports do not reliably carry original calendar or event colors. File import should map to GanbaruAI's default palette unless a standard or extension color property is actually present.
- **Guests and conference data are not symmetric through file import.** Google exports can include attendees, organizer data, and Google conference properties, but Google Help states that importing an event file into Google does not import guests and conference data. GanbaruAI should preserve these fields when present, but file round trips through Google may drop or rewrite them.

## GanbaruAI policy for Google quirks

- Treat the `.ics` file as the immediate source of truth for import.
- Do not auto-repair stale Google recurrence data without user consent.
- Surface suspicious old unbounded recurrences as import warnings once the import review UI exists.
- Keep exporting "following" deletes as capped recurrence rules so other clients receive a bounded series.
- Preserve raw Google fields where possible, but do not promise Google API-only behavior from file import/export.

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
- Whether Google exports stale unbounded recurring masters that are hidden in the UI.
- Whether Google represents "this and following" edits as capped `RRULE`, split master events, `RANGE=THISANDFUTURE`, or no visible future deletion marker.
- Whether Google imports `VTODO`, `VJOURNAL`, or `VFREEBUSY`, or ignores them.
- Whether Google rewrites custom `VTIMEZONE` definitions.
- Whether Google accepts binary attachments or only URI attachments.

## Observed behavior log

Partial manual compatibility run recorded in May 2026:

- GanbaruAI export imported into Google preserved ordinary timed events and a recurring series capped by the app's "following" delete behavior.
- Google export back to GanbaruAI included expected May 2026 events as UTC `Z` values, while older recurring routine events used `TZID=America/Mexico_City`.
- The same Google export contained old unbounded daily recurrences that were not visible in the Google Calendar UI. The file represented them as confirmed infinite recurrences, so a standards-based importer expands them.
- A Google invitation with an empty title was exported with organizer, attendees, and conference properties. GanbaruAI should import it as an event with an empty stored title unless the UI adds a display-only "Untitled" fallback.

When testing, record:

- test date
- Google Calendar web version if visible
- account type
- calendar timezone
- import source fixture
- import result
- export result
- warnings or visual differences

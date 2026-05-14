# Fixtures and clients

This document defines automated fixture coverage and manual client testing. Standards fixtures prove correctness. Client fixtures prove practical interoperability.

## Fixture principles

- Store fixtures in a dedicated test fixture folder, grouped by standards area and client source.
- Prefer small, readable fixtures for unit tests.
- Add at least one large synthetic fixture for performance testing.
- Keep original client exports unchanged in a raw fixture folder.
- Add normalized expected-output fixtures only when deterministic serialization is required.
- Record parser warnings expected from each fixture.
- Use semantic equivalence checks where property order can legitimately differ.

## Automated fixture classes

Core event fixtures:

- minimal UTC `VEVENT`
- zoned timed `VEVENT`
- floating timed `VEVENT`
- single-day all-day event
- multi-day all-day event
- event with `DURATION` instead of `DTEND`
- event with omitted optional fields
- event with rich text, commas, semicolons, backslashes, and newlines
- event with non-ASCII text and long folded lines

Recurrence fixtures:

- daily, weekly, monthly, and yearly recurrence
- `COUNT` and `UNTIL`
- all `BY*` families supported by RFC 5545
- `WKST`
- `RDATE` date and date-time values
- `EXDATE` date and date-time values
- override with `RECURRENCE-ID`
- override with `RECURRENCE-ID;VALUE=DATE`
- `RECURRENCE-ID` with `RANGE=THISANDFUTURE`
- recurrence across DST start and end
- recurrence with custom `VTIMEZONE`

Component fixtures:

- `VTODO` with due date, completion, status, percent, alarms, and recurrence
- `VJOURNAL` with summary and description
- `VFREEBUSY` with multiple `FREEBUSY` periods and `FBTYPE`
- standalone `VTIMEZONE`
- mixed `VEVENT`, `VTODO`, `VJOURNAL`, `VFREEBUSY`, and `VTIMEZONE`

People and scheduling fixtures:

- `ORGANIZER` with `CN`, `DIR`, `SENT-BY`, and `LANGUAGE`
- `ATTENDEE` with role, participation status, RSVP, delegation, member, and calendar address
- `METHOD:REQUEST`
- `METHOD:CANCEL`
- `METHOD:REPLY`
- `REQUEST-STATUS`

Alarm fixtures:

- display alarm with relative trigger
- absolute trigger alarm
- audio alarm with attachment
- email alarm with attendees and summary
- alarm with `REPEAT` and `DURATION`
- unknown alarm extension properties

Attachment and extension fixtures:

- URI attachment with `FMTTYPE`
- binary attachment with encoding
- `X-*` properties at object, component, and property level
- RFC 7986 fields such as `COLOR`, `IMAGE`, `NAME`, and `CONFERENCE`

Security fixtures:

- malformed line folding
- oversized property
- oversized recurrence count
- nested component depth stress
- external URI fields
- hostile HTML in descriptions
- zip entry path traversal
- decompression bomb shape

## Test assertions

Each fixture should assert:

- parse success or expected warning/failure
- preserved component shape
- projected row shape when applicable
- export serialization validity
- parse to export to parse semantic equivalence
- unsupported legal data remains present after a supported edit

## Manual client testing

Manual tests use disposable calendars. Never test with the user's primary calendar first.

For each client:

1. Create a disposable calendar.
2. Import GanbaruAI-generated fixtures.
3. Inspect visual behavior.
4. Export the same calendar back to `.ics`.
5. Store the raw export as a dated fixture.
6. Re-import into GanbaruAI.
7. Record differences in the relevant `clients/*.md` file.

Record:

- client name
- platform
- app or web version when visible
- test date
- timezone
- locale
- fixture name
- import result
- export result
- warnings or UI surprises
- screenshots if manual visual inspection is important

## Client docs

Client notes live under [clients](./clients/):

- [Google Calendar](./clients/google-calendar.md)
- [Outlook](./clients/outlook.md)
- [Apple Calendar](./clients/apple-calendar.md)
- [Thunderbird](./clients/thunderbird.md)
- [Nextcloud](./clients/nextcloud.md)
- [Proton Calendar](./clients/proton-calendar.md)
- [Fastmail](./clients/fastmail.md)

Client docs must not redefine standards behavior. They record what real clients export, accept, reject, or rewrite.

## Fixture naming

Use stable, descriptive names:

- `rfc5545-event-all-day-single.ics`
- `rfc5545-recur-exdate-zoned.ics`
- `rfc5545-vtimezone-custom.ics`
- `google-2026-05-14-yearly-all-day.ics`
- `outlook-2026-05-14-windows-tzid.ics`

Raw client exports should include a date in the file name when behavior may change over time.

## Comparison strategy

Use semantic comparison, not byte-for-byte comparison, for most tests. Legal iCalendar serializers can reorder properties, fold lines differently, or normalize case without changing meaning.

Byte-for-byte comparison is useful only for preserving exact unknown payloads before the export merger rewrites them. Once fields are edited, semantic equivalence is the correct target.

# Conformance checklist

This checklist tracks standards coverage. It is intentionally broader than the current implementation. Each item should eventually carry these status fields in issues or implementation notes:

- **Projected:** mapped into GanbaruAI normalized rows.
- **Preserved:** retained in structured iCalendar storage.
- **Exported:** emitted in standards-compliant output.
- **Editable:** user can edit it without corrupting preserved data.
- **Tested:** automated fixture or manual client test exists.
- **Notes:** limitations, warnings, and client observations.

Status values:

- `yes`: implemented and tested.
- `partial`: supported for common cases but not complete.
- `preserve-only`: stored and exported, but not app-editable.
- `planned`: not implemented yet.
- `not-applicable`: not meaningful for GanbaruAI UI, but may still be preserved.

## Components

Core RFC 5545 components to track:

- `VCALENDAR`: partial now. Preserve all object-level properties and methods.
- `VEVENT`: partial now. Primary projection target.
- `VTODO`: planned. Preserve first, future task projection later.
- `VJOURNAL`: planned. Preserve first, future diary or notes projection later.
- `VFREEBUSY`: planned. Preserve first, future availability view later.
- `VTIMEZONE`: partial now. Preserve full definition and map to IANA when possible.
- `VALARM`: partial now under `VEVENT`. Preserve all alarm properties even when projection is lossy.

Nested component rules:

- `VALARM` may appear inside event and task components.
- `STANDARD` and `DAYLIGHT` appear inside `VTIMEZONE`.
- Unknown or future components must be stored as preserved components instead of dropped.

## Object-level properties

Track these on `VCALENDAR` or whole-object metadata:

- `PRODID`: partial now. Preserve exact value.
- `VERSION`: partial now. Validate `2.0` for RFC 5545 input.
- `CALSCALE`: partial now. Preserve and default to `GREGORIAN` only when generating.
- `METHOD`: planned. Preserve scheduling method but do not act without transport.
- `NAME`, `DESCRIPTION`, `COLOR`, `IMAGE`, `REFRESH-INTERVAL`, `SOURCE`: planned extension tracking.
- unknown `X-*` and `IANA-*`: partial now for events, planned at object level.

## Event properties

`VEVENT` properties to project or preserve:

- Identity and timestamps: `UID`, `DTSTAMP`, `CREATED`, `LAST-MODIFIED`, `SEQUENCE`.
- Time fields: `DTSTART`, `DTEND`, `DURATION`.
- Text fields: `SUMMARY`, `DESCRIPTION`, `LOCATION`, `COMMENT`.
- Recurrence: `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`.
- Status and visibility: `STATUS`, `TRANSP`, `CLASS`, `PRIORITY`.
- Categorization and relation: `CATEGORIES`, `RESOURCES`, `RELATED-TO`.
- People: `ORGANIZER`, `ATTENDEE`, `CONTACT`.
- URLs and files: `URL`, `ATTACH`.
- Coordinates: `GEO`.
- Availability and request state: `REQUEST-STATUS`.
- Extensions: all `X-*` and registered `IANA-*` properties.

Current state:

- Projected partial support exists for core event fields.
- Preservation is incomplete until lossless storage lands.
- `DTSTAMP`, `CREATED`, and `LAST-MODIFIED` are not currently stored in app rows.
- `COMMENT`, `RESOURCES`, `RELATED-TO`, `CONTACT`, `REQUEST-STATUS`, and `ATTACH` are not fully modeled.

## Task properties

`VTODO` properties to preserve first:

- Identity: `UID`, `DTSTAMP`, `CREATED`, `LAST-MODIFIED`, `SEQUENCE`.
- Task dates: `DTSTART`, `DUE`, `COMPLETED`, `DURATION`.
- Task state: `STATUS`, `PERCENT-COMPLETE`, `PRIORITY`.
- Text: `SUMMARY`, `DESCRIPTION`, `LOCATION`, `COMMENT`.
- Recurrence: `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`.
- People and relation: `ORGANIZER`, `ATTENDEE`, `CONTACT`, `RELATED-TO`.
- Attachments and extensions: `ATTACH`, `CATEGORIES`, `RESOURCES`, `URL`, `X-*`.

Projection target:

- Future kanban or task model, not the current calendar event table.

## Journal properties

`VJOURNAL` properties to preserve first:

- `UID`, `DTSTAMP`, `CREATED`, `LAST-MODIFIED`, `SEQUENCE`
- `DTSTART`
- `SUMMARY`, `DESCRIPTION`, `COMMENT`
- `STATUS`, `CLASS`, `CATEGORIES`
- `ORGANIZER`, `ATTENDEE`, `CONTACT`
- `RELATED-TO`, `URL`, `ATTACH`, `X-*`

Projection target:

- Future diary or note entry model, not current event UI.

## Free/busy properties

`VFREEBUSY` properties to preserve first:

- `UID`, `DTSTAMP`
- `DTSTART`, `DTEND`
- `FREEBUSY`
- `ORGANIZER`, `ATTENDEE`, `CONTACT`
- `COMMENT`, `URL`, `REQUEST-STATUS`, `X-*`

Projection target:

- Future availability or scheduling diagnostics surface.

## Timezone properties

`VTIMEZONE`, `STANDARD`, and `DAYLIGHT` fields:

- `TZID`
- `LAST-MODIFIED`
- `TZURL`
- `DTSTART`
- `TZOFFSETFROM`
- `TZOFFSETTO`
- `TZNAME`
- `RRULE`
- `RDATE`
- `COMMENT`
- `X-*`

Compatibility requirement:

- Preserve the full `VTIMEZONE` definition.
- Map to IANA zones only for projection and expansion when safe.
- Export preserved definitions when source components still depend on them.

## Alarm properties

`VALARM` fields:

- `ACTION`
- `TRIGGER`
- `DESCRIPTION`
- `SUMMARY`
- `ATTENDEE`
- `DURATION`
- `REPEAT`
- `ATTACH`
- `ACKNOWLEDGED`
- `PROXIMITY`
- `X-*`

Current state:

- Basic alarms are projected.
- `REPEAT` and `DURATION` are currently dropped from projection and warned.
- Full preservation should retain all legal alarm data.

## Parameters

Core parameters to parse, preserve, and export:

- `VALUE`
- `TZID`
- `LANGUAGE`
- `ALTREP`
- `CN`
- `CUTYPE`
- `DELEGATED-FROM`
- `DELEGATED-TO`
- `DIR`
- `MEMBER`
- `PARTSTAT`
- `ROLE`
- `RSVP`
- `SENT-BY`
- `RELTYPE`
- `RANGE`
- `FBTYPE`
- `ENCODING`
- `FMTTYPE`
- `RELATED`
- unknown `X-*` and `IANA-*`

Compatibility requirement:

- Parameter values must preserve quoting and RFC 6868 caret semantics.
- Projection may use only a subset, but export must not lose unsupported parameters.

## Value types

Value types to parse, preserve, and serialize:

- `BINARY`
- `BOOLEAN`
- `CAL-ADDRESS`
- `DATE`
- `DATE-TIME`
- `DURATION`
- `FLOAT`
- `INTEGER`
- `PERIOD`
- `RECUR`
- `TEXT`
- `TIME`
- `URI`
- `UTC-OFFSET`

Compatibility requirement:

- Preserve exact value type and multi-value shape.
- Distinguish floating date-time from UTC and `TZID` date-time.
- Avoid converting value types just because the current UI projection cannot use them.

## Serialization rules

Must be covered by automated tests:

- CRLF line endings.
- Content lines folded at 75 octets, not characters.
- UTF-8 safe folding.
- TEXT escaping for backslash, semicolon, comma, newline, and carriage return.
- Parameter value escaping via RFC 6868.
- Date-only `DTEND` exclusivity for all-day events.
- `RECURRENCE-ID` value type matching `DTSTART`.
- `EXDATE` and `RDATE` value type matching recurrence semantics.
- Unknown properties and parameters preserved in structured storage.

## Fixture coverage tracker

Required fixture classes:

- minimal valid `VEVENT`
- all-day single-day event
- all-day multi-day event
- yearly all-day recurring event
- timed recurring event with `EXDATE`
- recurring override with `RECURRENCE-ID`
- `RANGE=THISANDFUTURE`
- `RDATE` with dates and date-times
- floating timed event
- custom `VTIMEZONE`
- alarm with repeat and duration
- attendee delegation parameters
- organizer `SENT-BY`
- attachment by URI and binary value
- non-ASCII text
- escaped parameters
- folded lines
- `VTODO`
- `VJOURNAL`
- `VFREEBUSY`
- mixed-component calendar
- invalid or malicious file

Each fixture should assert parse diagnostics, preservation data, projection result when applicable, and export equivalence.

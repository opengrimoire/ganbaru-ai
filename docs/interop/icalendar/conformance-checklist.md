# Conformance checklist

This checklist tracks standards coverage. It is intentionally broader than the current implementation. Each item should eventually carry these status fields in implementation notes, tests, or issues:

- **Projected:** mapped into GanbaruAI normalized rows.
- **Preserved:** retained in structured iCalendar storage.
- **Exported:** emitted in standards-compliant output.
- **Editable:** user can edit it without corrupting preserved data.
- **Tested:** automated fixture or manual client test exists.
- **Notes:** limitations, warnings, and client observations.

Status values:

- `yes`: implemented and tested.
- `partial`: supported for common cases but not complete.
- `no`: not currently supported.
- `preserve-only`: stored and exported, but not app-editable.
- `planned`: not implemented yet.
- `not-applicable`: not meaningful for GanbaruAI UI, but may still be preserved.

## Current audit baseline

Audit date: 2026-05-14.

Evidence reviewed:

- `apps/client/src/lib/calendar/ics/parser.ts`
- `apps/client/src/lib/calendar/ics/serializer.ts`
- `apps/client/src/lib/calendar/ics/types.ts`
- `apps/client/src/lib/calendar/ics/parser.test.ts`
- `apps/client/src/lib/calendar/ics/serializer.test.ts`
- `apps/client/src/lib/calendar/ics/round-trip.test.ts`
- `apps/client/src/lib/components/calendar/rrule.ts`
- `apps/client/src/lib/components/calendar/rrule.test.ts`
- `apps/client/src/lib/components/calendar/recurrence.ts`
- `apps/client/src/lib/components/calendar/recurrence.test.ts`
- `apps/client/src/lib/stores/calendar-bulk-import.ts`
- `apps/client/src-tauri/src/calendar_import.rs`
- `apps/client/test-fixtures/ics/google-calendar-sample.ics`
- `apps/client/test-fixtures/ics/outlook-sample.ics`
- `apps/client/test-fixtures/ics/edge-cases.ics`

Current implementation summary:

- The parser uses `ical.js` and returns projected `CalendarEvent` rows plus warning strings.
- New imports store structured iCalendar object and component JSON in `icalendar_objects` and `icalendar_components`.
- Projected events, attendees, alarms, and recurrence overrides link back to preserved components.
- Import still only projects `VEVENT` components into visible calendar rows. Other legal components are preserved without an app surface.
- Export always generates a new `VCALENDAR` object from projected rows.
- Some common event fields round-trip through projection. Unsupported `VEVENT` properties, unsupported parameters, and unsupported `VALARM` fields are preserved on new imports and merged back into export for linked events. Object metadata, non-event components, and full component ordering are preserved on import but are not merged back into export yet.
- Existing tests cover the projected subset and new preservation/link storage, but they do not prove full RFC 5545 file compatibility.

## Components

### `VCALENDAR`

- Projected: `not-applicable`.
- Preserved: `partial`.
- Exported: `partial`.
- Editable: `no`.
- Tested: `partial`.
- Evidence: `parseIcs` stores each parsed `VCALENDAR` object as structured JSON, plus copied `PRODID`, `VERSION`, `CALSCALE`, and `METHOD` metadata. `serializeCalendarToIcs` emits generated `PRODID`, `VERSION`, `CALSCALE`, `METHOD`, and `X-WR-CALNAME`.
- Gap: imported object-level properties are preserved for new imports but not merged into export yet.

### `VEVENT`

- Projected: `partial`.
- Preserved: `partial`.
- Exported: `partial`.
- Editable: `partial`.
- Tested: `yes` for the current projected subset.
- Evidence: parser, serializer, round-trip, import, recurrence, and serializer tests cover core event projection. New imports also preserve VEVENT jCal and link projected event rows back to preserved components. Serializer merge tests cover unsupported properties and parameters surviving supported edits.
- Gap: complete component ordering and every possible value type still need broader fixture coverage.

### `VTODO`

- Projected: `no`.
- Preserved: `yes`.
- Exported: `no`.
- Editable: `no`.
- Tested: `no`.
- Evidence: `parseIcs` preserves non-event components recursively and bulk import stores them even when no `VEVENT` rows are projected.
- Gap: legal task components do not have a visible app projection or export merge yet.

### `VJOURNAL`

- Projected: `no`.
- Preserved: `yes`.
- Exported: `no`.
- Editable: `no`.
- Tested: `no`.
- Evidence: `parseIcs` preserves non-event components recursively and bulk import stores them even when no `VEVENT` rows are projected.
- Gap: legal journal components do not have a visible app projection or export merge yet.

### `VFREEBUSY`

- Projected: `no`.
- Preserved: `yes`.
- Exported: `no`.
- Editable: `no`.
- Tested: `no`.
- Evidence: `parseIcs` preserves non-event components recursively and bulk import stores them even when no `VEVENT` rows are projected.
- Gap: legal availability components do not have a visible app projection or export merge yet.

### `VTIMEZONE`

- Projected: `partial`.
- Preserved: `partial`.
- Exported: `partial`.
- Editable: `no`.
- Tested: `partial`.
- Evidence: parser reads `TZID` parameters and maps common Windows names to IANA zones. New imports preserve VTIMEZONE, STANDARD, and DAYLIGHT components. Serializer emits stub `VTIMEZONE` blocks for recurring non-UTC zones.
- Gap: full `STANDARD` and `DAYLIGHT` definitions, custom timezone rules, original Windows names, `LAST-MODIFIED`, `TZURL`, and timezone extensions are preserved for new imports but not used for app recurrence math or merged into export yet.

### `VALARM`

- Projected: `partial`.
- Preserved: `partial`.
- Exported: `partial`.
- Editable: `partial`.
- Tested: `partial`.
- Evidence: parser maps `ACTION`, `TRIGGER`, and `DESCRIPTION` to `EventAlarm`. New imports preserve nested VALARM components and link projected alarm rows back to them. Serializer emits projected alarm fields and merges unsupported preserved alarm fields when exporting a linked VEVENT. Tests cover basic alarms, warning on repeat fields, preservation diagnostics, and preservation merge.
- Gap: unsupported alarm fields are preserved through export but are not editable as first-class app fields.

### Nested and future components

- Projected: `no`.
- Preserved: `yes`.
- Exported: `no`.
- Editable: `no`.
- Tested: `no`.
- Evidence: new import preservation stores recursive components as structured JSON.
- Gap: unknown or future legal components do not have a visible app projection or export merge yet.

## Object-level properties

Current object-level import status:

- `PRODID`: imported value is ignored.
- `VERSION`: parsed by `ical.js`, but not explicitly validated or preserved.
- `CALSCALE`: imported value is ignored.
- `METHOD`: imported value is ignored. Export always emits `PUBLISH`.
- `X-WR-CALNAME`: imported value is not preserved as object metadata.
- `X-WR-TIMEZONE`: imported value is not preserved as object metadata.
- `NAME`, `DESCRIPTION`, `COLOR`, `IMAGE`, `REFRESH-INTERVAL`, `SOURCE`: not modeled.
- unknown `X-*` and `IANA-*`: not preserved at object level.

Current object-level export status:

- Generated `PRODID`, `VERSION`, `CALSCALE`, `METHOD`, and `X-WR-CALNAME` are emitted.
- Original object-level fields from imports are not merged into export.

Required future state:

- Preserve every object-level property and parameter in structured storage.
- Project only fields the app needs.
- Merge generated and preserved fields intentionally on export.

## Event properties

### Identity and timestamps

- `UID`: projected as `sourceUid`, exported, and tested.
- `DTSTAMP`: required on export as a generated current value, but imported value is not stored.
- `CREATED`: ignored on import and not exported from preserved data.
- `LAST-MODIFIED`: ignored on import and not exported from preserved data.
- `SEQUENCE`: projected, exported, used for re-import ordering, and tested.

Gap: timestamp provenance is lost. Future preservation must retain original timestamp properties even if app rows keep `created_at` and `updated_at` separately.

### Time fields

- `DTSTART`: projected and exported for UTC, `TZID`, and all-day date values. Tested.
- `DTEND`: projected and exported. All-day exclusive end handling is fixed and tested.
- `DURATION`: projected into an end time on import, but original property shape is not preserved. Export writes `DTEND`, not original `DURATION`.

Gap: original use of `DURATION` versus `DTEND` is lost.

### Text and location fields

- `SUMMARY`: projected as title, exported, tested.
- `DESCRIPTION`: projected, sanitized before persistence, exported as TEXT, tested.
- `LOCATION`: projected, exported, tested through fixtures.
- `URL`: projected and exported, tested.
- `COMMENT`: not modeled or preserved.
- `RESOURCES`: not modeled or preserved.

Gap: non-modeled text properties are dropped.

### Recurrence

- `RRULE`: projected into `RecurrenceConfig` and exported. Tested for common and several `BY*` rules.
- `RDATE`: projected as a list of instants and exported. Tested for date-time values.
- `EXDATE`: projected as local date strings and exported at the event start time. Tested.
- `RECURRENCE-ID`: projected as overrides and exported. Tested for UTC and zoned timed overrides.
- `RANGE=THISANDFUTURE`: not preserved or implemented.

Current supported `RRULE` parts:

- `FREQ`
- `INTERVAL`
- `COUNT`
- `UNTIL`
- `BYDAY`, including ordinal values
- `BYMONTHDAY`
- `BYMONTH`
- `BYSETPOS`
- `BYYEARDAY`
- `BYWEEKNO`
- `WKST`

Known recurrence gaps:

- `BYSECOND`, `BYMINUTE`, and `BYHOUR` are not represented.
- Full preservation of unknown or unsupported recurrence parts does not exist.
- `RDATE` and `EXDATE` value types are narrowed.
- Recurrence property parameters are not preserved.
- Override matching is by master UID only, with no preservation of orphan override components.

### Status, visibility, and categorization

- `STATUS`: projected for `CONFIRMED`, `TENTATIVE`, and `CANCELLED`; exported and tested.
- `TRANSP`: projected for `OPAQUE` and `TRANSPARENT`; exported and tested.
- `CLASS`: projected for `PUBLIC`, `PRIVATE`, and `CONFIDENTIAL`; exported and tested.
- `PRIORITY`: projected, exported, validated, and tested.
- `CATEGORIES`: projected as string array, exported, and tested.
- `GEO`: projected, exported, and tested.
- `RELATED-TO`: not modeled or preserved.
- `REQUEST-STATUS`: not modeled or preserved.

Gap: relation and request-state metadata are dropped.

### People

- `ORGANIZER`: projected with `CN` and email, exported, and tested.
- `ATTENDEE`: projected with `CN`, `ROLE`, `PARTSTAT`, `RSVP`, and email, exported, and tested.
- `CONTACT`: not modeled or preserved.

Known people gaps:

- `SENT-BY` is not preserved.
- `DIR` is not preserved.
- `DELEGATED-FROM` and `DELEGATED-TO` are not preserved.
- `MEMBER` is not preserved.
- `CUTYPE` is not preserved.
- multiple values and unknown parameters are not preserved.

### Attachments, URLs, and extensions

- `URL`: projected and exported.
- `ATTACH`: not modeled or preserved.
- Unknown event `X-*`: projected into `extendedProperties` as string values and exported.
- Google guest permission `X-*`: projected into dedicated booleans and exported.
- Unknown registered `IANA-*`: treated like an unrecognized property if `ical.js` exposes it, but only first string value is retained and parameters are lost.

Gap: extension preservation is value-only and event-only. Parameters, groups, value types, multiplicity, and object-level extensions are not preserved.

## Task properties

`VTODO` properties are all planned and currently unsupported:

- `UID`, `DTSTAMP`, `CREATED`, `LAST-MODIFIED`, `SEQUENCE`
- `DTSTART`, `DUE`, `COMPLETED`, `DURATION`
- `STATUS`, `PERCENT-COMPLETE`, `PRIORITY`
- `SUMMARY`, `DESCRIPTION`, `LOCATION`, `COMMENT`
- `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`
- `ORGANIZER`, `ATTENDEE`, `CONTACT`, `RELATED-TO`
- `ATTACH`, `CATEGORIES`, `RESOURCES`, `URL`, `X-*`

Current status for all listed task fields:

- Projected: `no`.
- Preserved: `no`.
- Exported: `no`.
- Editable: `no`.
- Tested: `no`.

## Journal properties

`VJOURNAL` properties are all planned and currently unsupported:

- `UID`, `DTSTAMP`, `CREATED`, `LAST-MODIFIED`, `SEQUENCE`
- `DTSTART`
- `SUMMARY`, `DESCRIPTION`, `COMMENT`
- `STATUS`, `CLASS`, `CATEGORIES`
- `ORGANIZER`, `ATTENDEE`, `CONTACT`
- `RELATED-TO`, `URL`, `ATTACH`, `X-*`

Current status for all listed journal fields:

- Projected: `no`.
- Preserved: `no`.
- Exported: `no`.
- Editable: `no`.
- Tested: `no`.

## Free/busy properties

`VFREEBUSY` properties are all planned and currently unsupported:

- `UID`, `DTSTAMP`
- `DTSTART`, `DTEND`
- `FREEBUSY`
- `ORGANIZER`, `ATTENDEE`, `CONTACT`
- `COMMENT`, `URL`, `REQUEST-STATUS`, `X-*`

Current status for all listed free/busy fields:

- Projected: `no`.
- Preserved: `no`.
- Exported: `no`.
- Editable: `no`.
- Tested: `no`.

## Timezone properties

`VTIMEZONE`, `STANDARD`, and `DAYLIGHT` fields:

- `TZID`: projected partially by mapping to an IANA zone when possible.
- `LAST-MODIFIED`: not preserved.
- `TZURL`: not preserved.
- `DTSTART`: not preserved as part of the timezone definition.
- `TZOFFSETFROM`: not preserved.
- `TZOFFSETTO`: not preserved.
- `TZNAME`: not preserved.
- `RRULE`: not preserved as part of the timezone definition.
- `RDATE`: not preserved as part of the timezone definition.
- `COMMENT`: not preserved.
- `X-*`: not preserved.

Compatibility requirement:

- Preserve the full `VTIMEZONE` definition.
- Map to IANA zones only for projection and expansion when safe.
- Export preserved definitions when source components still depend on them.

## Alarm properties

Current alarm status:

- `ACTION`: projected, exported, tested.
- `TRIGGER`: projected, exported, tested.
- `DESCRIPTION`: projected, exported, tested.
- `SUMMARY`: not preserved.
- `ATTENDEE`: not preserved.
- `DURATION`: warned and dropped.
- `REPEAT`: warned and dropped.
- `ATTACH`: not preserved.
- `ACKNOWLEDGED`: not preserved.
- `PROXIMITY`: not preserved.
- `X-*`: not preserved inside alarms.

Compatibility requirement:

- Preserve all legal alarm properties and parameters even when only basic display alarms are projected.

## Parameters

Current parameter status:

- `VALUE`: partially honored for dates and date-times through `ical.js`, but not preserved.
- `TZID`: projected for date-time properties, mapped when possible, not preserved exactly.
- `CN`: projected for organizer and attendee, exported, tested.
- `ROLE`: projected for attendee, exported, tested.
- `PARTSTAT`: projected for attendee, exported, tested.
- `RSVP`: projected for attendee, exported, tested.
- `LANGUAGE`: not preserved.
- `ALTREP`: not preserved.
- `CUTYPE`: not preserved.
- `DELEGATED-FROM`: not preserved.
- `DELEGATED-TO`: not preserved.
- `DIR`: not preserved.
- `MEMBER`: not preserved.
- `SENT-BY`: not preserved.
- `RELTYPE`: not preserved.
- `RANGE`: not preserved.
- `FBTYPE`: not preserved.
- `ENCODING`: not preserved.
- `FMTTYPE`: not preserved.
- `RELATED`: not preserved.
- unknown `X-*` and `IANA-*`: not preserved as parameters.

Compatibility requirement:

- Parameter values must preserve quoting and RFC 6868 caret semantics.
- Projection may use only a subset, but export must not lose unsupported parameters.

## Value types

Current value-type status:

- `BINARY`: not preserved.
- `BOOLEAN`: not generally preserved; some Google `X-*` booleans are projected as booleans.
- `CAL-ADDRESS`: projected for organizer and attendee email addresses, but parameters are narrowed.
- `DATE`: projected for all-day dates and some recurrence values.
- `DATE-TIME`: projected for event times and recurrence values.
- `DURATION`: projected for event end calculation and alarm trigger duration, but original shape is not preserved.
- `FLOAT`: projected for `GEO` only.
- `INTEGER`: projected for `PRIORITY` and `SEQUENCE`.
- `PERIOD`: not preserved.
- `RECUR`: projected for supported `RRULE` parts.
- `TEXT`: projected for common fields and escaped on export.
- `TIME`: not preserved.
- `URI`: projected for `URL`, not preserved generally.
- `UTC-OFFSET`: not preserved in timezone definitions.

Compatibility requirement:

- Preserve exact value type and multi-value shape.
- Distinguish floating date-time from UTC and `TZID` date-time.
- Avoid converting value types just because the current UI projection cannot use them.

## Serialization rules

Current tested serialization support:

- CRLF line endings: `yes`.
- Content lines folded at 75 octets: `yes`.
- UTF-8 safe folding: `yes`.
- TEXT escaping for backslash, semicolon, comma, newline, and carriage return: `yes`.
- Parameter value escaping via RFC 6868: `partial`, tested for `CN`.
- Date-only `DTEND` exclusivity for all-day events: `yes`.
- `RECURRENCE-ID` value type matching `DTSTART`: `partial`, tested for UTC, `TZID`, and all-day through existing fixes.
- `EXDATE` and `RDATE` value type matching recurrence semantics: `partial`.
- Unknown properties and parameters preserved in structured storage: `no`.

## Fixture coverage tracker

Current automated fixture coverage:

- minimal valid `VEVENT`: `yes`, parser test.
- all-day single-day event: `yes`, parser and serializer tests.
- all-day multi-day event: `yes`, serializer test and Google fixture.
- yearly all-day recurring event: `yes`, parser test.
- timed recurring event with `EXDATE`: `yes`, parser and serializer tests.
- recurring override with `RECURRENCE-ID`: `yes`, parser and serializer tests.
- `RANGE=THISANDFUTURE`: `no`.
- `RDATE` with dates and date-times: `partial`, date-time tested.
- floating timed event: `partial`, fixture exists but floating status is not preserved.
- custom `VTIMEZONE`: `partial`, fixtures exist but definitions are not preserved.
- alarm with repeat and duration: `partial`, warning tested but preservation missing.
- attendee delegation parameters: `no`.
- organizer `SENT-BY`: `no`.
- attachment by URI and binary value: `no`.
- non-ASCII text: `partial`, UTF-8 folding tested.
- escaped parameters: `partial`, `CN` tested.
- folded lines: `yes`.
- `VTODO`: `no`.
- `VJOURNAL`: `no`.
- `VFREEBUSY`: `no`.
- mixed-component calendar: `no`.
- invalid or malicious file: `partial`, malformed parser input and import sanitization tested.

Each future fixture should assert parse diagnostics, preservation data, projection result when applicable, and export equivalence.

## Critical compatibility gaps

The gaps most likely to corrupt common real-world exports today:

- No preservation layer: unsupported legal data disappears on import.
- Non-event components are ignored.
- Object-level metadata and `VTIMEZONE` definitions are regenerated or dropped.
- `VALARM` repeat and duration are dropped.
- Attendee and organizer parameters beyond the current small subset are dropped.
- `ATTACH`, `REQUEST-STATUS`, `RELATED-TO`, `CONTACT`, `COMMENT`, and `RESOURCES` are dropped.
- Floating timed events are interpreted through the device zone and do not retain floating semantics.
- `DURATION` imports are exported as `DTEND`, losing original shape.
- `RANGE=THISANDFUTURE` is not preserved.
- Unsupported `RRULE` parts are not preserved losslessly.
- Unknown properties are narrowed to first string values when they are event-level extensions, and otherwise dropped.

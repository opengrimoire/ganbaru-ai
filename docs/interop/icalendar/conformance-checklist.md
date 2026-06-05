# Conformance checklist

This checklist tracks standards coverage. It is intentionally broader than the current implementation. Checklist rows use these status fields in implementation notes, tests, or issues:

- **Projected:** mapped into Ganbaru AI normalized rows.
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
- `not-applicable`: not meaningful for Ganbaru AI UI, but may still be preserved.

## Current audit baseline

Audit date: 2026-05-14.

Evidence reviewed:

- `apps/client/src/lib/calendar/ics/parser.ts`
- `apps/client/src/lib/calendar/ics/serializer.ts`
- `apps/client/src/lib/calendar/ics/types.ts`
- `apps/client/src/lib/calendar/ics/parser.test.ts`
- `apps/client/src/lib/calendar/ics/serializer.test.ts`
- `apps/client/src/lib/calendar/ics/fixture-suite.test.ts`
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
- `apps/client/test-fixtures/ics/rfc5545/core-events.ics`
- `apps/client/test-fixtures/ics/rfc5545/recurrence-timezones.ics`
- `apps/client/test-fixtures/ics/rfc5545/scheduling.ics`
- `apps/client/test-fixtures/ics/rfc5545/components.ics`
- `apps/client/test-fixtures/ics/rfc5545/attachments-extensions.ics`

Current implementation summary:

- The parser uses `ical.js` and returns projected `CalendarEvent` rows plus warning strings.
- New imports store iCalendar objects and components in relational preservation tables.
- Projected events, attendees, alarms, and recurrence overrides link back to preserved components.
- Import still only projects `VEVENT` components into visible calendar rows. Other legal components are preserved without an app surface.
- Export generates a new `VCALENDAR` object from projected rows, preserved timezones, preserved top-level passthrough components, and one safe object-level `METHOD` when available.
- Some common event fields round-trip through projection. Unsupported `VEVENT` properties, unsupported parameters, inert URI and binary attachments, imported `DURATION` shape, floating date-time shape, `RECURRENCE-ID;RANGE=THISANDFUTURE`, and unsupported `VALARM` fields are preserved on new imports and merged back into export for linked events. Preserved `VTIMEZONE` definitions export before generated timezone stubs. Preserved top-level non-event components pass through export unchanged while they have no app projection. Object metadata beyond `METHOD` and full component ordering are preserved on import but are not merged back into export yet.
- Existing tests cover the projected subset and new preservation/link storage, but they do not prove full RFC 5545 file compatibility.

## Components

### `VCALENDAR`

- Projected: `not-applicable`.
- Preserved: `partial`.
- Exported: `partial`.
- Editable: `no`.
- Tested: `partial`.
- Evidence: `parseIcs` stores each parsed `VCALENDAR` object as component, property, parameter, value, diagnostic, and metadata rows. Export emits generated `PRODID`, `VERSION`, `CALSCALE`, and `X-WR-CALNAME`, and reuses a preserved `METHOD` only when all preserved objects in the exported calendar agree on one method.
- Gap: imported object-level properties beyond a single safe `METHOD` are preserved for new imports but not merged into export yet.

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
- Exported: `yes`.
- Editable: `no`.
- Tested: `yes`.
- Evidence: `parseIcs` preserves non-event components recursively and bulk import stores them even when no `VEVENT` rows are projected. Export passes through top-level preserved `VTODO` components unchanged.
- Gap: legal task components do not have a visible app projection yet.

### `VJOURNAL`

- Projected: `no`.
- Preserved: `yes`.
- Exported: `yes`.
- Editable: `no`.
- Tested: `partial`.
- Evidence: `parseIcs` preserves non-event components recursively and bulk import stores them even when no `VEVENT` rows are projected. Export passes through top-level preserved non-event components unchanged.
- Gap: legal journal components do not have a visible app projection yet.

### `VFREEBUSY`

- Projected: `no`.
- Preserved: `yes`.
- Exported: `yes`.
- Editable: `no`.
- Tested: `yes`.
- Evidence: `parseIcs` preserves non-event components recursively and bulk import stores them even when no `VEVENT` rows are projected. Export passes through top-level preserved `VFREEBUSY` components unchanged.
- Gap: legal availability components do not have a visible app projection yet.

### `VTIMEZONE`

- Projected: `partial`.
- Preserved: `partial`.
- Exported: `partial`.
- Editable: `no`.
- Tested: `partial`.
- Evidence: parser reads `TZID` parameters and maps common Windows names to IANA zones. New imports preserve VTIMEZONE, STANDARD, and DAYLIGHT components. Serializer emits preserved `VTIMEZONE` definitions before generated stubs, and still emits generated stubs when no preserved definition exists.
- Gap: full `STANDARD` and `DAYLIGHT` definitions, custom timezone rules, original Windows names, `LAST-MODIFIED`, `TZURL`, and timezone extensions are preserved and exported for new imports but not used for app recurrence math yet.

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
- Exported: `partial`.
- Editable: `no`.
- Tested: `partial`.
- Evidence: new import preservation stores recursive components as relational rows. Top-level preserved components outside `VEVENT` and `VTIMEZONE` pass through export unchanged.
- Gap: unknown or future legal components do not have a visible app projection or export merge yet.

## Object-level properties

Current object-level import status:

- `PRODID`: stored in object metadata. Export uses Ganbaru AI's generated `PRODID`.
- `VERSION`: stored in object metadata. Export emits `VERSION:2.0`.
- `CALSCALE`: stored in object metadata. Export emits `CALSCALE:GREGORIAN`.
- `METHOD`: stored in object metadata. Export reuses it only when all preserved objects in the exported calendar agree on one method; otherwise export emits `PUBLISH`.
- `X-WR-CALNAME`: preserved in relational `VCALENDAR` component rows but not exported.
- `X-WR-TIMEZONE`: preserved in relational `VCALENDAR` component rows but not exported.
- `NAME`, `DESCRIPTION`, `COLOR`, `IMAGE`, `REFRESH-INTERVAL`, `SOURCE`: preserved in relational `VCALENDAR` component rows but not exported.
- unknown `X-*` and `IANA-*`: preserved in relational `VCALENDAR` component rows but not exported.

Current object-level export status:

- Generated `PRODID`, `VERSION`, `CALSCALE`, and `X-WR-CALNAME` are emitted.
- `METHOD` uses one distinct preserved method for the exported calendar, or generated `PUBLISH` for local rows, missing method metadata, mixed preserved methods, and invalid method tokens.
- Original object-level fields beyond `METHOD` are not merged into export.

Required future state:

- Keep preserving every object-level property and parameter in structured storage.
- Project only fields the app needs.
- Merge generated and preserved fields intentionally on export.

## Event properties

### Identity and timestamps

- `UID`: projected as `sourceUid`, exported, and tested.
- `DTSTAMP`: required on export as a generated current value, but imported value is not stored.
- `CREATED`: not projected, but preserved and exported for linked event components.
- `LAST-MODIFIED`: not projected, but preserved and exported for linked event components.
- `SEQUENCE`: projected, exported, used for re-import ordering, and tested.

Gap: timestamp provenance is not available in normalized event rows. App rows keep `created_at` and `updated_at` separately, and export regenerates `DTSTAMP`.

### Time fields

- `DTSTART`: projected and exported for UTC, `TZID`, and all-day date values. Tested.
- `DTEND`: projected and exported. All-day exclusive end handling is fixed and tested.
- `DURATION`: projected into an end time on import. Linked preserved exports keep the original `DURATION` property shape and regenerate its value from the current start and end.

Gap: generated rows without preserved source still export `DTEND`.

### Text and location fields

- `SUMMARY`: projected as title, exported, tested.
- `DESCRIPTION`: projected, sanitized before persistence, exported as TEXT, tested.
- `LOCATION`: projected, exported, tested through fixtures.
- `URL`: projected and exported, tested.
- `COMMENT`: not modeled, but preserved and merged for linked events.
- `RESOURCES`: not modeled, but preserved and merged for linked events.

Gap: non-modeled text properties are not editable as first-class app fields.

### Recurrence

- `RRULE`: projected into `RecurrenceConfig` and exported. Tested for common and several `BY*` rules.
- `RDATE`: projected as a list of instants and exported. Tested for date-time values.
- `EXDATE`: projected as local date strings and exported at the event start time. Tested.
- `RECURRENCE-ID`: projected as overrides and exported. Tested for UTC and zoned timed overrides.
- `RANGE=THISANDFUTURE`: projected on recurrence overrides, used to hide imported cancelled future instances during expansion, and merged on linked override export. Creating this range from the app UI is not implemented yet.
- Duplicate master `VEVENT` revisions with the same `UID`: the newest revision is projected by `SEQUENCE`, then by `LAST-MODIFIED`, `DTSTAMP`, or `CREATED` when sequence ties. Tested for Google-style old uncapped plus newer capped recurrence exports.

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
- Unsupported `RRULE` parts are preserved in linked raw jCal, but the recurrence UI cannot edit them without regenerating a narrower rule.
- `RDATE` and `EXDATE` value types are narrowed.
- Recurrence property parameters are preserved for linked export when the property remains, but they are not editable.
- Override matching is by master UID only, with no preservation of orphan override components.

### Status, visibility, and categorization

- `STATUS`: projected for `CONFIRMED`, `TENTATIVE`, and `CANCELLED`; exported and tested.
- `TRANSP`: projected for `OPAQUE` and `TRANSPARENT`; exported and tested.
- `CLASS`: projected and exported for `PUBLIC` and `PRIVATE`; `CONFIDENTIAL` imports as `PRIVATE` and is tested.
- `PRIORITY`: projected, exported, validated, and tested.
- `CATEGORIES`: projected as string array, exported, and tested.
- `GEO`: projected, exported, and tested.
- `RELATED-TO`: not modeled, but preserved and merged for linked events.
- `REQUEST-STATUS`: not modeled, but preserved and merged for linked events.

Gap: relation and request-state metadata are not editable as first-class app fields.

### People

- `ORGANIZER`: projected with `CN` and email, exported, and tested.
- `ATTENDEE`: projected with `CN`, `ROLE`, `PARTSTAT`, `RSVP`, and email, exported, and tested.
- `CONTACT`: not modeled or preserved.

Known people gaps:

- `SENT-BY` is preserved and merged for linked organizer and attendee properties.
- `DIR` is preserved and merged for linked organizer and attendee properties.
- `DELEGATED-FROM` and `DELEGATED-TO` are preserved and merged for linked attendee properties.
- `MEMBER` is preserved and merged for linked attendee properties.
- `CUTYPE` is preserved and merged for linked attendee properties.
- multiple values and unknown parameters are preserved in structured jCal and merged for linked properties when the property remains projected.

### Attachments, URLs, and extensions

- `URL`: projected and exported.
- `ATTACH`: not modeled, but URI attachments are preserved as inert properties and merged for linked events.
- Unknown event `X-*`: projected into `extendedProperties` as string values and exported.
- Google guest permission `X-*`: projected into dedicated booleans and exported.
- Unknown registered `IANA-*`: preservation-only for linked exports. They are not projected into editable event extensions, which avoids dropping their parameters, value types, and multiplicity.

Gap: `X-*` extension projection is value-only for app editing. Structured preservation keeps parameters, groups, value types, and multiplicity for linked event export, while object-level extension export merge is still future work.

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
- Preserved: `yes`.
- Exported: `preserve-only`.
- Editable: `no`.
- Tested: `partial`.

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
- Preserved: `yes`.
- Exported: `preserve-only`.
- Editable: `no`.
- Tested: `partial`.

## Free/busy properties

`VFREEBUSY` properties are all planned and currently unsupported:

- `UID`, `DTSTAMP`
- `DTSTART`, `DTEND`
- `FREEBUSY`
- `ORGANIZER`, `ATTENDEE`, `CONTACT`
- `COMMENT`, `URL`, `REQUEST-STATUS`, `X-*`

Current status for all listed free/busy fields:

- Projected: `no`.
- Preserved: `yes`.
- Exported: `preserve-only`.
- Editable: `no`.
- Tested: `partial`.

## Timezone properties

`VTIMEZONE`, `STANDARD`, and `DAYLIGHT` fields:

- `TZID`: projected partially by mapping to an IANA zone when possible.
- `LAST-MODIFIED`: preserved and exported for linked timezone definitions.
- `TZURL`: preserved and exported for linked timezone definitions.
- `DTSTART`: preserved and exported inside `STANDARD` and `DAYLIGHT`.
- `TZOFFSETFROM`: preserved and exported inside `STANDARD` and `DAYLIGHT`.
- `TZOFFSETTO`: preserved and exported inside `STANDARD` and `DAYLIGHT`.
- `TZNAME`: preserved and exported inside `STANDARD` and `DAYLIGHT`.
- `RRULE`: preserved and exported inside `STANDARD` and `DAYLIGHT`.
- `RDATE`: preserved and exported inside `STANDARD` and `DAYLIGHT`.
- `COMMENT`: preserved and exported for linked timezone definitions.
- `X-*`: preserved and exported for linked timezone definitions.

Compatibility requirement:

- Preserve the full `VTIMEZONE` definition.
- Map to IANA zones only for projection and expansion when safe.
- Export preserved definitions when source components still depend on them.

## Alarm properties

Current alarm status:

- `ACTION`: projected, exported, tested.
- `TRIGGER`: projected, exported, tested.
- `DESCRIPTION`: projected, exported, tested.
- `SUMMARY`: preserved and merged for linked alarm components.
- `ATTENDEE`: preserved and merged for linked alarm components.
- `DURATION`: preserved and merged for linked alarm components.
- `REPEAT`: preserved and merged for linked alarm components.
- `ATTACH`: preserved and merged for linked alarm components.
- `ACKNOWLEDGED`: preserved and merged for linked alarm components.
- `PROXIMITY`: preserved and merged for linked alarm components.
- `X-*`: preserved and merged inside linked alarm components.

Compatibility requirement:

- Preserve all legal alarm properties and parameters even when only basic display alarms are projected.

## Parameters

Current parameter status:

- `VALUE`: partially honored for dates and date-times through `ical.js`; preserved exactly in linked raw jCal for export merge.
- `TZID`: projected for date-time properties and mapped when possible; preserved exactly in linked raw jCal except for generated-owned time fields when the app changes the time model. Preserved VTIMEZONE definitions export with the calendar.
- `CN`: projected for organizer and attendee, exported, tested.
- `ROLE`: projected for attendee, exported, tested.
- `PARTSTAT`: projected for attendee, exported, tested.
- `RSVP`: projected for attendee, exported, tested.
- `LANGUAGE`: preserved and merged for linked event properties.
- `ALTREP`: preserved and merged for linked event properties.
- `CUTYPE`: preserved and merged for linked attendee properties.
- `DELEGATED-FROM`: preserved and merged for linked attendee properties.
- `DELEGATED-TO`: preserved and merged for linked attendee properties.
- `DIR`: preserved and merged for linked organizer and attendee properties.
- `MEMBER`: preserved and merged for linked attendee properties.
- `SENT-BY`: preserved and merged for linked organizer and attendee properties.
- `RELTYPE`: preserved and merged for linked relationship properties.
- `RANGE`: preserved and merged for linked `RECURRENCE-ID` properties.
- `FBTYPE`: preserved and exported for linked `VFREEBUSY` components.
- `ENCODING`: preserved in linked raw jCal; binary attachment handling remains inert.
- `FMTTYPE`: preserved and merged for linked attachment properties.
- `RELATED`: preserved and merged for linked alarm trigger properties.
- unknown `X-*` and `IANA-*`: preserved and merged as parameters for linked event properties.

Compatibility requirement:

- Parameter values must preserve quoting and RFC 6868 caret semantics.
- Projection may use only a subset, but export must not lose unsupported parameters.

## Value types

Current value-type status:

- `BINARY`: preserved in linked raw jCal as inert data, but not opened or decoded by the app.
- `BOOLEAN`: preserved in linked raw jCal; some Google `X-*` booleans are projected as booleans.
- `CAL-ADDRESS`: projected for organizer and attendee email addresses; unsupported parameters are preserved and merged for linked properties.
- `DATE`: projected for all-day dates and some recurrence values.
- `DATE-TIME`: projected for event times and recurrence values.
- `DURATION`: projected for event end calculation and alarm trigger duration. Linked event export preserves imported event `DURATION` shape and unsupported alarm duration fields.
- `FLOAT`: projected for `GEO` only.
- `INTEGER`: projected for `PRIORITY` and `SEQUENCE`.
- `PERIOD`: preserved in linked raw jCal and top-level `VFREEBUSY` passthrough, but not projected.
- `RECUR`: projected for supported `RRULE` parts.
- `TEXT`: projected for common fields and escaped on export.
- `TIME`: preserved in linked raw jCal when `ical.js` accepts the property, but not projected.
- `URI`: projected for `URL`; URI attachments and other linked URI properties are preserved as inert data.
- `UTC-OFFSET`: preserved and exported in linked timezone definitions.

Compatibility requirement:

- Preserve exact value type and multi-value shape.
- Distinguish floating date-time from UTC and `TZID` date-time. Linked preserved exports keep floating date-time shape.
- Avoid converting value types just because the current UI projection cannot use them.

## Serialization rules

Current tested serialization support:

- CRLF line endings: `yes`.
- Content lines folded at 75 octets: `yes`.
- UTF-8 safe folding: `yes`.
- TEXT escaping for backslash, semicolon, comma, newline, and carriage return: `yes`.
- Parameter value escaping via RFC 6868: `partial`, tested for `CN`.
- Date-only `DTEND` exclusivity for all-day events: `yes`.
- `RECURRENCE-ID` value type matching `DTSTART`: `partial`, tested for UTC, `TZID`, all-day, and linked `RANGE=THISANDFUTURE` preservation.
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
- `RANGE=THISANDFUTURE`: `yes`, linked export preservation tested in serializer and fixture suite.
- `RDATE` with dates and date-times: `partial`, date-time tested and fixture-covered, date-only value shape still needs more coverage.
- floating timed event: `yes`, linked export preserves floating shape.
- custom `VTIMEZONE`: `partial`, linked export emits preserved definitions, but app recurrence math still uses projected zones.
- alarm with repeat and duration: `partial`, warning and linked export preservation tested.
- attendee delegation parameters: `yes`, preserved and merged in fixture suite.
- organizer `SENT-BY`: `yes`, preserved and merged in fixture suite.
- attachment by URI and binary value: `yes`, preserved and merged in fixture suite.
- non-ASCII text: `partial`, UTF-8 folding tested.
- escaped parameters: `partial`, `CN` tested.
- folded lines: `yes`.
- `VTODO`: `partial`, preserve and export passthrough tested.
- `VJOURNAL`: `partial`, preserve and export passthrough path is shared with VTODO.
- `VFREEBUSY`: `partial`, preserve and export passthrough tested.
- mixed-component calendar: `partial`, parser and export passthrough cover mixed components.
- invalid or malicious file: `partial`, malformed parser input, parser safety limits, zip safety, and import sanitization tested.

Each future fixture should assert parse diagnostics, preservation data, projection result when applicable, and export equivalence.

## Critical compatibility gaps

The gaps most likely to corrupt common real-world exports today:

- Object-level metadata beyond a single safe `METHOD` is not merged into export yet.
- App recurrence math still uses projected zones rather than foreign `VTIMEZONE` transition rules.
- Attendee and organizer parameters beyond the current small subset are preserve-only, not editable.
- `CONTACT` is preserved and exported for linked events, but it is not editable as an app field.
- Floating timed events are interpreted through the device zone for projection, but linked export preserves floating date-time shape.
- Generated rows without preserved source still export `DTEND` rather than original `DURATION` shape.
- `RANGE=THISANDFUTURE` is applied for imported cancelled overrides and preserved on linked export, but not exposed as an app recurrence edit operation.
- Unsupported `RRULE` parts are not editable through the current recurrence UI.
- Unknown registered event properties are preserve-only for linked export. Unknown event `X-*` properties are projected as value-only editable extensions.

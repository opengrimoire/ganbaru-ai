# Standards scope

This document defines the compatibility target. It separates standards compliance, app feature support, and real-world client quirks.

## Target standards

Primary standards:

- **RFC 5545, iCalendar:** the core file format and data model for components, properties, parameters, value types, recurrence, `VTIMEZONE`, and line serialization.
- **RFC 6868, parameter value encoding:** caret escaping for parameter values, including names with quotes and newlines.
- **RFC 5546, iCalendar scheduling:** invitation and reply semantics. GanbaruAI should preserve this metadata offline, but must not act on it without a configured transport.
- **RFC 7265, jCal:** JSON representation of iCalendar. This is a strong candidate for the preservation format because it preserves the iCalendar data model in structured JSON.

Useful extension standards to track:

- **RFC 7986, iCalendar property extensions:** common modern properties such as calendar names, colors, images, and conference information.
- **IANA iCalendar registries:** the live registry for known components, properties, parameters, values, and methods.

The source of truth is the standards. Google Calendar, Outlook, Apple Calendar, Thunderbird, Nextcloud, Proton Calendar, and Fastmail are compatibility targets and fixture sources, but client quirks do not define correct behavior.

## Compatibility levels

### File compatibility

The parser accepts legal iCalendar input, records unsupported data instead of dropping it, and exports a legal iCalendar object later. This is fully offline and does not require accounts, tokens, hosted services, or network access.

This is the main goal.

### Semantic app support

The app understands the data well enough to render, edit, search, notify, expand recurrence, and connect it to pomodoro. This applies first to `VEVENT`, then optionally to `VTODO`, `VJOURNAL`, and `VFREEBUSY` as GanbaruAI grows.

This can be incremental. Unsupported semantics must still be preserved.

### Scheduling workflow

The app sends or receives scheduling messages, replies to organizers, cancels meetings, sends invitation emails, updates remote calendars, or syncs through CalDAV or a provider API.

This requires a transport and identity. It is not required for offline `.ics` compatibility.

## Current supported subset

GanbaruAI currently projects a `VEVENT`-focused subset into `calendar_events` and preserves broader iCalendar data in structured storage. Current support handles:

- all-day exclusive `DTEND`
- `STATUS`, `TRANSP`, and visual status rendering
- recurring timed `EXDATE` export at the event start time
- zoned `RECURRENCE-ID` export
- parameter escaping for attendee and organizer `CN`
- UTF-8 octet-based line folding
- all-day override date handling
- structured preservation for imported `VCALENDAR` objects and components
- linked export merging for `VEVENT` and nested `VALARM`
- passthrough export for preserved top-level `VTODO`, `VJOURNAL`, `VFREEBUSY`, and custom components
- preserved `VTIMEZONE` definitions emitted before generated timezone stubs
- scheduling metadata preserved as inert data without transport actions
- parser safety limits for unfolded lines, component count, property count, nesting depth, and inline binary attachments

Partial support exists for:

- `RRULE`, `RDATE`, `EXDATE`, and recurrence overrides
- `STATUS`, `CLASS`, `TRANSP`, `PRIORITY`, `SEQUENCE`, `CATEGORIES`, `GEO`
- `ORGANIZER` and `ATTENDEE`
- basic `VALARM`
- `X-*` properties and Google guest-permission properties
- inert URI and binary attachments through linked preservation
- floating timed events through linked preservation

## Known gaps

The current implementation is highly compatible for offline file import/export within documented safety limits, but it is still not full semantic app support for every RFC 5545 feature. Major remaining gaps include:

- app UI projection for non-`VEVENT` components: `VTODO`, `VJOURNAL`, `VFREEBUSY`
- complete `VTIMEZONE` interpretation for recurrence math
- full `VALARM` repeat and duration semantics
- first-class editing for every legal property, parameter, and value type
- first-class editing for attendee and organizer parameters beyond the projected subset
- full recurrence UI semantics for all legal `RRULE` and `BY*` combinations
- first-class floating timed event projection distinct from device-zone interpretation
- scheduling methods and workflow actions from RFC 5546
- object-level export merge beyond a single safe `METHOD`
- manual client compatibility observations for the major target clients

## Preservation rule

Unsupported standard data must be preserved unless it is invalid, unsafe, exceeds configured limits, or the user explicitly chooses to discard it. When the app cannot project or edit a field, it should still retain it for export and diagnostics.

## References

- RFC 5545: <https://www.rfc-editor.org/rfc/rfc5545>
- RFC 5546: <https://www.ietf.org/rfc/rfc5546.html>
- RFC 6868: <https://www.rfc-editor.org/rfc/rfc6868.html>
- RFC 7265: <https://www.rfc-editor.org/rfc/rfc7265.html>
- RFC 7986: <https://www.rfc-editor.org/rfc/rfc7986>
- IANA iCalendar registries: <https://www.iana.org/assignments/icalendar/icalendar.xhtml>

# Data model

This document defines the storage responsibilities for lossless iCalendar compatibility. The first preservation tables, projection links, and `VEVENT` export merge are implemented, while complete component semantics remain future milestones.

## Principles

- Do not add one column per RFC property.
- Keep the current normalized calendar rows as the render and editing projection.
- Store full imported iCalendar data in structured preservation tables.
- Link preserved components to projected rows when they map to app concepts.
- Keep raw or structured preserved data lazy-loaded.
- Make migrations idempotent and avoid modifying user-authored data unless the mapping is certain.

## Existing projection tables

The existing tables remain the app-facing model:

- `calendar_events`
- `calendar_event_attendees`
- `calendar_event_alarms`
- `calendar_event_overrides`
- future task, journal, and free/busy projection tables if those UI features ship

These tables are optimized for visible-window queries, recurrence expansion, editing, pomodoro, and notifications.

## Proposed preservation tables

Migration v12 implements preservation with `icalendar_objects`, `icalendar_components`, and relational property/value child tables. It stores imported iCalendar structure without JSON columns. Migration v13 links supported projections back to preserved components.

### `icalendar_objects`

One row per imported or generated top-level iCalendar object.

Suggested fields:

- `id`: primary key.
- `calendar_id`: owning Ganbaru AI calendar row.
- `source_kind`: `import-file`, `import-zip-entry`, `local-export-base`, `subscription`, or future source.
- `source_name`: file basename, zip entry name, URL label, or user-visible origin.
- `source_fingerprint`: hash of source text or normalized object for dedupe and diagnostics.
- `prodid`: preserved `PRODID` when present.
- `version`: preserved `VERSION`, normally `2.0`.
- `method`: preserved `METHOD`, if present.
- `calendar_scale`: preserved `CALSCALE`, normally `GREGORIAN`.
- `created_at`: row creation time.
- `updated_at`: last update time.

Parser notes live in `icalendar_object_diagnostics` as message rows ordered by `sort_order`.

Indexes:

- `(calendar_id)`
- `(source_kind, source_name)`
- `(source_fingerprint)`

### `icalendar_components`

One row per component that should be addressable independently.

Suggested fields:

- `id`: primary key.
- `object_id`: parent `icalendar_objects` row.
- `calendar_id`: owning calendar for simpler queries.
- `component_type`: lowercase component type such as `vevent`, `vtodo`, `vjournal`, `vfreebusy`, `vtimezone`, `valarm`.
- `uid`: `UID` value when the component type has one.
- `recurrence_id`: normalized recurrence identity when present.
- `recurrence_id_value_type`: `date`, `date-time`, or other exact value type.
- `sequence`: parsed `SEQUENCE`, if present.
- `dtstart_key`: normalized start key for lookup and ordering.
- `projected_kind`: `event`, `todo`, `journal`, `freebusy`, or null.
- `projected_id`: linked row in the projection table, such as `calendar_events.id`.
- `preservation_status`: `lossless`, `partial`, `unsupported`, `needs-review`, `regenerated`, or `invalid`.
- `created_at`: row creation time.
- `updated_at`: last update time.

Component properties are stored in `icalendar_component_properties`; property parameters are stored in `icalendar_property_parameters`; property and parameter values are stored as recursive rows in `icalendar_value_nodes`; lossy projection notes are stored in `icalendar_component_projection_warnings`.

Indexes:

- `(calendar_id, component_type)`
- `(calendar_id, uid)`
- `(calendar_id, uid, recurrence_id)`
- `(projected_kind, projected_id)`
- `(preservation_status)`

### `icalendar_timezones`

Optional table if `VTIMEZONE` lookup needs to avoid loading every object.

Suggested fields:

- `id`: primary key.
- `object_id`: parent object.
- `calendar_id`: owning calendar.
- `tzid`: `TZID` value.
- `component_id`: FK to the preserved `VTIMEZONE` component.
- `iana_zone`: matched IANA zone when known.
- `match_confidence`: `exact`, `alias`, `offset-only`, `unknown`.
- `created_at`: row creation time.
- `updated_at`: last update time.

Indexes:

- `(calendar_id, tzid)`
- `(iana_zone)`

### `icalendar_component_links`

Optional join table if one preserved component can map to multiple projection rows or one projection row must reference multiple preserved components.

Suggested fields:

- `id`: primary key.
- `component_id`: preserved component.
- `projected_kind`: projection type.
- `projected_id`: projection row id.
- `link_role`: `primary`, `override`, `alarm`, `attachment`, `diagnostic`.
- `created_at`: row creation time.

Use this only if the simpler `projected_kind` and `projected_id` fields on `icalendar_components` become insufficient.

## Preservation format

RFC 7265 jCal remains the in-memory parser and serializer shape, but SQLite stores the same structure relationally. The database representation must not lose:

- component names
- property names
- parameter names and values
- value types
- multi-value structure, including jCal array and object values
- nested components
- extension fields

Export should be generated from structured relational data so edited fields can be merged safely.

## Projection mapping

Projection creates or updates current app rows:

- `VEVENT` maps to `calendar_events`.
- `VALARM` under `VEVENT` maps to `calendar_event_alarms` when supported.
- `ATTENDEE` maps to `calendar_event_attendees` while preserving unsupported attendee parameters in `icalendar_property_parameters` and `icalendar_value_nodes`.
- recurring override `VEVENT`s map to `calendar_event_overrides`.
- `VTODO`, `VJOURNAL`, and `VFREEBUSY` are preserved only until matching app surfaces exist.

Every projected row created from preserved data should be traceable back to its component. Migration v13 adds nullable `icalendar_component_id` columns to `calendar_events`, `calendar_event_overrides`, `calendar_event_attendees`, and `calendar_event_alarms`. Attendees also store `icalendar_property_index`, because `ATTENDEE` is a property on a `VEVENT` rather than its own component.

The `icalendar_components.projected_kind` and `projected_id` reverse link is used where one component maps to one projected row: master events, override events, and alarms. Attendee rows keep their direct link on the projected row so multiple attendees can reference the same preserved `VEVENT` without overwriting the component's reverse link.

Full-event loads reconstruct linked `VEVENT` structures for the serializer. Export merges the preserved `VEVENT` and nested `VALARM` components with regenerated supported fields, preserving unsupported event properties, unsupported parameters, inert URI attachments, imported `DURATION` shape, floating date-time shape, `RECURRENCE-ID;RANGE=THISANDFUTURE`, and unsupported alarm fields. Preserved `VTIMEZONE` components are loaded separately for calendar export and emitted before generated timezone stubs. Preserved top-level non-event components such as `VTODO`, `VJOURNAL`, `VFREEBUSY`, and future components are passed through unchanged while they have no app projection. A projected row or projected alarm that was deleted is not re-created from preservation storage during export.

Rows from older imports may have a `source_uid` but no `icalendar_component_id`. Full-event loads derive a `regenerated` iCalendar preservation state for those rows so diagnostics and export behavior make clear that the original component is not available.

## Re-import dedupe

Re-import should compare:

- calendar source identity
- component type
- `UID`
- `RECURRENCE-ID`
- `SEQUENCE`
- source fingerprint as a fallback diagnostic

Equal or newer sequence can update the preserved component and projection. Older sequence is skipped unless the user explicitly requests repair or replacement. If an import file contains an older event revision, the importer does not replace preservation rows for that source, which prevents old component links from being detached while the projection is intentionally left unchanged for that event.

## Data retention

Deleting an imported calendar should delete:

- projected calendar rows
- preserved iCalendar objects
- preserved components
- diagnostics and links

Deleting a single projected event should mark or remove the linked preserved component according to the edit policy. If the user intends to export the calendar later, the component must not silently reappear from preservation storage after deletion.

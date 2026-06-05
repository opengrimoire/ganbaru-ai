# Edit merge policy

This policy defines how Ganbaru AI edits projected calendar data while preserving full iCalendar components.

## Core rule

Supported user edits update both the normalized projection and the preserved component. Unsupported fields remain untouched in preservation storage unless the edit structurally invalidates them.

The app must never silently discard unsupported legal data just because the UI does not show it.

## Supported field merge

For linked `VEVENT` components:

- Editing title updates `SUMMARY`.
- Editing description updates `DESCRIPTION`, after sanitization for UI rendering and safe serialization.
- Editing start/end updates `DTSTART`, `DTEND`, or `DURATION` according to the component's chosen representation.
- Editing all-day status updates value types and exclusive `DTEND` semantics.
- Editing recurrence updates `RRULE`, `RDATE`, `EXDATE`, and override relationships.
- Editing status updates `STATUS`.
- Editing transparency updates `TRANSP`.
- Editing visibility updates `CLASS` as `PUBLIC` or `PRIVATE`; imported `CONFIDENTIAL` values are normalized to `PRIVATE`.
- Editing attendees updates supported `ATTENDEE` fields while preserving unsupported attendee parameters where possible.
- Editing alarms updates supported `VALARM` fields while preserving unsupported alarm fields where possible.

## Unsupported field preservation

Fields the UI does not model remain in the preserved component. Examples:

- `COMMENT`
- `RESOURCES`
- `RELATED-TO`
- unsupported `ATTENDEE` parameters
- unsupported `ORGANIZER` parameters
- attachment parameters
- extension properties
- scheduling request metadata
- custom `VTIMEZONE` definitions

When exporting, these fields should remain unless the user deleted the component or accepted a lossy repair.

## Structural edit risks

Some edits can make preserved data questionable:

- converting timed recurring event to all-day
- changing recurrence frequency while preserving complex overrides
- changing timezone while original custom `VTIMEZONE` still exists
- deleting an attendee from a scheduling request
- changing organizer
- editing an event with `METHOD:REQUEST` or `METHOD:CANCEL`
- modifying a component with unknown recurrence properties
- editing a `VTODO` or `VJOURNAL` before those have projection models

If the merge cannot be proven safe, set preservation status to `needs-review` and keep diagnostics.

## Status transitions

Suggested transitions:

- `lossless` to `projected`: component was mapped into app rows without known loss.
- `projected` to `partial`: unsupported data exists but remains preserved.
- `partial` to `needs-review`: user made a structural edit whose merge is uncertain.
- `needs-review` to `regenerated`: user accepts app-generated output that may drop unsupported data.
- any status to `invalid`: parser or export validation found unrecoverable structure.

## Delete behavior

Deleting a projected event linked to a preserved component must also remove or tombstone the preserved component for that calendar. Otherwise an export would reintroduce a deleted event.

If the component is part of a recurring series:

- deleting one instance should add or update `EXDATE` or an override according to recurrence policy.
- deleting the whole series should remove or tombstone all linked master and override components.

## Attendee behavior

Ganbaru AI currently has no account identity model. Therefore:

- attendee response status imported from `.ics` is read-only by default.
- the app must not let the user RSVP as another attendee.
- organizer-side edits such as marking a guest optional are allowed only when editing the event is allowed.
- future identity support may allow editing the attendee row that matches the current user.

## Scheduling edits

Offline edits do not notify anyone. If a component has scheduling metadata:

- preserve `METHOD`, `ORGANIZER`, `ATTENDEE`, `REQUEST-STATUS`, and related fields.
- show diagnostics if export may look like an invitation update.
- emit a preserved `METHOD` only when the exported calendar has one distinct preserved method.
- do not imply that attendees were notified.
- require a future transport before sending scheduling messages.

## Export warnings

Before export, warn when:

- any component is `needs-review` or `invalid`.
- unsupported fields were dropped by an accepted regeneration.
- a scheduling component was edited offline.
- a custom timezone could not be interpreted for projection.
- recurrence expansion was capped or partially unsupported.

Warnings should be specific and include component `UID` when available.

## Repair behavior

Re-importing the original `.ics` source file is the preferred repair path when a row has no preserved component or when preservation data is known to be incomplete. Unsupported values that were never stored in Ganbaru AI must not be invented from the normalized projection.

Repair actions must be explicit. If a user accepts regenerated output, diagnostics should make clear that unsupported original fields may be absent from export.

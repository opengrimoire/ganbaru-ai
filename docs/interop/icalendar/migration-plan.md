# Migration plan

This plan introduces lossless iCalendar preservation without corrupting existing user data.

## Current lossy baseline

As of the 2026-05-14 audit, existing imports only store the projected `VEVENT` subset. The app does not store original `VCALENDAR` metadata, full `VTIMEZONE` definitions, non-event components, unsupported event properties, complete parameters, or original value-type shapes.

Data that may already be unrecoverable from older imported rows includes:

- imported `PRODID`, `CALSCALE`, `METHOD`, and object-level `X-*` fields
- custom `VTIMEZONE` `STANDARD` and `DAYLIGHT` rules
- `VTODO`, `VJOURNAL`, and `VFREEBUSY` components
- `VALARM` `REPEAT`, `DURATION`, `SUMMARY`, `ATTENDEE`, and `ATTACH`
- attendee and organizer parameters outside the current `CN`, `ROLE`, `PARTSTAT`, and `RSVP` subset
- `ATTACH`, `REQUEST-STATUS`, `RELATED-TO`, `CONTACT`, `COMMENT`, and `RESOURCES`
- `RANGE=THISANDFUTURE`
- floating timed-event semantics, because current projection interprets floating times through the device zone
- original use of `DURATION` when projection converted it to an end time
- unsupported `RRULE` parts and unsupported property parameters

Migration must not invent these values. Re-importing the original source file after preservation storage lands is the only reliable way to recover them.

## Existing data classes

### Local normalized events

Events created directly in Ganbaru AI have no original iCalendar component. They can continue to export through generated components.

Migration action:

- leave rows unchanged.
- optionally create generated preservation components only when needed for future export caching.

### Existing imported events

Events imported before preservation storage may already be lossy. The database may not contain enough provenance to reconstruct the original `.ics` component.

Migration action:

- leave normalized rows unchanged.
- mark full-event loads as `regenerated` when a row has an imported `UID` but no linked preserved component.
- do not attempt blind repair of ambiguous dates, recurrence, or unsupported fields.
- let users re-import original files to gain preservation data.

### Future imported events

New imports after the preservation migration should store both:

- full preserved iCalendar data
- projected normalized rows for supported app behavior

Migration action:

- none after the feature lands. This becomes the normal import path.

## Schema rollout

Implementation order:

1. Add preservation tables with no effect on current reads. Implemented in the baseline schema.
2. Add write path for new imports to populate preservation tables. Implemented for structured jCal-like object and component storage.
3. Add projection links for imported `VEVENT`s, attendees, alarms, and overrides. Implemented in the baseline schema.
4. Add export merger for linked components. Implemented for linked `VEVENT` and nested `VALARM` components, including unsupported parameters, inert URI attachments, imported `DURATION` shape, floating date-time shape, and `RECURRENCE-ID;RANGE=THISANDFUTURE`. Preserved `VTIMEZONE` definitions export before generated stubs.
5. Pass through preserved non-event components while they have no app projection. Implemented for top-level non-`VEVENT` and non-`VTIMEZONE` components.
6. Add diagnostics and repair surfaces. Projection warnings are stored now, and old imported rows without preserved components are surfaced as `regenerated` on full-event loads. A user-facing repair surface is still future work.
7. Optional backfill generated preservation records for local events.

Each step must be idempotent.

## Backfill policy

Backfill should not invent facts:

- Do not infer unsupported properties that were dropped.
- Do not rewrite existing all-day ranges without source evidence.
- Do not assume a row came from Google, Outlook, or any client unless stored source metadata proves it.
- Do not convert existing local events into scheduling messages.

Generated preservation records may include a diagnostic such as `generated-from-projection`.

## Re-import repair path

If the user still has the original `.ics` file:

1. Import it into the same imported calendar source.
2. Match by `UID`, `RECURRENCE-ID`, and `SEQUENCE`.
3. Store full preserved components.
4. Update projected rows according to current import rules.
5. Keep warnings for rows whose previous projection cannot be proven equivalent.

This should be the preferred repair path for old lossy imports.

## Rollback behavior

If a migration partially succeeds:

- existing projection rows must remain usable.
- preservation rows can be ignored by older code if no schema downgrade exists.
- failed preservation import should not delete projected events.
- diagnostics should include enough context to retry import.

## User-visible documentation

When the feature ships, release notes should explain:

- new imports preserve more `.ics` data.
- old imports cannot always be made lossless automatically.
- re-importing original source files is the safest way to recover full preservation data.
- no Google account or external login is required for file compatibility.

## Tests

Migration tests should cover:

- empty database
- database with local events only
- database with imported calendars and no preserved data
- malformed legacy payload fields
- duplicate UIDs
- recurring events with overrides
- all-day events imported before exclusive `DTEND` fixes
- rollback after failed preservation insert

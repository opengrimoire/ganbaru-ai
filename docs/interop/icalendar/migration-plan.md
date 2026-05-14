# Migration plan

This plan introduces lossless iCalendar preservation without corrupting existing user data.

## Existing data classes

### Local normalized events

Events created directly in GanbaruAI have no original iCalendar component. They can continue to export through generated components.

Migration action:

- leave rows unchanged.
- optionally create generated preservation components only when needed for future export caching.

### Existing imported events

Events imported before preservation storage may already be lossy. The database may not contain enough provenance to reconstruct the original `.ics` component.

Migration action:

- leave normalized rows unchanged.
- mark them as generated or no preserved source if preservation tables require a link.
- do not attempt blind repair of ambiguous dates, recurrence, or unsupported fields.
- let users re-import original files to gain preservation data.

### Future imported events

New imports after the preservation migration should store both:

- full preserved iCalendar data
- projected normalized rows for supported app behavior

Migration action:

- none after the feature lands. This becomes the normal import path.

## Schema rollout

Suggested order:

1. Add preservation tables with no effect on current reads.
2. Add write path for new imports to populate preservation tables.
3. Add projection links for imported `VEVENT`s.
4. Add export merger for linked components.
5. Add diagnostics and repair surfaces.
6. Optional backfill generated preservation records for local events.

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
- malformed old JSON fields
- duplicate UIDs
- recurring events with overrides
- all-day events imported before exclusive `DTEND` fixes
- rollback after failed preservation insert

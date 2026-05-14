# Architecture

Full iCalendar compatibility should not turn every standard field into always-loaded app state. The design uses a lossless preservation layer beside the existing normalized projection.

## Goals

- Preserve every legal imported iCalendar component, property, parameter, value type, and extension.
- Keep calendar startup and visible-window queries close to the current cost.
- Let GanbaruAI render and edit the supported event subset without corrupting unsupported data.
- Export standards-shaped `.ics` files from preserved components plus current projected edits.
- Keep scheduling transports optional and user-configured.

## Two-layer model

### Lossless preservation layer

The preservation layer stores full iCalendar data in durable structured form. jCal-like JSON is the preferred starting point because it maps directly to iCalendar components, properties, parameters, and values.

Responsibilities:

- store each imported `VCALENDAR` object
- store all components, including unsupported component types
- preserve nested components such as `VALARM`
- preserve property names, parameter names, value types, and values
- preserve `X-*` and `IANA-*` extensions
- preserve `VTIMEZONE` definitions
- keep source metadata and import diagnostics
- expose raw component data only when needed

The preservation layer is not loaded during normal boot.

### App projection layer

The projection layer is the current app-facing schema: `calendar_events`, attendee rows, alarm rows, override rows, recurrence data, and related fields.

Responsibilities:

- render day, week, and month views
- support event editing
- drive pomodoro and notifications
- support search and visible-window queries
- provide stable indexed data for performance

The projection layer may be lossy compared with iCalendar, but every lossy projection must keep a link to preserved data when it came from an imported component.

## Import flow

1. Read the `.ics` or `.ics.zip` entry through the existing safe file path and size checks.
2. Parse into a structured iCalendar representation.
3. Validate structure, line folding, value types, required fields, and configured limits.
4. Store the full object and components in preservation tables.
5. Project supported `VEVENT` components into normalized calendar rows.
6. Link each projected row to its preserved component.
7. Preserve unsupported components without projecting them.
8. Emit warnings for lossy projections, unsupported semantics, and repairable invalid data.
9. Dedupe re-imports by calendar source, `UID`, recurrence identity, and sequence rules.

## Export flow

1. Load projected rows for the target calendar.
2. Load preserved components only for events or components included in the export.
3. For linked projected events, merge supported edited fields into the preserved component.
4. For local events without preserved components, generate clean iCalendar components from projection data.
5. Include preserved unsupported components that belong to the exported calendar.
6. Emit `VTIMEZONE` data needed by the output, preferring preserved definitions when still valid.
7. Serialize with CRLF line endings, UTF-8 octet folding, TEXT escaping, parameter escaping, and stable property ordering.
8. Write through the existing atomic export path.

The exporter must not blindly concatenate stale raw text with edited projected fields. It must operate on structured component data or a controlled regenerated representation.

## Edit merge flow

When a user edits a supported field, the app updates:

- the normalized projection row
- the corresponding property in the preserved component when one exists
- component diagnostics if the edit changes lossless status

Unsupported preserved properties remain untouched.

If an edit changes structure in a way that cannot be safely merged, the component must be marked with a preservation status such as `needs-review` or `regenerated`. The user should see a warning before export if data may no longer be lossless.

Detailed rules live in [Edit merge policy](./edit-merge-policy.md).

## Lazy loading boundaries

Always loaded for calendar rendering:

- projected event rows in the requested window
- slim recurrence and override data needed for expansion
- fields already used by visible chips and blocks

Loaded on demand:

- preserved component JSON
- full attendee and organizer parameter sets
- full alarms
- unsupported component types
- raw import diagnostics
- export-only metadata

Never required for startup:

- full `.ics` text
- every preserved component in a calendar
- all recurrence instances for all time

## Error and preservation states

Suggested component preservation states:

- `lossless`: parsed and preserved without known loss
- `projected`: projected into app rows with all modeled fields mapped
- `partial`: projected with unsupported data preserved separately
- `unsupported`: preserved but not projected
- `needs-review`: edited or imported in a way that requires user-visible caution
- `regenerated`: original component was replaced by app-generated output
- `invalid`: could not be safely parsed or exported

These states are diagnostics. They must not block rendering of valid projected data.

## Security posture

Calendar files are user-supplied content. The implementation must:

- keep file size and zip limits
- cap component and property counts
- cap recurrence expansion work
- avoid executing or fetching external URLs
- treat attachments and `URI` values as data until the user explicitly opens them
- sanitize descriptions before rendering
- preserve unsafe-looking data only as inert data

## Testing strategy

Use three classes of tests:

- standards fixtures for individual RFC features
- round-trip preservation tests for unsupported but legal data
- client fixtures from real exports and manual imports

The final compatibility claim must be based on the conformance checklist and fixture coverage, not only on existing app tests.

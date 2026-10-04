# Architecture

Broad iCalendar compatibility should not turn every standard field into always-loaded app state. The design uses a structured preservation layer beside the existing normalized projection.

## Goals

- Preserve the semantic structure of every accepted iCalendar component, property, parameter, value type, and extension within documented safety limits.
- Keep calendar startup and visible-window queries close to the current cost.
- Let Ganbaru AI render and edit the supported event subset without corrupting unsupported data.
- Export standards-shaped `.ics` files from preserved components plus current projected edits.
- Keep scheduling transports optional and user-configured.

## Two-layer model

### Structured preservation layer

The preservation layer stores accepted iCalendar data in durable relational form. The parser uses jCal in memory because it maps directly to iCalendar components, properties, parameters, and values, while SQLite stores those parts as rows. The layer preserves semantics, not original bytes or lexical formatting.

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
4. Store the accepted object and component structure in preservation tables.
5. Project supported `VEVENT` components into normalized calendar rows.
6. Link each projected row to its preserved component.
7. Preserve unsupported components without projecting them.
8. Emit warnings for narrowed projections, unsupported semantics, and repairable invalid data.
9. Select duplicate masters within one file by `UID`, then newest `SEQUENCE` and revision timestamp.
10. Upsert projected events against the target calendar by `source_uid`, skipping a lower `SEQUENCE` than the stored row.

Preservation objects are replaced by target calendar, source kind, and source name only when the import contains no older projected event revision. This is the current re-import identity. Component type and `RECURRENCE-ID` are preserved metadata, but they are not independent bulk-upsert keys today.

## Export flow

1. Request one native export snapshot for the target calendar. Rust reads the current calendar header, full projected events, related rows, export metadata, and selected preservation in one SQLite read transaction.
2. Read normalized children and preservation in bounded batches. After releasing the transaction, reconstruct preserved components on a native blocking worker. Include live event and override components, timezone definitions, and top-level non-event components. Preserved event components without a live projected event or override do not reappear in the export.
3. For linked projected events, generate supported fields from current projection data and overlay them onto the preserved source component in memory.
4. For local events without preserved components, generate clean iCalendar components from projection data.
5. Include preserved unsupported components that belong to the exported calendar.
6. Emit `VTIMEZONE` data needed by the output, preferring preserved definitions when still valid.
7. Serialize with CRLF line endings, UTF-8 octet folding, TEXT escaping, parameter escaping, and stable property ordering.
8. Write through the existing atomic export path.

The exporter must not blindly concatenate stale raw text with edited projected fields. It must operate on structured component data or a controlled regenerated representation.

The frontend validates the typed snapshot, hydrates its full event rows with one captured render timezone, and retains the existing `ical.js` serializer and preservation merge policy. Export performs one application IPC read regardless of the event count. Concurrent writes can commit during the read, but every row and metadata value in that export comes from the same SQLite snapshot. Oversized or malformed snapshots fail explicitly; the frontend does not export a partial fallback. The native export file writer remains responsible for approved destinations, output limits, and atomic replacement.

## Edit merge flow

Current behavior:

- A supported user edit updates the normalized projection row.
- The imported relational component remains source provenance and is not rewritten at edit time.
- Export reconstructs that source component and replaces generated-owned fields with values from the current projection.
- Unsupported properties, parameters, and nested components remain in the reconstructed component where the merge path supports them.
- Native detach and split copy the master event's preservation into a separate object and component graph, including the import envelope and timezone definitions. Attendee and alarm references point to the copied graph. Unrelated VEVENT siblings are excluded. Copies survive deletion of the original import object, and moving the copied event into another calendar retains its timezone definitions there. Raw imported values remain provenance; export replaces UID and recurrence identity from the current projection.

Edit snapshots admit exact relational metadata under the same source row and byte allowance as recurrence and execution evidence. Component traversal proceeds in bounded layers using the parent-component index instead of repeated scans of unrelated imports. Cycles, missing or inconsistent value owners, non-finite numbers, and excessive source size fail explicitly. The returned metadata revision includes imported children and diagnostics, but complete reviewed semantic Save and planned override/materialization copying are still in progress.

The current implementation does not automatically change preservation status or add a user-visible export warning after structural edits.

Desired future safeguards are to mark uncertain structural edits as `needs-review` or `regenerated` and show a warning before export. These safeguards remain planned and must not be described as current behavior.

Detailed rules live in [Edit merge policy](./edit-merge-policy.md).

## Lazy loading boundaries

Always loaded for calendar rendering:

- projected event rows in the requested window
- slim recurrence and override data needed for expansion
- fields already used by visible chips and blocks

Loaded on demand:

- preserved component rows
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

The schema currently accepts these component preservation states:

- `lossless`: parsed and semantically preserved without a known narrowing
- `partial`: projected with unsupported data preserved separately
- `unsupported`: preserved but not projected
- `needs-review`: reserved for data that requires user-visible caution
- `regenerated`: no usable original component is linked, so export is generated from projection
- `invalid`: could not be safely parsed or exported

Imports currently assign these states from component type, and older imported rows without a component link derive `regenerated` during reads. Automatic edit-time transitions and corresponding user-visible warnings are planned. These diagnostics must not block rendering of valid projected data.

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

Compatibility claims must be based on [conformance status](./conformance/README.md) and fixture coverage, not only on individual app tests.

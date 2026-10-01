# Notes and projects schema

Notes and Projects share project identity, navigation, task scheduling, managed working folders, assets, and history, but they keep different canonical models. Notes is a document graph. Projects is structured planning data plus a logical working-folder boundary.

## Notes canonical graph

A Notes page has stable identity, metadata, placement, trash and archive state, and an ordered block tree. Blocks have stable identity independent of their current parent and order. Page and block mutations validate the resulting graph for cycles, stale parents, invalid project placement, and unsupported content before committing.

Page cover metadata is canonical SQLite data. Designed covers retain a validated pattern identifier and Automatic or a theme palette slot, while image covers retain their source reference and optional normalized focal coordinates. These descriptors follow page duplication, templates, and history; image bytes remain managed assets. Theme-resolved colors and rendered crops are presentation. See [Page covers](../../features/notes/page-covers.md).

Page bodies are not canonical Markdown or HTML. Rich content is stored as validated block data and text runs. Rendered output, Markdown export, previews, and search projections are derivative.

Trash is recoverable state. Restore validates the current graph and chooses a valid destination rather than blindly reinstating a stale parent. Permanent deletion applies retention, asset, link, comment, database, and history rules through one domain service.

## Placement and projects

A page is workspace-rooted, nested below one valid page, or placed through one valid project location. It cannot have competing canonical parents. Moves update project and ancestry implications transactionally.

Project working-folder Markdown remains file-authoritative and is not copied into the Notes graph. The project tree may present Notes pages and working-folder files together, but their source-of-truth rules remain distinct.

The single-placement rule is invariant 8 in [Data invariants](../invariants.md).

## Notes databases

Notes databases define stable property identities, types, options, views, filters, sorts, groups, and row values. A page may participate as a database row without losing its page identity.

A database shell owns its data sources; a linked shell has independent view settings and references another shell's sources. Independent database copying assigns new source, property, view, row, nested-content, and template identities in one transaction. Internal references are remapped, while unrelated external references remain intact. Trash follows owned sources and row graphs, never a linked shell's shared source. Reserved trash journal metadata in block payloads and page properties records which active objects a deletion changed. Restore uses that ownership token to avoid reviving previously trashed or subsequently deleted objects. This metadata is local lifecycle bookkeeping and does not replace canonical row and source ownership.

Relations point to stable database or page identities. Rollups and formulas are derived from canonical values and validated expressions. Computed values may be cached for performance only when their dependency revision and rebuild path are explicit.

Property type changes require a conversion policy. The application must not reinterpret incompatible stored values merely because a column was renamed or its presentation changed. Deleting a property handles relation, formula, rollup, view, and row dependencies explicitly.

Row-window queries use stable ordering and keyset boundaries. Exact hot-query indexes are documented in [Query plans](query-plans.md).

## Links, aliases, mentions, and comments

Internal links store stable target identity when resolved and bounded source location or block identity. Human-readable titles are presentation snapshots, not authority or identity.

Aliases and unresolved-link state allow a renamed or not-yet-existing target to be reconciled without destructive text rewriting. Backlinks and unresolved-link indexes are derived from canonical content and can be rebuilt.

Mentions, comments, suggestions, and mention notifications retain author, target, thread, resolution, and delivery state as separate concepts. Notification delivery is a projection. Deleting or restoring content must not fabricate a new comment or collaboration identity.

## Assets

Managed Notes assets use feature-owned relative identities below the active vault. Page icons, covers, block files, property files, comment attachments, and imported files remain distinguishable so cleanup can apply the correct references and retention.

Rust validates source type, size, content signature where relevant, and destination path before importing bytes. Canonical relationship writes and filesystem finalization follow a staged workflow with retryable cleanup. A missing derivative thumbnail does not imply a missing canonical asset.

Export rewrites or copies assets according to the chosen format. Exported paths do not become canonical managed paths.

## Import, export, and working Markdown

Import is an explicit conversion into validated canonical rows. It never treats an arbitrary Markdown edit as an implicit database mutation. Transfer workflows stage, validate, and report conflicts before replacing canonical content.

Working Markdown is a controlled bridge for selected Notes and related project context. It has provenance and revision checks. Applying changes back into Notes requires an explicit command and conflict handling. The bridge is not a second live source of truth.

## History and collaboration

Page history stores bounded canonical snapshots or chunks with content digests, encoding, byte limits, and retention metadata. The global page-history retention value supports 0, 7, 30, 90, 180, or 365 days. Zero means retain indefinitely. Project-specific retention may inherit the global value or select a supported override.

Reads treat compressed history as untrusted: validate encoding, declared size, decompression bound, digest, and JSON shape before use. Restore records the current state first, applies canonical rows transactionally, preserves append-only collaboration sequencing, suppresses historical notification delivery, and rebuilds disposable indexes.

Collaboration operations have stable sequence and author identity. They are durable local history today and a future sync input, not evidence that remote collaboration is already deployed.

## Search and derived indexes

Full-text search, backlinks, unresolved-link lookup, sidebar summaries, database computed projections, and rendered previews are rebuildable. Their source revision and invalidation rule must be explicit. Search result authorization and project scope are applied before content leaves Rust.

A rebuild cannot modify canonical page, block, property, comment, or asset identity.

## Project planning

A project owns stable metadata, lifecycle state, optional grouping, planning views, statuses, tasks, dependencies, custom fields, templates, history, and scheduling links. Presentation order is explicit and deterministic.

Tasks have stable identity independent of status column, view, schedule, or parent task. Dependencies validate both endpoints, prevent self-dependency and cycles where the domain forbids them, and survive ordinary reordering. Calendar links distinguish scheduled work from looser references.

Custom-field definitions and values are separate. Changing a definition validates or migrates existing values. Templates create ordinary project and task rows with new identities; template IDs do not become hidden privileges or shared mutable state.

Project history records meaningful user changes without treating every derived count as canonical. Restore and undo operate through domain commands so task links, Notes placement, and working-folder relationships remain consistent.

## Working folders

Every project receives a durable managed working-folder row when created or repaired. The managed directory is created below the vault using the project identity. Database creation and directory setup use staged compensation rather than leaving a project that falsely claims a usable folder.

External folders use the same portable logical identity model but resolve through a device-local binding. Absolute paths and filesystem fingerprints do not enter the vault database. Chat authority over a project does not imply access to every folder associated with it; exact grants remain governed by [Chat access control](../access-control.md).

Deleting a project must account for user-authored managed files, linked Notes, tasks, calendar events, Chat history, and external bindings. Destructive filesystem removal is never an automatic foreign-key cascade.

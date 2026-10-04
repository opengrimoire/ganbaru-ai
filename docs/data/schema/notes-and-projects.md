# Notes and projects schema

Notes and Projects share project identity, navigation, task scheduling, managed working folders, assets, and history, but they keep different canonical models. Notes is a document graph. Projects is structured planning data plus a logical working-folder boundary.

## Notes canonical graph

A Notes page has stable identity, metadata, placement, trash and archive state, and an ordered block tree. Blocks have stable identity independent of their current parent and order. Page and block mutations validate the resulting graph for cycles, stale parents, invalid project placement, and unsupported content before committing.

Page cover metadata is canonical SQLite data. Designed covers retain a validated pattern identifier and Automatic or a theme palette slot, while image covers retain their source reference and optional normalized focal coordinates. These descriptors follow page duplication, templates, and history; image bytes remain managed assets. Theme-resolved colors and rendered crops are presentation. See [Page covers](../../features/notes/page-covers.md).

Page bodies are not canonical Markdown or HTML. Rich content is stored as validated block data and text runs. Rendered output, Markdown export, previews, and search projections are derivative.

Trash is recoverable state. Restore validates the current graph and chooses a valid destination rather than blindly reinstating a stale parent. Permanent deletion applies retention, asset, link, comment, database, and history rules through one domain service.

## Compound editor edits

`notes_apply_compound_edit` accepts bounded typed block, layout, and database operations associated with one active Notes page. Rust claims the SQLite writer before checking canonical block fingerprints and destination ownership. References to blocks created earlier in the same action are validated against that transaction. Copy sources may belong to another page. Other foreign revisions are accepted only for an explicit move between named source and destination pages, limited to its moved root and destination references; ordinary operations remain confined to the requested page.

The graph changes, mention and asset-reference maintenance, page-history snapshot, and `notes_edit_receipts` entry commit together. Inner append, update, move, trash, and database helpers use the caller's transaction and suppress intermediate history snapshots. Immutable project-history recovery baselines can be established before that transaction; establishing a baseline is not a partial editor mutation. No filesystem copying is required for already managed asset references.

Receipts bind the operation identity to a digest of its complete typed request. The same request returns its original typed result after an uncertain response or restart. Reusing an identity with different intent fails. Receipt retention follows the owning page and ends when that page is permanently deleted. Returned blocks include affected parents and canonical descendants with their new fingerprints and sibling placements. Bounded canonical preimages share the receipt budget and complete only the corresponding undo boundaries, including unloaded table rows and moved layout content. Undo never restores an entire page blindly. These opaque fingerprints include persisted payload, placement, lifecycle, and metadata; they are equality tokens, not clocks or ordered revisions. Frontend queues resolve preconditions after earlier local writes acknowledge, retain one immutable request on retry, and reconcile historical undo tokens without changing unrelated historical payloads.

Limits bound operation counts, references, graph traversal, request bytes, table payloads, copied graphs, and result bytes. One copy budget spans all copied sources within the command, including nested child pages and owned databases. Native layout traversal preserves unloaded children; canonical table-column changes preserve each row's current rich text and metadata. Column width plans must supply revisions for every canonical sibling, so a partially loaded column list cannot silently renormalize only its visible columns. Undo plans contain changed payloads and placements only, avoiding unnecessary writes to unchanged loaded siblings. Failed validation or a failed operation rolls back the entire edit and its receipt. In-memory drafts and pending editor requests do not become a second canonical content store.

Template and button insertion resolves active roots and descendants inside the same transaction. Supplied identities for loaded content remain stable; Rust allocates missing copy identities and retains them in the durable receipt. The existing limit of 100 directly mapped block identities applies to this insertion, while nested owned database content also shares the command's broader copy budget. Prohibited child-page content and excessive graphs reject the complete action. Frontend undo projection applies the same selective payload and placement plan as persistence, preserving unrelated later text and ordering.

## Placement and projects

A page is workspace-rooted, nested below one valid page, or placed through one valid project location. It cannot have competing canonical parents. Moves update project and ancestry implications transactionally.

Project working-folder Markdown remains file-authoritative and is not copied into the Notes graph. The project tree may present Notes pages and working-folder files together, but their source-of-truth rules remain distinct.

The single-placement rule is invariant 8 in [Data invariants](../invariants.md).

## Notes databases

Notes databases define stable property identities, types, options, views, filters, sorts, groups, and row values. A page may participate as a database row without losing its page identity.

A database shell owns its data sources; a linked shell has independent view settings and references another shell's sources. Independent database copying assigns new source, property, view, row, nested-content, and template identities in one transaction. Internal references are remapped, while unrelated external references remain intact. Trash follows owned sources and row graphs, never a linked shell's shared source. Reserved trash journal metadata in block payloads and page properties records which active objects a deletion changed. Restore uses that ownership token to avoid reviving previously trashed or subsequently deleted objects. This metadata is local lifecycle bookkeeping and does not replace canonical row and source ownership.

Relations point to stable database or page identities. Rollups and formulas are derived from canonical values and validated expressions. Computed values may be cached for performance only when their dependency revision and rebuild path are explicit.

Property type changes require a conversion policy. The application must not reinterpret incompatible stored values merely because a column was renamed or its presentation changed. Deleting a property handles relation, formula, rollup, view, and row dependencies explicitly.

Source schema commands accept property definitions only; view order and visibility have separate saved-view commands. A source update reconciles every referencing view, including linked shells, in the same SQLite transaction. It preserves current surviving presentation and query state, appends new table properties deterministically, removes deleted property references, and clears incompatible grouping, date, and file-cover selections. It never writes presentation from the property editor's earlier schema snapshot.

Source creation adds one owned source and its initial table atomically to an existing shell. Attachment adds an independent table over an existing active source without changing its owner or copying rows. Source, shell, and view identities must be distinct. The selected saved view determines the source used for reads and row/template/property commands. A default-view replacement writes both `view_id` and `data_source_id` in the shell payload. Shell renaming synchronizes its single owned source, while multiple owned sources retain their independent titles.

An optional Boolean `editing_locked` in the canonical child-database payload defaults to false. It belongs to the shell and covers all of that shell's saved views; linked shells retain independent locks. Structural commands validate the requesting shell inside their transaction, including schema changes requested through a linked table. Row values, creation, and hierarchy do not require unlocking. This local editing preference is not authorization. Lock changes, source creation/attachment, and contextual schema insertion participate in canonical page and project history. Contextual insertion commits schema reconciliation and requesting-table placement in one transaction. Empty duplication generates fresh property/option identities and downgrades reciprocal relations to single relations without copying row values.

Row-window queries use stable ordering and keyset boundaries. Exact hot-query indexes are documented in [Query plans](query-plans.md).

Database sub-items live in `notes_data_source_row_hierarchy`, with one optional parent relationship per row. Both endpoints keep their canonical `data_source_id` page placement. Domain mutations enforce same-source active ownership, acyclic relationships, a maximum depth of 32, and atomic row-plus-relationship creation. Foreign-key cascades remove relationships when an endpoint or source is deleted; moving a page to another source or placement detaches incompatible incoming and outgoing relationships. Trash and archive retain canonical edges. Per-window ancestry and exact active child counts are derivative projections. Copies, canonical graph export, and project-history restoration include the relationship table; saved-view collapse identities reference rows without becoming another source of hierarchy data.

Saved table views also own grouping, collapsed groups, column wrapping, a visible freeze boundary, date/time display formats, compatible calculations, and ordered conditional color rules. These settings reference stable property identities. Source reconciliation removes deleted references and clears incompatible calculations and grouping without replacing surviving presentation. Filter expressions use bounded typed predicates and nested AND/OR groups. The row window, total count, group counts, and export predicate evaluation use the same expression semantics.

Text `contains`, `equals`, and `not_equals` fold only ASCII `A-Z` to `a-z`, matching SQLite's default case behavior. Non-ASCII characters remain case-sensitive, Unicode normalization is not applied, and containment treats wildcard characters literally. Text emptiness accepts null, empty text, or text containing only the 25 Unicode White_Space characters: U+0009 through U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 through U+200A, U+2028, U+2029, U+202F, U+205F, and U+3000. U+200B and U+FEFF are populated. SQLite predicates, Rust export evaluation, and frontend conditional color evaluation use this same explicit set; formula, rollup, and button predicates are rejected before emptiness evaluation.

Group counts and calculation footers describe the complete filtered source, including unloaded rows. Calculations stream bounded row windows and hydrate derived formula and rollup values before aggregating. Results are read DTO projections, not canonical row values. Empty and invalid input behavior is part of the feature contract. Unique calculation state is retained only when requested; ordinary numeric calculations do not retain all distinct row values.

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

Dependency date preview reads one consistent, complete project graph with task revisions and protection state. Deterministic topological traversal computes finish-to-start shifts and reports cycles or unresolved constraints explicitly. Task, edge, metadata, preview, and result limits reject oversized work without truncating its meaning. The reviewed digest includes native input and policy identity. Apply reserves the SQLite writer, recomputes that digest, and rejects any changed preview before writing dates. Date changes, per-field history, and `project_dependency_cascade_receipts` commit together. Receipts bind operation identity to the exact reviewed digest and remain until the owning project is permanently deleted. Existing task revisions prevent an older returned receipt from replacing newer frontend rows; the frontend retains operation identities and removal evidence across uncertain responses.

Custom-field definitions and values are separate. Changing a definition validates or migrates existing values. Templates create ordinary project and task rows with new identities; template IDs do not become hidden privileges or shared mutable state.

Project history records meaningful user changes without treating every derived count as canonical. Restore and undo operate through domain commands so task links, Notes placement, and working-folder relationships remain consistent.

Status, priority, archive, and restore selections use bounded native bulk commands. Only the intended field is taken from the client. Its displayed value is checked against current storage; unrelated newer fields are preserved. Archive and restore compute the descendant closure from SQLite, including unloaded tasks. Restoring a child below an archived parent is rejected unless that parent is restored in the same operation. Task rows, history, and the retry receipt commit together.

Bulk and reorder operation IDs identify immutable intent. Retrying the same payload returns its committed result, including after restart; reusing an ID with different intent is rejected. Receipts remain with their owning project and are deleted when that project is deleted. Task, custom-field, and option row revisions increase on every persisted update, including older command paths. Frontend mutation reconciliation ignores older revisions, so a recovered receipt cannot overwrite newer loaded state. Pending requests also retain explicit deletion evidence until acknowledgement or a vault reload, preventing an old receipt from restoring removed project schema. Absence from a paginated view is not deletion evidence. Existing rows start at revision zero through additive migrations; wall-clock timestamps remain display metadata.

Adjacent reordering reads canonical siblings after claiming the SQLite writer. It validates the selected placement, updates only ordering metadata, and commits the resulting rows with its receipt. Task lanes separate section and status order; a subtask's section order belongs to its parent's complete active child list even when children have different section assignments. Equal ranks use deterministic sibling tie breakers and are normalized atomically. Sibling counts, identity sizes, and receipt bytes are bounded; exceeding a limit rejects the complete operation.

## Working folders

Every project receives a durable managed working-folder row when created or repaired. The managed directory is created below the vault using the project identity. Database creation and directory setup use staged compensation rather than leaving a project that falsely claims a usable folder.

External folders use the same portable logical identity model but resolve through a device-local binding. Absolute paths and filesystem fingerprints do not enter the vault database. Chat authority over a project does not imply access to every folder associated with it; exact grants remain governed by [Chat access control](../access-control.md).

Deleting a project must account for user-authored managed files, linked Notes, tasks, calendar events, Chat history, and external bindings. Destructive filesystem removal is never an automatic foreign-key cascade.

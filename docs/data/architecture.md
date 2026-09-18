# Data architecture

Ganbaru AI uses three storage classes with deliberately different authority: user documents, structured application data, and device-local runtime state. Treating one class as another causes ambiguous recovery, unsafe sync, and data that cannot be inspected outside the app.

## Sources of truth

### User documents

Diary entries, project working documents, generated reports, and attachments are files inside the active Ganbaru AI folder. When a document format is canonical, the file is the source of truth. SQLite may index its path, metadata, extracted text, tags, or links, but that index must be rebuildable.

Project working-folder Markdown remains ordinary user-owned Markdown. Managed project folders live below the vault. External working folders stay at user-selected paths and are represented in the vault by durable logical identities, never by portable absolute paths.

Keeping canonical documents as files provides three long-term properties:

- The user can inspect, edit, back up, version, and migrate them with ordinary tools.
- The folder remains useful if Ganbaru AI is unavailable.
- Import and synchronization conflicts can be resolved at a visible document boundary.

### Structured data and document graphs

Calendar events, Pomodoro state, projects and tasks, Notes pages and blocks, Quick notes, themes, playlist definitions, and organizational Chat state are structured data. SQLite is authoritative because these domains require transactions, foreign keys, stable identities, ordering, and relational queries. Authoritative pools configure every connection with WAL, `synchronous=FULL`, foreign keys, and a bounded busy timeout. Recycled connections retain those settings.

Notes is intentionally included here. A Notes page is a graph of blocks, properties, links, comments, history, collaboration operations, database rows, and assets. Markdown cannot preserve that graph without lossy conventions. Notes Markdown is therefore import, export, or bridge output, not the canonical page.

Organizational Chat is also structured data. A project channel can outlive any provider session. Replacing or deleting a provider continuation cannot replace, merge, or delete the surrounding channel, membership, approval, decision, checkpoint, or execution history.

### Device-local state

The platform application config directory stores state that is meaningful only on one installation, including the active-vault pointer, device identity, external folder bindings, executable paths, provider homes, process state, probe caches, benchmark state, and transient runtime snapshots.

Portable rows may refer to a logical working-folder ID. Resolving that ID to an external absolute path requires a current device-local binding and filesystem identity check. A portable database must never acquire authority merely because it contains a path copied from another device.

## The active Ganbaru AI folder

The active folder contains the vault marker, portable configuration, SQLite database, managed project folders, reserved document directories, and managed assets. The canonical current tree is maintained in [AGENTS.md](../../AGENTS.md). This document does not duplicate that tree.

Production and development builds use separate default folders and separate platform config directories. A user may choose another folder or import a valid existing vault. Folder validation must reject an unrelated non-empty folder, an invalid marker, unsupported schema versions, permission failures, and a database that cannot be opened. The application must never delete or silently recreate a configured vault to recover from one of these errors.

Music bytes remain wherever the user stores them. The vault owns playlist definitions, canonical library metadata, source identities, and managed playback state, not the external music library itself. Backups are written to a user-selected location outside the active folder.

## Portable configuration

Portable preferences that should follow the vault live in config.json. Writes use a Rust-owned read, validate, merge, and atomic-replace flow so independent windows do not overwrite unrelated settings. Unknown or obsolete fields are handled by explicit validation and migration rules, not silently preserved forever.

The maintainer-approved pre-user reset on 2026-08-30 established the current SQLite, portable configuration, and device-local state shapes together. Earlier development vaults and platform app-state files are intentionally unsupported and must be removed before creating a fresh vault. After a user-capable release can persist these shapes, later changes require explicit migration or compatibility rules.

Device-only values do not belong in config.json. Examples include external absolute paths, native credential material, executable discovery, provider process state, and the active-folder pointer.

## Notes import and export

An exported Notes Markdown file is a derivative view. Editing it does not mutate the canonical page until the user performs an explicit import or transfer operation. Import validates and converts external content into a new or selected canonical graph. Export may be regenerated at any time.

Project working-folder Markdown is different. It is already file-authoritative and appears beside linked Notes content without being copied into the Notes graph.

Assets use managed relative identities. Import copies validated bytes into a feature-owned asset directory and records the relationship transactionally. Exports may copy or rewrite asset references, but an export never becomes a second canonical asset store.

## Chat separation

The durable organization layer owns projects, channels, memberships, messages, ordered provider-session links, canonical events, projections, drafts, attachments, checkpoints, access revisions, and cleanup records. Provider-native thread IDs are continuation handles within that organization layer.

One organizational run may be targetless while it performs planning or discussion. Before native filesystem, terminal, Git, preview, or process work begins, the run must resolve exactly one authorized execution target: a project working folder or a private scratch generation. Provider-native trust does not widen that target.

The current local coding-agent Chat uses Rust application services and an ephemeral assignment-scoped internal MCP endpoint for narrowly scoped host tools. A separately authorized external MCP service and a ganbaru-ai CLI are future integrations. They must reuse service-layer validation but do not exist as current authorization paths.

## Transactions and filesystem work

SQLite transactions protect relational changes. Filesystem operations cannot participate in a SQLite transaction, so commands that affect both layers use an explicit staged workflow:

1. Validate authority and all input before mutation.
2. Prepare filesystem work using bounded paths and sibling temporary files where appropriate.
3. Commit the canonical database relationship at a defined point.
4. Finalize or compensate the filesystem step.
5. Persist retryable cleanup when immediate compensation is unsafe or incomplete.

Blocking filesystem, process, and operating-system work must not hold a database transaction or shared async lock. The detailed runtime boundary is documented in [Native work](../architecture/native-work.md).

## Derived data and caches

Search indexes, projections, thumbnails, diagnostic summaries, and exported Markdown are derived. Every derived store needs a declared canonical input, invalidation rule, rebuild path, and size bound. A cache must not become the only remaining copy of user-authored information.

Chat projections and Notes search indexes may be persisted for speed, but canonical events and canonical Notes rows remain authoritative. Rebuilding a projection must preserve authorization and audience filtering.

## Storage decision checklist

Before adding persisted data, answer:

1. Is this user-authored content with a useful canonical external format? Prefer a file.
2. Does it require relational integrity, transactional multi-row updates, or graph identity? Prefer SQLite.
3. Is it meaningful only on one device or tied to a native path or process? Keep it device-local.
4. Is it derivable? Define the canonical input and rebuild path instead of granting the derivative equal authority.
5. Does it contain a secret? Store only an opaque credential reference in ordinary configuration and keep secret material in the native credential store.
6. Will it synchronize? Give it stable identity, deterministic merge semantics, and explicit authorization before treating sync as an implementation detail.

These questions are more durable than a table inventory. Exact current schema relationships are indexed in [Schema](schema/README.md).

## Implemented whole-vault handoff boundary

The linked desktop and Android workflow transfers one consistent copy of the complete portable vault. It includes `vault.json`, portable `config.json`, the SQLite snapshot, managed project folders, and managed assets. Live WAL and SHM files are never archived. External music bytes, external project folders, credentials, executable and provider paths, operating-system permissions, active-vault pointers, device keys, pairing records, ownership records, transfer recovery state, and live process state remain device-local.

Only the current ownership generation may open the active vault for native writes. The other device opens its last activated replica read-only. Ownership changes and read-only refreshes reuse the same staged archive validation and atomic activation path. Doomscrolling usage is the sole exception: inactive-device samples wait in a bounded device-local spool until the current owner commits them idempotently to portable SQLite.

This boundary transfers current state and does not merge independently edited vaults. Initial Android replacement creates a recoverable portable backup first. Explicit lost-device recovery creates a separate writable copy and does not claim that later changes can merge.

## Planned concurrent replication boundary

[Device linking and synchronization](sync.md) separates the implemented single-writer whole-vault handoff from planned concurrent replication. Shared defaults will move into transactional SQLite preferences for concurrent replication; current `config.json` consumers have not migrated. No field can participate in concurrent operation sync before its classification, validation, mutation journal, and conflict semantics exist.

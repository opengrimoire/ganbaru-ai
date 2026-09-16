# Device linking and synchronization

**Status: Partial.** A local multi-device whole-vault handoff is implemented in source. It provides secure LAN pairing, one administration desktop, explicit single-writer ownership, read-only whole-vault refresh, and combined Doomscrolling accounting without concurrent editing. Physical multi-device acceptance remains pending. The typed operation replication, conflict handling, end-to-end encrypted relay, and concurrent convergence described later in this document remain planned.

This contract links one person's devices. Multi-person sharing is later work. The phone must provide full offline access to portable Notes, Projects, Calendar, and other synchronized content. Focus execution has its own controller and evidence rules in [Focus authority](../algorithms/pomodoro/focus-authority.md).

## Implemented local whole-vault handoff

The administration desktop runs one embedded coordinator bound to a private LAN address. Phones link through a short-lived, single-use QR invitation. Another desktop can use the complete short-lived invitation copied from the coordinator. Every enrolled device authenticates with its own certificate and pins the coordinator certificate fingerprint from the invitation. Mutual TLS protects all later control and archive traffic. One administration desktop coordinates up to 32 enrolled computers and phones for one vault. There is no account, hosted service, relay, internet traversal, or general remote procedure interface.

Linux requires explicit user authorization when an active host firewall blocks the coordinator. The application explains the request before opening the operating system authorization agent and never receives the user's administrator password. Installed Debian and RPM builds use a named PolicyKit action whose privileged entry point validates every argument again. Development and portable builds use a generic authorization fallback. The application manages only its own TCP 43821 rule for the current private subnet, interface, and local address. It never disables the firewall or grants general inbound access. The user can remove recorded Ganbaru AI rules from Data settings.

Ownership is explicit and single-writer. Device-local records hold the current owner, monotonically increasing generation, transfer phase, device identity, pairing identity, membership, and resumable transfer state. SQLite connections and managed-vault file writes enforce the current role centrally. The coordinator serializes transfers. If one client owns the vault and another requests it, the owner first returns a committed snapshot to the coordinator, which then grants a later generation to the requester. Other replicas remain read-only throughout, so this path does not require domain conflict resolution. A stale generation or a grant from outside the pinned coordinator cannot restore write access. Active Chat work and an active Pomodoro run block ownership transfer, and local playback stops before the source is frozen.

Ownership transfer and read-only refresh both use one bounded whole-vault path:

1. Fence new writes, drain current writes, close or isolate database access, and create a consistent SQLite snapshot.
2. Archive the complete portable vault without live WAL or SHM files, then stream it into device-local staging.
3. Validate identities, generation, bounds, archive hash, paths, required files, schema compatibility, and SQLite integrity.
4. Commit a new generation only for ownership transfer, atomically activate staging, reopen through normal startup, and acknowledge the same durable transfer.
5. Preserve post-commit state until acknowledgement so restart retries the same activation instead of granting a second owner.

Each non-owner keeps its last activated copy for read-only browsing. A client refreshes from the current owner through the coordinator on application start, resume, LAN reconnect, or explicit user action without changing ownership. When the coordinator itself is read-only, it first requests a fresh snapshot from the current owner and relays that immutable copy to waiting clients. Reachable client devices keep a bounded authenticated long poll active so an explicit request does not wait for the periodic reconnect interval. Disconnected retries retain the slower backoff. Android reloads its ordinary startup reconciliation after activation, which rebuilds Calendar notification schedules and republishes portable Doomscrolling rules. Already scheduled alarms and accepted rules continue while disconnected. Changes cannot affect a force-stopped or disconnected phone until Android successfully refreshes.

Desktop and Android expose the linked relationship through a compact control beside Pomodoro. Its panel lists enrolled devices and presents the relevant refresh and ownership actions. Per-device removal and recovery remain in Data settings. A read-only replica does not add a permanent warning row to every application view. Whole-vault refresh remains an explicit or lifecycle operation and must not run after every mutation as a substitute for incremental synchronization.

The first desktop-vault activation on Android saves the previous Android vault as a portable backup in Downloads before ownership commits, and activation also preserves the prior private copy for recovery. Unlink does not silently choose a new owner. If the owning device is permanently lost, an explicit recovery action unlinks the devices and advances the local copy to a new standalone generation; the two copies do not merge.

Doomscrolling is the only inactive-device write exception. Browser, desktop-application, and Android-application usage enters a bounded device-local spool with stable device-scoped sample IDs. Through the authenticated coordinator, the current owner inserts samples transactionally and idempotently, then acknowledges committed IDs and returns the combined counter. Disconnected enforcement uses the last accepted combined value plus new local usage. Reconnection preserves the exact sum without duplication. Simultaneous disconnected use can temporarily exceed a combined limit because neither device knows the other's newest usage.

This handoff is deliberately not the planned concurrent synchronization system. It has no domain operation journal, CRDT, conflict resolution, cloud delivery, or automatic bidirectional editing.

## Target concurrent synchronization architecture

SQLite remains the durable local store. Replicas exchange validated domain operations and immutable assets, never raw database pages, arbitrary SQL, or unclassified application configuration. Foreground saves do not wait for a network.

Collaborative text uses Rust Yrs with a compatible Yjs editor adapter. Binary CRDT state is canonical in SQLite; rich-text payloads and plain-text columns are deterministic query and rendering projections. Text document identities are independent of block placement. Active documents use a bounded lazy cache.

Local network linking works without an account or server. An optional user-hosted Rust relay stores opaque encrypted records for cross-network and asynchronous delivery. Hocuspocus is no longer the proposed relay: its normal persistence loads and stores server-side Yjs documents, which does not match this encrypted record boundary. See [Hocuspocus persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence).

The intended crates are `ganbaru-sync-contracts`, `ganbaru-sync`, and an optional `ganbaru-sync-relay` binary. They have not been created. Domain services retain validation and projection ownership; the sync engine owns delivery and calls those adapters. Durable replication, live presence, and executable commands are distinct protocols.

## Target storage ownership

Every persisted field requires an explicit replication classification before it can leave a device. Unknown fields fail closed. This table is the target ownership contract, not a claim that existing mixed configuration has already migrated.

| Domain | Portable data | Device-local data |
| --- | --- | --- |
| Notes, Projects, Calendar, Quick notes | Content, relationships, templates, archive, Trash, retained history, favorites | Recents, current selection, navigation, viewport layout |
| Preferences | Profile, themes, language, time format, rhythm defaults | Font scale, layout, shortcuts, notification delivery, explicit presentation overrides |
| Doomscrolling | Rule definitions and device-attributed history | Permissions, application bindings, enforcement state |
| Music | Library identities, playlists, assignments, portable preferences | Source bindings, media bytes, current playback, volume, routing |
| Chat | Organizational content, portable review history, origin-attributed drafts | Execution processes, credentials, provider homes, terminals, native trust, paths, caches |
| Managed assets | Immutable content and metadata | Transfer staging, local availability, caches |
| Focus | Committed history, explicit controller ownership history | Live presence, local activity sources, native alarms and effects |

Unsent Chat drafts retain their origin and can be explicitly continued on another device. Sending clears only the revision sent. Arbitrary project source trees and external music files keep their existing device boundaries.

Shared preferences move into SQLite so preference changes and outbound records can commit atomically. Device preferences stay in application configuration storage. Remove canonical `config.json` and the unused `.yjs` vault skeleton only after their consumers migrate. Both still exist today.

## Target transactional operation boundary

Every synchronizable mutation, including imports, restores, scheduled jobs, and native background writes, must commit these together:

- Canonical changes and required relational projections.
- Stable operation identity, cryptographic device identity, writer generation, causal dependencies, resource scope, authorization revision, and protocol version.
- The operation receipt and durable outbound record.
- Required history and asset references.

UI invalidations and native effects follow commit. Incoming operations use the same validators and transaction boundary. Missing dependencies remain pending. Malformed or unauthorized records receive bounded diagnostics. A relay receipt means delivery to the relay; it does not mean another device committed the change.

Authoritative connections use WAL and `synchronous=FULL`, including replacement connections in a pool. SQLite documents that WAL with `NORMAL` can lose committed transactions on power failure; `FULL` synchronizes the WAL at each commit. Hardware and filesystem behavior still require failure testing. See [SQLite synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous).

The UI distinguishes saved on this device, received by relay, and confirmed on another device.

## Target conflict semantics

Valid concurrent operations converge regardless of delivery order. Rejecting the second operation to arrive is insufficient.

- Independent fields merge. Concurrent values for the same scalar retain alternatives, a deterministic displayed value, and a visible resolution action.
- Calendar start, end, timezone, and recurrence form one coupled value. Conflicts suspend automatic occurrence activation until resolved.
- Notes and project placement use stable identities and a cycle-safe replicated tree move algorithm. Stable ordering identifiers replace floating positions. Validate against a simple reference model of the [replicated move algorithm](https://martin.kleppmann.com/papers/move-op.pdf).
- Deletion creates tombstones. Concurrent edits remain recoverable in Trash or conflict recovery. Old operations cannot silently restore deleted content.
- Database property type changes retain incompatible values for resolution.
- History restore writes a safety version and new operations against current state. It never rewinds causal history.
- Cross-feature actions such as task scheduling form one operation group.
- Scheduled messages and other executable jobs have an execution device and stable execution receipts. Receiving their records cannot execute them.

## Target Notes editing

Whole-block replacement is not a collaborative text protocol. The editor must submit incremental operations, preserve relative selections and comment anchors, and keep locally authored undo separate from concurrent remote changes. TypeScript and Rust use UTF-16 positions. Composition, autocorrect, paste, marks, mentions, and Unicode need adapter-level tests.

Prepare incoming changes in isolated working state. Validate and atomically commit binary updates and SQL projections before publishing them to the active cache. Discard the working state on failed persistence. Preserve unsaved input and show saving until native acknowledgement. Writer IDs must be unique across installations, restored copies, and simultaneous windows. See [Yrs](https://docs.rs/yrs/latest/yrs/).

Current Notes writes still replace complete block payloads. Their collaboration log covers comments and suggestions, not general replica synchronization.

## Target enrollment and key lifecycle

The first desktop is the administration device. A short-lived, single-use QR invitation contains its identity fingerprint and a high-entropy enrollment secret. Manual entry accepts the complete invitation. Both devices show a verification code; the existing device explicitly confirms enrollment before releasing vault keys.

Direct connections use TLS 1.3 with pinned device identity. Operations are signed. Records and asset chunks use XChaCha20-Poly1305. Resource-key distribution uses HPKE with X25519 and HKDF-SHA256. Secrets use native desktop credential storage or Android Keystore wrapping. Review maintained implementations, minimal features, pinned versions, advisories, and the protocol composition before enabling transport. [HPKE](https://www.rfc-editor.org/rfc/rfc9180.html) does not provide application authorization, replay protection, or downgrade protection by itself.

Enrollment and revocation follow signed administration history. A separate owner recovery identity and recovery kit receive resource-key envelopes alongside authorized devices. Revocation rotates affected keys and rejects new operations from the removed device once revocation is known. Preserve rejected pending content for explicit recovery. Removal cannot erase copies already held by that device.

## Target bootstrap, assets, backup, and compaction

Bootstrap transfers a consistent typed snapshot and causal checkpoint followed by incremental operations. Stage, validate references and integrity, then activate atomically. If a phone has a different vault, retain it as a recoverable local vault. Combining vaults requires an explicit import preview.

Managed assets use immutable identities, encrypted manifests, authenticated hashes, bounded resumable chunks, and atomic publication. Native code transfers bytes. Filenames remain metadata and cannot choose destination paths. Structured data synchronizes automatically; managed attachments default to unmetered transfer with explicit download and offline controls.

Backups capture a consistent database and pinned asset set using authenticated encryption. Restore defaults to an isolated recovery copy. Rejoining the original vault requires current membership reconciliation and a fresh writer generation. Do not restore credentials, rewind acknowledgements, or resurrect tombstoned resources.

Offline enrolled devices retain the causal state and tombstones they need. Compaction requires acknowledged checkpoints; retirement is explicit. Asset collection considers live references, retained history, pending transfers, and backup pins.

Vault replacement must fence the generation across processes, pause native work, close pools, swap staging, and restart against the new generation. The existing process-local replacement guard is not sufficient for this target.

## Target settings and Android delivery

Onboarding and Settings will provide device linking, linked-device identity, connection method, last successful synchronization, pending changes, unavailable assets, conflicts, recovery status, focus controller, pause, retry, removal, recovery export, and optional relay configuration.

Android uses WorkManager for deferred synchronization and a visible, user-enabled connected-device service for live companion status. Alarms deliver scheduled reminders. Permission denial, process death, reboot, network changes, and background restrictions must expose degraded connectivity truthfully. Background service availability never establishes focus or idle activity.

## Delivery and acceptance

| Milestone | Status | Remaining work |
| --- | --- | --- |
| Focus correctness and contracts | Partial | Move all transition decisions and command receipts into Rust, add durable device controller ownership and native runtime bridge |
| Durable mutation and storage boundaries | Partial | WAL durability is configured; scoped preferences, cryptographic writers, journal and domain-wide atomic mutation coverage remain |
| Local replica convergence | Planned | Notes text and tree merging, all portable domain adapters, two- and three-replica failure tests |
| Local whole-vault handoff | Partial | Implemented in source for one administration desktop and a bounded membership of desktop and Android clients; physical multi-device acceptance remains |
| Concurrent secure local linking | Planned | End-to-end encrypted operation enrollment, key lifecycle, revocation, typed bootstrap, and convergence |
| Relay and Android sync | Planned | Encrypted relay, native background runtime, encrypted backup, measurements and physical acceptance |

Required tests include reordered, duplicated, delayed and interrupted delivery; text and tree convergence; deletion, undo and history restore; crashes at persistence and acknowledgement boundaries; full disks, corrupt staging and missing assets; invalid identity, signature, invitation replay, revocation, key epochs, payload bounds and protocol versions; controller handoff failure and expired commands; duplicate jobs; long-offline replicas, compaction, restored backups and cloned writers.

Measure bootstrap, input and save latency, bandwidth, memory, battery, and database contention. Queues and caches remain bounded, with lazy loading, incremental indexing, and background backoff. Run the serialized `validate:full` gate for the complete dependency and security changes. Pairing, key lifecycle, native bridges and remote capabilities require a separate security review. Physical Android and desktop acceptance is mandatory for sleep, force-stop, reboot, permissions, manufacturer restrictions, clock changes, and disconnected use.

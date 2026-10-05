# Device linking and synchronization

**Status: Partial.** Local single-writer whole-vault handoff is implemented in source: secure LAN pairing, one administration desktop, explicit write ownership, read-only refresh, and combined distraction usage accounting. Physical multi-device acceptance is pending. Concurrent operation replication, conflict handling, the encrypted relay, and convergence are planned.

This contract links one person's devices; multi-person sharing is later work. The phone must provide full offline access to portable Notes, Projects, Calendar, and other synchronized content. Focus execution has its own controller and evidence rules in [Focus authority](../algorithms/pomodoro/focus-authority.md).

## Implemented local whole-vault handoff

Source: `apps/client/src-tauri/app/src/vault/handoff/`.

### Pairing and transport

The administration desktop runs one embedded coordinator on a private LAN address and coordinates up to 32 enrolled desktops and phones for one vault. Phones link by scanning a short-lived, single-use QR invitation; desktops paste the complete textual invitation. The QR form is a compact binary projection because module density limits reliable scanning distance. Every device authenticates with its own certificate and pins the coordinator fingerprint from the invitation, and mutual TLS protects all later traffic. There is no account, hosted service, relay, internet traversal, or general remote procedure interface.

Enrollment is idempotent for the same device identity and coordinator. A linked client must unlink before accepting an invitation from a different coordinator, vault, or certificate. A reinstalled app has a new device identity and stays a separate membership until the old entry is removed.

On Linux, when an active host firewall blocks the coordinator, the app explains the request and opens the operating system authorization agent; it never receives the administrator password. Installed Debian and RPM packages use a named PolicyKit action whose privileged entry point revalidates every argument; development and portable builds use a generic authorization fallback. The app manages only its own rule (TCP 43821 for production, 43822 for development so both can run) scoped to the current private subnet, interface, and address. It never disables the firewall, and the user can remove its rules from Data settings.

Every invitation, transfer, owner poll, and archive declares the handoff protocol and a fingerprint of the embedded SQLite migration set. A mismatch is rejected before snapshot preparation with a request to update both devices. Package versions are included only for diagnosis, because equal versions do not prove an equal data format.

### Ownership

Ownership is explicit and single-writer. Device-local records hold the current owner, a monotonically increasing generation, transfer phase, and resumable transfer state. SQLite connections and managed file writes enforce the current role centrally. The coordinator serializes transfers: the current owner first returns a committed snapshot, then the coordinator grants a later generation to the requester. Other replicas stay read-only throughout, so no domain conflict resolution is needed. A stale generation or a grant from outside the pinned coordinator never restores write access.

An active Chat run or Pomodoro run blocks transfer, and local playback stops before the source is frozen. Before queuing a request for a remote owner, the coordinator requires a recent owner heartbeat; an unavailable owner ends the attempt with ownership unchanged.

Ownership persistence distinguishes failure before replacement from uncertain durability after it. If the directory sync after replacement fails, ownership reads, database access, and managed writes stay blocked until the state reloads successfully; the old writable owner is never restored only in memory. Unix builds synchronize the containing directory before reporting success; other platforms still need physical crash and power-loss acceptance.

### Transfer and refresh

Ownership transfer and read-only refresh share one bounded path:

1. Fence new writes, drain current writes, isolate database access, and create a consistent SQLite snapshot.
2. Archive the complete portable vault without live WAL or SHM files and stream it into device-local staging.
3. Validate identities, generation, bounds, archive hash, paths, required files, migration history, and SQLite integrity.
4. For a transfer, commit the new generation; then atomically activate staging, reopen through normal startup, and acknowledge.
5. Keep post-commit state until acknowledgement, so a restart retries the same activation instead of granting a second owner.

Failure or cancellation before the transfer is durably stored restores pre-commit ownership before fences are released. Committed ownership is never rolled back by preparation cleanup.

The archive includes `vault.json`, portable `config.json`, the SQLite snapshot, managed project folders, and managed assets. External music and project folders, credentials, executable and provider paths, operating-system permissions, the active-vault pointer, device keys, pairing and ownership records, and live process state stay device-local.

Each non-owner keeps its last activated copy for read-only browsing and refreshes through the coordinator on start, resume, LAN reconnect, or explicit request. A read-only coordinator first fetches a fresh snapshot from the owner and relays it. Reachable clients keep a bounded authenticated long poll open so an explicit request does not wait for the periodic reconnect interval; disconnected clients retry with slower backoff. After activation, Android reruns startup reconciliation, rebuilding Calendar notification schedules and republishing distraction rules. A disconnected phone keeps its existing alarms and rules until it refreshes. Whole-vault refresh is a lifecycle or explicit operation and must never run after every mutation as a substitute for incremental sync.

### Replacing and recovering vaults

Linking never merges two independent vaults. Before the first transfer replaces an independent local vault, the app asks for confirmation and states where the old copy will be kept: Android writes a complete portable backup to Downloads, and desktop keeps the previous vault in a visible sibling folder. Failing to preserve it aborts activation. The only exception is an untouched Android starter vault created during first-use onboarding, which may become a replica directly.

Unlinking never silently picks a new owner. The owner can remove an unreachable read-only device immediately but not an unreachable device that owns the vault. The coordinator keeps a bounded revocation record; on reconnect the removed device is denied, clears its link, and keeps its copy read-only. Network and TLS failures never clear membership. If the owner is permanently lost, an explicit recovery action unlinks the devices and advances the local copy to a new standalone generation; the copies do not merge.

### Distraction usage exception

Distraction usage is the only write from inactive devices. Browser, desktop, and Android usage enters a bounded device-local spool with stable device-scoped sample IDs. Through the coordinator, the owner inserts samples transactionally and idempotently, acknowledges them, and returns the combined counter. Disconnected enforcement uses the last accepted combined value plus new local usage, and reconnection preserves the exact sum. Simultaneous disconnected use can temporarily exceed a combined limit because neither device knows the other's newest usage.

This handoff is deliberately not the concurrent synchronization system: it has no operation journal, CRDT, conflict resolution, cloud delivery, or bidirectional editing.

## Target concurrent synchronization

### Architecture

SQLite remains the durable local store. Replicas exchange validated domain operations and immutable assets, never raw database pages, arbitrary SQL, or unclassified configuration. Foreground saves never wait for the network.

Collaborative text uses Rust Yrs with a compatible Yjs editor adapter. Binary CRDT state is canonical in SQLite; rich-text payloads and plain-text columns are deterministic projections. Text document identities are independent of block placement.

Local network linking works without an account or server. An optional user-hosted Rust relay stores opaque encrypted records for cross-network and asynchronous delivery. Hocuspocus was rejected as the relay because its normal persistence stores server-side Yjs documents, which breaks the encrypted record boundary.

Planned crates are `ganbaru-sync-contracts`, `ganbaru-sync`, and an optional `ganbaru-sync-relay` binary. Domain services keep validation and projection ownership; the sync engine owns delivery. Durable replication, live presence, and executable commands are distinct protocols.

### Storage ownership

Every persisted field needs an explicit replication classification before it can leave a device. Unknown fields fail closed.

| Domain | Portable data | Device-local data |
| --- | --- | --- |
| Notes, Projects, Calendar, Quick notes | Content, relationships, templates, archive, Trash, retained history, favorites | Recents, current selection, navigation, viewport layout |
| Preferences | Profile, themes, language, time format, rhythm defaults | Font scale, layout, shortcuts, notification delivery, explicit presentation overrides |
| Distraction blocker | Rule definitions and device-attributed history | Permissions, application bindings, enforcement state |
| Music | Library identities, playlists, assignments, portable preferences | Source bindings, media bytes, current playback, volume, routing |
| Chat | Organizational content, portable review history, origin-attributed drafts | Execution processes, credentials, provider homes, terminals, native trust, paths, caches |
| Managed assets | Immutable content and metadata | Transfer staging, local availability, caches |
| Focus | Committed history, explicit controller ownership history | Live presence, local activity sources, native alarms and effects |

Unsent Chat drafts keep their origin and can be explicitly continued on another device. Shared preferences move from `config.json` into SQLite so a preference change and its outbound record commit atomically. Remove `config.json` and the unused `.yjs` vault directory only after their consumers migrate.

### Transactional operation boundary

Every synchronizable mutation, including imports, restores, scheduled jobs, and native background writes, commits together:

- Canonical changes and required relational projections.
- Stable operation identity, cryptographic device identity, writer generation, causal dependencies, resource scope, authorization revision, and protocol version.
- The operation receipt and durable outbound record.
- Required history and asset references.

UI invalidation and native effects follow commit. Incoming operations use the same validators and transaction boundary; missing dependencies stay pending. A relay receipt means delivery to the relay, not that another device committed the change. The UI distinguishes saved on this device, received by relay, and confirmed on another device.

Authoritative connections already use WAL with `synchronous=FULL`, because WAL with `NORMAL` can lose committed transactions on power failure. See [SQLite synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous).

### Conflict semantics

Valid concurrent operations converge regardless of delivery order; rejecting whichever arrives second is insufficient.

- Independent fields merge. Concurrent values for one scalar keep alternatives, a deterministic displayed value, and a visible resolution action.
- Calendar start, end, timezone, and recurrence form one coupled value. A conflict suspends automatic occurrence activation until resolved.
- Notes and project placement use stable identities and a cycle-safe [replicated tree move algorithm](https://martin.kleppmann.com/papers/move-op.pdf), with stable ordering identifiers instead of floating positions.
- Deletion creates tombstones. Concurrent edits stay recoverable in Trash or conflict recovery, and old operations never silently restore deleted content.
- Database property type changes keep incompatible values for resolution.
- History restore writes a safety version and new operations against current state; it never rewinds causal history.
- Cross-feature actions such as task scheduling form one operation group.
- Scheduled messages and other executable jobs have one execution device and stable execution receipts. Receiving their records never executes them.

### Notes editing

Whole-block replacement is not a collaborative text protocol, and current Notes writes still replace complete block payloads. The editor must submit incremental operations, preserve relative selections and comment anchors, and keep local undo separate from remote changes. TypeScript and Rust share UTF-16 positions. Incoming changes are prepared in isolated working state and committed atomically with their SQL projections before reaching the active cache. Writer IDs must be unique across installations, restored copies, and windows. See [Yrs](https://docs.rs/yrs/latest/yrs/).

### Keys and enrollment

Both enrolling devices show a verification code, and the existing device confirms before releasing vault keys. Direct connections use TLS 1.3 with pinned device identity, operations are signed, records and asset chunks use XChaCha20-Poly1305, and resource-key distribution uses HPKE with X25519 and HKDF-SHA256. Secrets live in native credential storage or Android Keystore wrapping. [HPKE](https://www.rfc-editor.org/rfc/rfc9180.html) alone does not provide authorization, replay protection, or downgrade protection, so the protocol composition needs review before transport is enabled.

Enrollment and revocation follow signed administration history. A separate owner recovery identity and recovery kit receive resource-key envelopes. Revocation rotates affected keys and rejects new operations from the removed device; it cannot erase copies that device already holds.

### Bootstrap, assets, backup, and compaction

Bootstrap transfers a consistent typed snapshot and causal checkpoint, followed by incremental operations, staged and validated before atomic activation. A phone with a different vault keeps it as a recoverable local vault; combining vaults requires an explicit import preview.

Managed assets use immutable identities, encrypted manifests, authenticated hashes, bounded resumable chunks, and atomic publication. Filenames are metadata and never choose destination paths. Structured data syncs automatically; attachments default to unmetered transfer with explicit download and offline controls.

Backups capture a consistent database and pinned asset set with authenticated encryption. Restore defaults to an isolated recovery copy; rejoining requires membership reconciliation and a fresh writer generation, and never restores credentials, rewinds acknowledgements, or resurrects tombstones. Compaction requires acknowledged checkpoints, and asset collection respects live references, retained history, pending transfers, and backup pins.

Vault replacement must fence the generation across processes, not only within one process as the current guard does.

### Settings and Android delivery

Onboarding and Settings will show linked devices, connection method, last successful sync, pending changes, unavailable assets, conflicts, recovery status, focus controller, and relay configuration, with pause, retry, removal, and recovery export.

Android uses WorkManager for deferred sync and a visible, user-enabled connected-device service for live companion status. Permission denial, process death, reboot, network changes, and background restrictions must surface as degraded connectivity. Background service availability never establishes focus or idle activity.

## Delivery and acceptance

| Milestone | Status | Remaining work |
| --- | --- | --- |
| Focus correctness and contracts | Partial | Durable device controller ownership, remote commands, and live companion status |
| Durable mutation and storage boundaries | Partial | Scoped preferences, cryptographic writers, operation journal, and domain-wide atomic mutation coverage |
| Local whole-vault handoff | Partial | Physical multi-device acceptance |
| Local replica convergence | Planned | Notes text and tree merging, portable domain adapters, two- and three-replica failure tests |
| Concurrent secure local linking | Planned | Encrypted operation enrollment, key lifecycle, revocation, typed bootstrap, and convergence |
| Relay and Android sync | Planned | Encrypted relay, native background runtime, encrypted backup, measurements, and physical acceptance |

Required tests include reordered, duplicated, delayed, and interrupted delivery; text and tree convergence; deletion, undo, and history restore; crashes at persistence and acknowledgement boundaries; full disks, corrupt staging, and missing assets; invalid identity, signatures, invitation replay, revocation, key epochs, payload bounds, and protocol versions; controller handoff failure and expired commands; duplicate jobs; and long-offline replicas, compaction, restored backups, and cloned writers.

Queues and caches stay bounded. Pairing, key lifecycle, native bridges, and remote capabilities require a separate security review, and physical Android and desktop acceptance covers sleep, force-stop, reboot, permissions, manufacturer restrictions, clock changes, and disconnected use.

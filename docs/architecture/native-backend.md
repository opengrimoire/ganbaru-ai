# Native backend architecture

Rust owns operations that require durable storage, native authority, bounded filesystem access, provider processes, media playback, or operating-system integration.

## Tauri composition

`apps/client/src-tauri/` is the Tauri package. Its desktop `main.rs` and mobile `lib.rs` delegate to the ordinary Rust library in `apps/client/src-tauri/app/`.

The application library has separate desktop and mobile composition roots. Target-scoped dependencies ensure that unsupported desktop services are not linked into mobile builds. Tauri commands are adapters: they validate transport values, resolve managed state, enforce vault or platform authority, and call focused services.

## Domain crates

The Cargo workspace extracts domains that benefit from Tauri-free contracts and tests:

- `ganbaru-db` owns pool configuration, migrations, and database test support.
- `ganbaru-focus` owns focus persistence, history, validation, recovery, and local activity admission. Live phase orchestration remains in Svelte until the Rust transition service is completed.
- `ganbaru-notes` owns the Notes graph, persistence, transfers, history, assets, and bounded file operations.
- `ganbaru-chat-contracts` defines provider-neutral identifiers, commands, events, read models, and errors.
- `ganbaru-chat-providers` owns provider processes, transports, normalization, cancellation, and registry behavior.
- `ganbaru-chat` owns Chat persistence, runtime services, Git workspaces, checkpoints, review, and source control.
- `ganbaru-working-folders` owns portable folder identities, bindings, repository kinds, and device-local state shapes.
- `ganbaru-native-messaging` is the independent Chromium native messaging host.
- `ganbaru-mobile-*` crates expose narrow Android notification, document, media, and Doomscrolling plugins.

New code should remain in the application crate when it is only composition or Tauri adaptation. Move it to a core crate when the domain boundary, portability, or independent tests justify the extraction.

Chat's organizational access command facade keeps teammate access preview and atomic replacement together. Its `coordination_commands/access/` modules separate profile lifecycle, device-local assignment targets, channel-access resolution, and retained-reference disclosure checks. Profile publication and teammate replacement retain their original transaction boundaries; extracting these implementations does not create new authorization layers or change effective authority.

Internal Chat host tools keep their catalog, dispatch, and run-local cursors in `internal_mcp_tools.rs`. Its child modules own live authorization checks, durable invocation budgets and provenance, frozen channel-history reads, and bounded workspace operations. Invocation reservation still precedes execution, and audit completion still precedes returning a successful result. Tool calls and final publication share the same live authorization checks.

The scratch command facade keeps generation identity and shared owner/inspection authority checks together. Its `scratch_commands/` modules separate inspection, artifact promotion, and cleanup. Promotion retains its request-digest identity, destination rechecks, and durable outcome record. Cleanup retains confirmation, revision checks, lifecycle transitions, filesystem removal, and failure recording in one workflow. The device-local scratch service and core bounded filesystem operations remain separate from these command adapters.

## SQLite and migrations

The active vault SQLite database is the source of truth for structured data. SQLx embeds migrations from `apps/client/src-tauri/migrations/`. Migration filenames use UTC timestamps and are applied in order.

The database layer does not expose a generic query bridge to the frontend. Domain services own statements, transactions, validation, and result shapes. Cross-table changes that represent one user action commit atomically where partial success would violate the product contract.

Exact columns and indexes belong to migrations. The [schema guide](../data/schema/README.md) documents domain ownership, evolution rules, and important relationships without mirroring every SQL declaration.

## Filesystem authority

The active vault and explicitly authorized working folders are separate roots. Every command resolves identifiers through the owning service, canonicalizes paths where needed, rejects traversal and unsafe symbolic-link escapes, and applies byte, depth, count, or time bounds appropriate to user-controlled input.

Managed assets use validated relative paths beneath the vault. External working files remain externally owned. Device-local absolute paths and provider configuration stay outside synchronized vault records.

### Vault implementation boundaries

`vault.rs` owns folder identity, selection, device bootstrap state, managed write permits, and the stable Tauri command facade. `vault/config.rs` owns bounded configuration mutations. `vault/documents.rs` owns native Calendar and theme import/export, which operates on selected external documents rather than the active vault. Configuration writes and archive creation still use the same configuration lock.

Local handoff keeps one `PairingManager`, one mutex, and one persisted pairing schema. Its `state.rs` owns identity and membership, `state/transfers.rs` owns transfer progress and staging, and `state/storage.rs` owns validation and private-file persistence. These are implementation boundaries, not independent stores. Persisted field names, recovery ordering, and membership checks must remain compatible when these modules change.

The desktop coordinator has one serialized request loop and shared transfer state. Its outgoing workflow prepares snapshots and grants ownership; its incoming workflow stages and activates snapshots returned by the current owner. The transport's desktop-only server module owns authenticated request dispatch and archive serving. Client requests and shared streaming helpers remain usable by both desktop and Android.

Two longer vault modules deliberately remain together. `ownership.rs` keeps the coupled generation, write-fence, commit, and recovery rules adjacent to their tests. `backup.rs` keeps the bounded archive-to-activation pipeline with its whole-vault preservation tests, which account for nearly half the file. Neither is split solely to satisfy a line-count threshold. The behavior and physical acceptance contract remain in [Device linking and synchronization](../data/sync.md) and [Local vault handoff testing](../testing/vault-handoff.md).

## Asynchronous and blocking work

SQLx operations stay asynchronous. Potentially blocking platform APIs, process observation, archive work, image or media probing, and bounded filesystem walks use replaceable or dedicated blocking workers. Cancellation must not publish a partial authoritative result or hold database transactions across blocking waits.

See [Native work](native-work.md) for the shared rule and current examples.

## Native services

Desktop composition can include the tray, updater, detached windows, native notifications, process control, browser native messaging, Rodio and Symphonia audio, MPRIS or Windows media controls, provider processes, terminals, Git workspaces, and browser previews.

Media controls keep the shared command and hardware-event payload in `media_controls.rs`. Target-gated adapters under `media_controls/` own Linux MPRIS and Windows system media transport integration. Platform protocol state and callbacks stay within their owning adapter.

Android composition uses plugin adapters and system-owned surfaces instead of importing desktop implementations. Notification schedules, selected document grants, Media3 playback, and Doomscrolling access projections remain subordinate to canonical vault data.

The independent browser native messaging host separates configuration parsing, device snapshot freshness, pure rule evaluation, and event persistence. Blocking reasons are typed internally: extension labels and database classifications are derived from the same decision, rather than classifying events by parsing display text. Existing wire labels, rule fingerprints, stored event values, stale-state behavior, and vault ownership checks remain unchanged. Device-local usage spooling stays separate from canonical vault event writes.

## Error and security boundary

Native commands return bounded, user-meaningful errors without embedding secrets, full remote bodies, unnecessary home paths, or unchecked provider data. Secrets are stored only through operating-system credential references where the feature requires persistence.

Provider output, external files, archives, browser messages, and mobile plugin responses are untrusted input. Validation occurs before persistence or frontend projection. See [Security](../data/security/README.md).

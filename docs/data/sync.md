# Sync

Sync turns GanbaruAI from a local app into a multi-device, optionally collaborative one. The user provisions and hosts the sync server themselves; GanbaruAI does not run shared infrastructure. CRDTs handle conflict resolution automatically. End-to-end encryption ensures the server never sees the user's data in cleartext.

This doc is a placeholder. Deeper design comes in a later pass, alongside phase 9 of the roadmap.

## Architecture

**Yjs CRDTs.** Yjs provides conflict-free replicated data types for collaborative editing. Each piece of mutable state (a calendar event, a kanban task, a note) lives in a Yjs document. Edits are encoded as operations that converge to the same final state regardless of order or connectivity.

**Hocuspocus server.** A self-hostable Yjs sync server. The user runs it themselves on a VPS, a home server, or any host they control. GanbaruAI connects to the server via WebSocket.

**End-to-end encryption.** Encryption uses libsodium. The server stores ciphertext only; only authorized clients (with the user's keys) can read. The server can route messages and persist state without ever decrypting it.

**Live presence.** Active devices show as cursors or activity indicators in collaborative views (notes, kanban). Implemented as ephemeral Yjs awareness data.

## What syncs

- **Documents** (notes, diary entries): markdown files, with edits propagated as Yjs operations on a per-file basis.
- **Structured data** (calendar events, kanban tasks, work environments, project state): SQLite tables, with row-level Yjs documents.
- **Pomodoro tracking data** (runs, segments, pauses): per-user, scoped to the device. Sync exposes these to other devices the user owns. Other users on shared workspaces never see another user's tracking data.

The two-category storage model (see `data/architecture.md`) is preserved across sync: documents stay markdown on each client; structured data stays SQLite on each client. Sync replicates the operations, not the storage format.

## Conflict resolution

CRDT semantics handle most conflicts automatically: concurrent edits to a document merge without losing data; concurrent edits to structured fields use last-writer-wins or merge by field depending on the type.

A small number of app-specific tiebreakers layer on top:

- **Active sessions.** Two devices both showing a session as active is impossible by design (one user, one session at a time). Tiebreaker uses the most recent heartbeat to determine which device's view is authoritative; the other device drops its session view.
- **Recurring event scope edits.** When the same instance is edited from two devices with different scope choices ("this" vs "all"), the most recent edit wins. The losing edit is preserved as a notification on the device that lost so the user can decide whether to re-apply.

## Self-hosting

The user is responsible for the sync server. GanbaruAI provides:

- A Hocuspocus server image (Docker, with a documented Compose file).
- A setup guide accessible to non-technical users (step-by-step for a few common providers).
- A health check the app can run to confirm the server is reachable.

GanbaruAI does **not** offer a hosted sync service. The project is donation-funded and cannot guarantee uptime or operate user data infrastructure. This is documented prominently so users understand what they are choosing when they enable sync.

## Backups

Sync is not a backup. Backups go to a user-specified path outside the vault, on a schedule the user configures. Sync ensures multiple devices have the same state; backups ensure the state can be recovered if all devices are lost.

## What this doc does not cover yet

The exact CRDT schema for each table, the encryption key management flow, the onboarding sequence for setting up sync, the conflict UI, and the multi-user permissions model are all to be designed when sync is implemented (phase 9). This placeholder establishes the architecture so other docs can reference it; the specifics will follow.

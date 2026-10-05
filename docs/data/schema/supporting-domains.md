# Supporting schema domains

This document covers persisted domains that do not need a dedicated schema page. Exact columns, constraints, and indexes remain authoritative in migrations and schema tests.

## Quick notes

Quick notes are structured SQLite data, not loose Markdown files. A note has stable identity, rich text stored as normalized text runs, color, pin, archive and trash state, an optional tag, manual order, and timestamps. Rendered HTML is never canonical.

Tags have stable identity independent of their name. Deleting a tag detaches notes through a domain command instead of deleting them. Manual order uses explicit values with a stable ID tie breaker, so window synchronization never reorders equal entries. Windows sync through canonical writes and invalidation; a window is never the only copy of a note.

## Themes

Themes and token values live in SQLite so custom themes can be validated, selected, repaired, imported, and exported as structured data. Built-in themes have stable identities, and a custom theme never mutates a built-in row. Import validates format, token keys, value types, size, and identity before writing. Token rules are owned by [Themes](../../features/themes/README.md).

The active theme ID is portable configuration. Applying it to a webview is runtime projection. A missing or invalid selected theme falls back safely without deleting the user's row, so it can still be repaired or exported.

## Music

Music separates canonical library identity from physical source location and playback state.

- Library items carry playable identity and metadata. Local roots and locations describe user-selected folders or document trees without making an absolute path canonical.
- Source collections (local collections, YouTube playlists, and other discovery sources) keep refresh generation and failure state. Refresh and relink use staged generations so a failed scan leaves the previous library usable.
- User playlists and ordered memberships are independent of source collections; removing or refreshing a source never silently destroys a playlist.
- Related families cover skip ranges, item signals, snoozes, statistics, recent selections, refresh issues, context assignments, and soundscapes.

Music bytes stay in the user's library and are never copied into the vault because an item was indexed. Relative identities and platform document handles are revalidated before playback.

Import receipts store the action identity, request hash, and result in the same transaction as the imported rows, so a lost response cannot duplicate a playlist, and a reused identity with different input is rejected. Export reads all row families from one bounded snapshot.

Native session checkpoints are keyed by device ID and hold portable item and membership IDs, playback settings, bounded navigation history, and queue state, never resolved paths, content URIs, or decoder handles. Copying a vault copies these records, not permission to resume another device's playback. Recovery rebuilds the local queue against current rows and bindings and starts paused. Listening counters, checkpoint changes, and action receipts share one transaction.

Background sound state records whether a selection was manual or automatic. An automatic selection restored after restart is displayed but never starts output by itself; a fresh native Focus phase decision is required.

## Distraction blocker

Portable rules live in the vault `config.json`, with separate browser and desktop settings because the surfaces can carry different intent. SQLite stores usage samples and block events for daily limits, reports, and recovery. Local-date grouping keeps the date basis, so a later device timezone change never reassigns historical usage. Browser rules, desktop application rules, and Android app rules have separate source identities and validation.

Device-local state supports enforcement without replacing portable policy:

- Runtime and budget snapshots are native derivatives of the persisted rules and accepted usage. Their configuration fingerprint, local day, week, and totals are admission checks, not policy.
- The desktop native owner spools captured usage batches with retry receipts before publishing totals, and sent sample IDs are immutable until acknowledged.
- Android's Guardian journal records usage, totals, and its observation checkpoint in one transaction. A full journal rejects new evidence without advancing the checkpoint, and rows from another vault stay pending until that vault is active again.

Linked-device accounting follows [Sync](../sync.md#distraction-usage-exception). Accepted totals and acknowledgement identities commit together, so a failed acknowledgement is retried before new evidence is sent and never double-counts usage. A capture with inconsistent identities, vault attribution, dates, or oversized evidence fails explicitly instead of publishing a truncated total. Vault and configuration changes revoke the old native publication before the new one becomes visible.

## Profile and managed icons

Profile metadata is portable configuration. Profile and project-icon bytes use bounded feature-owned asset paths, and rows store managed relative identity, never an absolute or hardcoded vault path. Replacing an image stages validated bytes, updates the relationship atomically, and removes the old asset only after rechecking references.

## Domain evolution

Split a domain into its own page when it gains a distinct set of identity, retention, recovery, or interoperability rules that maintainers need to understand together, not merely to list more columns.

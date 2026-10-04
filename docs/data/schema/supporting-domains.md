# Supporting schema domains

This document covers persisted domains that do not need a dedicated schema page. Exact columns, constraints, and indexes remain authoritative in migrations and schema tests.

## Quick notes

Quick notes are structured SQLite data, not loose Markdown files. A note has stable identity, rich text content, color, pin and archive state, trash state, optional tag, manual order, and timestamps. Normalized text runs preserve rich-text structure without treating rendered HTML as canonical.

Tags have stable identity independent of their display name. Deleting a tag detaches or migrates notes through a domain command rather than deleting the notes. Manual order uses explicit deterministic values and a stable ID fallback so repeated window synchronization does not reorder equal entries.

Active and tag-filtered masonry reads have protected query plans. See [Query plans](query-plans.md).

Quick-note state synchronizes between application windows through canonical writes and invalidation. A frontend window is never the only copy of a note.

## Themes

Themes and theme token values live in SQLite so custom themes can be validated, selected, repaired, imported, and exported as structured data. Built-in theme identities are stable. A custom theme has its own identity and does not mutate a built-in row.

Theme token catalogs are versioned product contracts. Import validates the format, supported token keys, value types, size, and identity before replacing or creating rows. Unknown obsolete values are handled through explicit migration or validator rules.

The active theme is portable preference state. Applying it to a specific webview is runtime projection, not schema authority. If a selected custom theme is missing or invalid, startup falls back safely without deleting the invalid user-authored row before repair or export is possible.

## Music

Music persistence separates canonical library identity from physical source location and playback projection.

Canonical library items represent playable identity and metadata. Local roots and locations describe user-selected document trees or folders without making an absolute portable path canonical. Source collections represent local collections, YouTube playlists, or other supported discovery sources and retain refresh generation and failure state.

User playlists and ordered memberships are independent of source collections. Removing or refreshing a source does not silently destroy a user playlist. Memberships retain explicit position and per-item playback overrides where supported.

The domain also records:

- device-keyed native Music session checkpoints;
- skip ranges and per-item behavior;
- item signals, snoozes, statistics, and recent selections;
- refresh issues and user-required actions;
- bounded refresh and relink jobs;
- context assignments, background-sound definitions, custom groups, and selected layers.

Background playback state distinguishes manual intent from automatically selected intent. Native soundtrack acceptance commits the selected layer and this provenance flag with the Music session transition. Restart may display an automatic selection but cannot use its saved desired-playing flag as permission to start output. A fresh native phase decision is required. Explicit manual state writes clear that flag through the existing version check.

These are related table families, not one denormalized playlist document. Refresh and relink use staged generations so a failed scan leaves the previous successful library usable. Relative local identities and platform document handles are revalidated before playback. Music bytes stay in the user's library and are never copied into the vault merely because an item was indexed.

Music import receipts persist the accepted action identity, exact request hash, compact result, and native commit time alongside the imported rows in the same transaction. They survive database reopen so a lost command response cannot duplicate a playlist. Reusing an action identity with different input is rejected. A preview revision covers incoming data and relevant canonical state, including child rows and assignment-owner revisions that are not represented by playlist versions. Export assembly reads all selected row families from one bounded snapshot and releases that transaction before document output.

Native session checkpoints contain portable item and membership IDs, playback settings, bounded navigation history, and queue-selection state, keyed by the originating device ID. Resolved paths, content URIs, browser URLs, and decoder handles are excluded. Copying the vault copies checkpoint records, not a live session or permission to resume another device's playback. Recovery reconstructs the local device's queue against canonical rows and current root bindings, and starts paused. Listening counters, checkpoint changes, and semantic action receipts share one transaction. A retained receipt suppresses a repeated action after an uncertain response without replaying a stale live projection.

Playback hosts, media sessions, ephemeral loopback URLs, decoded artwork, and active queue transitions are runtime state. Only the durable definition or resumable state belongs in SQLite.

Important music query plans are listed in [Query plans](query-plans.md).

## Doomscrolling

Portable Doomscrolling policy lives primarily in the vault config under separate browser and desktop settings. Browser and desktop pause-during-focus-pause choices remain independent because enforcement surfaces can have different user intent.

SQLite stores durable usage samples and journals needed for daily limits, reports, and recovery. Samples use the established domain time encoding, including integer epoch values where defined. Local-date grouping retains the date basis needed to avoid reassigning historical usage when the device zone changes later.

Browser rules, desktop application rules, and mobile app-rule snapshots have separate source identities and validation. Mobile foreground enforcement and launchable-app discovery are platform capabilities, not evidence that all rule surfaces share one native identifier.

Runtime snapshots in the platform app config directory help recover current enforcement. They are device-local and do not replace the canonical portable policy or durable usage journal.

Desktop budget snapshots are native derivatives of the current persisted limit branch and the active database's accepted usage window. Their configuration fingerprint, local day, Monday-based week, and internally consistent totals are admission checks, not portable policy. Older snapshots without the fingerprint expire open and are replaced by native reads. Linked accepted-cache replacement and acknowledgement of included pending samples use one device-local transaction, so failure cannot delete pending evidence without installing the corresponding accepted total. Accounting reads are separate from transport batching.

The desktop native owner records captured interval batches in the device-local spool before publishing totals. Each batch shares a transaction with its retry receipt. Sent sample identities remain immutable until acknowledged, and only unsent samples can be compacted. The writable owner drains the complete bounded local spool before reading canonical budgets. The UI receives cached totals and adapter availability rather than individual intervals or execution requests. Desktop block events and their rule snapshots also share one transaction.

Android's separate Guardian journal marks usage identities before returning them for exchange. Its schema upgrade conservatively treats old identities as sent, and compaction preserves every second by splitting aggregates into bounded samples. Usage insertion, daily totals, compaction, capacity admission, and the observation checkpoint share one transaction. A full journal rejects new evidence without advancing that checkpoint. Rows belonging to a previously active vault remain pending until that vault is active again. Read-only exchanges export usage without marking local block history as sent.

Accepted linked snapshots and retained Guardian acknowledgement identities commit together in the Rust device cache. A failed Android acknowledgement leaves those identities durable, so an offline read excludes them from pending usage and the next synchronization retries deletion before sending new evidence. Cleanup follows confirmed Guardian deletion and remains scoped to the original vault and device. The Guardian accounting bridge captures local counters and complete pending evidence under the same lock. Rust excludes already committed or accepted identities before grouping pending usage. It publishes each shared total with that captured local baseline, so observations recorded between capture and application contribute only their later local delta. Captures with inconsistent identities, vault attribution, clock/date facts, oversized evidence, or overflowing aggregates cannot publish a truncated total.

Guardian rule invalidation retains the journal's vault attribution and localized notification text, including text from an older rule snapshot. Retained peer acknowledgement identities also exclude pending evidence after that device becomes the writable owner, until Guardian confirms deletion. Configuration and vault changes revoke the old native publication before becoming visible. App exit stops the shared-total publisher while preserving the independent Guardian policy. Native transport reads return a complete accepted snapshot within the protocol limit, separately from the smaller pending exchange batch; an oversized accepted cache fails explicitly instead of silently truncating it.

## Profile and managed icons

Local profile metadata is portable configuration or structured identity according to the owning feature. Managed profile and project-icon bytes use bounded feature-owned asset paths. Database or config rows store managed relative identity, never a hardcoded Ganbaru AI folder path.

Replacing an image stages validated bytes and atomically updates the relationship. Cleanup rechecks whether the older managed asset is still referenced. Arbitrary external paths are not retained as portable avatar or icon values.

## Domain evolution

When one of these domains grows enough to require extensive migration rationale, split it into a dedicated page. Do not split merely to list more columns. The threshold is a distinct set of identity, retention, recovery, or interoperability rules that maintainers need to understand together.

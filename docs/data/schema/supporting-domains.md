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

- stable playback resume state by source identity;
- skip ranges and per-item behavior;
- item signals, snoozes, statistics, and recent selections;
- refresh issues and user-required actions;
- bounded refresh and relink jobs;
- context assignments, background-sound definitions, custom groups, and selected layers.

These are related table families, not one denormalized playlist document. Refresh and relink use staged generations so a failed scan leaves the previous successful library usable. Relative local identities and platform document handles are revalidated before playback. Music bytes stay in the user's library and are never copied into the vault merely because an item was indexed.

Playback hosts, media sessions, ephemeral loopback URLs, decoded artwork, and active queue transitions are runtime state. Only the durable definition or resumable state belongs in SQLite.

Important music query plans are listed in [Query plans](query-plans.md).

## Doomscrolling

Portable Doomscrolling policy lives primarily in the vault config under separate browser and desktop settings. Browser and desktop pause-during-focus-pause choices remain independent because enforcement surfaces can have different user intent.

SQLite stores durable usage samples and journals needed for daily limits, reports, and recovery. Samples use the established domain time encoding, including integer epoch values where defined. Local-date grouping retains the date basis needed to avoid reassigning historical usage when the device zone changes later.

Browser rules, desktop application rules, and mobile app-rule snapshots have separate source identities and validation. Mobile foreground enforcement and launchable-app discovery are platform capabilities, not evidence that all rule surfaces share one native identifier.

Runtime snapshots in the platform app config directory help recover current enforcement. They are device-local and do not replace the canonical portable policy or durable usage journal.

## Profile and managed icons

Local profile metadata is portable configuration or structured identity according to the owning feature. Managed profile and project-icon bytes use bounded feature-owned asset paths. Database or config rows store managed relative identity, never a hardcoded Ganbaru AI folder path.

Replacing an image stages validated bytes and atomically updates the relationship. Cleanup rechecks whether the older managed asset is still referenced. Arbitrary external paths are not retained as portable avatar or icon values.

## Domain evolution

When one of these domains grows enough to require extensive migration rationale, split it into a dedicated page. Do not split merely to list more columns. The threshold is a distinct set of identity, retention, recovery, or interoperability rules that maintainers need to understand together.

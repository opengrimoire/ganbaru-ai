# Progress

## Current phase

Phase 1: core loop (wrapping up)

## Active work

- Documentation reorganization: split the legacy `PROGRESS_TRACKING.md` into granular per-concept files under `docs/features/`, `docs/data/`, and `docs/algorithms/`. Top-level markdowns moved into `docs/`. `PROGRESS_TRACKING.md` deleted. `PRODUCT_SPEC.md` retained pending full migration of unbuilt-feature detail.

## Blocked / needs decision

(none)

## Next up



## What exists (phase 1)

- Monorepo scaffold (Turborepo + pnpm workspaces + Cargo workspace)
- Tauri v2 + Svelte 5 + Vite app shell with tab navigation
- shadcn-svelte + Tailwind CSS v4, custom neutral gray theme (dark + light), custom title bar
- shared-types package
- SQLite schema with migrations (calendar_events, pomodoro_sessions, pomodoro_configs, pomodoro_segments, tasks, calendars, attendees, alarms, overrides)
- Calendar: custom Google Calendar-style component (week/day/month views, drag-and-drop create/move/resize, recurring events with full RFC 5545 RRULE support, all-day events, iCalendar field parity, edit session overlay model, EventPanel with 8 extracted sub-components including unified Meeting section that bundles attendees, URL, and location under one collapsible, 275 unit tests)
- Kanban board (backlog/todo/in_progress/done columns, CRUD, move between columns, priority badges)
- Pomodoro timer (focus/break phases, cycle tracking, segment lifecycle, timeline rail visualization, idle detection, suspend/wake handling)
- Theming: registry-based theme store with two built-in themes plus full user-theme CRUD (create, duplicate, edit, rename, delete) through the Themes settings section. In-house HSL color picker (no external library) edits any of the 24 event-palette slots and any app or calendar shell token. JSON import/export through both clipboard and native file dialog (tauri-plugin-dialog). Built-in themes are frozen; editing one duplicates it first.
- Vault foundation: `vault/config.json` on disk with atomic write (tmp + fsync + rename) via Rust commands `vault_read_config` / `vault_write_config`. Frontend bridge (`lib/vault/config.ts`) caches the config, exposes synchronous reads, and debounces writes. One-time migration moves the legacy localStorage keys (`ganbaruai-theme`, `ganbaruai-font-family`, `ganbaruai-font-scale`) into the vault. Active theme, user themes, font family, and font scale all persist through the vault now. Two extra commands `vault_read_text` / `vault_write_text` back the dialog-driven import/export of theme files.
- Settings modal (`SettingsModal.svelte`) opens from the title-bar gear icon and hosts an Appearance section (compact theme selector, font family, three steppers for text size, app zoom, calendar zoom) and a Themes section (list + editor). Webview zoom lives in a single `zoom.svelte.ts` store; the calendar header zoom controls and the title-bar reset-zoom button moved into the modal (keyboard shortcuts preserved).

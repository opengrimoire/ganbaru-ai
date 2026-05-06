# Progress

## Current phase

Phase 1: core loop (wrapping up)

## Active work

(none)

## Blocked / needs decision

(none)

## Next up

- Compare future performance changes against canonical baseline `2026-05-05-01`.

## What exists (phase 1)

- Monorepo scaffold with Turborepo, pnpm workspaces, Cargo workspace, Tauri v2, Svelte 5, Vite, shadcn-svelte, Tailwind CSS v4, and shared TypeScript types.
- Production build hygiene: stable Rollup manual chunks for Svelte, Tauri, Temporal, ical.js, lucide, and vendor code; `pnpm tauri build` avoids the earlier Svelte circular chunk warnings and oversized chunk warning.
- Development runtime policy: Node 24 LTS is recommended through `.nvmrc` and `.node-version`; `package.json` accepts Node 22.12.0 or newer. Node is a build-time tool only and is not bundled into Tauri installers.
- SQLite schema and migrations for calendar events, recurrence overrides, attendees, alarms, pomodoro sessions/configs/segments, tasks, calendars, preferences, and themes.
- Vault foundation: `vault/config.json` with Rust-backed atomic text reads/writes, frontend config cache, legacy localStorage migration, and theme import/export file helpers.
- Calendar core: week, day, and month views; drag create, move, and resize; all-day events; recurring events with RFC 5545 RRULE support; timezone-aware persistence and rendering; edit sessions; undo/redo; pomodoro integration; and iCalendar import/export including `.ics.zip` imports.
- Calendar performance: slim in-memory event rows, heavy fields loaded on demand, window-bounded event expansion through `calendar-index.ts`, per-day buckets, CSS gridlines, lighter panel detail queries, hover/pointer prefetch, and parked/lazy EventPanel.
- Event panel stability: full detail preload before paint, no meeting-field pop-in, no control color animation on open, stable selected contours, safe create-panel outside-click handling, and reusable parked panel state without save/title regressions.
- App shell layout: compact, even edge spacing around the tabs and primary workspace, persisted right-click visibility controls for hideable title bar sections and compact tab labels, a `Ctrl + ,` settings shortcut, and a help modal listing available keyboard shortcuts.
- Pomodoro timer: focus/break phases, cycle tracking, segment lifecycle, timeline rail visualization, idle detection, suspend/wake handling, and active-block calendar integration.
- Kanban board: backlog, todo, in-progress, and done columns with CRUD, task movement, and priority badges.
- Theme system: built-in light/dark themes, user theme CRUD, SQLite-backed token snapshots, derivation engine, contrast checks, preset picker, JSON import/export, and floating theme editor.
- Settings surface: Appearance and Data sections, font and zoom controls, calendar import/export controls, and a floating theme editor that can operate while the app remains clickable.
- Diagnostics: lazy performance popover with live RAM, startup RAM snapshot, chart copy, speed log, launch-time breakdown, and benchmark controls.
- Benchmark harness v6: isolated benchmark DB passes, startup-boot, idle-memory, calendar-nav, event-panel-open, and calendar-create-cancel scenarios; one Run all button; suite state persisted across restarts; interrupted-pass cleanup; repeated startup launch medians to usable calendar paint after closed-process cooldowns; clearer running labels for memory windows; rendered summary tables; canonical markdown with compact dataset ids, one run metadata notes column, and separate latency/scalar metric tables; build refs and detailed platform labels; canonical baseline `2026-05-05-01`; and docs at `docs/features/performance-benchmark.md` plus indexed canonical tracking rules in `docs/PERFORMANCE.md`.

## Validation baseline

- Standard gate before reporting completion: `pnpm -w run validate`.
- Focused benchmark formatter test: `pnpm -C apps/client exec vitest run src/lib/benchmark/output.test.ts`.

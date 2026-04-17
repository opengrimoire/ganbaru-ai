# Progress

## Current phase

Phase 1: core loop (wrapping up)

## Active work

- Documentation reorganization: split the legacy `PROGRESS_TRACKING.md` into granular per-concept files under `docs/features/`, `docs/data/`, and `docs/algorithms/`. Top-level markdowns moved into `docs/`. `PROGRESS_TRACKING.md` deleted. `PRODUCT_SPEC.md` retained pending full migration of unbuilt-feature detail.

## Blocked / needs decision

(none)

## Next up

Phase 2: notes and diary

- Tiptap rich text editor integration (markdown storage)
- Morning and evening diary entry forms
- Note creation, editing, and linking
- Bidirectional backlink index in SQLite

## What exists (phase 1)

- Monorepo scaffold (Turborepo + pnpm workspaces + Cargo workspace)
- Tauri v2 + Svelte 5 + Vite app shell with tab navigation
- shadcn-svelte + Tailwind CSS v4, custom neutral gray theme (dark + light), custom title bar
- shared-types package
- SQLite schema with migrations (calendar_events, pomodoro_sessions, pomodoro_configs, pomodoro_segments, tasks, calendars, attendees, alarms, overrides)
- Calendar: custom Google Calendar-style component (week/day/month views, drag-and-drop create/move/resize, recurring events with full RFC 5545 RRULE support, all-day events, iCalendar field parity, edit session overlay model, EventPanel with 8 extracted sub-components, 275 unit tests)
- Kanban board (backlog/todo/in_progress/done columns, CRUD, move between columns, priority badges)
- Pomodoro timer (focus/break phases, cycle tracking, segment lifecycle, timeline rail visualization, idle detection, suspend/wake handling)

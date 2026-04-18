# Progress

## Current phase

Phase 1: core loop (wrapping up)

## Active work

- Documentation reorganization: split the legacy `PROGRESS_TRACKING.md` into granular per-concept files under `docs/features/`, `docs/data/`, and `docs/algorithms/`. Top-level markdowns moved into `docs/`. `PROGRESS_TRACKING.md` deleted. `PRODUCT_SPEC.md` retained pending full migration of unbuilt-feature detail.
- Theme foundation (dev branch): registry-based theme store (`stores/themes.ts` + `theme.svelte.ts`) replaces the binary light/dark toggle. Each theme owns its full event palette plus optional app/calendar token overrides, so adding a custom theme is a single object addition. Calendar palette functions (`getEventColor`, past/cancelled/free/outside-month variants) now accept a `Theme` instead of `isDark`. Next pass: port the remaining hardcoded color sites (pomodoro idle overlay, kanban badges, confirm dialog, event panel placeholders, etc.) to CSS tokens and wire `appTokenOverrides` through CSS variable injection.

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

# Progress

## Current phase

Phase 1 — Core loop

## Status

Building the core plan-focus-earn-see cycle. Monorepo scaffold, app shell, Pomodoro timer, Kanban board, and SQLite schema are done. Calendar (Schedule-X) and skill tree (D3.js) views are placeholder stubs. XP pipeline not yet wired.

## Completed

- Phase 0: created CLAUDE.md, ROADMAP.md, PROGRESS.md, DECISIONS.md
- Phase 0: designed 12-phase roadmap covering all product spec systems, verified coverage
- Phase 1: monorepo scaffold (Turborepo + pnpm workspaces + Cargo workspace)
- Phase 1: Tauri v2 + Svelte 5 + Vite app (plain Svelte, not SvelteKit)
- Phase 1: shadcn-svelte + Tailwind CSS v4 with notion-like neutral gray theme (dark + light)
- Phase 1: custom in-app title bar (decorations: false, drag region, window controls)
- Phase 1: shared-types package (Task, SessionBlock, SkillNode, XpEntry types)
- Phase 1: SQLite schema (tasks, session_blocks, skill_nodes, skill_branches, pomodoro_sessions, xp_entries, streaks, daily_xp_caps)
- Phase 1: app shell with sidebar navigation (calendar, kanban, pomodoro, skill-tree views)
- Phase 1: Pomodoro timer (focus/short_break/long_break phases, cycle tracking, start/pause/reset/skip)
- Phase 1: Kanban board with CRUD (backlog/todo/in_progress/done columns, task creation, move between columns, delete, priority badges)

## In progress

- Phase 1: calendar view (Schedule-X integration)
- Phase 1: skill tree view (D3.js SVG rendering)
- Phase 1: XP pipeline (Pomodoro completion → Activity XP + Will Focus → skill tree)

## Blocked / needs decision

(none)

## Next up

- Integrate Schedule-X calendar with session block creation/editing
- Implement D3.js skill tree with sample data
- Wire XP pipeline: Pomodoro completion → XP calculation → SQLite → skill tree update
- Add basic Will Focus tracking (timer adherence, break extensions)

## Session log

| Date | Summary |
|---|---|
| 2026-03-09 | Created tracking documents and 12-phase roadmap. Started Phase 1: monorepo scaffold, Tauri+Svelte app, shadcn-svelte, SQLite schema, app shell, Pomodoro timer, Kanban board. Custom title bar with window controls. Notion-like neutral gray theme. |

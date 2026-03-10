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
- Phase 1: calendar view (Schedule-X week/day/month, session block create/move/delete, SQLite-backed)
- Phase 1: skill tree view (D3.js force-directed graph, sample data, zoom/pan, node details, XP progress arcs)
- Phase 1: XP pipeline (Pomodoro → pomodoro_sessions + xp_entries in SQLite, +XP toast on completion)

## In progress

(none — Phase 1 core loop complete)

## Blocked / needs decision

(none)

## Next up

Phase 2 — Notes and Diary:
- Tiptap rich text editor integration (markdown storage)
- Morning and evening diary entry forms
- Note creation, editing, and linking
- Bidirectional backlink index in SQLite

## Session log

| Date | Summary |
|---|---|
| 2026-03-09 | Created tracking documents and 12-phase roadmap. Phase 1 complete: monorepo scaffold, Tauri+Svelte, SQLite, app shell, Pomodoro timer, Kanban board, Schedule-X calendar with session blocks, D3.js skill tree, XP pipeline. Custom title bar + Notion-like theme. |

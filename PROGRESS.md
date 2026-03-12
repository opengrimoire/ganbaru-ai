# Progress

## Current phase

Phase 1 — Core loop

## Status

Building the core plan-focus-earn-see cycle. Monorepo scaffold, app shell, Pomodoro timer, Kanban board, SQLite schema, calendar, and XP pipeline are done. Skill tree rebuilt with Shield Hero-style center-snap navigation replacing D3.js force graph.

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
- Phase 1: calendar view (custom Google Calendar-style component, week/day/month views, session block CRUD, drag-and-drop move/resize, current-time indicator, SQLite-backed — replaced schedule-x library)
- Phase 1: skill tree view (SVG + Svelte center-snap navigation, neighborhood culling, sub-layer navigation, keyboard nav, locked/available/unlocked visual states, node detail panel, removed D3.js dependency)
- Phase 1: skill tree data (153-node temporal tree from JSON, 7 branches with radial tree layout adapter, cluster sub-graphs, auto-focus, always-visible detail panel)
- Phase 1: XP pipeline (Pomodoro → pomodoro_sessions + xp_entries in SQLite, +XP toast on completion)

## In progress

- UI overhaul: sidebar replaced with tab navigation, contour layout, dual theme (light/dark), custom calendar

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
| 2026-03-09 | Created tracking documents and 12-phase roadmap. Phase 1 complete: monorepo scaffold, Tauri+Svelte, SQLite, app shell, Pomodoro timer, Kanban board, calendar with session blocks, XP pipeline. Custom title bar + Notion-like theme. Skill tree rewritten: replaced D3.js force graph with SVG + Svelte center-snap navigation (Shield Hero style), neighborhood culling, sub-layer navigation, authored graph data, keyboard controls, visual states. Updated PRODUCT_SPEC, TECH_STACK, ROADMAP, DECISIONS, CLAUDE.md. Integrated 153-node temporal skill tree JSON (7 branches, radial layout adapter, cluster sub-graphs). Fixed: center-snap positioning, kanban/calendar scroll, auto-focus, always-visible detail panel, simplified keyboard nav. |
| 2026-03-11 | UI overhaul: replaced sidebar with tab navigation, contour layout, dual light/dark theme with custom colors. Fixed Ctrl+Shift+Tab (WebKitGTK e.code workaround). Replaced schedule-x calendar library with custom Google Calendar-style component: week/day/month views, event overlap layout, pointer-based drag-and-drop, current-time indicator, half-hour dashed gridlines, 8-color event palette. |

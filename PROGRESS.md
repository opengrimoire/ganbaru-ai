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
- Pomodoro: native pre-break notification and fullscreen break overlay (Linux implemented, Windows/macOS pending)

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
| 2026-03-11 | UI overhaul: replaced sidebar with tab navigation, contour layout, dual light/dark theme with custom colors. Fixed Ctrl+Shift+Tab (WebKitGTK e.code workaround). |
| 2026-03-12 | Replaced schedule-x calendar library with custom Google Calendar-style component: week/day/month views, event overlap layout, pointer-based drag-and-drop, current-time indicator, half-hour dashed gridlines, 8-color event palette. Undo/redo (Ctrl+Z/Y) with confirmation dialogs. Clickable day headers, Alt+arrow view history, arrow key navigation. Header drill-down picker, help/settings buttons, calendar account selector. Mini calendar scroll navigation, month view past-day styling. Scrollable top bar for tab switching. |
| 2026-03-13 | Pomodoro: added native pre-break notification (notify-rust, action buttons, transient, sound), fullscreen break overlay (GTK, countdown timer, space x3 dismiss, Esc x3 skip, 30s inactivity re-show via GNOME IdleMonitor). Keyboard shortcut blocking during overlay via gsettings (Super, Alt, dash-to-dock hotkeys). System tray progress ring with pause/skip controls. Close confirmation dialog. Theme persistence. Pomodoro tab removed — timer now auto-starts from active calendar session blocks. |
| 2026-03-14 | Calendar: drag-to-create blocks (click+drag with 10-min grid snap), snap indicator line with time label, resize flip (drag past opposite edge), block hover highlight. Extracted shared drag controller (useDragController.svelte.ts) for WeekView/DayView. Fixed calendar time storage (local time, no UTC conversion). Scroll position preserved across view switches. Break overlay focus handling. Added vitest with 38 unit tests. Provisional DB reset button. Close shortcut Ctrl+Shift+W. Hour height 1.4x. RAM usage in title bar (dev monitoring). Resolved all Svelte a11y warnings. Fixed sub-pixel gridline/text rendering, gridline color artifact during drag, global cursor lock during drag. |
| 2026-03-15 | Pomodoro: removed "work 3 more minutes" from break screen, notification changed to "Focus session ending in 1 minute" with one-time +3min extension (removed skip-break option). Break overlay changed to black background with white text. RAM usage now includes WebKitGTK child processes. Reset button now deletes database file and restarts app. Fixed DB connection race condition and silent load failures. Focus duration default set to 40 minutes. |
| 2026-03-16 | Calendar: replaced CreateDialog/EventDetail with floating EventPanel (inline edit with color picker, description, pomodoro settings). Added repeat rule (daily/weekdays/weekly/monthly/yearly) and notification scheduling (native OS notifications via notify-rust, 30s polling). DB migration v2 (color, description columns), v3 (exceptions, repeat_until). Recurring events: virtual instance expansion, Google Calendar-style scope dialog (this/following/all) for save/delete/drag. Detach instance, split series, add exception store methods. Live preview for non-recurring edits only. Neutral create preview (no default blue). Fixed Svelte 5 reactivity issue with plain let vs $state for onChange tracking. |

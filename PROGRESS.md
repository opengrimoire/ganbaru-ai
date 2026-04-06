# Progress

## Current phase

Phase 1: core loop (wrapping up)

## Active work

- UI overhaul: tab navigation, contour layout, dual theme (light/dark)
- Pomodoro: native pre-break notification and fullscreen break overlay (Linux done, Windows/macOS pending)
- Pomodoro: centralized timeline rail with focus fills and break bands
- Pomodoro: suspend/wake detection, pause gap visualization, orphan cleanup, idle detection with forced-interaction overlay
- Calendar: Ctrl+scroll zoom (discrete levels 30-200px, animated transitions, adaptive snap grid)
- Calendar: drag/create interactions (layout-aware previews, scroll-aware dragging, auto-scroll at edges)
- Calendar: event panel polish (drag handle, icon sizing/alignment, rounded corners)
- Calendar: past event immutability (past events fully read-only, "All events" edit splits series freezing past, active blocks: hybrid if new time covers now, stop + new block if not, pre-save confirmation when session would stop, batch mode prevents UI flicker, preview matches save behavior, transferBlockId for seamless session handoff after detach)
- Calendar: crossover resize (drag handle past opposite edge flips the resize direction)
- Calendar: segment migration on detachInstance (re-parents pomodoro_segments when recurring instance becomes standalone)
- Calendar: cross-midnight support for "All" scope recurring edits (end date derived from changes day span)
- Calendar: event panel always shows both start and end dates with date pickers
- Calendar: create preview break marks start from current time, not event start (applies to expanded recurring instances too, updates live)

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

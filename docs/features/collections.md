# Shared collection views

Status: Implemented for the shared surfaces below.

Notes databases and Projects use one collection component family (`apps/client/src/lib/components/collections/`). Changes to shared rows, cells, resize handles, view buttons, floating panels, cards, inline creation, or Kanban interaction apply to both features. Shared components accept snippets and typed callbacks so each feature exposes its own properties and actions.

Rationale: the two features present the same kinds of collections, and one implementation keeps their interaction and visual rules from drifting apart.

## Domain boundaries

The shared UI does not import either feature's stores, invoke native commands, or own persisted data. Notes pages and properties remain Notes data; Projects tasks, statuses, priorities, scheduling, selection, and bulk actions remain Projects data. Each feature supplies only the operations it supports, and shared components never infer unsupported property operations or expose controls that cannot be saved safely.

Each feature owns its complete-result calculations and conditional rules; neither derives totals from a partially loaded row window.

Projects Calendar renders canonical Calendar events and task scheduling, while Notes Calendar renders date properties; their scheduling semantics remain distinct. Timeline and Gantt keep their own domain renderers.

## Tables

Rows share spacing, cell frames, focus treatment, and resize handles. Resizing works with pointer and keyboard; a failed width save restores the canonical width and shows the error. Notes persists widths in its saved database view; Projects keeps its own column sizing, automatic fit, task selection, subtasks, and grouped ordering.

Inline creation differs by domain. Projects requires a task name before creating a task, and a failed write keeps the draft. Notes creates a real blank page immediately, since empty Notes titles are valid. Pending writes prevent duplicate submissions.

## Cards and Kanban

Boards share column widths, cards, inline creation per column, and secondary actions in a menu. Each feature provides menu actions for moving between groups so touch and keyboard users never need to drag.

The shared board owns drag state, drop feedback, pending state, and error feedback, and ignores unrelated external drags. Projects supplies status writes and manual ordering; sorted views permit group changes but not reordering within a column. Notes supplies its validated grouping-property writes and does not invent manual order. A failed write leaves the card in its canonical position. Gallery and Notes Calendar reuse the same card and action components.

## View controls and panels

Both features share view buttons and compact floating settings panels anchored to the invoking toolbar control. Opening settings leaves the collection visible and interactive. Panels fit the viewport, scroll only when content exceeds the available height, and stay inside an owning page preview when applicable.

Settings panels are navigable pages: rows show an icon, label, and current value, and selecting a row opens its detail page in the same popover. Back keeps drafts. Escape closes the innermost layer first, and explicit dismissal returns focus to the invoking control. Pointer menus stay compact while touch layouts use larger targets.

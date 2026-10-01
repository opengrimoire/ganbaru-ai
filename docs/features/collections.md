# Shared collection views

Status: implemented for the shared surfaces below, with real desktop and Android visual acceptance pending.

Notes databases and Projects use one collection component family. Changes to shared row spacing, cell focus, resize handles, view buttons, panels, cards, inline creation, or Kanban interaction apply to both features. The shared components accept content snippets and typed callbacks so each feature can expose its own properties and actions.

## Table and list

Rows use the same spacing, typography, hover treatment, cell frames, and resize handles. Text editing uses a background focus cue without an extra input outline. Resize handles support pointer dragging and keyboard resizing. The preview remains in place until the saved width is reflected in the view; a failed save restores the canonical width and exposes the error. Scrollbars update when columns or groups change size, without requiring an initial scroll gesture. Notes tables scroll horizontally without creating a nested vertical scrollbar. Notes persists widths in its saved database view; Projects retains its project column sizing, automatic fit, horizontal scrolling, task selection, subtasks, and grouped ordering.

Projects inline creation reveals a field on demand and requires a task name. Enter submits, Escape cancels, and failed writes retain the draft. Notes tables create an actual blank page on click and immediately show its editable title, with another New page control below. Empty Notes titles are valid, so consecutive clicks can create multiple blank pages. Pending writes prevent duplicate submissions of the same draft while controls retain their normal appearance. Fast saves do not add a message or fade the collection. In Notes, saves lasting at least 600 ms show the standard loading spinner beside the database title; the indicator uses reserved space and disappears when saving finishes. Title changes, view operations, property changes, and row mutations share that indicator. Notes row actions and Projects task selection occupy their own leading controls; clicking an editor or property does not select a document block.

## Cards and Kanban

Boards have consistent column widths, stable scrollbar space, shared cards, readable titles, metadata, and inline creation within each column. Secondary actions live in a menu. Each feature provides menu actions for moving between groups so touch and keyboard users do not need to drag.

The shared board owns local drag state, drop feedback, pending state, and error feedback. It ignores unrelated external drags. Projects supplies status writes and manual ordering; sorted Projects views permit status changes but do not enable reordering within a column. Notes supplies its validated grouping-property writes and does not invent manual order within sorted groups. A failed write leaves the card in its canonical position.

Projects card windows use measured card heights so wrapped titles and extra metadata do not leave gaps or skip cards while scrolling. Notes retains bounded backend reads and its continuation control. Gallery uses the same card and action components, with optional cover content and a responsive grid. Notes Calendar uses compact versions of those cards and opens creation from a day's add control.

## View controls and settings

Both features share active view buttons and panel styling. Projects uses text-only view labels at its compact toolbar text size, with horizontal scrolling when the labels do not fit, and retains its project filters. Notes keeps its database view-label size, saved-view creation, renaming, duplication, templates, and property editing. All six Notes layouts and Projects view controls use compact floating panels anchored to the invoking toolbar control. Opening settings leaves the collection visible and interactive. Panels fit the viewport and remain inside an owning page preview when applicable.

Panels use a light shadow, inset row highlights, compact action text and icons, and no gaps between adjacent action rows. Plain actions, checkbox rows, and submenu triggers share one row height. Action and property menus omit a repeated heading unless their caller requests one. Nested menu rows show their current setting and a disclosure chevron; table column headers retain their property identity without another disclosure icon. Desktop menus remain compact when a mouse is available; mobile and touch-only menus use consistently larger targets. Hover changes the highlight without changing row height. Panels measure intrinsic content at their final width, including fractional borders and any fixed header, independently of their scroll viewport. Reopening and switching to a shorter settings page preserve uniform row heights without introducing a scrollbar. Long content scrolls only when it exceeds the panel's available height; property-type pickers use that single panel scroll area.

Settings rows use an icon, a label, the current value or count, and a disclosure chevron. Selecting a row opens its detail page in the same popover. Back returns to the row while retaining drafts; Escape first closes a nested dropdown, then returns through settings pages, then closes the panel. Explicit dismissal restores the invoking control's focus. Clicking or focusing outside dismisses without taking focus away from the destination. Arrow keys navigate settings rows. Mouse controls stay compact, while mobile and touch-only menus retain larger targets.

The shared column header accepts a domain-owned action snippet beside its resize handle, plus presentation attributes for saved frozen columns. Notes supplies property editing, filtering, sorting, visibility, visible column order, wrapping, freezing, formatting, and calculations. Projects retains its own task-column contracts. Shared components never infer unsupported property operations. Each domain owns complete-result summaries and conditional rules; neither derives totals from a hydrated row window.

## Domain boundaries

The shared UI does not import either feature's stores, invoke native commands, or own persisted data. Notes pages and properties remain Notes data. Projects tasks, statuses, priorities, scheduling, selection, and bulk actions remain Projects data. Each adapter supplies its own supported operations rather than exposing controls that cannot be saved safely.

Projects Calendar continues to render canonical Calendar events and task scheduling. Notes Calendar continues to render date properties. Their scheduling semantics and full calendar engines are distinct. Timeline and Gantt retain their current domain renderers; deeper timeline interaction work remains outside this consolidation.

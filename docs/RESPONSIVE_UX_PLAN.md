# Responsive UX plan

This document is the implementation plan for making GanbaruAI feel good at very large, normal, compact, narrow, and extremely small window sizes. The goal is not to squeeze the same desktop layout into every frame. The goal is that every size has a deliberate, useful, non-overlapping interface with clear controls, stable state, and predictable scrolling.

## Goal

Users should be able to resize the app freely and still get a polished experience:

- Large windows show dense planning surfaces.
- Normal laptop windows show the current desktop UI without clipping.
- Compact windows preserve primary workflows by collapsing secondary controls.
- Narrow windows switch from multi-column planning to focused single-day, single-column, or sheet-based workflows.
- Extremely small windows become a useful focus capsule: current task, timer, quick navigation, and access to full surfaces through menus or sheets.

The app may not expose every command at every size, but hidden commands must stay reachable through an overflow menu, sheet, or keyboard shortcut. No surface should rely on overlapping text, clipped controls, or unreachable buttons as its fallback.

## Current state audit

### Strong foundations

- The app already uses a single Svelte shell in `apps/client/src/App.svelte`, so responsive decisions can be centralized instead of duplicated across routes.
- Many components already use `min-w-0`, `overflow-hidden`, and truncation to avoid text pushing layouts apart.
- Calendar day labels already adapt through `ResizeObserver` in `WeekView.svelte`, `DayView.svelte`, and `MonthView.svelte`.
- `calendarZoom.svelte.ts` preserves visible time while zooming the calendar timeline.
- Title-bar visibility preferences already exist in `preferences.ts`, so there is a natural model for moving controls into an overflow menu.
- The custom resize handles are now present, so the user can discover window resizing before clicking.

### Primary blockers

| Area | Current behavior | UX risk |
|---|---|---|
| Tauri window | `tauri.conf.json` sets `minWidth: 800` and `minHeight: 600`. | The OS prevents truly compact or tiny window testing. |
| App shell | `App.svelte` uses a fixed full-screen frame with fixed content margin and rounded content panel. | The frame chrome consumes too much space at tiny sizes. |
| Title bar | `TitleBar.svelte` keeps tabs, utility buttons, and window controls in one row. Compact tabs are manual, not automatic. | Controls can run out of room before the app reaches a useful tiny mode. |
| Calendar header | `CalendarHeader.svelte` keeps navigation, date picker, zoom, view switches, today, and calendar picker in one row. | The toolbar has no priority collapse model. |
| Week view | `WeekView.svelte` renders fixed timezone gutter columns plus seven `1fr` day columns and hides horizontal overflow. | Small widths compress day columns until labels and events lose meaning. |
| Day view | `DayView.svelte` still reserves timezone gutter columns and the all-day band. | Multiple timezones make narrow day view too crowded. |
| Month view | `MonthView.svelte` always renders a seven-column grid with up to three event rows per cell. | Tiny cells become unreadable and hide too much context. |
| Event panel | `EventPanel.svelte` uses a fixed `PANEL_WIDTH = 320` and `window.innerWidth` placement math. | It cannot fit under roughly 340px and can become awkward during live window resize. |
| Settings modal | `SettingsModal.svelte` uses `w-[min(900px,90vw)]` plus a fixed `w-60` sidebar. | It has too little content width at compact sizes and no mobile-style nav mode. |
| Floating theme editor | `FloatingThemeEditor.svelte` uses a fixed 700px width. | It cannot fit in compact windows without off-screen clamping. |
| Kanban | `KanbanColumn.svelte` uses fixed `w-72` columns inside horizontal scroll. | This works as a fallback, but a narrow user needs a focused task flow, not only a wide board scroller. |
| Help and performance overlays | Some overlays use fixed grid columns or fixed popover widths. | Secondary tools can overflow before primary app surfaces do. |

## Responsive contract

Every major surface should declare four things:

1. **Primary job:** what the user is trying to do in this surface.
2. **Minimum useful information:** what must remain visible at tiny sizes.
3. **Collapse order:** which controls move to overflow first.
4. **Fallback layout:** reflow, sheet, focused mode, scroll region, or unavailable-with-reason.

Avoid global page-level horizontal scrolling. Horizontal scrolling is allowed only inside deliberate content regions such as a kanban board or a week planner, and those regions need visible affordances or a focused alternative.

## Size classes

Use semantic classes rather than scattering raw pixel checks through components.

| Class | Width | Height | Intended experience |
|---|---:|---:|---|
| `wide` | 1100px and up | 700px and up | Dense desktop planning, full week and board views. |
| `regular` | 800px to 1099px | 600px and up | Current desktop baseline. |
| `compact` | 560px to 799px | 480px and up | Desktop shell with collapsed toolbars and focused content. |
| `narrow` | 390px to 559px | 360px and up | Single-column workflows, sheets, compact title bar. |
| `micro` | Below 390px or below 360px height | Any | Focus capsule with current context, quick actions, and menus. |

The exact thresholds can move after implementation testing, but the class names should stay stable.

## Architecture plan

### Shared viewport store

Add `apps/client/src/lib/stores/viewport.svelte.ts`:

- Track `width`, `height`, `sizeClass`, `isShort`, and `canShowDenseChrome`.
- Use one window `resize` listener or root `ResizeObserver`, not component-local listeners everywhere.
- Expose typed helpers such as `atLeast("regular")` and `below("compact")`.
- Persist nothing. Window size is runtime context, not user preference.

Add pure helpers in `apps/client/src/lib/utils/responsive.ts` with tests:

- `classifyViewport(width, height)`.
- `pickToolbarItems(items, availableWidth)`.
- `clampPanelRect(rect, viewport, margins)`.

### CSS tokens

Define shell tokens in `app.css`:

- shell gap
- content radius
- title-bar height
- toolbar height
- panel margin

Map them by size class on the root element. At `micro`, remove decorative gaps and reduce radii so the app uses almost every pixel. Do not scale font size with viewport width.

### Component strategy

Prefer container queries for local components and the shared viewport store for route-level decisions. Use JS layout only when the decision depends on measured available controls, pointer anchors, or viewport clamping.

Keep state outside render variants. If week view falls back to a focused day renderer, the user's selected view should still be `week`; the renderer is the only thing that changes.

## Shell and title bar plan

### Tauri window

Do not remove the current 800 by 600 minimum until the shell and primary surfaces have compact modes. Lower it in stages:

1. After shell and title bar work: 560 by 420.
2. After calendar panel work: 390 by 360.
3. After micro capsule work: 280 by 180, if the OS and Tauri behavior remain stable.

This prevents the app from entering sizes that are technically possible but not yet usable.

### App shell

In `App.svelte`:

- Add the viewport store and write `data-size-class` to the root frame.
- Collapse `mx-1.5 mb-1.5` to smaller values in `compact` and to zero in `micro`.
- Keep the resize handles above app chrome but below blocking modals.
- Ensure the root never clips the only available close, restore, or overflow command.

### Title bar

In `TitleBar.svelte`:

- Give each title-bar item a priority: window controls, active pomodoro, navigation tabs, settings, performance, theme, help, reset.
- Keep close, restore, and minimize visible as long as possible. At `micro`, close and restore can move into a system menu only if there is a visible menu button.
- Turn tabs into icon-only automatically before hiding utility controls.
- Move lower-priority utility controls into the existing title-bar context menu when width is tight.
- Use a single visible overflow button instead of relying on right-click as the only discovery path.
- Keep a draggable region in unused title-bar space at every size.

## Calendar plan

Calendar is the hardest surface because it is both a planning grid and a direct manipulation editor. It needs multiple render variants.

### Calendar header

In `CalendarHeader.svelte`:

- Split controls into primary, secondary, and overflow groups.
- Primary: previous, date label, next, current view or view menu.
- Secondary: zoom, today, calendars.
- Overflow: anything that does not fit.
- Replace fixed view buttons with a segmented control at `regular` and a menu button at `compact` and below.
- Keep mini calendar and account picker viewport-aware. At `narrow`, open them as sheets instead of absolute popovers.

### Week view

In `WeekView.svelte`:

- Keep the full seven-column week only when day columns can retain a useful minimum width.
- Define `MIN_WEEK_DAY_COLUMN = 88` to 104px after testing.
- If width is below `timezoneGutters + 7 * MIN_WEEK_DAY_COLUMN`, switch to one of two compact variants:
  - `compact week`: horizontally scrollable day columns with sticky day headers and visible scroll affordance.
  - `focused week`: one day column plus a seven-day strip for switching days.
- At `narrow`, prefer `focused week`. Planning still stays in week context, but the user edits one day at a time.
- Collapse extra timezone gutters into a popover or stacked labels when they would consume more than 25 percent of the content width.
- Keep all-day events visible, but cap rows aggressively and open the full all-day list in a sheet.

### Day view

In `DayView.svelte`:

- Keep the day column as the primary narrow calendar surface.
- At `narrow`, collapse timezone columns into a small timezone selector chip in the header.
- At `micro`, show an agenda/timeline hybrid: now, next event, current pomodoro state, and a scrollable list of upcoming blocks.
- Preserve direct manipulation only when the hit area is large enough. Below that threshold, use tap or click to open a create sheet with start and end fields.

### Month view

In `MonthView.svelte`:

- Keep the seven-column month grid at `regular` and above.
- At `compact`, reduce event rows to one or two and make `+N more` open a day sheet.
- At `narrow`, use a month calendar for date selection plus a selected-day agenda below it.
- At `micro`, show a compact date strip and agenda list.

### Event panel

In `EventPanel.svelte`:

- Replace fixed `PANEL_WIDTH = 320` with a responsive width: `min(320px, calc(100vw - 2 * margin))`.
- Use anchored side panel at `regular` and above.
- Use side sheet or centered sheet at `compact`.
- Use bottom sheet at `narrow`.
- Use full-height editor sheet at `micro` or short-height windows.
- Rework the date and time row so it can stack. The current absolutely centered time group is fragile on narrow widths.
- Keep section expansion pinned to viewport bounds in every mode.
- Add resize handling while the panel is open. A live window resize should recompute panel mode and clamp position without waiting for unrelated state changes.

### Popovers inside calendar

For `TimezoneSelector`, `MiniDatePicker`, `TimePicker`, `ColorPicker`, `RecurrenceSection`, `NotificationsSection`, and `DescriptionEditor`:

- Use shared viewport-aware placement helpers.
- At `narrow`, prefer modal sheets for large pickers.
- Cap height with `max-height: calc(100dvh - margin * 2)`.
- Keep the trigger visible after opening a picker when possible.

## Kanban plan

Kanban should not rely only on a horizontal four-column board.

In `KanbanView.svelte` and `KanbanColumn.svelte`:

- `wide` and `regular`: current board layout, with better column width using `clamp(240px, 24vw, 288px)`.
- `compact`: two-column board or horizontally scrollable board with snap points.
- `narrow`: one status column at a time with a segmented status switcher.
- `micro`: task inbox mode with filters for status and priority.

Task cards should expose key actions without hover-only controls at touch-like or narrow sizes. Hover-only buttons are not discoverable in compact contexts.

## Settings and secondary surfaces

### Settings

In `SettingsModal.svelte`:

- `regular` and above: current sidebar modal.
- `compact`: narrower sidebar or icon-only rail.
- `narrow`: full-screen settings sheet with section tabs or a section picker at top.
- `micro`: one setting group per screen, with back navigation.

Reduce content padding from `px-8 py-6` at compact sizes. Preserve scroll position per section.

### Floating theme editor

In `FloatingThemeEditor.svelte`:

- Replace the fixed 700px width with `min(700px, calc(100vw - 2 * margin))`.
- At `narrow`, make it a full-width bottom sheet.
- At `micro`, make it a full-screen editor with sticky save and cancel actions.
- Keep drag only in modes where there is meaningful free space around the panel.

### Help, performance, and benchmark overlays

- Help shortcuts should change from fixed two-column rows to single-column rows below `compact`.
- Performance popover should become a sheet when 288px would not fit.
- Benchmark overlay can remain large, but its summary tables need horizontal scroll inside the overlay, not page-level overflow.

## Interaction rules

- A resized window must never trap the user without a visible close or overflow action.
- Keyboard shortcuts must continue to work when controls move into overflow.
- Hover-only actions need a visible alternative in `narrow` and `micro`.
- Pointer hit targets should stay at least 28px for dense desktop controls and 36px for compact touch-like controls.
- Direct manipulation should be disabled or changed when the visual target is too small to manipulate accurately.
- Scroll ownership must be explicit. Nested scroll regions should avoid competing wheel behavior.

## Performance rules

Responsiveness should not add a heavy resize listener to every component.

- One viewport store publishes size class changes.
- Components use CSS and container queries where possible.
- Resize handlers should coalesce through `requestAnimationFrame` if they do real layout work.
- Do not measure every event block on every resize. Calendar layout should continue to derive from container width, existing event layout data, and CSS grid.
- Keep all compact render variants lazy only when they are expensive. Small markup branches can stay in the same component if it avoids module churn.

## Verification plan

Add a responsive QA matrix to future implementation PRs:

| Size | Required checks |
|---|---|
| 280 by 180 | Micro shell shows focus capsule or safe fallback. Close and overflow reachable. |
| 320 by 360 | Title bar usable. Event panel uses sheet mode. Settings opens without clipped controls. |
| 390 by 360 | Day calendar usable. Week falls back to focused week. |
| 480 by 640 | Narrow month and kanban modes usable. |
| 560 by 420 | Compact toolbar collapse works. |
| 800 by 600 | Current desktop baseline still works. |
| 1200 by 800 | Current default view unchanged except planned polish. |
| 1920 by 1080 | Dense desktop remains stable and does not over-expand text. |

Run the matrix at font scale 1.0 and 1.3. Also test with one, three, and five timezones because timezone gutters are a major calendar width pressure.

## Automated checks to add

- Unit tests for `classifyViewport`.
- Unit tests for toolbar priority packing.
- Unit tests for panel clamping and mode selection.
- A benchmark scenario for resize stress, focused on calendar week view with synthetic data.
- A benchmark scenario for opening responsive sheets: event panel, settings, and theme editor.
- Existing `pnpm -w run validate` remains the completion gate for implementation work.

## Implementation sequence

1. Add viewport classification and shell tokens.
2. Add automatic title-bar and calendar-header overflow.
3. Lower Tauri minimum size to 560 by 420.
4. Make event panel responsive with anchored, sheet, and full-screen modes.
5. Add compact and focused calendar render variants.
6. Lower Tauri minimum size to 390 by 360.
7. Make settings, theme editor, help, performance, and kanban responsive.
8. Add micro focus capsule.
9. Lower Tauri minimum size as far as verified.
10. Add responsive benchmark scenarios and record any meaningful performance changes in `docs/PERFORMANCE.md`.

## Definition of done

The responsiveness work is done when:

- The app can be resized below the current 800 by 600 floor without broken or unreachable UI.
- Each major surface has an explicit `wide`, `regular`, `compact`, `narrow`, and `micro` behavior.
- Calendar planning, event editing, kanban task work, settings, and title-bar controls remain usable at compact and narrow sizes.
- Micro windows provide a useful focus capsule instead of a broken desktop layout.
- Validation passes.
- Responsive behavior has unit coverage for shared layout decisions and benchmark coverage for resize-sensitive performance.

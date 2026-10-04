# Project tasks and views

## Task model

A task has stable identity, project, optional section and parent task, title, description, status, priority, type, estimate, dates, milestone state, blocker reason, dependencies, tags, custom values, assignment and review metadata, archive state, and timestamps.

Subtasks are normal tasks with a parent. Checklist items are lighter completion records owned by one task. A parent and its descendants retain explicit states; completion does not silently erase open child work.

## Sections and ordering

Sections provide project-local organization. They can be created, renamed, reordered, collapsed, hidden, archived, and restored. Section archive never deletes its tasks.

Manual task order is meaningful only in views and groups that use it. Sorting or computed grouping does not rewrite canonical manual order.

Adjacent moves use the complete current sibling order in native storage, including siblings outside the loaded view. Top-level tasks move within their selected section or status lane; subtasks move among all active children of their parent. Custom fields and their options follow the same atomic adjacent-move contract. The selected item's placement must still match the user's request. Unrelated changes, such as a newer title or completion state, are preserved. Tied ranks are normalized as part of the same transaction, and retrying an uncertain response cannot perform the move twice.

## Archive and restore

Archive is preferred to deletion when a task has useful history, scheduled blocks, dependencies, subtasks, Notes, comments, or review context. Archiving a parent also archives descendants so active children do not become hidden under an inactive parent. Restore follows the same closure.

Archived tasks remain queryable through explicit filters and history surfaces.

## Selection and bulk actions

List and Kanban support multi-select with bulk completion, reopening, priority, archive, and restore where valid. Bulk operations preview mixed or invalid states and apply one coherent command rather than silently skipping ambiguous items.

Status, priority, archive, and restore changes commit the complete accepted selection and its history atomically. Missing tasks, mixed projects, or changed selected field values reject the operation with no partial writes. Archive and restore include descendants outside the loaded view. A failed or uncertain response keeps the visible state and can be retried with the same operation identity.

## List

List is the default view. It presents section or computed groups, configurable columns, inline editing, selection, task creation, and horizontal access to wider schemas.

Its rows, cells, resize handles, and inline task creation use the [shared collection components](../collections.md) also used by Notes. Task property editors, automatic width fitting, section controls, subtasks, selection, and manual ordering remain project-specific.

Columns can include status, dates, priority, assignee, reviewer, estimate, schedule, dependencies, tags, and compatible custom fields. Users can show, hide, reorder, and resize columns per project. Column headers expose contextual sorting, compatible filters, visibility, wrapping, and freezing through a selected column. Frozen offsets use the rendered column widths, including resized tracks and preceding selection controls. Narrow tables limit the effective frozen prefix to leave room for a scrollable data column, while preserving the configured frozen-through property for a wider viewport. Wrapping and freezing persist by stable property identity in the project's List preferences.

Date columns offer local, ISO, and relative display. Start and due times offer local, 12-hour, 24-hour, or hidden time. Numeric custom properties offer plain, grouped, or percent display; editing always uses the canonical numeric value. These display choices persist per column without changing task values, query predicates, or sorting.

Headers can insert a custom property next to the current column and edit its name and options. Duplicate property with empty values creates a new schema and fresh option identities in one native transaction. It copies the property's type and option configuration, leaves source values intact, and creates no task values for the duplicate. A failed visibility write leaves a successfully created property available in Columns, with a visible retryable error.

Property creation reserves column visibility and ordering until its schema and visibility writes finish. Header name drafts refresh after canonical renames when pristine, preserve active or rejected edits, and reset for a different property. Numeric cell edits keep failed or invalid drafts when refocused for correction, and prevent a second edit while their value write is pending.

Each column can show a calculation over all tasks matched by the native query, including rows beyond the loaded page and excluding unmatched parent context. All properties support count, filled, and empty counts. Estimate and numeric custom properties also support sum, average, minimum, and maximum. Custom property counts include zero and explicitly unchecked values as filled. Missing numeric values do not contribute to reductions; an empty sum displays zero, while an empty average, minimum, or maximum displays Empty. Calculations wait for the current query and do not display totals from an older filter. Failed reads show a retryable error and hide calculations until the query succeeds.

Conditional row colors use ordered project-local status or priority rules. The first matching rule sets the row tint; selection remains visible. Rule identities, conditions, palette colors, and order persist in List preferences. Failed presentation writes restore the saved state and report the failure while retaining schema drafts.

Grouping, filters, sorting, columns, and saved views use the shared compact floating settings shell. Its root summarizes the current configuration, and detail pages retain the same owning popover and keyboard navigation. Column changes disable competing writes while saving; a failed preference write restores the previous columns and displays a retryable error beside their controls.

Rows can group by section, status, priority, due-date bucket, or scheduled state. Computed groups are projections over the same tasks. Quick creation pre-fills a group value only when it maps safely to canonical fields.

## Kanban

Kanban groups cards by status and supports creation, movement, selection, and compact task metadata. Moving a card changes its status through the same validation as the task detail surface.

Each Kanban column keeps its card area at the same width as cards begin or stop overflowing, so adding a card does not shift existing cards horizontally.

Cards and columns share the Notes board presentation. Card menus contain movement and detail actions, and each column offers inline task creation with that status. Manual sorting supports card reordering; other sorts permit status changes without rewriting manual order. Measured card heights keep virtual scrolling aligned with wrapped titles and metadata. Rejected drag writes display an error and keep the previous canonical position.

Hidden or archived statuses do not make tasks disappear without an explicit filter or recovery path.

## Calendar project view

The project Calendar view shows events linked to the project and task scheduling context. It reuses canonical Calendar events and links rather than creating a separate scheduling source of truth.

Scheduling a task creates or links a Calendar block through the rules in [Settings and scheduling](settings-and-scheduling.md).

## Gantt

Gantt renders dated tasks and milestones on a proportional timeline with sections, today, overdue, blocked, done, dependencies, and finish-to-start conflict signals.

Dragging and resizing proposes valid date changes. Dependency repair reads the complete canonical project graph, including tasks outside the current filter or loaded window, and applies its dated shifts only after explicit review. Completed and archived tasks and scheduled Calendar commitments remain protected; unresolved constraints prevent applying the proposal. Explicit date locks and protection overrides remain planned. See [Dependency date proposals](settings-and-scheduling.md#dependency-date-proposals).

## Dashboard

Dashboard summarizes task counts, completion, open estimates, scheduled hours, blockers, deadlines, overdue work, unscheduled due tasks, missing estimates, recent changes, and recent completions.

These are planning signals. They do not become productivity scores, employee rankings, or automatic judgments.

## Saved views

A saved view captures the selected project tab and relevant search, filters, sorting, visible columns, grouping, collapsed state, and archived visibility. It never snapshots task data.

Applying a saved view changes presentation and query state. Deleting a saved view does not change tasks.

## Task detail

Task detail is a focused editing surface available from every view. It keeps a local draft, groups fields into understandable sections, and adapts between modal, sheet, and full-screen presentation.

The implemented editor uses one open workspace with a content column for description, checklists, subtasks, dependencies, scheduled blocks, and activity, alongside an always-visible property column. Narrow panels stack the columns. Sections never collapse, and opening a control does not insert content into the scroll layout. Selected tags and relationships remain visible; candidate searches use floating menus.

Task properties and single-choice custom fields reuse the settings dropdown. Date fields open the shared calendar in an anchored floating surface that fits above or below the field. Menus stay within the task dialog's focus boundary and dismiss with Escape or an outside click. Keyboard dismissal and selection return focus without scrolling. Focus uses a background change rather than an outline around inputs. Save stays in the footer, with errors immediately above it and archive presented as a secondary action.

Unsaved closure uses the shared discard flow. Date fields use the shared date picker. Links to Calendar, Notes, Chat, files, and dependencies remain explicit and navigable.

## Accessibility and touch

All views provide keyboard routes for navigation, creation, editing, selection, bulk action, movement, and opening task detail. Pointer drag behavior starts only from valid non-interactive areas and has keyboard alternatives.

Touch layouts use native two-axis panning for wide List and Gantt surfaces and do not hide critical actions behind hover.

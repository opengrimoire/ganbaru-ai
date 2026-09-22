# Project tasks and views

## Task model

A task has stable identity, project, optional section and parent task, title, description, status, priority, type, estimate, dates, milestone state, blocker reason, dependencies, tags, custom values, assignment and review metadata, archive state, and timestamps.

Subtasks are normal tasks with a parent. Checklist items are lighter completion records owned by one task. A parent and its descendants retain explicit states; completion does not silently erase open child work.

## Sections and ordering

Sections provide project-local organization. They can be created, renamed, reordered, collapsed, hidden, archived, and restored. Section archive never deletes its tasks.

Manual task order is meaningful only in views and groups that use it. Sorting or computed grouping does not rewrite canonical manual order.

## Archive and restore

Archive is preferred to deletion when a task has useful history, scheduled blocks, dependencies, subtasks, Notes, comments, or review context. Archiving a parent also archives descendants so active children do not become hidden under an inactive parent. Restore follows the same closure.

Archived tasks remain queryable through explicit filters and history surfaces.

## Selection and bulk actions

List and Kanban support multi-select with bulk completion, reopening, priority, archive, and restore where valid. Bulk operations preview mixed or invalid states and apply one coherent command rather than silently skipping ambiguous items.

## List

List is the default view. It presents section or computed groups, configurable columns, inline editing, selection, task creation, and horizontal access to wider schemas.

Columns can include status, dates, priority, assignee, reviewer, estimate, schedule, dependencies, tags, and compatible custom fields. Users can show, hide, reorder, and resize columns per project. Long values truncate with accessible full text.

Rows can group by section, status, priority, due-date bucket, or scheduled state. Computed groups are projections over the same tasks. Quick creation pre-fills a group value only when it maps safely to canonical fields.

## Kanban

Kanban groups cards by status and supports creation, movement, selection, and compact task metadata. Moving a card changes its status through the same validation as the task detail surface.

Hidden or archived statuses do not make tasks disappear without an explicit filter or recovery path.

## Calendar project view

The project Calendar view shows events linked to the project and task scheduling context. It reuses canonical Calendar events and links rather than creating a separate scheduling source of truth.

Scheduling a task creates or links a Calendar block through the rules in [Settings and scheduling](settings-and-scheduling.md).

## Gantt

Gantt renders dated tasks and milestones on a proportional timeline with sections, today, overdue, blocked, done, dependencies, and finish-to-start conflict signals.

Dragging and resizing proposes valid date changes. Dependency repair can calculate affected tasks and reasons, but it applies changes only after explicit review. Locked, completed, archived, or otherwise protected dates remain unchanged unless the user deliberately includes them.

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

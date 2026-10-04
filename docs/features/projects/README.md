# Projects

Projects turns intentions into durable tasks, schedules, decisions, and reviewable work. It provides a calm local planning surface without requiring AI and supplies the organizational context used by Calendar, Notes, Chat, and Music.

## Hierarchy

The durable hierarchy is:

```text
Group
  Project
    Section
      Task
        Subtask
        Checklist item
```

Groups organize projects. Projects own settings, task schemas, views, statuses, priorities, tags, custom fields, templates, history, and an optional authorized working-folder binding. Sections organize tasks without becoming task parents. Tasks can nest and can link to scheduled Calendar events.

## Current scope

| Capability | Status |
| --- | --- |
| Groups, projects, sections, tasks, subtasks, checklists, archive, and restore | Implemented |
| Dashboard, List, Kanban, Calendar, and Gantt views | Implemented |
| Filters, sorting, grouping, saved views, selection, bulk actions, and custom columns | Implemented |
| Native atomic bulk mutations and complete sibling/schema reorder | Implemented; real interaction acceptance pending |
| Project defaults, statuses, priorities, tags, custom fields, icons, and templates | Implemented |
| Task scheduling and task-event links | Implemented |
| Real focus and break playlist assignment selectors | Implemented |
| Task dependencies, milestones, date proposals, and history | Implemented |
| Complete-graph dependency review and atomic date cascades | Implemented; physical interaction acceptance pending |
| Explicit task date locks and cascade protection overrides | Planned |
| Organizational assignments, reviews, and Chat linkage | Partial |
| Guided AI planning and automatic reports | Planned or partial by workflow |
| Work-environment and blocker defaults | Planned |

## Routine project

Every group owns exactly one protected Routine project for recurring life-maintenance work. It cannot be archived or deleted, and its group cannot be removed while doing so would violate that invariant.

Routine is an ordinary project for tasks, views, scheduling, Notes, and Music defaults. Its protected identity does not grant broader access or special task semantics.

## Source of truth

Projects, tasks, schemas, views, links, templates, and history are SQLite-canonical. Working-folder files and Git repositories remain file-authoritative and can be linked to a project without becoming project rows.

Project Notes are canonical Notes pages with project membership. Working-folder Markdown can appear beside them in Notes but remains a separate file-authoritative model.

## Principles

- Planning can remain exploratory until an explicit commitment creates or updates canonical work.
- Archiving preserves useful history and links.
- Automatic scheduling and dependency repair present proposals before mutation.
- Project defaults initialize new work but do not silently rewrite active or authored records.
- AI assignments use the same project, access, budget, and review boundaries as human-created work.
- Capacity and progress are planning signals, not measures of personal worth.

## Documentation map

- [Shared collection views](../collections.md)
- [Tasks and views](tasks-and-views.md)
- [Settings and scheduling](settings-and-scheduling.md)
- [Guided planning](guided-planning.md)
- [Chat teammates and coordination](../chat/teammates-and-coordination.md)
- [Calendar](../calendar/README.md)
- [Notes](../notes/README.md)

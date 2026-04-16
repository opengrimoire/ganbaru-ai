# Kanban

The kanban board is GanbaruAI's task layer. It surfaces what the user is working on, in what state each task sits, and how tasks tie back to calendar blocks. The full design will be developed in a later pass; this doc captures what is settled so far.

## Two scopes

Kanban operates at two levels:

**Personal kanban.** The user's own tasks, organized by status (backlog, to do, in progress, done, or custom columns the user defines). Tasks carry priority levels, an estimated pomodoro count, an actual pomodoro count, due dates, tags, and links to notes and calendar session blocks.

**Project kanban.** Inside a project (see `features/project-management.md`), each project has its own board. Tasks at this level also carry requirement version history: every change to a task's description, acceptance criteria, or scope creates a timestamped diff recording what changed, when, and why. This becomes the version-controlled requirement system that distinguishes the project layer from the personal layer.

## Task properties

A kanban task has at minimum:

- **Title and description.**
- **Status:** which column it lives in.
- **Priority tier:** easy, medium, hard, or epic. The four tiers are coarse on purpose; finer gradations create false precision in subjective estimates.
- **Estimated pomodoro count:** how many focus periods the user expects this to take.
- **Actual pomodoro count:** computed from runs against this task's linked calendar events.
- **Due date** (optional).
- **Tags** (free-form).
- **Links** to notes and to calendar session blocks.

When a calendar event is linked to a task and the task's estimate changes, the calendar can suggest rescheduling downstream blocks (see `features/calendar.md` and the date cascade discussion in `features/project-management.md`).

## Task-to-session linking

A task linked to a session block creates a two-way relationship:

- The session block knows which task is being worked on; this drives the work environment activation, the AI panel context, and the edge panel display.
- The task accumulates pomodoro counts from runs that happened on the linked session block.

The linkage is many-to-many in the data model: a task can span multiple session blocks (a long task chunked across the week), and a session block can cover multiple tasks (a "miscellaneous admin" block).

## Current status

The kanban tab currently exists as a placeholder in the multi-tab navigation. The data model, drag-and-drop interactions, requirement version control, and integration points (calendar, AI panel, edge panel) are still to be designed. Deeper design comes in a later conversation.

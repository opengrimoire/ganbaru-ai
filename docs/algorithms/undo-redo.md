# Delete undo

GanbaruAI does not provide a general calendar undo or redo stack. Calendar
creates, edits, moves, resizes, and recurrence edits are committed directly.

Delete is the only reversible calendar action in the UI. After an event delete,
the calendar shows a bottom toast for 5 seconds:

- Message: `Event deleted`
- Action: `Undo`
- Dismiss: close button

If the user clicks `Undo` before the toast expires, the app restores the event
from the in-memory snapshot captured before deletion. If the toast expires, is
dismissed, or the app closes, the delete remains permanent.

## Scope

The delete toast covers the calendar delete flows that are available from the
event panel:

- A normal event delete restores the deleted event row.
- A recurring `this` delete restores the previous exception list.
- A recurring `following` delete restores the previous recurrence rule.
- A recurring `all` delete restores the previous series state when the series is
  capped to protect past instances, or recreates the deleted template when the
  whole series is deleted.

Only the latest delete has an undo toast. Starting a new delete while a previous
toast is visible makes the previous delete permanent.

## Pomodoro interaction

When deleting an event stops an active pomodoro session, undoing the delete only
restores the calendar event. It does not restart the pomodoro session or remove
historical pomodoro data.

This preserves the append-only invariant for completed or interrupted work.

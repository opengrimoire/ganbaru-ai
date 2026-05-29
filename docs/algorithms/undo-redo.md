# Delete undo

Ganbaru AI does not provide a general calendar undo or redo stack. Calendar creates, edits, moves, resizes, and recurrence edits are committed directly.

Delete and archive are the only reversible calendar actions in the UI. When an event delete or archive starts, the panel closes and the calendar shows a bottom toast with `Deleting...` or `Archiving...`. After persistence succeeds, the same toast becomes the undo toast for 5 seconds:

- Message: `Event deleted`, `Event archived`, or `Events deleted and archived`
- Action: `Undo`
- Dismiss: close button

If the user clicks `Undo` before the toast expires, the app restores the event from the in-memory snapshot captured before deletion or archive. If the toast expires, is dismissed, or the app closes, the delete or archive remains permanent.

## Scope

The undo toast covers the calendar delete and archive flows that are available from the event panel:

- A normal event delete restores the deleted event row.
- A recurring `this` delete restores the previous exception list.
- A recurring `following` delete restores the previous recurrence rule.
- A recurring `all` delete restores the previous series state when the series is capped to protect past instances, or recreates the deleted template when the whole series is deleted.

Only the latest delete has an undo toast. Starting a new delete while a previous toast is visible makes the previous delete permanent.

## Pomodoro interaction

When deleting an event stops an active pomodoro session, undoing the delete only restores the calendar event. It does not restart the pomodoro session or remove historical pomodoro data.

This preserves the append-only invariant for completed or interrupted work.

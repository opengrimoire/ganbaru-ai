# Undo and redo

Undo and redo operate on calendar event properties (time, title, color, recurrence). They do not operate on pomodoro session state, which is append-only historical data.

This doc is a placeholder. Deeper design comes in a later pass.

## Scope

Undoable operations include:

- Creating, moving, resizing, recoloring, retitling a calendar event.
- Changing an event's recurrence rule (with the same scope picker as a normal save: this, following, all).
- Adding, editing, removing notification offsets.
- Toggling all-day.
- Linking and unlinking notes, tasks, environments.

Operations that are explicitly **not** undoable:

- Stopping a pomodoro session.
- Reconfiguring a pomodoro mid-session.
- Any change that wrote to `pomodoro_runs`, `pomodoro_segments`, or `pomodoro_pauses`. These are append-only by invariant 6 (see `data/invariants.md`).
- Archiving an event with past tracking data: the archive is reversible (a separate "restore from archive" action), but it does not enter the undo stack alongside other edits.

## Pomodoro interaction

When an undoable calendar edit triggers a pomodoro side effect (e.g., resizing an event past its end stops the active session), the side effect is **not** undone by undo.

**Example.** The user resizes an active event from 16:00 to 15:00 (shortening it). The system stops the session because the event's end is now in the past. The user hits Ctrl+Z. The event reverts to 16:00. The session does not restart. The user sees the event back at its original time with the recorded progress, and can manually start a new session if they want to continue.

This is intentional. Session state changes (segments written, runs closed, pauses recorded) are append-only historical data. Reverting them would violate invariant 6 (past progress never erased). Undo is a calendar operation, not a time machine for tracking data.

## Undo after delete with tracking data

Deleting an event with past tracking data is not allowed (invariant 7); the operation becomes an archive. Undo on an archive should restore the event from `calendar_events_archive` back to `calendar_events`, including restoring the runs' `event_id` from null to the event's ID via the `original_event_id` snapshot.

## Stack semantics

A bounded undo stack (depth to be decided based on memory tradeoffs and user expectations). Each entry captures the operation type, the affected event ID, and enough state to reverse the change. Redo replays an undone operation.

The stack is per-app-session: closing and reopening the app starts with an empty stack. This avoids the complexity of persisting the undo history across restarts and matches user expectations from most editors.

## What the design needs to settle later

- Exact scope of "an operation" for grouping (is dragging an event one undo step or one per pixel?).
- Stack depth limit.
- Whether redo survives a new operation (most editors discard the redo stack on a new edit; that is the likely choice here too).
- UI affordances (button, keyboard shortcut, toast on undo with "redo" link).

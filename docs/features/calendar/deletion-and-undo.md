# Calendar deletion and undo

Ganbaru AI does not provide a general Calendar undo and redo stack. Creates, edits, moves, resizes, and recurrence changes commit directly. Delete and archive are the reversible Calendar actions exposed through a short-lived undo opportunity.

**Implemented native deletion and Undo boundary:** native deletion review, visible projection, receipt-backed mutation, explicit Focus stopping and complete process-local Undo are implemented in the shared Calendar and Focus owner. Review captures bounded complete metadata and exact execution references. Timed protection uses canonical instants; floating protection requires the native device date. The UI submits typed deletion and Undo intent, with immutable requests retained across lost replies and view remounts. Focus stopping remains in the accepted native transaction. The earlier frontend planner, restoration flow and raw native mutation commands are removed. Labels use the current native review: Delete, Archive, or Remove for mixed or still-unreviewed selections. Focused boundary tests and client diagnostics passed; final broader gates and physical platform acceptance remain required.

## Delete versus archive

Future untracked events may be hard deleted. Events that started, have timer history, are active, or own another durable reference are archived instead. A scoped recurrence operation can combine archive of protected occurrences with removal of mutable future expansion.

Scope uses original recurrence identities even when an override moves the displayed occurrence. A started selection makes a wider scope history-only: scoped started occurrences archive while later mutable occurrences remain live. A future `All` selection retains already-started occurrences, removes mutable future members and archives protected future members. A future `Following` selection keeps the original prefix and archives protected members on the removed side. Selecting the active occurrence forces `Only this`; a wider operation affecting another active occurrence identifies the exact run that must stop.

The confirmation explains the effective result. Active events require the run to end before delete or archive becomes available.

The native semantic command accepts the original selection, requested scope and an explicit stop intent. It recaptures the reviewed source before writing. When stopping is required, the exact reviewed run stops in the same transaction as archival, recurrence changes, nullable history references and the accepted receipt. A rejected review does not stop another run or reinterpret a changed selection.

Project task links and imported preservation state are durable references. Archives preserve complete normalized metadata, task-link kinds and creation timestamps, Focus configuration, both Music assignment owners and their versions, and an independent imported component graph. Opaque archive keys retain a separate original occurrence identity and scoped recurrence date, including a qualified selection of the bare source anchor. A duplicate archive key fails instead of replacing an earlier snapshot. Original execution identities and timestamps remain unchanged.

Removing the original calendar retains imported graphs referenced by archives under the built-in local calendar's storage custody. The archive keeps its original calendar identity. Ordinary archive restoration requires a valid source calendar or recurring identity and fails transactionally if a referenced task is missing, belongs to another project, or a capped recurrence can no longer admit the archived identity.

## Pending and completed state

When deletion or archive begins, the event panel closes and a status toast reports the pending operation. The calendar applies the semantic plan's final visible projection so one scoped operation does not disappear occurrence by occurrence.

After persistence succeeds, the toast reports whether events were deleted, archived, or both and offers `Undo` for five seconds. It also has a dismiss control.

Only the latest completed delete or archive operation has an undo opportunity. Starting another operation finalizes the previous one.

## Undo scope

Undo restores the snapshot and recurrence structure captured by the successful operation:

- A standalone delete restores the event.
- `Only this` restores the prior exception and occurrence state.
- `Following` restores the prior recurrence boundary and any detached survivor.
- `All` restores the prior historical and mutable series state.
- Archive undo restores archived records to their valid active representation.

If Undo expires, is dismissed, or the app closes, the operation remains committed. Durable recovery of archived history remains available through archive surfaces where supported; a hard-deleted future event does not gain indefinite recovery from the toast.

The native owner retains one bounded preimage, fences it to the vault and process generation, and expires it with monotonic time after five seconds. Native wall time can shorten that lease, preventing system sleep or clock rollback from extending it on platforms where monotonic time excludes suspend. An unavailable clock also revokes availability. Beginning another deletion finalizes the previous opportunity. The preimage is not written to SQLite or accepted from the frontend. Undo checks the exact post-deletion source, original imported graph and affected live references before restoring the captured rows. It rejects later source recreation or edits rather than overwriting them. Removing an archive releases only independent imported objects that have no remaining live or archived projection.

Undo has its own immutable command receipt. Accepted retries resolve before expiry and live-source checks; they do not execute restoration again. An uncertain deletion commit retains its prospective preimage only within the native expiry window and requires a readable, matching accepted deletion receipt before Undo can execute. Replies report the remaining native Undo opportunity separately from the stored receipt, so retry and restart cannot renew it. The toast subtracts subsequent projection-refresh time from that availability. Dismissal identifies the deletion and vault generation, so a delayed older toast cannot discard a newer preimage.

## Pomodoro interaction

If an operation stops an active Pomodoro run, undoing the Calendar mutation restores calendar data only. It does not restart the run, delete interruption history, or rewrite completed segments. This preserves append-only focus history.

## Failure behavior

The backend applies a scoped plan atomically. A failed operation restores the canonical visible window and reports an error rather than leaving a partial split, archive, exception, or run-reference transfer.

See [Recurrence editing](recurrence-editing.md) and [data invariants](../../data/invariants.md).

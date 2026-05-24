# Calendar recurrence editing

This document defines how editing recurring calendar events must behave. It is the contract for the event panel preview, the save path, and the calendar render state after save.

The core rule is simple: preview is a non-mutating projection of the current save result. It must show what the visible calendar would contain if the user pressed Save with the current draft and scope, but it must not detach, split, collapse, delete, transfer sessions, or write any data until the user actually saves.

## Ownership boundary

The long-run architecture is intentionally split:

- The frontend owns recurrence edit planning, preview projection, affected-set contours, display freeze, active-event edit restrictions, and occurrence materialization payloads for Save. These are UI semantics and must stay pure, local, and synchronous enough to update while the user drags, resizes, switches scope, or edits fields. They must not depend on async backend expansion before the user can see the preview.
- The backend owns durable persistence, invariant enforcement, and atomic mutation. Once the frontend has a semantic commit plan, the store translates it to a backend batch and Rust commits or rolls back the calendar writes and active Pomodoro reference transfers together.
- Rust may own canonical render expansion for persisted window loads. That does not make Rust the owner of edit preview semantics. Preview and canonical render expansion must stay equivalent for supported recurrence rules, and tests should cover that equivalence when recurrence support grows.

Do not move live recurrence edit preview behind Tauri IPC just to make Rust the only recurrence engine. That would make stale async responses, visual flashes, and drag-time lag more likely. A full Rust-only recurrence engine would only be justified if the whole app moved recurrence planning, expansion, wall-clock occurrence materialization, and preview invalidation to a shared non-IPC library. That is not the preferred direction for this app.

## Related docs

- `features/calendar-recurrence.md`: the stored template and instance model.
- `algorithms/recurrence-expansion.md`: how a recurrence rule expands into visible instances.
- `data/invariants.md`: invariant 7, protected events are never deleted.
- `features/pomodoro.md`: timer behavior tied to calendar events.
- `features/pomodoro-progress-displays.md`: rail rendering for event blocks.

## Product goal

Recurring edits must be predictable. A user should be able to change repeat state, switch between `Only this`, `Following`, and `All`, look at the preview, save, and see the same result that a restart would show.

These outcomes are required:

- Preview and save use one semantic model.
- Scope switching reprojects the same draft immediately.
- Missing draft fields and explicitly cleared fields are never confused.
- The occurrence the user is editing remains visible unless the selected save semantics truly remove it.
- After save, the visible window uses canonical persisted expansion, not a stale optimistic copy.
- Preview contours only apply to currently rendered events and always disappear after save or close.
- There are no event hit areas for blocks that are visually missing.

## Domain model

**Template.** A persisted calendar event with a recurrence rule. It owns the recurrence pattern and expands into occurrences.

**First occurrence.** The template row is also the first visible occurrence. Its ID is the template UUID.

**Synthetic occurrence.** Any later generated occurrence uses `templateId::YYYY-MM-DD` as its ID.

**Detached standalone.** A persisted non-recurring event created from one occurrence. It preserves an edited or protected occurrence independently from its original template.

**Captured edit time.** The wall-clock date and time sampled for one projection and its matching Save plan. Projection and Save must use the same captured edit time for recurrence boundary decisions.

**Protected occurrence.** A generated occurrence whose start time is at or before the captured edit time and that would vanish, move, or change meaning after a structural edit. For supported recurrence rules, all affected protected occurrences from the template start through the captured edit time are protected, not only occurrences in the visible window. Occurrences with runs, segments, overrides, exceptions, active sessions, or persisted references are always protected.

**First mutable occurrence.** The first generated occurrence from the same source series whose start time is after the captured edit time and that has no tracking or persisted reference. `All` edits may apply from this occurrence forward while protected history remains unchanged.

**Exception date.** A date on the template that prevents one generated occurrence from appearing.

**Split.** A structural edit that caps the old template before the selected occurrence and creates a new template beginning at the selected occurrence.

**Collapse.** A structural edit that removes recurrence from a series and leaves one non-recurring survivor for the series identity. Protected history or active-session rules may also materialize additional standalone events.

**Scope.** The selected edit range: `Only this`, `Following`, or `All`.

**Baseline.** The event state when the edit session opened.

**Draft.** The current user edits in the panel.

**Field operation.** The normalized meaning of a draft field: unchanged, set, or cleared.

**Projection.** The non-mutating visible event list and preview contour set for the current draft and scope.

**Delete or archive plan.** The semantic plan for a delete or archive request. It owns the affected visible IDs, the final visible projection, the active-session stop requirement, the ordered backend operations, and the undo metadata. Protected occurrences archive while future untracked occurrences hard delete, but both disappear from the visible calendar in one final projection.

**Commit plan.** The ordered mutation plan that Save executes to make the projection real. Calendar writes and active Pomodoro reference transfers from this plan are applied through one backend transaction.

**Canonical render window.** The persisted event rows expanded by the canonical recurrence expander for the visible date window.

## Draft field operations

Partial object patches are not precise enough for recurrence editing. The planner must normalize every draft field that matters to recurrence behavior.

For recurrence, the normalized operation must be one of:

- **Unchanged:** the user did not touch recurrence in this edit session.
- **Cleared:** the user explicitly turned repeat off.
- **Set:** the user explicitly turned repeat on or changed the rule.

The implementation must not infer `Cleared` from a missing key. Missing means the UI did not provide a recurrence operation. An explicit clear must survive scope changes, preview recomputation, and Save.

The same principle applies to other nullable fields where clearing is meaningful, such as location or call link, but recurrence is the critical field because it changes the event graph.

## Edit session state

An edit session has one source of draft truth. `EventPanel`, the edit session store, preview computation, and Save must not each reinterpret draft state.

The session state must include:

- The selected persisted event or synthetic occurrence.
- The original template when editing a synthetic occurrence.
- The selected occurrence date.
- The baseline event values shown when the panel opened.
- The current draft field operations.
- The selected scope.
- The captured edit time used for projection and Save.
- The current visible window.
- Active pomodoro metadata, if any session is running on the selected series.

Changing a field updates the draft. Changing scope updates only the scope. Projection then reruns from the same draft and the new scope.

## Scope selector visibility

The scope selector appears when the event being edited was already part of a saved recurring series when the panel opened.

It must not appear merely because the user adds repeat to a saved non-recurring event during the edit. In that case, Save converts that one event into a recurring template with no scope choice.

It must appear for both the template's first occurrence and synthetic occurrences of a saved recurring series.

It must not appear when the selected recurring occurrence is the active pomodoro event. In that case the effective scope is `Only this`, even if the previous panel state held `Following` or `All`.

## Projection contract

Projection is pure. Given the same saved event rows, selected event, draft, scope, active session metadata, captured edit time, and visible window, it returns the same result without writing to the store or database.

Projection returns:

- The visible event list for the window.
- The preview contour ID set.
- The editing ID to keep the panel anchored.
- The commit plan Save would execute.
- A flag saying whether Save must refresh the canonical visible window.

The visible event list must include unchanged unrelated events exactly as they were. It may replace events from the edited series with virtual events, but only inside the visible window.

Preview contour IDs must be a subset of the rendered event IDs. If a virtual event is previewed, it needs a stable virtual ID that cannot collide with persisted or synthetic IDs.

For delete and archive, the scope selector uses the same affected-set preview model as editing. `Only this` contours the selected occurrence. From a future selected occurrence, `Following` contours the selected occurrence and later rendered occurrences in the same series. `All` contours all rendered occurrences only when the series has no protected history; otherwise it contours the mutable future rows that would disappear and leaves protected history unhighlighted. From a started selected occurrence, `Following` and `All` contour only started occurrences because history archive does not affect future mutable rows. A protected occurrence may keep its current geometry and content in the preview, but the contour still communicates that the operation will archive it.

When the user confirms delete or archive, the UI applies the plan's final visible projection for the affected scope before sending one atomic backend batch. This projection is display-only. It prevents protected occurrence archive batches from disappearing one by one while the backend snapshots each occurrence and caps the template.

## Save contract

Save executes the same semantic commit plan projection would produce for the current draft, scope, active metadata, captured edit time, and visible window. The implementation may reuse the exact plan object or recompute it from the same normalized inputs, but it must not independently decide what recurrence operation means.

When Save starts, the submitted projection may remain visually frozen until the canonical refresh completes. This freeze is display-only: it must not detach, split, collapse, delete, transfer sessions, or write data before Save executes the commit plan.

Save translates the commit plan to one backend recurrence batch. The batch may update templates, detach occurrences, split series, and transfer the active run reference, and those writes must commit or roll back together. Single-operation backend commands remain available for compatibility, but the normal recurrence Save path must not sequence them independently.

After Save succeeds:

- The edit session closes or resets.
- Preview contours are cleared.
- Any visible window cache for affected calendar data is invalidated.
- The current visible window is refreshed from canonical persisted expansion.
- Stale prefetch results cannot replace the refreshed window.

An optimistic in-memory render may only be used if it is mechanically derived from the same commit plan and tests prove it matches canonical expansion. Otherwise the canonical refresh is required.

## Create and non-recurring edit semantics

Creating an event with recurrence creates one template. Preview expands the pending template within the visible window and contours all generated pending events.

Adding recurrence to a saved non-recurring event converts that event into a template. The base event ID remains the first occurrence, so active sessions and existing references to the base ID remain valid.

Clearing recurrence on a saved non-recurring event is a no-op because there is no recurrence to clear.

Changing recurrence on a saved non-recurring event does not show the recurring scope selector. There is no old series to detach, split, or collapse.

## Recurring edit semantics

All recurring edits begin from the selected occurrence and its source template. The first occurrence and a synthetic occurrence must be handled explicitly because their IDs differ but their product behavior is the same.

### Only this

`Only this` affects the selected occurrence only.

If recurrence is unchanged or cleared, Save detaches the selected occurrence into a non-recurring standalone event with the draft non-recurring fields. The source template continues unchanged except for an exception date for the selected occurrence.

If recurrence is set or changed, Save detaches the selected occurrence into a new independent recurring template anchored on the selected occurrence. The source template continues unchanged except for an exception date for the selected occurrence.

Preview shows the source series without the selected occurrence and shows the detached result at the selected occurrence date. If the detached result is recurring, preview expands that new independent series in the visible window.

### Following

`Following` affects the selected occurrence and later occurrences from the same source template.

If recurrence is unchanged or set, Save caps the old template before the selected occurrence and creates a new template beginning at the selected occurrence with the draft fields and recurrence rule.

If recurrence is cleared, Save caps the old template before the selected occurrence and creates one non-recurring standalone survivor at the selected occurrence date with the draft fields.

Preview shows the old template only before the selected occurrence and shows the new result from the selected occurrence onward. When recurrence is cleared, future repeated occurrences disappear and only the selected survivor remains.

### All

`All` applies to the series as a whole while preserving past data.

If recurrence remains set and there are no protected occurrences, Save may update the template directly. If protected occurrences exist, Save preserves them first. The preferred preservation mechanism is a capped historical template ending at the last protected occurrence, followed by a new mutable template beginning at the first mutable occurrence. Detached standalones are used when a protected occurrence needs its own event ID or cannot be represented safely by the capped template.

If a protected active occurrence is in the affected series but is not the selected occurrence, it remains unchanged with the protected side of the series. Template-wide edits started from another occurrence do not move, retime, or rewrite that active occurrence.

If recurrence is cleared, Save collapses the mutable side of the series. The selected occurrence becomes the single non-recurring survivor for the mutable side with the draft fields. This is true even when the selected occurrence is synthetic and not the original template date. Protected history remains visible through a capped historical template or detached standalones.

Collapse must preserve invariant 7:

- Any protected occurrence that would vanish, move, or change meaning remains visible with its original meaning.
- A capped historical template is preferred when one template can preserve the protected range without rewriting it.
- A detached standalone is required when an individual occurrence needs its own event ID or when the selected survivor cannot safely reuse the old template.
- Runs and segments attached to materialized occurrences are transferred to their standalone event IDs.
- The selected survivor receives any runs from the selected occurrence ID.
- The old template is reused as the survivor only when reuse does not rewrite protected history. Otherwise it remains as the historical template or is converted only when deletion is legal.
- Mutable occurrences other than the selected survivor stop expanding after the collapse.

Preview shows exactly the collapsed result inside the visible window. It must not collapse the preview back to the original template date when the user is editing a later occurrence.

## Scope switching

The selected scope is a projection parameter, not a separate draft.

Example: a user opens a daily series, stays on `Only this`, turns repeat off, then switches to `Following`. The explicit recurrence operation is still `Cleared`. Projection must immediately change from "detach this one occurrence" to "cap the old template and leave one survivor at the selected occurrence."

Switching from `Following` to `All` after the same draft must immediately show the collapse result for all. Switching back must restore the following projection. No save happens during these transitions.

## Repeat toggle edge cases

Turning repeat off and back on in the same edit session must produce a final recurrence operation based on the current visible value:

- If the current rule equals the baseline rule, the operation is `Unchanged`.
- If the current value has no rule, the operation is `Cleared`.
- If the current value has a rule different from baseline, the operation is `Set`.

Preview contours must be recomputed from scratch after each toggle. No contour ID from the previous projection may remain unless that same ID is rendered in the new projection.

## Active pomodoro sessions

An active session must survive every recurrence edit, but an active selected occurrence cannot edit the repeat chain.

If Save materializes, detaches, or otherwise changes the active occurrence's event ID, the active run's event references transfer to the new event ID.

For `Only this`, an active selected occurrence transfers to the detached result. An active occurrence elsewhere in the same source series is unaffected because the source template continues unchanged except for the selected exception date.

For an active selected recurring occurrence, the panel hides the scope selector and Save uses `Only this`. Direct manipulation can only resize the bottom edge to change the end time. Moving the block, resizing its top edge, changing the panel start date or time, and toggling all-day are disabled because the start time already has pomodoro history.

For `Following`, if the active occurrence is before the selected split point, it is unaffected. If the active occurrence is after the selected split point, Save materializes it unchanged as a standalone event and transfers the active run there before splitting the source series. The active occurrence does not move to the new template.

For `All`, protected active occurrences are preserved like other protected history. A template-wide edit started from another occurrence does not move, retime, collapse, or detach the active occurrence merely to apply the new chain. Mutable occurrences after the protection boundary receive the edited fields.

Projection never transfers a session. It only marks which transfer Save would perform.

## Rendering and cache rules

The canonical rendered state is persisted event rows expanded for the visible window.

After recurrence Save, the store must not briefly re-render the old series from a stale cache, a stale prefetch response, or an optimistic expansion that was not derived from the commit plan.

The frontend can keep windowed caching, but affected mutations must invalidate every cached window that could include:

- The old template.
- The new template.
- Any capped historical template that preserves protected occurrences.
- The selected survivor.
- Detached protected standalones in the visible range.
- Deleted or capped future occurrences.

The current foreground load is latest-wins. Older loads or prefetches cannot overwrite a newer post-save refresh.

## Required scenario matrix

The planner and tests must cover these scenarios.

Scopes:

- `Only this`.
- `Following`.
- `All`.
- Scope switching after a draft recurrence change.

Repeat operations:

- Add repeat to a new event.
- Add repeat to a saved non-recurring event.
- Clear repeat.
- Clear repeat and set it again before save.
- Change frequency.
- Change interval.
- Change end condition.
- Change recurrence while changing time.
- Change recurrence while changing all-day state.

Occurrence positions:

- First occurrence with the template ID.
- Synthetic future occurrence.
- Synthetic past occurrence.
- Today's occurrence.
- Same-day occurrence that already started before the captured edit time.
- Same-day occurrence that has not started at the captured edit time.
- Cross-midnight occurrence whose start date and end date fall on different sides of the captured edit time.
- Occurrence after the original first occurrence was detached.

Series shapes:

- Daily.
- Weekly with selected weekdays.
- Monthly.
- Rule with `until`.
- Rule with `count`.
- Rule with exception dates.
- Imported overrides when they affect visible expansion.

Event shapes:

- Timed.
- All-day.
- Cross-midnight.
- Meeting enabled with no guests.
- Meeting with location.
- Meeting with call link.
- Notifications enabled.
- Pomodoro config enabled.

Runtime states:

- No active pomodoro session.
- Active session on the edited occurrence.
- Active session on another occurrence in the same series.
- Active session on an unrelated event.
- Past occurrences outside the current visible window that would be erased by the edit.
- Past occurrences outside the current visible window with stored run references.
- Captured edit time that separates a started occurrence and a future occurrence on the same date.

Window states:

- Current week shows every expected daily instance from Monday through Sunday.
- Navigating away and back after Save shows the same state as reload.
- Preview result matches canonical persisted expansion after Save.
- No preview contour remains after Save or close.
- No rendered event ID has a hit area without visible block content.

## Test strategy

The recurrence edit planner must be tested as pure logic. Component tests alone are not enough because the bugs are semantic.

Required tests:

- Normalize recurrence operations as unchanged, cleared, and set.
- Reproject the same draft when scope changes.
- Preview adding recurrence to a saved non-recurring event without showing the scope selector.
- Preview and save plan for clearing recurrence with `Only this`.
- Preview and save plan for clearing recurrence with `Following`.
- Preview and save plan for clearing recurrence with `All`, keeping the selected occurrence as survivor.
- Handle first occurrence and synthetic occurrence IDs.
- Handle a series whose first occurrence was already detached, then collapse remaining occurrences with `All`.
- Compare preview projection against post-commit canonical expansion for representative cases.
- Ensure every preview contour ID exists in the rendered projection.
- Ensure a daily repeat created on Monday renders through Sunday in the current week.
- Ensure same-day started occurrences are protected by start time, not by date only.
- Ensure clearing recurrence with `All` preserves protected history, removes mutable non-survivors, and keeps the selected survivor.
- Ensure post-save refresh cannot be overwritten by stale prefetch data at the semantic store boundary.

## Implementation requirements

The implementation should introduce a shared recurrence edit planner or equivalent semantic layer. It should be pure and should be used by both preview and Save.

The planner should accept:

- Saved events needed for the visible window.
- The source template.
- The selected occurrence.
- Baseline values.
- Draft field operations.
- Scope.
- Captured edit date and time.
- Active session metadata.
- Visible window.

The planner should return:

- Projection events.
- Preview contour IDs.
- Editing ID.
- Commit plan.
- Active-session transfer plan.
- Cache invalidation or canonical refresh requirement.

Save code may translate the commit plan into backend payloads, but it must not recalculate recurrence semantics with separate conditionals.

## Commit plan operations

The exact TypeScript shape can differ, but the semantic operations should be explicit:

- Add exception date to template.
- Detach occurrence to standalone.
- Detach occurrence to new template.
- Cap template before date.
- Create following template.
- Cap historical template at the protected boundary.
- Collapse series to selected survivor.
- Materialize protected occurrences when a capped historical template is not enough.
- Transfer active or historical run references.
- Refresh canonical window.

Each operation must be ordered. For example, preserving protected occurrences happens before the template is changed in a way that would make those occurrences impossible to reconstruct.

## Quality bar

The recurrence edit flow is correct only when:

- Preview is a non-mutating projection of Save.
- Save executes the same semantic plan preview showed.
- Save followed by canonical reload equals the preview result inside the visible window.
- Protected and mutable occurrences are separated by occurrence start time, not calendar date alone.
- Scope switching never loses the draft recurrence operation.
- Clearing repeat for `All` keeps the selected occurrence as the survivor.
- Adding repeat to a non-recurring event previews the new instances immediately and does not show a meaningless scope selector.
- Saving keeps the submitted projection visually stable until the canonical refresh replaces it.
- Preview contours cannot become stale.
- Visually invisible clickable events cannot exist.

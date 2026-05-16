# Recurrence refactor implementation goal

## Purpose

This file is the durable goal for the next implementation phase. It exists so a future agent can continue after conversation compaction without needing the original chat history.

The task is to implement the full recurrence edit refactor described by `docs/features/calendar-recurrence-editing.md`. The existing code has a partial stabilization, but the full refactor is not done.

## Current repository state

Relevant recent commits:

- `7049a58 docs(calendar): specify recurrence edit semantics`
- `8a5b156 fix(calendar): stabilize recurrence save previews`

The second commit added useful pieces but must not be treated as the final architecture. It introduced:

- `getRecurrenceFieldOperation` in `apps/client/src/lib/components/calendar/display-events.ts`
- `buildRecurringCommitPlan` and `buildRecurringEditPlan` in the same file
- A save-time display freeze in `CalendarView.svelte`
- Focused tests in `display-events.test.ts`

However, the current implementation still has the main architectural problem:

- `display-events.ts` still owns most preview projection branching.
- `CalendarView.svelte` still owns most recurring save branching.
- Preview and save are not fully driven by one complete semantic plan.
- There is no dedicated recurrence edit planner module.
- There is no executor that applies a typed mutation plan.
- Store refresh is improved, but the recurrence graph can still depend on multi-step UI code decisions.

## Final objective

Refactor recurrence editing so create preview, edit preview, save behavior, and post-save rendering all follow one tested recurrence edit semantic model.

The finished system must make these properties true:

- Preview is a non-mutating projection of the current save result.
- Save executes the same plan that preview projected.
- Save followed by canonical reload equals the preview result in the visible window.
- Switching `Only this`, `Following`, and `All` reprojects the same draft immediately.
- Missing recurrence fields and explicit repeat clear are distinct states.
- Adding repeat to a saved non-recurring event previews instances immediately and does not show a meaningless scope picker.
- Clearing repeat with `All` keeps the selected occurrence as the surviving non-recurring event.
- Clearing repeat with `Following` caps the old series and leaves one selected survivor, unless active-session protection intentionally moves the effective split.
- Stale preview contours cannot remain after save or close.
- Old repeated instances cannot flash back during save.
- A rendered hit area cannot exist without visible event content.
- Current visible state after save matches what app restart would show.

## Source of truth

Use these docs as the product contract:

- `docs/features/calendar-recurrence-editing.md`
- `docs/features/calendar-recurrence.md`
- `docs/algorithms/recurrence-expansion.md`
- `docs/data/invariants.md`
- `docs/features/calendar.md`

If code and docs disagree, the docs above win unless the code exposes a real impossible constraint. If a constraint is impossible, update the docs and explain the reason in the implementation commit.

## Non-goals

Do not redesign unrelated calendar UI.

Do not replace the entire calendar store unless a smaller change cannot satisfy the goal.

Do not replace the entire recurrence expansion algorithm.

Do not add dependencies.

Do not add browser or Tauri automation as a substitute for pure semantic tests. The project rules say UI changes are verified through tests and `pnpm -w run validate`.

Do not stop after adding conditionals to `CalendarView.svelte` or `display-events.ts`. The goal is architectural consolidation.

## Required architecture

Create a dedicated pure planner module, probably:

`apps/client/src/lib/components/calendar/recurrence-edit-plan.ts`

The exact name can change, but it must be separate from `CalendarView.svelte` and should not depend on Svelte state or Tauri IPC.

The planner must accept:

- Raw persisted event rows available to the current window.
- The visible expanded events in the current window.
- The source template for the selected occurrence.
- The selected occurrence.
- Baseline event values.
- Draft field operations.
- Selected scope.
- Current local date.
- Visible expansion window.
- Active pomodoro metadata.

The planner must return:

- Projection events for the visible window.
- Preview contour IDs.
- Editing ID.
- A typed commit plan.
- Active-session transfer operations.
- Cache invalidation and canonical refresh requirement.
- Diagnostics for impossible or inconsistent inputs.

The planner must be pure. It must not mutate the store, call Tauri, call `calendarStore`, call `pomodoro`, or read live time directly. Current date and active session state are inputs.

## Draft operation model

Create explicit typed field operations at least for recurrence:

- `unchanged`
- `cleared`
- `set`

Do not use missing object keys or `undefined` alone to mean "clear repeat."

Recommended type shape:

```ts
type FieldOperation<T> =
  | { kind: "unchanged"; value: T | undefined }
  | { kind: "cleared" }
  | { kind: "set"; value: T };
```

Keep `getRecurrenceFieldOperation`, but move it into the new planner module or a small shared utility. Update imports accordingly.

The planner should normalize the panel's `Partial<CalendarEvent>` into explicit operations before it projects or builds commit plans.

## Commit plan model

Create a typed operation union. Names can differ, but the plan must represent these semantics explicitly:

- Add exception date to template.
- Detach occurrence into standalone.
- Detach occurrence into independent recurring template.
- Cap template before date.
- Split template into old and new templates.
- Collapse series to selected occurrence.
- Materialize protected past occurrences.
- Update template fields.
- Create or update selected survivor.
- Transfer active run references.
- Refresh canonical visible window.

Example shape:

```ts
type RecurrenceCommitOperation =
  | { type: "add-exception"; templateId: string; date: string }
  | { type: "detach-occurrence"; sourceId: string; occurrenceDate: string; target: "standalone" | "template" }
  | { type: "cap-template"; templateId: string; untilDate: string }
  | { type: "create-following-template"; sourceTemplateId: string; startDate: string; patch: CalendarEventDraft }
  | { type: "collapse-series"; templateId: string; survivor: SurvivorSpec }
  | { type: "materialize-past"; templateId: string; dates: string[] }
  | { type: "transfer-active-run"; fromId: string; toId: string };
```

Do not treat this exact shape as mandatory. The important rule is that `CalendarView.svelte` should execute plan operations, not rediscover recurrence semantics.

## Projection model

Projection must be derived from the same plan as Save.

Implementation path:

1. Build normalized recurrence edit input.
2. Build semantic commit plan.
3. Project the commit plan into visible events without mutation.
4. Return projection events, preview contour IDs, and editing ID.
5. Save executes the commit plan through an executor.
6. After save, refresh current visible window from canonical persisted data.

Projection must not write:

- No DB writes.
- No store writes.
- No exception mutations.
- No split mutations.
- No active-session transfer.
- No cache invalidation.

Projection must always keep preview contour IDs as a subset of rendered IDs.

## Save executor

Create a save executor, probably:

`apps/client/src/lib/components/calendar/recurrence-edit-executor.ts`

The executor can depend on the calendar store and pomodoro store through injected function interfaces. Keep those interfaces narrow so tests can use fakes.

`CalendarView.svelte` should become a coordinator:

- Build the planner input.
- Ask the planner for a projection and commit plan.
- Ask the executor to execute the plan on Save.
- Stop or transfer pomodoro according to the plan.
- Refresh the current visible window.
- Close the session.

`CalendarView.svelte` should not contain recurrence structural logic such as "if scope is following and active date, split tomorrow" after the refactor. That belongs in the planner.

## Store changes to consider

Audit whether existing store methods are enough:

- `detachInstance`
- `addException`
- `setRepeatUntil`
- `splitSeries`
- `updateBlock`
- `refreshWindow`
- `beginBatch`
- `endBatch`
- `hasProgressSegments`
- `protectHistoricalSegments`

If existing methods force incorrect semantics, add focused store methods. Likely candidates:

- `collapseSeriesToOccurrence`
- `createStandaloneFromOccurrence`
- `createRecurringTemplateFromOccurrence`
- `executeRecurrenceCommitPlan`

Any new store method must preserve durable data and respect invariant 7.

Avoid relying on `splitSeries` for every case if the semantics are different. For example, clearing recurrence with `Following` should produce a non-recurring selected survivor, not an accidental recurring template with no recurrence because the method happened to accept `recurrence: undefined`.

## Required behavior by scope

### Only this

When recurrence is unchanged or cleared:

- The selected occurrence detaches into a standalone non-recurring event.
- The source template continues unchanged except for the selected exception date.

When recurrence is set:

- The selected occurrence detaches into an independent recurring template.
- The source template continues unchanged except for the selected exception date.

### Following

When recurrence is unchanged or set:

- The old template is capped before the selected occurrence.
- A new template starts at the selected occurrence with the draft fields.

When recurrence is cleared:

- The old template is capped before the selected occurrence.
- The selected occurrence becomes one non-recurring survivor.
- Later occurrences disappear.

When the selected occurrence has an active session:

- Active-session protection wins.
- The active occurrence remains with the old template.
- The effective future change starts at the next occurrence.
- If repeat was cleared, the old template is capped at the active occurrence and no future template is created.

### Active session on another occurrence in the same series

- `Only this` leaves that active occurrence untouched.
- `Following` leaves it untouched when it is before the split point.
- `Following` transfers it to the corresponding occurrence in the new template when it is after the split point and repeat remains set.
- `Following` materializes it as a standalone and transfers the active run when it is after the split point and repeat was cleared.
- `All` materializes it as a standalone and transfers the active run whenever collapse or a template-wide edit would make it vanish, move, or change meaning.

### All

When recurrence remains set:

- Apply the draft to the template after materializing protected past occurrences.
- The selected occurrence must stay coherent with the new template projection.

When recurrence is cleared:

- Collapse the series.
- The selected occurrence is the single non-recurring survivor.
- This is true even when the selected occurrence is synthetic.
- Past protected occurrences are materialized first.
- Future occurrences disappear.

If the first occurrence was already detached:

- The detached first occurrence remains unrelated.
- Collapsing the remaining template must not delete the selected occurrence.
- The selected occurrence remains the survivor.

## Cache and render requirements

After Save:

- Invalidate affected cached windows.
- Supersede stale prefetch and stale foreground loads.
- Refresh the current visible window from canonical persisted expansion.
- Do not release the save-time preview freeze until canonical refresh has applied.
- Clear preview contours after the session closes.

The current `saveDisplayFreeze` stabilization may be kept if it still fits the architecture, but it should become a coordinated save-state behavior rather than a patch over divergent semantics.

## Test requirements

Add or update pure tests before relying on behavior.

Required new or strengthened tests:

- Recurrence operation normalization: missing, unchanged, cleared, set.
- `Only this` clear repeat projection and commit plan.
- `Only this` set repeat projection and commit plan.
- `Following` clear repeat projection and commit plan.
- `Following` active selected occurrence clear repeat plan.
- `Following` active later occurrence clear repeat plan.
- `Following` active later occurrence set repeat plan.
- `Following` selected occurrence with historical progress.
- `All` clear repeat keeps selected synthetic occurrence as survivor.
- `All` clear repeat materializes a different active occurrence before collapse.
- `All` clear repeat after first occurrence was detached.
- `All` recurrence change materializes protected past instances.
- Protected past instances outside the current visible window are materialized when a structural edit would erase them.
- Dates with stored run references are preserved even when they are outside the current visible window.
- Add repeat to saved non-recurring event previews instances and does not request scope.
- Create event with Monday daily repeat renders Monday through Sunday.
- Scope switching after repeat clear reuses the same draft operation.
- Repeat off, repeat on, repeat off again recomputes contour IDs from scratch.
- Every preview contour ID exists in the returned projection.
- Preview projection compared against a fake post-commit canonical expansion for representative cases.
- Save executor executes the expected store calls for each commit operation.
- Stale prefetch or cached window cannot overwrite a forced post-save refresh.

Tests should be mostly in:

- `apps/client/src/lib/components/calendar/recurrence-edit-plan.test.ts`
- `apps/client/src/lib/components/calendar/display-events.test.ts`
- `apps/client/src/lib/stores/window-load-coordinator.test.ts`, if cache behavior changes

Use existing test style. Do not write shallow "it exists" tests.

## Implementation milestones

Commit after each major milestone.

### Milestone 1: extract planner types and recurrence operation normalization

Deliver:

- New planner module.
- Recurrence operation normalization moved there.
- Tests for missing, unchanged, cleared, set.
- Existing imports updated.

Suggested commit:

`refactor(calendar): extract recurrence edit planner`

### Milestone 2: move preview projection into planner

Deliver:

- `computeEditDisplay` delegates to planner projection.
- `applyAll`, `applyFollowing`, and related helper logic are either moved or wrapped behind planner APIs.
- Preview contour IDs are validated by tests.
- Scope switching tests live at planner level.

Suggested commit:

`refactor(calendar): centralize recurrence preview projection`

### Milestone 3: create typed commit plans

Deliver:

- Planner returns a typed commit plan for each scope and recurrence operation.
- Tests assert the plan shape for reported edge cases.
- The plan includes refresh and active-session transfer requirements.

Suggested commit:

`refactor(calendar): plan recurrence edit commits`

### Milestone 4: implement executor and reduce CalendarView branching

Deliver:

- New executor module or equivalent injected executor.
- `CalendarView.svelte` no longer owns recurrence structural semantics.
- Existing store calls are used through typed operations.
- Add store methods only where existing calls cannot express correct semantics.

Suggested commit:

`refactor(calendar): execute recurrence edit plans`

### Milestone 5: fix collapse and following clear semantics end to end

Deliver:

- `Following` clear repeat creates one selected survivor.
- `All` clear repeat keeps the selected occurrence as survivor.
- Detached-first-occurrence scenario works.
- Active-session and historical-progress cases are explicit.

Suggested commit:

`fix(calendar): make recurrence clear semantics deterministic`

### Milestone 6: canonical refresh and stale render protection

Deliver:

- Save-time preview freeze or equivalent state is tied to canonical refresh completion.
- A forced refresh supersedes stale cache and stale prefetch.
- Tests cover stale refresh behavior where practical.

Suggested commit:

`fix(calendar): prevent stale recurrence render after save`

### Milestone 7: final cleanup and docs

Deliver:

- Remove dead helper functions and obsolete tests.
- Update docs if implementation clarified any decisions.
- Run full validation.

Suggested commit:

`docs(calendar): align recurrence refactor notes`

## Verification gate

Run focused tests as work progresses, then run:

```bash
pnpm -w run validate
```

Do not report completion if validation fails.

Do not start a dev server or Tauri app as a substitute for validation. Project rules say UI changes in this environment finish through tests and `pnpm -w run validate`.

## Completion checklist

Before marking the implementation goal complete, verify every item:

- `docs/features/calendar-recurrence-editing.md` still matches code behavior.
- Planner is pure and separately tested.
- Save executor uses typed commit operations.
- `CalendarView.svelte` no longer contains recurrence structural decision trees.
- Explicit recurrence clear is not represented only by missing fields.
- Preview and save use the same semantic plan.
- Scope switching reprojects the same draft.
- `Only this`, `Following`, and `All` clear repeat behavior matches the spec.
- Adding recurrence to saved non-recurring events previews immediately without scope selector.
- Post-save render is canonical and stale loads cannot overwrite it.
- Preview contours clear after save or close.
- No test depends on current wall-clock date unless date is injected.
- `pnpm -w run validate` passes.
- Git worktree is clean after the final commit.

## If blocked

If existing store or backend commands cannot express the correct operations safely, stop and document the exact missing primitive. Then add the smallest store or backend command needed, with tests.

If preserving past instances cannot be implemented exactly for a malformed imported rule, stop and document a specific protected-history policy first. Dates with runs, segments, overrides, exceptions, active sessions, or persisted references must still be preserved. Do not use the current visible window as the only limit.

If active-session behavior conflicts with current pomodoro APIs, preserve the active session first and document the required pomodoro API change before continuing.

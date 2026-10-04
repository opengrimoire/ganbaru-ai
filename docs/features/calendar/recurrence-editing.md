# Calendar recurrence editing

Recurrence preview is a non-mutating projection of the current Save result. It shows what the visible calendar will contain if the current draft and scope are saved, but it never detaches, splits, collapses, deletes, archives, transfers sessions, or writes data before Save.

## Product contract

- Preview and Save use the same semantic plan.
- Scope switching requests a new projection of one shared draft.
- Missing fields and explicitly cleared fields are distinct.
- The selected occurrence stays visible unless the selected operation truly removes it.
- Save commits the calendar mutation and Pomodoro reference transfers atomically.
- Successful Save refreshes the visible window from canonical persisted expansion.
- Preview contours refer only to rendered event identities and always clear on close or completion.
- A visually absent block never retains an invisible hit area.

## Ownership

The frontend owns draft normalization, immediate pointer feedback, rendering, and affected-set presentation. Existing-event edits use debounced native previews and semantic Save. The selected card responds immediately over cached occurrences while native review prepares the affected series; this local overlay makes no recurrence or protection decisions.

The backend owns canonical window expansion, semantic scope and protection decisions, visible edit projection, durable validation, and atomic persistence. Main windows and schedulers consume native occurrences. Panel creation and Project bulk scheduling share the native review and commit boundary. Reviewed deletion, visible deletion projection and bounded process-local Undo also share that native owner, including transactional Focus stopping and complete metadata preservation. The Delete UI submits semantic intent and retains immutable requests for retry. The raw mutation interfaces and both superseded expansion engines are removed. Native conformance and transaction tests cover supported recurrence behavior; broader integration and physical platform acceptance remain separate requirements.

Delete, archive, and protected event updates resolve mutation geometry from the current native transaction. Generated identities use their original home-zone recurrence date, even when an override moves the displayed occurrence to another day. Frontend timestamps cannot override that geometry or bypass started-event protection. Excluded, cancelled, and exhausted recurrence identities are rejected. Lookup has shared source row and byte limits, bounded recurrence work, and an awaited native worker; budget exhaustion is an explicit failure. The superseded raw recurrence batch interface and its direct Focus history rewrite have been removed.

Typing and pointer movement retain immediate draft overlays over cached occurrences. Changes to recurrence meaning request debounced native previews tagged with the edit generation; stale results cannot replace newer drafts. Commit revalidates canonical state even when a preview was previously reviewed.

A read-only native scope service is implemented for both platform compositions. It captures recurrence geometry and all source-related persisted Focus evidence in one bounded SQLite snapshot, then computes effective scope, the first mutable occurrence, and protected occurrences requiring preservation. It accepts no frontend clock or execution evidence. Its pure planner also runs inside the semantic Save transaction. A returned scope plan is not permission to commit later against changed data.

That native result also includes the source recurrence fields for both sides of a required split. The split preserves COUNT before exclusions, original termination, future exceptions, additional dates, and original override references. These are the unchanged source sets on which draft edits and protected-occurrence materialization must operate, not a complete draft preview or a client-writable mutation batch. The preservation rules are described in [recurrence expansion](../../algorithms/calendar/recurrence-expansion.md#native-recurrence-partitions).

Native draft preparation is also implemented as an intermediate read service. It accepts separate timing and recurrence intent plus typed editable metadata, attendees, alarms, and Focus configuration. It rejects duplicate fields, derived exception lists and split cutoffs, client clocks, and execution evidence. Payloads have record and serialized-byte limits; metadata parsing, HTML sanitization, timezone conversion, and scope analysis run on the shared admitted native worker. Equivalent supported recurrence rules normalize to unchanged, including legacy termination. A timed-to-floating conversion requires both endpoints and clears inherited Focus configuration.

Preparation resolves the selected occurrence from its original identity, including moved overrides and explicit repeated-hour instants. It protects recorded history, active starts, and existing active recurrence chains using persisted evidence. Opening a protected occurrence with no changes remains valid. Standalone events always use `Only this`, even if a caller requests a series scope. An active standalone may still gain recurrence without moving its recorded start.

The service also builds concrete recurrence sets for no-op, existing-row update, detach, split, and collapse operations. It identifies protected materializations, metadata provenance, and the exact active run and result that require reference transfer. Those recurrence fields are decoded again through the canonical engine before returning a plan, including overrides newly made reachable by a changed rule. Preparation also captures exact event and child rows, Focus configurations, Music assignments, task links, and imported component data under the same source allocation budget. Its metadata revision includes child changes even when the event timestamp is unchanged. A separate review digest binds that revision to normalized intent, scope, selected geometry, and the native plan. Save captures fresh rows and protection evidence and rejects a changed review.

Existing native detach and split transactions copy alarms, attendee provenance, categories, extended properties, organizer, task links, and an independent imported component graph. The copied import retains its envelope, timezone definitions, unknown properties, parameters, nested values, and diagnostics. It does not clone unrelated event siblings. Copy failures roll back with the surrounding transaction. The semantic Save service additionally prepares complete planned sides and protected materializations from captured rows. It preserves retained override metadata, explicit clears, inherited Focus settings, and current Music assignment versions. Equivalent metadata values do not create a split or replace imported children.

**Implemented native boundary and existing-event frontend cutover:** semantic Save is registered in both platform compositions and enters the serialized native Focus queue. One authorized SQLite transaction applies the native Calendar rows, retargets exact execution references, reconciles Focus, and records the result. Current aliases change independently of original run identity, device-day date, and title. Completed segments retain their original execution facts; Calendar history reads project their current owner through the run. Publication follows successful commit. The transaction rechecks vault ownership, foreground state, and time-sensitive protection before committing.

The same boundary accepts explicit `End now` and `Enable Focus` actions from the event panel. End now applies only to one ongoing timed occurrence, retains its original start, and chooses the cutoff from the native acceptance clock. Preview review binds source, protection, and user intent rather than an aging preview timestamp. Calendar cutoff, exact owned-run completion, pause closure, reference changes, and retry receipt share one transaction. Enable Focus requires an ongoing standalone event without Focus configuration, an explicit configuration, and no other active run when accepted. Configuration, explicit run start, and receipts commit together.

An earlier closed Focus run does not freeze an ongoing timed Calendar occurrence. Its recorded start and date kind remain protected, its end cannot be moved before native current time, and an existing recurrence chain cannot be changed. If that occurrence detaches, prior closed runs acquire the new current Calendar alias while preserving original run identity, timestamps, title, and physical segment facts. Completed events and recorded future occurrences after clock correction remain protected.

A retry identity is bound to the complete request and returns its recorded result before source reads or recovery. Reusing that identity with different intent fails. Preparation shares the existing admitted worker and source budget; output fanout is reserved before copying and capped at 10,000 rows and 16 MiB per mutation. Failures roll back source changes, copies, Focus changes, and receipts together.

Native Save failures distinguish a confirmed uncommitted request from an unresolved outcome. Only an authorized receipt lookup can establish that a retry was not previously accepted. Failures before that lookup, lost owner replies, and uncertain SQLite commits retain the original retry identity. The frontend controller coalesces preview requests, discards stale edit and vault generations, and retains immutable uncertain Save requests across panel close and Calendar view remounts. An unresolved Save exposes Retry without permitting a different draft to reuse the request. Confirmed results are cached so a failed visible-window refresh does not repeat the write. Accepted receipts invalidate derived caches and notify other Calendar windows independently of that refresh.

An accepted receipt can also be confirmed after the vault becomes read-only. This path uses a read-only connection, reserves the vault transition during lookup, and checks active vault identity and ownership generation before and after the read. It needs no live Focus execution context and cannot execute a missing request. Lookup failures keep the outcome unresolved; only a successful authorized read that finds no receipt rejects the uncommitted request. Receipt reads and writes have an explicit byte limit, and filesystem verification uses admitted workers with deadlines and permits retained through actual worker completion.

Native visible preview is implemented over the same complete prepared rows that Save writes. It projects only the affected source family through the persisted-window expander, retaining unrelated cached events in the frontend. Operation identities keep preview and committed row identities stable. The native plan identifies the selected occurrence independently of geometry, since two overrides can share the same displayed time. Contours and panel identities refer only to rendered occurrences. Preview releases SQLite and the Focus queue before its admitted worker performs recurrence work. Its clock cannot precede the captured Focus owner or committed execution clock after a civil-clock rollback.

Edited civil labels carry their display timezone separately from the event's home timezone. Rust resolves those labels without changing the home zone. Omitted endpoints retain their exact instants, including the later side of a repeated hour. Floating edits carry dates and require both endpoints when changing date kind.

Calendar panel creation uses the same native preview expander, semantic Save queue, atomic Calendar and Focus transaction, and durable receipt recovery as existing-event edits. Rust validates the complete draft, resolves authored timing, canonicalizes recurrence, and assigns the source identity and persistence timestamps. Creation review is independent of advancing time. The frontend shows one immediate authored card while review is pending, then renders the native recurrence family. Pending card IDs belong only to presentation and never authorize a write. A matching persisted native source identity resolves an accepted creation; matching time ranges cannot hide unrelated overlapping events.

Delete restoration uses the native process-local preimage and its receipt. Native tests cover scoped recurrence partitions, preserved imported metadata, nullable execution references, rollback and lost-response recovery. Frontend tests cover immediate interaction, stale previews, immutable retries and projection reconciliation. Archive-only imported envelopes remain in storage without appearing in live exports; shared live envelopes and independent imports retain their export scope. Installed-app held navigation, editing, undo and cross-platform lifecycle behavior still require physical acceptance. Isolated CPU diagnostics and their limitations are recorded in [Calendar migration measurements](../../performance/calendar-migration.md).

## Edit-session input

One edit session contains:

- The selected template or occurrence.
- The source template for a generated occurrence.
- The selected recurrence date.
- Baseline event values.
- Normalized draft field operations.
- Selected scope.
- Native preview and commit identities, with acceptance time owned by Rust.
- Current visible window.
- Native vault context, with Focus evidence loaded by Rust.

Changing scope changes only the projection parameter. It does not create a separate draft or reset explicit edits.

## Field operations

Nullable and structurally meaningful fields use explicit operations:

- **Unchanged:** the user left the baseline value unchanged.
- **Set:** the user supplied a new value.
- **Cleared:** the user explicitly removed the value.

For recurrence, a missing property never means that repeat was turned off. Turning repeat off and back on resolves from the final visible value compared with the baseline.

## Scope selector

The selector appears only when the event belonged to a saved recurring series when the session opened. It appears for the template occurrence and generated occurrences.

Adding recurrence to a non-recurring event does not show a scope selector. The event becomes one recurring template while retaining its base identity.

The selector is hidden for the selected active occurrence, and the effective scope is `Only this`.

## Projection output

Given the same saved rows, selected occurrence, normalized draft, scope, active-session metadata, captured edit time, and visible window, projection returns the same:

- Visible events for the window.
- Preview contour identities.
- Editing identity used to anchor the panel.
- Semantic commit plan.
- Canonical-refresh requirement.

Unrelated events remain unchanged. Virtual preview events use stable collision-free identities. Contour identities are always a subset of rendered identities.

Delete and archive previews use the same affected-set model. Protected rows can retain their current geometry while a contour explains that the operation will archive them.

## Save

Save uses the current projection's semantic plan or recomputes the same plan from identical normalized input. It does not reinterpret the draft independently.

The panel can close and the submitted projection can remain visually stable while persistence completes. That display state is not a mutation. One backend batch applies template updates, exceptions, detachment, splitting, materialization, archive operations, and active-run reference transfers.

After success, the app clears preview state and reloads the visible range from canonical expansion. Older foreground or prefetched loads cannot replace that result. After failure, the user receives a retryable error and no partial recurrence mutation remains.

## Create and non-recurring edits

Creating a recurring event creates one template. Preview expands it only in the visible window.

Adding recurrence to a saved non-recurring event converts that row into a template and preserves its ID as the first occurrence. Clearing recurrence on a non-recurring event is a no-op.

## Only this

If recurrence is unchanged or cleared, the selected occurrence detaches as a non-recurring standalone and the source template gains an exception for that date.

If recurrence is set to a different rule, the selected occurrence becomes an independent recurring template and the source still gains one exception.

Preview shows the source without the selected occurrence plus the detached result and any visible expansion of its independent rule.

## Following

The old template ends before the selected occurrence. If recurrence remains set, a new template begins at the selected occurrence. If recurrence is cleared, only one standalone survivor remains there.

Exceptions relevant to the new side transfer so an occurrence previously detached, archived, or deleted cannot regenerate after a split.

## All

Without protected history, the template can be updated directly. With protected history, the old template is capped at the protected boundary and a new template begins at the first mutable occurrence. Individual protected occurrences detach only when a historical template cannot preserve them safely.

Protection need not form one continuous prefix of recurrence identities. An override can move an earlier identity into the future, and recorded execution can protect a later identity. The first mutable occurrence still begins the edited side. Protected identities on that side must be preserved individually, rather than making intervening mutable occurrences uneditable.

Timed scope protection compares canonical instants. Floating all-day scope protection compares dates against the native device's current civil date. Missing device-date facts are an explicit failure. Scoped edits and deletion use this distinction. Removing a whole calendar also captures the native device date through an admitted worker before its write transaction; it preserves protected events and their imported metadata under archive storage custody.

Clearing recurrence collapses only the mutable side. The selected occurrence is the survivor even when it is not the original template date.

The native plan requires a mutable selected survivor when collapsing a series. A protected historical selection cannot become a newly edited survivor. An exhausted series with no mutable occurrence rejects actual edits instead of inventing a new future series; opening it without changes remains valid.

## Active Pomodoro sessions

A continuing active run keeps its identity through recurrence edits. When its occurrence receives a new event identity, current references transfer atomically while original historical identity remains preserved. Removing Focus configuration stops the owned execution through the same transaction. Explicit End now completes it at the native acceptance cutoff, including an open pause, without creating a later phase.

An active selected occurrence cannot edit the repeat chain or its recorded start. A different active occurrence in the affected series stays unchanged on the protected side or is materialized before the edit.

## Rendering

Preview affects only occurrences from the edited series and current window. The calendar rail, event status, and active-session presentation use the projected identities and geometry without writing history.

After commit, rendering comes from canonical persistence. A preview or cache never becomes a second source of truth.

Opening another card during preview resolves its editor baseline from persisted occurrences and verifies the source again after details load. A proposed-only card cannot open as a saved source. Discarding a preview does not carry its unsaved metadata or geometry into another editor.

## Quality requirements

- Planning and projection remain pure and deterministic.
- Protected-history decisions consider the complete affected range, not only visible dates.
- Malformed or unsupported recurrence that cannot be enumerated safely stops with a diagnostic rather than rewriting history.
- Preview and commit plans have focused parity tests.
- Backend batches prove rollback across calendar and Pomodoro reference changes.
- Required user scenarios live in [Calendar recurrence testing](../../testing/calendar-recurrence.md).

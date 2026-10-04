# Calendar recurrence testing

Canonical Rust expansion is the sole production recurrence engine. Its fixtures cover COUNT before exclusions, independent additional dates, overlap, advanced selectors, home-zone identities, imported Google termination, gaps and folds. Frontend tests retain date-picker, codec, preview and command-recovery responsibilities. Archive custody regressions verify that archived-only components and METHOD cannot leak into live exports. Calendar removal tests compare floating dates to the native device day on both sides of UTC midnight. Real Tauri and Android navigation, editing and lifecycle acceptance remain manual checks.

Calendar recurrence testing must prove that preview, commit planning, backend persistence, canonical expansion, protected history, and active Pomodoro references agree.

## Automated coverage

Frontend unit tests exercise draft serialization, native contour merging, selected-card feedback, semantic action dispatch, stale editor handling, receipt retries, and cache invalidation with mocked native boundaries. Rust tests exercise canonical scope planning, complete prepared rows, Calendar and Focus transactions, lifecycle protections, and preview/commit comparisons. Automated boundary coverage does not replace physical Tauri or Android acceptance.

Native mutation regressions cover misleading frontend timestamps, moved-override archive geometry, original home-zone identity across UTC midnight, excluded and cancelled identities, exhausted COUNT, independent RDATE, offset-aware protection boundaries, source allocation limits, and rollback when a later protected deletion fails. Pure recurrence lookup cases additionally cover repeated-hour disambiguation, generated DST gaps, agreement with window expansion, and explicit work-budget exhaustion. These cases protect the native lookup used by current mutation checks; they do not establish full scoped preview/commit parity.

Native cross-boundary tests now compare the complete visible preview against a committed plan reloaded through the canonical backend window reader, including slim metadata, configuration, overrides, attendee order, and occurrence identities. The complete supported recurrence-family matrix remains required.

Native window selection tests cover explicitly authored DST-gap times and legacy civil timestamps for rendering, Focus, and notifications. Home dates on either side of the displayed UTC date remain selectable with their original recurrence identities; the final canonical viewport filter excludes outside instants admitted by the conservative SQL prefilter.

Native partition tests serialize both sides and reload them through canonical expansion. Their disjoint union must match the original recurrence dates and instants. Coverage includes COUNT with exclusions, all UNTIL forms, unlimited rules, legacy termination, advanced period selectors, off-pattern and independent RDATE, cancellation ranges, moved overrides, all-day spans, fractional timestamps, generated and explicit gaps, repeated-hour duration, and retained wall-clock anchors. These are recurrence-field round trips; complete supported-format and visible preview/commit equivalence remain separate requirements.

Native scope tests cover persisted active-run scope selection, complete history outside the selected range, unchanged read snapshots followed by fresh evidence, shared geometry/history allocation limits, isolated protected dates within the mutable side, moved occurrence ordering, home-zone boundaries, floating all-day device dates, finite COUNT/UNTIL exhaustion, independent RDATE before and after DTSTART, sparse recurrence beyond thirty years, and explicit work exhaustion. Native visible preview and semantic Save consume the same analysis, and existing-event frontend actions now use those boundaries. The complete supported recurrence-family matrix remains required.

Native deletion review tests reparse retained recurrence fields to verify the actual surviving set. They cover future and history-only scopes, moved original identities, COUNT exclusions without revival, RDATE before a distant anchor, floating device dates, active scope normalization and exact stop identity, durable task references, malformed live aliases, clock transitions and work exhaustion. SQLite cases verify non-mutating preparation, child-only metadata revisions, imported parameters, Music and Focus settings, source history outside the selection, and changed evidence after a captured snapshot. This review evidence also binds semantic deletion in the owner transaction. Atomic deletion, complete Undo, visible projection and retry regressions are described below.

Native draft preparation tests cover omitted versus cleared fields, equivalent recurrence rules and legacy termination, moved selected geometry, explicit gaps and later folds, strict floating endpoints, active recorded starts, historical protection after clock correction, and recurrence creation on an active standalone. Adapter cases reject client execution evidence, raw derived fields, duplicate metadata and child identities, invalid JSON shapes and geographic coordinates, duplicate Music phases and incorrect provenance, and oversized payloads. SQLite tests establish non-mutating preparation over durable run identity and implicit Focus removal for floating conversion. These cases do not yet establish full draft projection or Save parity.

Native concrete-plan tests decode the planned recurrence fields through the canonical engine and compare affected dates and instants. They cover all scopes, collapse survivors, no-op protected views, standalone scope normalization, protected prefixes and isolated history, exact active transfer targets, advanced unchanged recurrence sets, off-pattern RDATE reanchoring and remaining COUNT, moved override provenance, multi-day intervals, later folds, floating termination dates, and changed rules that would activate malformed overrides. SQLite preparation also verifies that persisted history outside the selected occurrence produces preservation targets without changing stored execution references. The semantic Save tests now exercise complete captured metadata persistence; visible preview/commit parity remains unfinished.

Native metadata tests cover child-only source revision changes, independent imported envelopes and timezone trees, unknown parameters and nested values, attendee and alarm provenance, copying into another calendar, task-link project constraints, source deletion after copying, malformed graph rejection, non-finite imported numbers, shared byte limits, and injected rollback after earlier rows were inserted. Existing detach/split tests exercise the connected metadata copy path. Semantic Save integration tests additionally cover retained override rows and imported provenance, canonical expansion after a split, explicit clears with omitted configuration, unchanged master and selected-override metadata, child-only stale reviews, protection changes after review, command-identity conflicts, replay after source removal, aggregate fanout bounds, and rollback after a late child insert fails. Active Focus failure injection verifies that Calendar writes, reference changes, execution revisions, and receipts commit or roll back together. Closed-run materialization keeps physical segment history unchanged while the read projection follows the current Calendar reference.

Core Focus retarget tests cover restart, exact run and revision checks, manual pause preservation, subminute progress during rhythm changes, configuration removal, expired-run rejection, active-segment write failure, and different home-zone and device-day dates. The native Focus context test verifies qualified recurring occurrence ownership despite an overlapping event with an earlier end. Native active timing rejects retroactive removal of already accepted elapsed execution.

Preview cases cover detach, split, whole-series update, no-op scopes, retained protected history, floating conversion and Focus removal, identical geometry belonging to different identities, ongoing untracked edits, and out-of-window contours. Core history tests keep exact anchor, later occurrence, and retargeted identities separate when device dates differ, and admit a visible occurrence despite more than 10,000 unrelated historical segments. Frontend boundary tests reject mismatched reviews and invisible identities, preserve retry requests, and send only actual editor changes with native recurrence provenance and explicit input zones.

Controller tests verify one active preview with one coalesced latest draft, late replies after session or same-vault generation changes, and no Save using an older in-flight review. They distinguish native rejected and unknown outcomes, retain exact requests after lost replies and panel close, prevent retry against another vault, renew review after confirmed rejection, and reuse a confirmed receipt after visible-window refresh fails. Presentation tests reject old contours before the next update effect, retain unrelated source families, and freeze the displayed projection. Save-controller tests cover confirmations that outlive their selected editor, failed End now responses, explicit native Enable Focus, failed refreshes, and late completion after another editor opens. Store tests verify acceptance invalidates cached windows and publishes to other windows even when the next read fails.

Compound current-event tests cover a native End now cutoff that changes between preview and acceptance, invalid caller cutoffs, unchanged starts, expired/future rejection, exact run completion and pause closure, and rollback when completion evidence or the final receipt fails. Enable Focus cases cover configuration and explicit start in one transaction, failure during phase insertion, rejection of another active run, and retry without duplicate execution. Earlier closed history remains immutable when its ongoing Calendar occurrence detaches; a backwards clock cannot shorten the event before recorded completion.

The semantic endpoints drive existing-event previews, panel Save, End now, Enable Focus, immediate drag saves, new panel creation, and Project bulk scheduling on desktop and Android. The superseded TypeScript edit planner/executor, native raw recurrence batch endpoint, and lower-level mutation interfaces have been removed. Native fixtures cover imported override export preservation and preview/commit comparisons. The visible preview/Save matrix and physical platform checks remain required.

Read-only receipt tests confirm retry after source removal and process-generation changes without writes, reject changed intent, leave absent requests unexecuted, and retain unknown outcomes for oversized, malformed, or unavailable receipt reads. The database registry separately verifies that read-only file connections cannot write or be reused as writable pools. Frontend tests retain the same request when Focus context disappears, use the validated active-vault identity for retry, and reject a different active vault. Physical handoff acceptance must additionally exercise a lost reply followed by confirmation on the read-only source device.

Rail history boundary tests validate native phases, statuses, dates, nullable pause endings, exact occurrence ownership, duplicate segments, UTF-8 identity limits, and aggregate row/pause budgets. Controller tests verify visible unavailability without blocking navigation, successful retry after a failed read, malformed-response rejection, and stale failure suppression. Physical acceptance should additionally confirm the localized notice and shorter-range navigation with a legitimately oversized history.

## Required scenario matrix

Creation tests compare the complete native preview family and slim child projection with the committed native window. They cover canonical rules, untitled events, coincident sources, description sanitization, explicit gap labels, later-fold instants, separate input and home zones, and inclusive floating ranges. Receipt tests cover time advancing between preview and Save, source removal and process-generation changes, changed-intent rejection, malformed command shapes, invalid references, and injected child-write failure followed by rollback and the same request retry. Frontend boundary tests verify native creation identities, complete contours, immediate authored-card feedback, native family rendering, overlap preservation, and immutable lost-response recovery. Physical acceptance must also exercise creation, recurring draft dragging, and lost-response retry in the real desktop and Android editor.

Project scheduling tests cover atomic event, task date, link, history, Focus configuration and receipt writes; a late link failure followed by full rollback and same-command retry; stale, archived, foreign, duplicate and excessive selections; custom idle and copied soundtrack snapshots; changed project defaults and soundtrack reviews; preserved completion and existing due dates; elapsed intervals across DST gaps and folds; and inclusive all-day scheduling. The frontend validates the complete native task/event association and retains one exact command across a lost response, view remount, or failed cache refresh. Real desktop and Android acceptance must schedule a batch with custom Focus and phase playlists, retry after an interrupted response, and confirm the same events and task history after restart.

Each scenario is tested for the template's first occurrence and a generated occurrence where both are valid:

| Draft operation | Scope | Required result |
| --- | --- | --- |
| Non-recurring event gains repeat | No scope selector | Existing row becomes the first template occurrence and keeps its identity. |
| Fields change, recurrence unchanged | Only this | Selected occurrence detaches; source series continues with one exception. |
| Recurrence changes | Only this | Selected occurrence becomes an independent recurring template. |
| Fields or recurrence change | Following | Old template caps before selection and new template starts at selection. |
| Repeat clears | Following | Old template caps and one standalone survivor remains. |
| Recurrence changes, no protected history | All | Template may update directly. |
| Recurrence changes with protected history | All | Historical template remains unchanged through the boundary; mutable template carries the new rule. |
| Repeat clears with protected history | All | Protected history remains and selected mutable occurrence becomes the sole survivor. |

## Protection scenarios

Tests must cover:

- Adding an exception for started, tracked, overridden, active, and future untracked occurrences.
- Moving an end date before protected occurrences.
- Reducing count below protected occurrences.
- Changing a rule so protected dates no longer match.
- Time shifts that would otherwise disconnect event geometry from recorded segments.
- Same-day occurrences on both sides of the captured edit time.
- Exceptions that must transfer across a following split.
- Unsupported or malformed imported rules that cannot be enumerated safely.

## Active-session scenarios

- Adding recurrence to an active non-recurring event retains the base identity.
- Editing the selected active occurrence forces `Only this` and protects its start.
- A following edit across a later active occurrence materializes it unchanged before splitting.
- An all edit from another occurrence leaves the active protected occurrence unchanged.
- Run and segment transfer rolls back with the Calendar transaction on failure.

## Delete and archive scenarios

Native persistence cases cover complete archive and preimage round trips, opaque archive identity for the explicit source anchor, moved override metadata, current Focus aliases that differ from original execution identity, task and Music version preservation, independent imported values, duplicate archive conflicts, and rollback after late archive or receipt failure. Aggregate archive fanout fails before copying or writing rows. Floating cases use native civil dates on both sides of the UTC date boundary and retain inclusive end dates. Calendar removal must retain archived imported envelopes and components despite source-calendar cascades.

Native Undo cases compare the complete original metadata revision, preserve stopped execution and suppression after Calendar observation, release unused archive copies, reject recreated sources and changed shared import graphs, and roll back restoration and cleanup after a late receipt failure. A hard-deleted future source keeps its preimage only in process memory; its receipt contains no recoverable event payload. Owner tests check monotonic expiry, sleep and clock rollback, scoped dismissal, exact vault/generation/preimage fencing and readable accepted-deletion confirmation. Visible deletion projection is compared with persisted windows across removed and retained families, three scopes, started selections and moved identities. Frontend tests cover confirmation races, unknown-outcome retries and refresh recovery across remounts, remaining availability, changed selection, unmounted views and explicit Undo failure. Actual five-second toast, desktop sleep and Android lifecycle behavior remain real platform acceptance.

- Only the selected future untracked occurrence hard deletes.
- Protected selected occurrences archive.
- Following from a started occurrence affects started history without deleting later mutable occurrences.
- Following from a future occurrence preserves protected history and removes the mutable future chain.
- All on a future-only untracked series can delete the template.
- All with protected history preserves the historical side and removes only the intended mutable side.
- Undo restores the complete prior recurrence structure and does not restart Pomodoro history.

## Manual acceptance

For representative daily, weekly, monthly, and advanced rules:

1. Open an occurrence and change scope without editing fields. Verify only the affected contour changes.
2. Edit fields, clear and restore repeat, and move between all scopes. Verify the same draft is retained.
3. Save and confirm the immediate view matches a restart and fresh window load.
4. Repeat with started history and an active occurrence elsewhere in the series.
5. Trigger a persistence failure and confirm no partial structure or stale preview remains.

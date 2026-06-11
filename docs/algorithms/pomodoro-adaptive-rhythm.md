# Adaptive Pomodoro rhythm

Ganbaru AI's long-term Pomodoro direction is personalized adaptive scheduling. The app should learn which focus and break rhythms help a specific user make durable progress, while preserving recovery, happiness, and user trust.

This doc covers the optimization framing, data requirements, experimentation model, and UX guardrails for Adaptive Pomodoro. User-facing rhythm controls live in `features/pomodoro.md`. Plan derivation and segment persistence live in `algorithms/pomodoro-segments-and-plan.md`. Current storage fields are documented in `data/schema.md`.

## Product thesis

The target is not "maximize focus minutes at any cost." The target is a constrained personal optimization problem:

> Maximize useful progress, subject to recovery, happiness, sustainability, and trust constraints.

This means a rhythm that increases focus time but worsens evening mood, causes skipped breaks, or increases next-day avoidance is not a better rhythm. Recovery is not a bonus metric; it is part of the objective.

The first implementation step was deterministic customization:

- Long break after N focus periods.
- Repeating break sequences, such as short, short, long or short, long.
- Optional per-position focus and break durations.

Only after those choices are representable can the app choose or test alternatives safely.

## Evidence ladder

Adaptive behavior should ship in stages. Each stage depends on trustworthy data from the previous one.

1. **Manual custom rhythms.** The user can define and run custom count-based or sequence-based rhythms. No optimization is attempted.
2. **Instrumentation.** Runs snapshot the exact rhythm, policy, decision source, context, and data quality. Events record skips, extensions, idle pauses, focus failures, reconfiguration, and adaptive changes.
3. **Opt-in Adaptive mode.** Selecting Adaptive lets the app choose future phase durations or rhythm variants within bounded local rules. The app does not ask for approval on every change.
4. **Descriptive analytics.** A later analytics surface explains patterns, progress, relapses, and adaptive decisions without interrupting the timer loop.
5. **Local experimentation.** Safe micro-experiments run only when enough comparable context exists and guardrails allow the candidate change.

Skipping instrumentation would create noisy data and low trust. Adaptive can run behind the scenes only when every decision remains bounded, local, reversible, and auditable.

## Current implementation state

Adaptive currently has the first local controller path:

- Recent Pomodoro segments, rhythm positions, pauses, run events, doomscrolling block events, and recent adaptive context states are loaded before a fresh Adaptive session starts.
- The TypeScript policy extracts features, including late-position focus failures, early-vs-late focus blocker timing, repeated blocked-source attempts, early-vs-late focus idle timing, break-overtime blocker pressure, early-vs-late `go_to_break_now` timing, whether early break endings are followed by successful or failed focus, and whether skipped breaks are followed by successful or failed focus. It scores hidden state and chooses an effective count rhythm within bounded focus, short break, long break, and cadence limits.
- The selected fresh-session rhythm is used for segment planning and persisted with context, feature rows, data quality flags, reason codes, state scores, and selected values. Prior hidden state is blended only when its context key exactly matches the new decision context.
- When the run-start policy sees clean momentum, enough comparable history, and low strain, recovery debt, and avoidance pressure, it can deterministically assign the run to a bounded focus-duration experiment: 40 minute control or 45 minute capacity-growth treatment. When the policy sees low-risk short-break drift, it can assign the run to a bounded short-break-duration experiment: 5 minute control or 7 minute treatment. When the policy sees clean long-break drift without blocker pressure, it can assign the run to a bounded long-break-duration experiment: 10 minute control or 15 minute treatment. When the policy sees mild late-cycle recovery pressure, it can assign the run to a bounded long-break-cadence experiment: C4 control or C3 treatment. When the policy sees very clean high-momentum work, it can assign the run to a bounded cadence-expansion experiment: C4 control or C5 treatment. When the policy sees high-confidence clean momentum with stable completed focus and break history, it can assign the run to a bounded focus-with-short-break rhythm-bundle experiment: 40/5/10/C4 control or 45/7/10/C4 treatment. When the policy sees clean long-break drift with enough stable completed focus and break history, it can assign the run to a bounded long-recovery rhythm-bundle experiment: 40/5/15/C4 control or 40/5/15/C3 treatment. The assignment seed, experiment, variant, decision, and later outcomes are all persisted locally.
- Recent assignment history is loaded with adaptive history. If a comparable context already has two experiment assignments in the last seven days, run-start assignment is suppressed for that context. The latest recent assignment also defines the active experiment lane for that context, so the selector keeps collecting evidence for the same parameter instead of silently switching to a different duration or cadence experiment inside the same seven-day window. This keeps silent exploration bounded even when multiple parameter-specific experiments are eligible. Rhythm-bundle assignment is also suppressed when one of its scalar components has an abandoned cooldown or current evidence prefers control, so a combined treatment cannot keep exploring a 7 minute short break or C3 cadence that has already failed as a component.
- Assignment-linked outcomes are aggregated back into adaptive history by experiment, variant, and coarse context key. The TypeScript experiment analyzer uses exact-context evidence once both arms have enough observations. Sparse but paired context evidence first borrows a small discounted prior from neighboring contexts with similar time-of-day, session-position, event-length, workload, energy, and matching environment buckets. If neighboring context evidence is still insufficient, the analyzer can borrow the same small discounted prior from broader non-context evidence before falling back to global evidence. Shared statistics helpers estimate binary rates with Wilson intervals, aggregate numeric means from sums and square sums, compare conservative treatment improvements, and evaluate guardrails with conservative harm plus severe point-harm safety stops. Numeric primary outcomes and guardrails include clean focus, blocker pressure, skipped breaks, short-break overtime, long-break overtime, same-day missed planned blocks, and same-day blocker pressure. The focus-duration analysis checks completion, stop-rate, run blocker pressure, same-day missed planned blocks, same-day blocker pressure, and next-day-start guardrails, and can stop assigning once the treatment is clearly preferred or force the run-start decision back to the 40 minute control when guardrails fail. The short-break analysis uses short-break overtime as the primary outcome while applying the same completion, blocker, missed-work, skipped-break, and next-day guardrails; if 7 minute breaks increase drift or risk, the policy reverts to the 5 minute control. The long-break analysis uses long-break overtime as the primary outcome with the same guardrails; if 15 minute long breaks increase drift, skipped breaks, blocker pressure, missed planned work, or next-day avoidance, the policy reverts to the 10 minute control. The C3 cadence analysis uses reduced blocker pressure or conservative completion improvement as primary evidence while preserving clean focus, completion, next-day return, and day-level guardrails; if C3 increases drift, skipped breaks, blocker pressure, missed planned work, clean-focus loss, or next-day avoidance, the policy reverts to C4. The C5 cadence-expansion analysis uses clean-focus gain as primary evidence while preserving completion, blocker pressure, skipped-break behavior, long-break return, same-day planned-work completion, and next-day return; if C5 increases blockers, skipped breaks, missed planned work, long-break drift, or next-day avoidance, the policy reverts to C4. The focus-with-short-break rhythm-bundle analysis compares 40/5/10/C4 with 45/7/10/C4, using clean-focus gain as primary evidence while guarding completion, stop-rate, blocker pressure, skipped breaks, short-break drift, missed planned work, and next-day return. The long-recovery rhythm-bundle analysis compares 40/5/15/C4 with 40/5/15/C3, using reduced blocker pressure, reduced long-break drift, or conservative completion improvement as primary evidence while guarding clean focus, completion, stop-rate, blocker pressure, skipped breaks, long-break drift, missed planned work, and next-day return. Terminal experiment status is persisted with `ended_at` as `completed` when treatment wins and `abandoned` when guardrails force control. A terminal result creates a 14-day cooldown for that experiment; abandoned cooldowns also hold the control rhythm instead of allowing immediate repeat exploration.
- Focus-start and break-start boundaries can run the same bounded policy before the next segment starts. The chosen rhythm is written with the started segment in one backend transaction.
- Adaptive run starts capture a day-level snapshot of the visible planned Pomodoro blocks for that date from the scheduler's expanded event window. This includes recurring occurrences as stable synthetic event ids, so later calendar edits do not rewrite missed planned-work evidence. Closed Adaptive runs write run-window outcomes, phase outcomes for adaptive segment decisions, matured same-day outcomes for older run-start decisions after that day has passed, and matured next-day outcomes after the following day has passed. They also update the current context state plus append-only context-state history.
- The backend can load a bounded replay dataset from persisted run-start adaptive decisions, reconstructing the previous count rhythm, selected count rhythm, optional replay candidate id, run timing, run-window outcome rows, and the bounded pre-decision history available at each original decision time. The frontend adaptive module includes pure run-start replay helpers for offline policy checks. They rerun synthetic or loaded opportunities through the current policy, summarize decision modes, reasons, assignments, and changed rhythm values, build bounded multi-parameter run-start policy candidates, convert persisted run-window outcome rows into scored observed outcomes, join observed outcomes, score guardrail burden, score actual observed outcomes by persisted candidate id, compare candidate policies globally, report candidate scores by comparable context, compare multi-parameter candidates against generated single-parameter component candidates, and run an end-to-end candidate workflow that classifies candidates as usable, unsafe, or inconclusive from minimum context evidence, maximum guardrail burden, direct live-use candidate outcomes, and interaction evidence without touching persistence. Bounded replay candidates can adjust focus, short break, long break, and long-break cadence together, but they preserve fallback, guardrail, and recovery decisions unchanged. The default offline catalog currently includes focus growth with short-break support, long-recovery support, and capacity cadence growth candidates. A pure selector can choose the strongest usable candidate only after the gated workflow has marked candidates usable, ranking by guardrail burden, matched evidence, clean focus, completion, blocker pressure, skipped breaks, and break overtime. Counterfactual policy outcome scoring only attributes an observed result to a candidate policy when the candidate selected the same rhythm that produced the logged outcome; candidate-id scoring separately reports outcomes from runs that actually used a candidate. Once enough direct live-use outcomes exist for a replay candidate, excessive guardrail burden suppresses that candidate even if its counterfactual replay gate still passes; sparse direct candidate evidence remains diagnostic and non-blocking. Once enough matched component evidence exists for a multi-parameter candidate, the workflow marks the combination unsafe if it has materially higher guardrail burden, lower clean-focus ratio, or lower completion than its strongest single-parameter component.
- Fresh Adaptive run starts now load a small bounded replay dataset after the normal policy decision. If the default multi-parameter candidate catalog has a usable candidate for the current comparable context, and direct live-use candidate outcomes do not suppress it, the run-start decision can use that candidate's selected rhythm and persists the candidate id with the adaptive decision. If replay loading fails, evidence is insufficient, the current context is missing, the candidate has enough harmful direct outcome evidence, or the candidate would override fallback, guardrail, or recovery behavior, the original policy decision is kept.
- If there is no usable history or confidence is too low, the policy records fallback and keeps the 40/5/10/C4 baseline.
- Repeated focus failures at rhythm position 3 or later are treated as late-session recovery evidence. Blocked-site pressure is also split by timing inside a focus segment: early-focus attempts primarily contribute to avoidance pressure, while attempts that cluster near the end of focus can become recovery evidence. The current policy responds to late focus collapse by bringing the long break forward and lengthening it, without automatically shrinking focus duration unless broader strain or recovery-debt guardrails also fire.
- Repeated attempts against the same blocked source increase avoidance pressure. If focus remains clean and recovery risk is low, the policy holds the rhythm and records repeated blocked-source pressure instead of shortening work.
- Focus idle pauses are split by timing inside focus. Repeated early idle under strain can shorten future focus, while repeated late idle under recovery debt can shorten future focus. A single idle pause does not rewrite the rhythm.
- Manual `go_to_break_now` events are split by focus timing. Repeated early exits under strain shorten future focus, while repeated late exits under recovery debt also shorten future focus. A single early exit does not rewrite the rhythm. When older or incomplete history lacks the explicit event, early completed focus followed by a break is treated as fallback evidence for the same signal.
- Early break endings are not treated as positive by default. They add readiness only when the following focus completes; if the following focus fails, they increase recovery debt and strain. Explicit `start_focus_now` events are preferred, with early-ended break timing used as fallback evidence.
- Short-break return drift only explores longer breaks when the drift is not paired with blocked-site pressure after the planned break end. If blocked attempts happen during break overtime, the policy records break-transition pressure and holds the short-break duration instead of rewarding drift.
- Long-break return drift can explore a 15 minute long break only when the drift is clean and recovery risk is otherwise low. Blocker pressure during long-break overtime blocks that experiment path.
- Skipped breaks are classified by the next focus outcome. If skipped recovery is followed by failed focus, the policy records skipped-break recovery evidence and protects long recovery by bringing the long break forward and lengthening it.

Still pending: broader statistical models beyond the current focus-duration, short-break-duration, long-break-duration, C3 cadence, C5 cadence-expansion, and initial rhythm-bundle experiments, plus analytics.

## Decision variables

The adaptive engine can eventually choose among these Pomodoro variables:

| Variable | Examples | Notes |
|----------|----------|-------|
| Focus duration | 25, 35, 40, 50 minutes | Should normally change only for future focus phases. |
| Break sequence | short, short, long or short, long | Defines which break is owed after each focus position. |
| Short break duration | 3, 5, 7, 10 minutes | Can be personalized by context. |
| Long break duration | 10, 15, 20, 30 minutes | Should protect recovery after accumulated focus. |
| Per-position durations | focus 40, focus 35, focus 25 | Useful for tapering effort during long sessions. |
| Idle threshold | 2, 3, 5, 10 minutes | Should be treated carefully because it changes measurement, not only behavior. |
| Break controls | extension cap, early-end friction | These affect adherence and should not be mixed casually with duration experiments. |

The first adaptive scope should be smaller: focus duration, break duration, and long break cadence. Wider parameters can wait until the app has enough stable history.

## Outcome signals

The app should combine objective behavioral signals with optional lightweight subjective signals.

Objective signals:

- Completed focus time, excluding manual, idle, and suspend pauses.
- Task progress, when a session block is linked to tasks.
- Break adherence: whether the user returned, skipped, extended, drifted into overtime, and whether skipping recovery led to successful or failed focus.
- Focus failures, idle pauses and their focus timing, manual pauses, and manual break-now actions.
- Doomscrolling blocker events during focus and break periods, including whether focus-phase attempts cluster near the start or near the end.
- Session starts, stops, restarts, and missed calendar blocks.
- Recent workload: focus already completed today and in recent days.
- Calendar pressure: remaining time, back-to-back events, deadline proximity.

Optional subjective signals:

- Morning diary mood, energy, and sleep.
- Evening diary mood, reflection, and perceived sustainability.
- Post-session satisfaction, effort, or usefulness rating.

Subjective prompts must stay sparse. A rating that interrupts every session will corrupt the product experience and reduce data quality.

## Context and confounders

Pomodoro outcomes are not randomized by default. The user may choose long focus sessions on days when they already feel strong, or short sessions when a task is ambiguous and unpleasant. The app must treat these confounders as first-class modeling context:

- Time of day and day of week.
- Sleep, mood, and energy.
- Project, task type, task difficulty, and task ambiguity.
- Planned event length and whether the session is first, middle, or late in the day.
- Recent focus load and recent missed sessions.
- Work environment, music source, and blocker configuration.
- Deadline pressure and meeting density.

The model should prefer simple, robust comparisons over high-dimensional overfitting. One user's local history is valuable, but sparse. A small number of coarse context buckets is more defensible than a large model that finds patterns by chance.

## Experimentation rules

Choosing Adaptive is consent for bounded local tuning and safe exploration. The app should not prompt for every rhythm change because prompts would create friction and distort behavior.

- Experiments change one or two variables at a time.
- Assignment happens at a session boundary or phase boundary, not mid-focus.
- Candidate values stay inside product guardrails and future user-pinned bounds.
- The app keeps an exploration budget so it does not constantly perturb a working rhythm.
- A comparable context should not interleave different run-start experiments inside the same short window. Continue the latest assigned experiment until the budget or cooldown stops it, then let a later window test another parameter.
- Comparisons should use similar contexts when practical, such as morning deep work against other morning deep work.
- The app records whether a setting was user-chosen, selected by policy, or assigned by an experiment.
- The user can leave Adaptive, pause experimentation, or pin a rhythm.

The first experiment engine can be simple A/B comparison. Later, a local contextual bandit can choose among rhythm variants, but only if the app can explain the decision in product language through diagnostics or analytics. Black-box tuning that cannot answer "why did the rhythm change?" is not acceptable.

The first implemented experiment is intentionally narrow: run-level focus duration at 40 vs 45 minutes. It is eligible only when the deterministic policy already wants capacity growth and current risk scores are low. Recovery, guardrail, low-confidence, blocker-pressure, and break-drift contexts do not enter this experiment. Result analysis is also narrow: below the minimum observed runs per variant, the result is inconclusive; treatment can win only with a clean-focus gain and preserved completion and next-day behavior; control wins immediately when treatment breaches guardrails.

The second implemented experiment tests short-break duration at 5 vs 7 minutes. It is eligible only when the deterministic policy already sees low-risk short-break return drift. The treatment wins only if it materially reduces short-break overtime while preserving completion, blocker pressure, skipped-break behavior, same-day planned-work completion, and next-day return. If the longer break increases drift, skipped breaks, blocker pressure, missed planned work, or next-day avoidance, control wins and the experiment cools down.

The third implemented experiment tests long-break duration at 10 vs 15 minutes. It is eligible only when the deterministic policy already sees clean long-break return drift, the user is not showing broader strain or avoidance pressure, and no blocked attempt happened during long-break overtime. The treatment wins only if it materially reduces long-break overtime while preserving completion, blocker pressure, skipped-break behavior, same-day planned-work completion, and next-day return. If the longer long break increases drift, skipped breaks, blocker pressure, missed planned work, or next-day avoidance, control wins and the experiment cools down.

The fourth implemented experiment tests long-break cadence at C4 vs C3. It is eligible only when the deterministic policy already sees mild late-cycle recovery pressure, such as a single late-position focus failure or late-focus blocker pressure after multiple focus positions, without broader high strain, high recovery debt, or high avoidance pressure. The treatment wins only if earlier long recovery reduces blocker pressure or improves completion while preserving clean focus, completion, same-day planned-work completion, and next-day return. If C3 increases skips, blocker pressure, missed planned work, clean-focus loss, or next-day avoidance, control wins and the experiment cools down.

The fifth implemented experiment tests long-break cadence expansion at C4 vs C5. It is eligible only when the deterministic policy sees very clean high-momentum work: at least 12 completed focus periods, completed breaks, no skipped breaks, no blocked attempts, no break drift, no focus failures, enough comparable history, and low strain, recovery debt, and avoidance pressure. The treatment wins only if delayed long recovery materially increases clean focus while preserving completion, blocker pressure, skipped-break behavior, long-break return, same-day planned-work completion, and next-day return. If C5 increases blockers, skipped breaks, missed planned work, long-break drift, or next-day avoidance, control wins and the experiment cools down.

The sixth implemented experiment tests a small rhythm bundle at 40/5/10/C4 vs 45/7/10/C4. It is eligible only when clean momentum is already strong enough for capacity growth, short-break return behavior is stable, completed focus and break history are both high, comparable history is available, and strain, recovery debt, and avoidance pressure are low. The treatment wins only if the longer focus with short-break support materially increases clean focus while preserving completion, stop-rate, blocker pressure, skipped-break behavior, short-break return, same-day planned-work completion, and next-day return. If the paired change increases drift, blockers, skipped breaks, missed planned work, or next-day avoidance, control wins and the experiment cools down.

The seventh implemented experiment tests a long-recovery support bundle at 40/5/15/C4 vs 40/5/15/C3. It is eligible only when the deterministic policy already sees clean long-break drift, completed focus and break history are both stable, comparable history is available, no blocked attempt happened during long-break overtime, and strain, recovery debt, and avoidance pressure are low. The treatment wins only if earlier 15 minute long recovery reduces blocker pressure, reduces long-break drift, or improves completion while preserving clean focus, completion, stop-rate, skipped-break behavior, same-day planned-work completion, and next-day return. If C3 inside the 15 minute long-break rhythm increases skipped breaks, blocker pressure, missed planned work, clean-focus loss, long-break drift, or next-day avoidance, control wins and the experiment cools down. A harmful result blocks only the combined 15 minute plus C3 shape; it does not automatically mark 15 minute long breaks harmful by themselves.

## Adaptive decision examples

Good decisions are narrow and tied to observable behavior:

- Long break after 3 focus periods for deep work when focus failure rate rises after the third period.
- 7 minute short breaks when the user repeatedly returns late from 5 minute breaks without blocker pressure.
- 15 minute long breaks when the user returns late from 10 minute long breaks without blocker pressure and later focus remains healthy.
- 35 minute focus periods on low-energy mornings when similar sessions complete better at that length.

Bad decisions overclaim causality or optimize the wrong target:

- "You are 18% more productive with 50 minute focus periods" when the sample is small or confounded.
- "Skip long breaks to finish faster" when skipped breaks correlate with worse return rates or lower evening mood.
- Changing focus or break lengths without a persisted reason, selected value, previous value, context snapshot, and undo path.

## UX guardrails

The default UI should remain simple:

- Preset selector.
- Focus duration.
- Short break duration.
- Long break duration.
- Long break after N focus periods.

Advanced custom rhythm editing should be opt-in and visual. A compact sequence editor is better than a table of parameters:

```text
Focus 40 -> short 5 -> focus 40 -> short 5 -> focus 40 -> long 15
```

Adaptive mode must be explicit. Once selected, it should run quietly: no recurring approval dialogs, no mid-focus surprise shortening, and no visible explanations in the normal timer path. Later analytics can show active bounds, recent changes, reasons, uncertainty, and a clear way to return to manual control.

## Data requirements

Future rhythm storage must preserve analysis integrity:

- Every run snapshots the rhythm and adaptive policy active at start.
- Every segment stores planned timestamps chosen for that phase.
- Every adaptive decision writes previous value, selected value, decision source, reason code, context, state scores, and data quality.
- Phase outcomes attach to the decision that started the segment. Run outcomes attach to the run-start decision. Same-day outcomes attach to the run-start decision after that day has passed. Next-day outcomes are filled only after the following calendar day has passed.
- Run events should store bounded reason codes and IDs, not raw diary text.
- Older simple count-based configs must migrate to an equivalent explicit break plan.

The data model should keep decisions and outcomes separate. A decision says what the app selected. A later run or segment says what happened. Mixing them would make causal analysis harder.

## Non-goals

- No global telemetry or cross-user model training.
- No cloud optimization service.
- No unbounded or unauditable manipulation of breaks or focus duration.
- No automatic tuning before enough local history exists.
- No optimizing raw focus time while ignoring recovery and happiness.

## Open design questions

- Which task categories and difficulty fields should become first-class context?
- Which sparse subjective fields are worth collecting through diary or optional review surfaces?
- What minimum sample size is required before analytics can use confident language?
- Which adaptive parameters should be allowed during a running calendar session, and which should wait for the next session?
- How should analytics surface uncertainty without overwhelming non-technical users?

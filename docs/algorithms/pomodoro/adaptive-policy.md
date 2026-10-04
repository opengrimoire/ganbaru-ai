# Adaptive Pomodoro policy

Adaptive Pomodoro is a local, explicit opt-in policy that adjusts bounded rhythm choices using the user's own history. Its goal is sustainable completed focus, not maximum timer length. It must not diagnose health, punish missed work, or turn noisy behavior into confident advice.

The policy is deterministic from persisted inputs, versioned, auditable, reversible, and applied only at safe run or phase boundaries.

**Implementation status: Native authority implemented, final acceptance pending.** The Rust core owns the feature/state policy, all seven experiment lanes, bounded replay candidate approval, snapshot construction, and transactional run/phase decisions. The desktop and Android native owner invokes that service; Svelte displays accepted state and sends commands. Shared golden fixtures compare complete decisions and replay workflows across three device timezones and preserve the existing snapshot schema. Failure and retry tests cover accepted execution, experiment exposure, restart, atomic rollback, and harmful actual candidate exposure. Broader integration gates and physical platform acceptance remain required.

## Objective

The policy balances:

- clean completed focus;
- completion and stop behavior;
- break return and skip behavior;
- blocker or doomscrolling pressure;
- planned-work completion;
- next-day willingness to return;
- uncertainty and limited sample size.

More focus seconds are not automatically better. A treatment that increases one session but increases stops, avoidance, missed blocks, or harmful break drift must not be preferred.

## Scope and consent

Adaptive analysis runs locally against the active vault. It does not upload behavioral history or require a cloud model. Enabling ordinary Pomodoro does not enable experimentation.

The user chooses the adaptive preset or equivalent explicit control. Custom rhythms remain user-authored unless the user deliberately enters adaptive mode. Leaving adaptive mode stops new assignments without rewriting historical decisions or outcomes.

The product explains that adaptation is experimental assistance based on local behavior. It does not present inferred energy, strain, recovery need, or avoidance as a medical fact.

## Decision boundaries

Adaptation may occur:

- at run start, before the run snapshot and experiment assignment commit;
- at a phase boundary, before the next segment starts;
- after an explicit reconfiguration request, through the normal reconfiguration transaction.

It never silently changes the duration of an already running phase. Once a segment starts, its selected duration and planned boundary remain persisted facts.

Decision, assignment, and new run or segment state commit together. A crash cannot leave an unexplained selected duration.

The initial run rhythm remains an immutable start snapshot. Later accepted boundary choices are separate persisted decisions. Recovery reads the latest accepted run-start or phase-start decision rather than rewriting the initial rhythm or silently reverting to it when accepted values are missing.

## Replay approval

Native run-start decisions can evaluate the established bounded candidate catalog against at most 50 historical opportunities. The opportunity inputs, historical evidence, observed outcomes, and current decision share the accepted transition's SQLite snapshot. Device-local timezone facts are resolved natively for both current and historical opportunities.

Replay attributes an observed outcome to a candidate only when its selected rhythm matches the rhythm actually observed. Comparable contexts require sufficient matching outcomes and acceptable guardrail burden. Multi-parameter candidates are also compared with their individual component changes. Harmful actual candidate exposure or an antagonistic component comparison vetoes a candidate. Sparse direct exposure or component evidence remains inconclusive and does not independently overturn a passing context gate. Equal scores retain the established candidate order.

Replay never overrides recovery, fallback, or guardrail decisions under the default candidate configuration. An accepted candidate retains its identity and reason code in the same transaction as the new run. Historical evidence excludes segments completed, events recorded, and outcomes measured after its observation cutoff. Oversized evidence collections fail explicitly instead of being truncated into an apparently complete score.

Native input admission bounds SQL aggregation before grouping, in the same snapshot as the calculation. One history read admits at most 100,000 aggregate input rows. One replay read shares an allowance of 1,000,000 input rows across decision/value selection and every historical opportunity; each policy additionally admits at most 4,096 experiments. Indexed count probes stop at one excess row. A small number of result groups cannot hide an oversized input collection.

The work allowance includes later outcomes attached to selected assignments and later context snapshots for the selected policy when their index scan is required. Their values remain excluded from historical decisions. Exceeding an allowance reports an error and rolls back the attempted execution, revision, and receipt. It never substitutes an empty aggregate, truncates canonical evidence, or deletes history. A narrower diagnostic replay can be retried independently. Increasing an allowance requires measured work and memory evidence.

## Context

Policy context may include only validated, relevant local evidence, such as:

- coarse time of day;
- session position and recent completed focus;
- event length and remaining planned window;
- current rhythm and recent rhythm exposure;
- recent stops, focus failures, skipped breaks, and break overtime;
- blocker pressure during focus or break overtime;
- same-day missed planned blocks;
- next-day observed return;
- optional user-entered energy or work-environment category.

Context uses coarse categories where exact values would fragment evidence or expose unnecessary detail. Calendar titles, Notes content, Chat messages, keystrokes, camera data, and arbitrary application activity are not adaptive features.

Missing optional context remains unknown. It is not filled with a negative assumption.

## Stable policy states

The deterministic policy can choose among broad postures before experimentation:

### Recovery

Prefer a conservative or shorter established rhythm when recent evidence shows stops, focus failure, high blocker pressure, repeated missed planned work, unhealthy break drift, or weak return behavior. Recovery does not assign a capacity-expansion treatment.

### Maintain

Keep the current proven rhythm when evidence is mixed, sparse, or stable without a clear reason to explore. Uncertainty favors maintain.

### Capacity exploration

Consider a bounded treatment only when comparable history is sufficient, recent behavior is stable, completion is healthy, and strain, recovery debt, avoidance pressure, and relevant drift guardrails are low.

### Break support

Explore a longer break or earlier long-break cadence only for the corresponding clean return-drift pattern. Blocker pressure during overtime or broader avoidance blocks this path.

These states guide experiment eligibility. They do not directly prove that a treatment is beneficial.

## Evidence hierarchy

Analysis prefers the most comparable evidence that has enough observations in both arms:

1. Exact coarse context.
2. Paired neighboring contexts with similar session, time, event, workload, energy, and environment categories.
3. Broader non-context evidence for the same experiment.
4. Global experiment evidence.
5. Inconclusive when none is sufficient.

Neighboring and broader evidence is discounted. It provides a small prior, not a substitute for observing both variants in the relevant context.

Sparse evidence never produces a confident treatment win merely because its point estimate is positive.

## Assignment

An eligible run receives a deterministic assignment from a persisted seed, experiment identity, policy version, participant scope, and context. Assignment remains stable across retries and windows.

The policy balances exposure without making a provider or frontend random number generator authoritative. A command replay returns the existing assignment rather than creating another observation.

Control remains a real assigned variant. The analyzer does not compare treatment runs only with unrelated historical defaults.

## Outcomes

Assignment and outcome are separate durable records. Outcomes mature after enough time exists to observe relevant behavior.

Depending on the experiment, outcomes may include:

- clean focus seconds;
- phase and run completion;
- stop or focus-failure count;
- blocker pressure;
- skipped breaks;
- short-break or long-break overtime;
- same-day missed planned work;
- next-day observed return.

Unknown future outcomes remain absent rather than counted as failure. Recomputing aggregates does not rewrite original assignments or raw outcomes.

## Conservative analysis

Binary outcomes use conservative interval comparisons and severe point-harm stops. Numeric outcomes use counts, sums, and squared sums so noisy mean differences remain inconclusive until uncertainty is acceptably small.

A treatment wins only when its primary outcome improves meaningfully and every required guardrail remains acceptable. Control wins or exploration stops when a guardrail shows conservative harm or severe direct harm.

No result is equivalent to no evidence. Inconclusive analysis keeps or returns to control and waits for more eligible observations.

## Guardrails

Common guardrails include:

- completion does not materially decline;
- stop and focus-failure rates do not rise;
- blocker pressure does not rise;
- clean focus does not fall where it is a guardrail;
- skipped breaks and break drift do not worsen beyond experiment-specific limits;
- same-day planned work does not worsen;
- next-day return does not worsen.

An experiment may add stricter guardrails but may not omit a material known risk merely to reach a result sooner.

## Terminal state and cooldown

When evidence reaches a terminal result, the experiment records completed when treatment wins or abandoned when guardrails force control. It does not create another assignment merely to persist the terminal state.

Current policy applies a 14-day cooldown after terminal state. An abandoned experiment holds its control value during cooldown. A completed treatment remains bounded to its supported adaptive context and does not become a universal user preference.

Different experiment lanes retain independent results. Harm in a combined rhythm bundle does not automatically prove that every component is harmful by itself.

## Explainability

Every selected value retains:

- policy and experiment version;
- previous and selected value;
- control or treatment assignment;
- coarse context key;
- reason codes and posture;
- relevant state scores or guardrail inputs;
- assignment seed identity;
- later result and cooldown state.

User-facing explanation should summarize the main reason and uncertainty in plain language. It should not expose a giant feature vector or claim causation from correlation.

## Privacy and retention

Raw adaptive history stays in the vault and follows explicit product retention. Derived aggregates are rebuildable. Export or synchronization of detailed Pomodoro behavior is disabled by default and requires an explicit audience.

Do not infer sensitive traits from Notes, Chat, calendar titles, browsing history, or biometric data. Webcam-use suppression is an idle-detection input and is not retained as adaptive behavioral history.

## Policy versioning

A material change to eligibility, context bucketing, assignment, outcomes, statistics, guardrails, or terminal interpretation increments the policy or experiment version. Older decisions remain interpretable under the version that created them.

Do not bump a version for a source refactor that leaves semantics unchanged. Do not reinterpret old observations under a new outcome definition without an explicit migration or separate analysis version.

## Non-goals

Adaptive Pomodoro does not:

- maximize every focus interval;
- diagnose burnout, attention disorders, sleep, or mood;
- alter an active phase without explicit reconfiguration;
- use a cloud LLM to choose timer values;
- hide treatment assignment or history from the user;
- share detailed productivity behavior by default;
- override an explicit custom rhythm.

Current experiment lanes are specified in [Adaptive experiments](adaptive-experiments.md).

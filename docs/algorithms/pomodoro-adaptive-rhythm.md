# Adaptive Pomodoro rhythm

Ganbaru AI's long-term Pomodoro direction is personalized adaptive scheduling. The app should learn which focus and break rhythms help a specific user make durable progress, while preserving recovery, happiness, and user trust.

This doc covers the optimization framing, data requirements, experimentation model, and UX guardrails for future adaptive Pomodoro recommendations. User-facing rhythm controls live in `features/pomodoro.md`. Plan derivation and segment persistence live in `algorithms/pomodoro-segments-and-plan.md`. Current storage fields are documented in `data/schema.md`.

## Product thesis

The target is not "maximize focus minutes at any cost." The target is a constrained personal optimization problem:

> Maximize useful progress, subject to recovery, happiness, sustainability, and trust constraints.

This means a rhythm that increases focus time but worsens evening mood, causes skipped breaks, or increases next-day avoidance is not a better rhythm. Recovery is not a bonus metric; it is part of the objective.

The first implementation step is deterministic customization:

- Long break after N focus periods.
- Repeating break sequences, such as short, short, long or short, long.
- Optional per-position focus and break durations.

Only after those choices are representable can the app recommend or test alternatives.

## Evidence ladder

Adaptive behavior should ship in stages. Each stage depends on trustworthy data from the previous one.

1. **Manual custom rhythms.** The user can define and run custom count-based or sequence-based rhythms. No optimization is attempted.
2. **Instrumentation.** Runs snapshot the exact rhythm, decision source, and context. Events record skips, extensions, idle pauses, focus failures, reconfiguration, recommendations, and adaptive changes.
3. **Descriptive analytics.** The app explains patterns without changing behavior, for example "you often extend 5 minute breaks after the third focus period."
4. **Recommendations.** The app suggests bounded changes and explains the evidence. The user accepts, rejects, pins, or ignores them.
5. **Opt-in adaptive mode.** The app can choose future phase durations or rhythm variants within user-approved bounds. Experiments run only when enough comparable context exists.

Skipping straight to automatic tuning would create noisy data and low trust. The app should earn automation by showing useful explanations first.

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
- Break adherence: whether the user returned, skipped, extended, or drifted into overtime.
- Focus failures, idle pauses, and manual pauses.
- Doomscrolling blocker events during focus and break periods.
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

Controlled experiments are allowed only with explicit user consent.

- Experiments change one or two variables at a time.
- Assignment happens at a session boundary or phase boundary, not mid-focus.
- Candidate values stay inside user-approved bounds.
- The app keeps an exploration budget so it does not constantly perturb a working rhythm.
- Comparisons should use similar contexts when practical, such as morning deep work against other morning deep work.
- The app records whether a setting was user-chosen, recommended, or assigned by an experiment.
- The user can pause experiments, pin a rhythm, or reject a recommendation.

The first experiment engine can be simple A/B comparison. Later, a local contextual bandit can choose among rhythm variants, but only if the app can explain the decision in product language. Black-box tuning that cannot answer "why did you change my break?" is not acceptable.

## Recommendation examples

Good recommendations are narrow and tied to observable behavior:

- "Try a long break after 3 focus periods for deep work. Your focus failure rate rises after the third period."
- "Try a 7 minute short break. You extended 5 minute breaks in 6 of the last 8 similar sessions."
- "Try 35 minute focus periods on low-energy mornings. You complete more sessions at that length when morning energy is 2 or lower."

Bad recommendations overclaim causality or optimize the wrong target:

- "You are 18% more productive with 50 minute focus periods" when the sample is small or confounded.
- "Skip long breaks to finish faster" when skipped breaks correlate with worse return rates or lower evening mood.
- "Automatic mode changed your rhythm" without a visible explanation and undo path.

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

Adaptive recommendations should appear as suggestions with:

- The proposed change.
- The reason.
- The expected tradeoff.
- Accept, reject, pin current rhythm, and remind me later actions.

Automatic mode must be explicit. It should show active bounds, recent changes, and a clear way to return to manual control.

## Data requirements

Future rhythm storage must preserve analysis integrity:

- Every run snapshots the rhythm and adaptive policy active at start.
- Every segment stores planned timestamps chosen for that phase.
- Every adaptive decision writes an event with previous value, selected value, decision source, reason code, and user response.
- Run events should store bounded reason codes and IDs, not raw diary text.
- Older simple count-based configs must migrate to an equivalent explicit break plan.

The data model should keep decisions and outcomes separate. A recommendation event says what the app suggested. A later run or segment says what happened. Mixing them would make causal analysis harder.

## Non-goals

- No global telemetry or cross-user model training.
- No cloud optimization service.
- No hidden manipulation of breaks or focus duration.
- No automatic tuning before enough local history exists.
- No optimizing raw focus time while ignoring recovery and happiness.

## Open design questions

- Which task categories and difficulty fields should become first-class context?
- How often can the app ask for subjective feedback without becoming annoying?
- What minimum sample size is required before a recommendation can use confident language?
- Which adaptive parameters should be allowed during a running calendar session, and which should wait for the next session?
- How should the app surface uncertainty without overwhelming non-technical users?

# Performance benchmark harness

The benchmark harness is a dev-visible mechanism inside the app for taking deterministic, comparable performance measurements. It exists because the prior workflow (a human holding right-arrow for an imprecise ~2 seconds, then eyeballing a panel and copying a 250-line ring buffer) made cross-build comparisons unreliable. Two specific failure modes drove the design:

1. **GC timing dominates single-shot readings.** Identical state can read 478 MB right after an action and 263 MB after the app sits idle for five minutes. WebKit and V8 defer garbage collection aggressively, and a snapshot taken at one arbitrary moment captures whatever the collector has not yet released. Comparing builds across single-snapshot readings hides real wins under GC variance and invents fake ones.
2. **Boot timings need a controlled dataset.** Some predicted boot wins (slimmer SQL reads, fewer JSON parses) only show on inputs with rich heavy fields. The user's null-heavy 968-event Google Calendar import already had cheap parses, so a refactor with no measurable boot improvement on that dataset might still be a meaningful win on a different shape. Without a synthesized dataset under our control, every measurement run sits on whatever the user happened to import.

The harness solves both problems at once: it drives a deterministic stress sequence (no human pacing), samples memory across the full GC-decay window (so the steady-state floor is visible, not just an arbitrary slice), and seeds a fixed synthetic dataset alongside the real one (so cross-build comparisons control for input shape). The output is a compact markdown block of about twenty lines, ready to paste into `docs/PERFORMANCE.md` as a historical row.

This doc is the spec. The first scenario (calendar week-view nav) is the worked example. New scenarios for kanban drag, pomodoro state churn, notes editor stress, and so on plug in by implementing the contract described under "Adding a scenario".

## When to run a benchmark

The benchmark is **not** a CI tool. One full run takes about ten to eleven minutes (two five-minute idle-decay tails plus the restart and seeding bridge), and the readings depend on WebKit GC heuristics that are not reproducible across machines or window-manager states. Treat it as a release-candidate gate, not a per-PR check.

Good times to run:

- Before tagging a release that touches the calendar render path, recurrence expansion, or the SQL boot path.
- After a refactor that targeted memory or boot time, to verify the predicted win materialized.
- When investigating a user report of "the app got slow" against a representative dataset.

Bad times to run:

- During active development of unrelated features. The numbers will fluctuate from window-manager noise alone.
- On battery, with throttling, with a heavy load on the same machine, or with browser dev tools open. Any of these contaminate the reading.

## Scenario contract

A scenario is one TypeScript module exporting a `BenchmarkScenario` value. The contract is:

```ts
export interface BenchmarkScenario {
  /** Stable identifier. Used for the persisted state file and in markdown output. */
  id: string;
  /** Human label shown in the Settings developer card. */
  label: string;
  /** Short paragraph rendered under the label. Explain what the scenario stresses. */
  description: string;
  /**
   * Configure the app into the precondition required by the stress phase. For
   * the calendar scenario, this forces week view and parks the anchor on a
   * deterministic date. Runs at the start of every phase (A and B).
   */
  setup(): Promise<void>;
  /**
   * Drive the deterministic stress for exactly STRESS_DURATION_MS. The runner
   * starts a peak-sampling timer before calling this and stops it after; the
   * scenario only needs to keep the work loop going for the full window.
   */
  runStress(signal: AbortSignal): Promise<void>;
  /**
   * Seed the synthetic dataset for Phase B. Called once between Phase A and
   * the restart, with the dataset version tag so the seed is comparable
   * across builds.
   */
  seed(version: string): Promise<{ calendarId: string; eventCount: number }>;
  /**
   * Undo whatever `seed()` created. Called when the user cancels mid-run, or
   * when the summary screen closes. The scenario owns the cleanup so the
   * runner does not need to know which calendar / table / store was touched.
   */
  cleanup(seedHandle: { calendarId: string }): Promise<void>;
}
```

The runner orchestrates two phases around this contract:

- **Phase A** runs `setup()` then `runStress()` against the user's current data. Memory is sampled at 200 ms cadence during the stress burst (peak buffer), then at fixed offsets afterward (`t0`, `+5s`, `+30s`, `+60s`, `+180s`, `+300s`). Boot marks already captured by `lib/stores/perflog.svelte.ts` are folded into the result.
- **Phase B** runs the same shape after a restart, with `seed()` having populated the deterministic dataset. The runner persists Phase A to `app_config_dir/benchmark-state.json` and calls `restart_app` (the Tauri command around `AppHandle::restart()`). On the next boot, App.svelte detects the persisted state and hands control back to the runner, which calls `setup()` and `runStress()` against the seeded data.

Each phase therefore captures a memory curve, a peak, and the boot timings of the run that produced it. Phase A's boot timings are the user's real boot. Phase B's are the boot of an app that mounted with the synthetic dataset.

## Sampling cadence

The cadence is pinned in code under `lib/benchmark/sampler.ts` and reproduced here so historical entries in PERFORMANCE.md remain readable:

| Sample point | What it captures |
|---|---|
| `peak`        | Maximum total observed during the stress burst (200 ms sampling). |
| `t0`          | First reading after `runStress` resolves. Includes any unreleased GC residue. |
| `+5s`         | Confirms whether the immediate post-stress reading was already settling. |
| `+30s`        | Crosses one major-GC window on most machines. |
| `+60s`        | A common round-number checkpoint; the panel's "live" mode polls at five-second intervals so a minute is twelve panel updates. |
| `+180s`       | Three-minute checkpoint. Most observed decays flatten by here. |
| `+300s`       | Five-minute settled floor. Empirically the first asymptote we have seen on this codebase. |

If real runs show the curve flattens earlier on every codebase the user ships, the long tail can be dropped from the spec rather than gated behind a runtime toggle. Keep the cadence in code; do not let the UI parameterize it. Cadence drift across runs invalidates historical comparisons.

WebKit does not expose a force-GC API, so `+5m` is an approximation of the steady-state floor, not a guarantee. Non-monotonic decay (a later sample higher than an earlier one) usually indicates background work the harness did not stop; treat it as "rerun" rather than as data.

## Synthetic event generator (calendar scenario)

The first scenario seeds events into a dedicated calendar so the synthetic data groups separately from the user's real imports and can be wiped by deleting one calendar. The dataset is versioned: `benchmark-synth-v1` ships first, and any change to the generator's distribution or shape requires bumping to `v2`. The version string is part of the calendar grouping name and the markdown output, so historical rows in PERFORMANCE.md stay clearly tagged with the dataset that produced them.

`v1` distribution (1000 events by default, parameterizable per scenario), spread across `[today - 365d, today + 365d]`, generated from a `mulberry32` PRNG seeded with `0x1234`:

| Share | Shape |
|---|---|
| 70% | Timed plain. Random start snapped to a 15-minute boundary, duration in `{30, 60, 90}` minutes, no description. |
| 10% | Timed with description. Same start/duration distribution, plus a 50 to 200 character synthetic description. |
| 10% | Recurring. Split among `FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=MO,WE,FR`, `FREQ=MONTHLY`. Half capped with `COUNT=20`, half open-ended. |
| 5%  | All-day, single-date span. |
| 5%  | One alarm or one to three attendees. |

Determinism is the contract: for a given seed, the first N events must be byte-identical across runs and across machines. The vitest suite in `lib/benchmark/synth.test.ts` locks the first five events in golden form so silent generator drift fails the build.

Bumping to `v2` means renaming the constant, the calendar grouping, and the synth filename, and starting a fresh row series in PERFORMANCE.md. Old rows tagged `v1` stay readable; new rows tagged `v2` are not directly comparable to them, and the doc should call that out.

## Output format

The Copy button on the summary overlay emits a single markdown block. The shape is pinned so historical rows in PERFORMANCE.md remain comparable. Numbers below are placeholders, not real readings.

````markdown
## Benchmark 2026-04-30 (build ae2c02b, Linux Ubuntu 25.10, WebKitGTK 2.46)

Scenario: calendar-nav, dataset benchmark-synth-v1 (1000 events).
Methodology: 3000 ms programmatic right-nav in week view; sampled at 200 ms during stress, then at fixed offsets.

### Boot (ms from process start)

| Mark              | Phase A (empty) | Phase B (1000 synth) |
|-------------------|-----------------|----------------------|
| sql-main-done     | 412             | 609                  |
| maprow-done       | 415             | 783                  |
| sql-children-done | 418             | 817                  |
| first-paint       | 542             | 921                  |
| rawblocks-set     | 545             | 924                  |

### Memory PSS, MB (backend / frontend / network / total)

| t     | Phase A (empty)             | Phase B (1000 synth)        |
|-------|-----------------------------|-----------------------------|
| peak  | 87.0 / 245.0 / 15.8 / 348   | 88.1 / 412.5 / 16.0 / 517   |
| t0    | 87.0 / 222.1 / 15.8 / 325   | 87.9 / 358.2 / 15.9 / 462   |
| +5s   | 87.0 / 218.4 / 15.8 / 321   | 87.9 / 350.1 / 15.9 / 454   |
| +30s  | 87.0 / 192.3 / 15.8 / 295   | 87.8 / 268.7 / 15.9 / 372   |
| +60s  | 87.0 / 180.0 / 15.8 / 283   | 87.8 / 230.5 / 15.9 / 334   |
| +3m   | 87.0 / 175.0 / 15.8 / 278   | 87.5 / 215.0 / 15.9 / 318   |
| +5m   | 87.0 / 175.0 / 15.8 / 278   | 87.5 / 214.6 / 15.9 / 318   |

Settled floor: empty 278 MB at +60s, 1000 synth 318 MB at +3m. 1000-event delta over empty: +40 MB at floor, +169 MB at peak.
````

The format is deliberately one block, not two. Phase A and Phase B share rows so the reader can compare the same sample point across phases at a glance. The settled floor footer summarizes the takeaway: the asymptote and the dataset cost.

The markdown is also legal Markdown for the doc renderer in the summary overlay, so the user sees the same shape in-app that they paste into PERFORMANCE.md.

## How to add a scenario

1. **Create the module** at `apps/client/src/lib/benchmark/scenarios/<scenario-id>.ts`. Implement the `BenchmarkScenario` interface. The `id` becomes part of the persisted state filename and the markdown output, so pick something stable.
2. **Decide what `runStress` does.** It must keep the JS event loop working for the full `STRESS_DURATION_MS` window. For UI scenarios this typically means scheduling work via `requestAnimationFrame` so the work matches a real user's frame budget. Honor the `AbortSignal` so a cancel from the runner stops the loop promptly.
3. **Seed your data.** `seed()` should populate a versioned, dedicated grouping (calendar, board, project, etc.) so the synthetic dataset never mingles with user data. Return a handle the runner can hand back to `cleanup()`.
4. **Add a card.** `DeveloperSection.svelte` reads the registry in `lib/benchmark/registry.ts` and renders a card per scenario. Adding to the registry surfaces the new scenario in Settings without other UI changes.
5. **Lock the synth.** If your scenario seeds a deterministic dataset, add a vitest case under `lib/benchmark/scenarios/<id>.test.ts` that pins the first few generated items in golden form. This is the only protection against silent generator drift.

The runner, sampler, output formatter, and persistence layer are scenario-agnostic. A new scenario does not touch those files.

## Pitfalls and constraints

**GC un-forceability.** WebKit and V8 do not let user code force a major collection. The `+5m` sample is an empirical approximation of steady state, not a guarantee. If the curve is non-monotonic, rerun.

**Restart fragility.** `AppHandle::restart()` on Linux spawns a new instance via the original argv. Distros that wrap the binary through a launcher script may break the relaunch. The runner's contract is: if the relaunch fails, the persisted state stays on disk, and the next manual reopen of the app picks up Phase B from where Phase A left off. The persisted state includes the build hash and an ISO 8601 `startedAt`; if either is stale (build hash mismatch, or `startedAt` more than one hour old), the boot-time check clears the state silently and the next benchmark run starts fresh.

**Synth shape drift.** Bumping the generator without renaming the version invalidates every prior row in PERFORMANCE.md. The contract is: rename the constant in `synth.ts`, rename the calendar grouping in the scenario, write a one-line note in PERFORMANCE.md when the new version's first row lands. Old rows then read as historical context for the prior shape, not as comparable data points to the new shape.

**Cross-build comparability.** Even within a single dataset version, comparing two runs requires holding constant: the host machine, the OS and WebKitGTK version, the window manager state, the absence of dev tools, and ideally a fresh boot. The harness does not enforce these. Document them in the row's prefix line so the reader can spot apples-to-oranges comparisons.

**Five-minute sampling tail.** The sampling itself is not blocking: the JS event loop runs and the user could in principle interact with the app under the overlay. The overlay sets `pointer-events: none` on the underlying app to make this hard, but the user can still focus the window through other means and contaminate the measurement. The overlay carries a one-line warning telling the user not to interact while sampling runs.

**State left behind on cancel.** If the user cancels after `seed()` but before the restart, the synthetic calendar exists in the DB. The scenario's `cleanup()` is responsible for removing it, called from the runner's cancel path. Do not assume the runner will sweep the DB; cleanup runs only what the scenario specifies.

**No CI integration.** The harness is interactive by design. Headless and CI integration would require force-killing GC, which is impossible, and a stable host environment, which CI does not provide. Anyone wanting per-PR measurement should fall back to the existing `pnpm -w run test` performance unit tests, not this harness.

## Critical files

- `lib/benchmark/types.ts`: `BenchmarkScenario`, `PhaseResult`, `SamplePoint`, `BenchmarkState`.
- `lib/benchmark/sampler.ts`: peak-sampling and idle-curve sampling. Wraps `get_memory_report` invokes and the `snapshot()` helper from `lib/stores/perflog.svelte.ts`.
- `lib/benchmark/runner.ts`: phase orchestration, persistence, restart wiring.
- `lib/benchmark/synth.ts`: `mulberry32` PRNG plus the `v1` distribution. Pure logic; tested.
- `lib/benchmark/output.ts`: `PhaseResult[]` to markdown. Pure logic; tested.
- `lib/benchmark/registry.ts`: list of installed scenarios. Adding to this array surfaces the scenario in the UI.
- `lib/benchmark/scenarios/calendar-nav.ts`: first scenario; worked example.
- `apps/client/src-tauri/src/lib.rs`: `read_benchmark_state`, `write_benchmark_state`, `clear_benchmark_state`, `restart_app`.
- `lib/components/calendar/nav-handle.svelte.ts`: shared store exposing `navigate(dir)` and `setViewMode(mode)` for headless drivers.
- `lib/components/settings/DeveloperSection.svelte`: Settings entry rendering one card per scenario.
- `lib/components/benchmark/BenchmarkOverlay.svelte`: full-screen overlay during a run; renders the summary tables on completion.

The harness reuses the existing memory and perf-mark infrastructure verbatim: `get_memory_report` (Tauri command in `lib.rs`), `mark()` and `snapshot()` (in `lib/stores/perflog.svelte.ts`), and the boot/nav marks already firing from `App.svelte` and `CalendarView.svelte`. None of those files change for the harness.

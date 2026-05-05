# Performance benchmark harness

The benchmark harness is a dev-visible mechanism inside the app for taking deterministic, comparable performance measurements. It exists because manual timing and one-off RAM snapshots are too noisy for cross-build decisions.

Harness v4 runs scenarios against isolated benchmark databases, records only the measurement type each scenario needs, then emits normalized markdown for `docs/PERFORMANCE.md`.

## User flow

The performance panel shows one button per scenario plus `Run all benchmarks`.

Recommended flow:

1. Build and install a release package.
2. Open the installed app.
3. Open the title-bar performance panel.
4. Click `Run all benchmarks`.
5. Leave the app alone while the overlay runs.
6. Copy the markdown summary and paste it into the thread for placement.

The harness fires a desktop notification when it reaches summary or error state.

## Data safety

The harness uses `app_config_dir/ganbaruai-benchmark.db` for the whole run. The user's real database and vault are not opened during benchmark phases.

Safety mechanisms:

- `prepare_benchmark_db` deletes the benchmark DB and sidecars before a scenario starts.
- `vaultMode: "benchmark"` in `benchmark-state.json` tells the boot path to open the benchmark DB.
- `teardown_benchmark_db` deletes the benchmark DB when the summary closes, when the run is cancelled, or when stale state is detected.
- The app restarts after teardown so the SQL plugin opens the real user DB again.
- Stale state is discarded when `HARNESS_VERSION`, `SYNTH_VERSION`, or the TTL check fails.

## Phase model

Every scenario runs two cold phases:

| Phase | Dataset |
|---|---|
| A | Empty isolated benchmark DB, plus setup rows required by the scenario |
| B | Isolated DB seeded with `benchmark-synth-v1` at 1000 events, plus setup rows required by the scenario |

Each scenario declares a primary measurement mode:

| Kind | Captures | Post-workload memory wait |
|---|---|---|
| `startup` | Boot marks only | No |
| `idle-memory` | Workload peak, workload end, and +30s memory while idle | Yes |
| `stress-memory` | Workload peak, workload end, and +30s memory during a fixed stress action | Yes |
| `interaction-latency` | Repeated UI action timings and averages | No |
| `operation-latency` | Repeated or single operation timings and counters | No |

The point is to keep each benchmark honest. Feature latency scenarios should not spend 30 seconds waiting for memory GC if the thing being measured is how quickly the feature paints or finishes.

## Suite state machine

Single-scenario runs and suite runs use the same state file. Suite runs add a queue and accumulated results.

```text
idle
  user clicks Run or Run all
  user confirms
  prepare benchmark DB
  write phase-a-pending
  restart app

phase-a-pending
  open isolated empty DB
  run Phase A
  seed benchmark-synth-v1
  write phase-b-pending
  restart app

phase-b-pending
  open isolated seeded DB
  run Phase B
  if suite has more scenarios:
    prepare benchmark DB
    write next phase-a-pending with accumulated results
    restart app
  otherwise:
    show summary

summary
  user clicks Return to your data
  teardown benchmark DB
  clear benchmark state
  restart app
```

One scenario currently costs two benchmark phases plus restarts. A full suite costs that amount multiplied by the number of registered scenarios.

## Scenario contract

A scenario is one module exporting a `BenchmarkScenario`.

```ts
export interface BenchmarkScenario {
  id: string;
  label: string;
  description: string;
  workload: {
    kind:
      | "startup"
      | "idle-memory"
      | "stress-memory"
      | "interaction-latency"
      | "operation-latency";
    question: string;
    label: string;
    durationMs: number;
    memoryMode: "none" | "post-workload";
  };
  defaultSeedSize: number;
  setup(): Promise<void>;
  runWorkload(signal: AbortSignal): Promise<void | BenchmarkMetric[]>;
  seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }>;
  cleanup(seedHandle: { calendarId: string }): Promise<void>;
}
```

Implementation rules:

- `setup()` places the app in the deterministic starting state for both phases.
- `runWorkload()` performs the measured action and must honor the abort signal.
- Scenarios that need a fixed measurement window should keep the workload alive for `workload.durationMs`.
- Interaction scenarios should run enough repetitions to report an average, median, p95, min, and max when practical.
- Scenario metrics must be scalar and non-sensitive. Do not record titles, notes, URLs, or other user content.
- `seed()` writes only to the isolated benchmark DB.
- `cleanup()` is usually a no-op because the benchmark DB is deleted wholesale after the run.

## Registered scenarios

| Scenario | Module | Primary measurement |
|---|---|---|
| `startup-boot` | `lib/benchmark/scenarios/startup-boot.ts` | Cold launch and boot marks |
| `idle-memory` | `lib/benchmark/scenarios/idle-memory.ts` | Idle calendar RAM |
| `calendar-nav` | `lib/benchmark/scenarios/calendar-nav.ts` | Week-view navigation stress RAM |
| `event-panel-open` | `lib/benchmark/scenarios/event-panel-open.ts` | Existing-event panel open and switch latency |
| `calendar-create-cancel` | `lib/benchmark/scenarios/calendar-create-cancel.ts` | Create-panel open and cancel latency |
| `ics-import` | `lib/benchmark/scenarios/ics-import.ts` | ICS parse and database write latency |
| `theme-editor-open` | `lib/benchmark/scenarios/theme-editor-open.ts` | Settings and theme editor lazy-load and open latency |

## Synthetic event generator

`benchmark-synth-v1` is deterministic. It uses a `mulberry32` PRNG seeded with `0x1234` and produces 1000 events by default.

Distribution:

| Share | Shape |
|---|---|
| 70% | Timed plain events |
| 10% | Timed events with description |
| 10% | Recurring events split among daily, weekly, and monthly |
| 5% | All-day events |
| 5% | Events with one alarm or one to three attendees |

Bumping the generator requires a new synth version and a fresh row series in `docs/PERFORMANCE.md`.

## Output format

The summary overlay emits one markdown block per scenario. `Run all benchmarks` concatenates every block into one copyable suite summary.

Every block contains:

- Header with date and platform.
- Scenario and primary question.
- Phase A and Phase B datasets.
- Methodology line.

Then the block contains exactly the section that matches the scenario's primary measurement:

- `startup` emits `Startup boot`.
- `idle-memory` and `stress-memory` emit `Memory PSS, MB`.
- `interaction-latency` and `operation-latency` emit `Primary metrics`.

The output intentionally avoids slash-packed memory cells so results can be copied into canonical tables with minimal rewriting.

## Critical files

- `lib/benchmark/types.ts`: scenario contract, phase result types, suite state, versions, sampling constants.
- `lib/benchmark/runner.ts`: phase orchestration, persisted state, restart wiring.
- `lib/benchmark/sampler.ts`: memory sampling and boot timing capture.
- `lib/benchmark/output.ts`: benchmark result markdown formatter.
- `lib/benchmark/registry.ts`: installed scenario list.
- `lib/stores/benchmarkRunner.svelte.ts`: UI-facing runner state and suite continuation.
- `lib/components/benchmark/BenchmarkOverlay.svelte`: confirmation, running, summary, and error overlays.
- `lib/components/perf/PerformancePopover.svelte`: benchmark buttons.
- `lib/components/calendar/nav-handle.svelte.ts`: headless calendar driver for benchmark scenarios.
- `lib/api/db.ts`: benchmark DB selection through `vaultMode`.
- `apps/client/src-tauri/src/lib.rs`: benchmark state commands, DB prepare and teardown, restart, startup elapsed time, memory report.

## Constraints

- Benchmarks are not CI. They require a real graphical environment and are affected by WebKit or WebView2 GC heuristics.
- Compare runs on the same host, OS, WebView engine version, window state, and power mode.
- Do not interact with the app during a run.
- Do not use benchmark rows as claims about one user's real database. They are cross-build comparison signals.

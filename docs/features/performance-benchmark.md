# Performance benchmark harness

The benchmark harness is a dev-visible mechanism inside the app for taking deterministic, comparable performance measurements. It exists because manual timing and one-off RAM snapshots are too noisy for cross-build decisions.

Harness v9 runs scenarios against isolated benchmark databases, records only the measurement type each scenario needs, then shows readable summary tables and copies normalized markdown for `docs/PERFORMANCE.md`.

## User flow

The performance panel shows one button per scenario plus `Run all benchmarks`.

Recommended flow:

1. Build and install a release package.
2. Open the installed app.
3. Open the title-bar performance panel.
4. Click `Run all benchmarks`.
5. Leave the app alone while the overlay runs.
6. Review the readable summary tables.
7. Click `Copy markdown` and send the markdown to an agent for careful placement in the performance record.

The harness fires a desktop notification when it reaches summary or error state.

## Data safety

The harness uses `app_config_dir/ganbaruai-benchmark.db` for the whole run. The user's real database and vault are not opened during benchmark passes.

Safety mechanisms:

- `prepare_benchmark_db` deletes the benchmark DB and sidecars before a scenario starts.
- `vaultMode: "benchmark"` in `benchmark-state.json` tells the boot path to open the benchmark DB.
- `teardown_benchmark_db` deletes the benchmark DB when the summary closes, when the run is cancelled, or when stale state is detected.
- The app restarts after teardown so the SQL plugin opens the real user DB again.
- Stale state is discarded when `HARNESS_VERSION`, `SYNTH_VERSION`, or the TTL check fails.

## Dataset ids

Benchmark result tables use compact dataset ids:

| Pattern | Meaning |
|---|---|
| `base-N` | The isolated benchmark DB after scenario setup and before synthetic seeding. `N` is the number of calendar events present at measurement start. |
| `synth-vX-N` | The isolated benchmark DB seeded with synthetic dataset version `vX`. `N` is the number of calendar events present at measurement start. |

The formatter emits these ids directly. Do not render prose dataset labels such as "empty", "setup events", or "synthetic calendar" in copied markdown.

Each scenario declares a primary measurement mode:

| Kind | Captures | Post-workload memory wait |
|---|---|---|
| `startup` | Repeated process launches to usable calendar paint after a closed-process cooldown | No |
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
  write phase-a-running
  run baseline pass
  for startup only, repeat phase-a-pending until enough launch samples exist
  seed benchmark-synth-v1
  write phase-b-pending
  restart app

phase-b-pending
  open isolated seeded DB
  write phase-b-running
  run synthetic pass
  for startup only, repeat phase-b-pending until enough launch samples exist
  if suite has more scenarios:
    prepare benchmark DB
    write next phase-a-pending with accumulated results
    restart app
  otherwise:
    teardown benchmark DB
    clear benchmark state
    show summary

summary
  user clicks Return to your data
  restart app

phase-a-running or phase-b-running on boot
  previous process was killed mid-pass
  teardown benchmark DB
  clear benchmark state
  continue on the user's real DB
```

Non-startup scenarios currently cost two benchmark passes plus restarts. The startup scenario records five process launches per dataset, so it costs five baseline restarts and five synthetic restarts. Each startup relaunch exits the app, waits 10 seconds in a helper process, then opens GanbaruAI again. A full suite adds the cost of each registered scenario.

If the process is killed during a benchmark pass, the partial result is not comparable. The next boot discards the isolated benchmark DB instead of trying to resume from data that may contain half-finished setup or workload state. Explicit Cancel still aborts the active run and restarts on the user's real DB.

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

- `setup()` places the app in the deterministic starting state for both passes.
- `runWorkload()` performs the measured action and must honor the abort signal.
- Scenarios that need a fixed measurement window should keep the workload alive for `workload.durationMs`.
- Interaction scenarios should run enough repetitions to report an average, median, p95, min, and max when practical.
- Scenario metrics must be scalar and non-sensitive. Do not record titles, notes, URLs, or other user content.
- `seed()` writes only to the isolated benchmark DB.
- `cleanup()` is usually a no-op because the benchmark DB is deleted wholesale after the run.

## Registered scenarios

| Scenario | Module | Primary measurement |
|---|---|---|
| `startup-boot` | `lib/benchmark/scenarios/startup-boot.ts` | Repeated launch to usable calendar paint |
| `idle-memory` | `lib/benchmark/scenarios/idle-memory.ts` | Idle calendar RAM |
| `calendar-nav` | `lib/benchmark/scenarios/calendar-nav.ts` | Week-view navigation stress RAM |
| `event-panel-open` | `lib/benchmark/scenarios/event-panel-open.ts` | Existing-event panel open and switch latency |
| `calendar-create-cancel` | `lib/benchmark/scenarios/calendar-create-cancel.ts` | Create-panel open and cancel latency |

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

The summary overlay has two outputs:

- A readable on-screen preview rendered from `BenchmarkResult` data as normal HTML tables.
- A `Copy markdown` action that copies plain canonical markdown. This markdown is agent input for placing rows in `docs/PERFORMANCE.md`, not HTML and not a raw preview.

While the benchmark overlay is active, in-app close affordances are blocked, including the title-bar close button, `Ctrl+Shift+W`, and Tauri close requests. A forced OS process kill cannot be blocked; the `*-running` state handles that case on the next boot.

During memory scenarios, the running overlay labels the fixed workload period as `Idle window: 3 s` or `Stress window: 3 s`. That label describes only the measured workload window. The later `Idle curve` step still waits for the post-workload memory sample.

The copied markdown is one suite-level block. It contains:

- Header with the run placeholder, such as `YYYY-MM-DD-ID` or the current date plus `-ID`.
- One generated `Index` table that lists run metadata and every scenario section.
- One `Run metadata` table with run id, harness, build ref, platform, and notes.
- One section per scenario in the run.

Each scenario section contains exactly the table that matches the scenario's primary measurement:

- `startup` emits repeated launch stats. `Launch median ms` is the headline value for app-open comparisons. It measures Rust process start through `boot.usable-paint`, when calendar data has loaded and the calendar has rendered a frame. Harness v9 waits 10 seconds while the app is closed before each startup sample, reducing instant-relaunch cache bias without pretending to be a first launch after OS reboot.
- `idle-memory` and `stress-memory` emit the memory table.
- `interaction-latency` and `operation-latency` emit repeated latency rows for metrics with run statistics.
- Scalar metrics without run statistics, such as counts or one-off module load times, emit a compact `Run`, `Dataset`, `Metric`, `Value`, `Unit` table.

The copied markdown intentionally avoids slash-packed memory cells, repeated global metadata, empty stat columns, and measurement-level notes. Run metadata is the only generated table with a `Notes` column. Fixed scenario details belong in `docs/PERFORMANCE.md` prose near the scenario section. A future comparable detail should become a dedicated typed column instead of a generic note.

`buildRef` is generated at frontend build time from the app version and short git commit, such as `0.1.0+a7451de`. A dirty worktree adds `-dirty`. The platform label comes from the native memory-report command and should include useful OS detail, such as `Linux Ubuntu 24.04.4 LTS` or `Windows 11 (10.0.22631)`.

## Critical files

- `lib/benchmark/types.ts`: scenario contract, pass result types, suite state, versions, sampling constants.
- `lib/benchmark/runner.ts`: pass orchestration, persisted state, restart wiring.
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

# Performance benchmark harness

The benchmark harness is a dev-visible mechanism inside the app for taking deterministic, comparable performance measurements. It exists because manual timing and one-off RAM snapshots are too noisy for cross-build decisions.

Harness v1 is the current active baseline after the 2026-05-12 reset. It runs scenarios against isolated benchmark databases, records only the measurement type each scenario needs, then shows readable summary tables and copies normalized markdown for `docs/PERFORMANCE.md`. Startup and idle memory run both dense calendar datasets: `dense-v1-r1y-s1-d1` and `dense-v1-r10y-s1-d1`. Practical user-window scenarios run only `dense-v1-r1y-s1-d1`.

Harness and dataset versions are tied to recorded rows, not local iteration. Do not bump `HARNESS_VERSION`, `DENSE_DATASET_VERSION`, or dense detail profile names until the current version has at least one run recorded in `docs/PERFORMANCE.md`. While tuning an unrecorded benchmark shape, edit the current version in place.

## User flow

The performance panel shows compact grouped suite buttons. Each suite row has a primary run button and a square expand button that reveals individual scenario buttons.

Recommended flow:

1. Build and install a release package.
2. Open the installed app.
3. Open the title-bar performance panel.
4. Click `Run core benchmarks`, `Run backend benchmarks`, or `Run all benchmarks`.
5. Leave the app alone while the overlay runs.
6. Review the readable summary tables.
7. Click `Copy markdown` and send the markdown to an agent for careful placement in the performance record.

The harness fires a desktop notification when it reaches summary or error state.

## Data safety

The harness uses `app_config_dir/ganbaruai-benchmark.db` for the whole run. The user's real database and vault are not opened during benchmark passes.

Safety mechanisms:

- `prepare_benchmark_db` deletes the benchmark DB and sidecars before a scenario starts.
- `vaultMode: "benchmark"` in `benchmark-state.json` tells the database URL resolver to open the benchmark DB.
- `teardown_benchmark_db` deletes the benchmark DB when the summary closes, when the run is cancelled, or when stale state is detected.
- The app restarts after teardown so the Rust database layer returns to the real user DB.
- Stale state is discarded when `HARNESS_VERSION`, `DENSE_DATASET_VERSION`, the total run TTL, or the short pending-restart TTL check fails.

## Dataset ids

Benchmark result tables use compact dataset ids:

| Pattern | Meaning |
|---|---|
| `base-N` | The isolated benchmark DB after scenario setup and before dense dataset seeding. `N` is the number of calendar events present at measurement start. |
| `dense-vX-rYy-sZ-dP` | The isolated benchmark DB seeded with dense dataset version `vX`, `Y` years before and after the run anchor date, `Z` overlapping timed events at each hourly start, and detail profile `dP`. Detail profiles may add all-day events or productivity history. |

The formatter emits these ids directly. Do not render prose dataset labels such as "empty", "setup events", or "dense calendar" in copied markdown.

Each scenario declares a primary measurement mode:

| Kind | Captures | Memory observation |
|---|---|---|
| `startup` | Repeated process launches to usable calendar paint after a closed-process cooldown | No |
| `idle-memory` | Min, max, and end memory during the idle observation window | Yes |
| `stress-memory` | Min, max, and end memory after the fixed user action | Yes |
| `interaction-latency` | Repeated UI action timings and averages | No |
| `operation-latency` | Repeated or single operation timings and counters | No |

The point is to keep each benchmark honest. Feature latency scenarios should not spend 30 seconds waiting for memory GC if the thing being measured is how quickly the feature paints or finishes.

Memory scenarios must capture every one-second sample in the observation window. A failed sample is a harness failure, not a reportable `n/a` row.

## Benchmark boot path

The benchmark boot path intentionally differs from normal app boot so it can measure exactly one calendar window.

On normal boots, `App.svelte` loads calendar metadata, runs the timezone hydrator, then loads the user's current calendar window.

On benchmark boots, `App.svelte` first reads `benchmark-state.json`. If a benchmark state exists, the app resolves the DB URL before the runner flips the state from pending to running. This caches `sqlite:ganbaruai-benchmark.db` for valid pending benchmark boots, while stale, invalid, or interrupted running states still resolve to the user DB and are discarded by the runner. The benchmark overlay and runner then load before normal calendar hydration starts. When the runner claims the pending state, normal current-week hydration is skipped for that process. The scenario setup then loads calendar metadata and the run anchor window itself.

This matters for memory comparability. Without this gate, a benchmark run could preload the real current week and then load the benchmark week, measuring two calendar windows instead of the scenario window.

If the persisted state is stale, invalid, or missing, the app falls back to the normal boot path and opens the user's real database.

## Suite state machine

Single-scenario runs and suite runs use the same state file. Suite runs add a queue and accumulated results.

```text
idle
  user clicks Run on a scenario or suite
  user confirms
  resolve and persist the local anchor date
  prepare benchmark DB
  write phase-a-pending
  restart app

phase-a-pending
  open isolated empty DB
  skip normal current-week preload
  write phase-a-running
  run baseline pass at the persisted anchor, unless the scenario is dense-only
  for startup only, repeat phase-a-pending until enough launch samples exist
  seed dense-v1-r1y-s1-d1 around the persisted anchor
  write phase-b-pending
  restart app

phase-b-pending
  open isolated seeded DB
  skip normal current-week preload
  write phase-b-running
  run dense pass for the current dataset at the persisted anchor
  for startup only, repeat phase-b-pending until enough launch samples exist
  if the scenario has more dense datasets:
    seed the next dense dataset around the same anchor
    write phase-b-pending with completed dense results
    restart app
  if suite has more scenarios:
    prepare benchmark DB
    write next phase-a-pending with accumulated results and the same anchor
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

Baseline-and-dense scenarios cost one baseline pass plus one pass per dense dataset. Dense-only scenarios skip the measured baseline pass and run only the practical dense dataset. The startup scenario records five process launches per dataset, so it costs five baseline restarts and five restarts for each dense dataset. Each startup relaunch exits the app, waits 10 seconds in a helper process, then opens GanbaruAI again. A full suite adds the cost of each registered scenario.

If the process is killed during a benchmark pass, the partial result is not comparable. The next boot discards the isolated benchmark DB instead of trying to resume from data that may contain half-finished setup or workload state. Explicit Cancel still aborts the active run and restarts on the user's real DB.

Pending state is different: it is valid only during the small gap between an intentional restart and the next boot claiming the pass. The state file carries both `startedAt` and `updatedAt`; `startedAt` caps the full benchmark run, while `updatedAt` caps the pending restart gap. If a relaunch helper fails or the frontend never reaches the runner, the pending state expires quickly and the next boot returns to the real user DB instead of repeatedly trying the benchmark DB.

## Anchor date

The benchmark anchor is the user's local current date when they confirm the benchmark run. It is stored as `anchorDate` in `benchmark-state.json`, carried through every restart, and copied into run metadata.

This keeps the benchmark in the same practical temporal context as normal app use. The app sees anchor-day events as today, future events as future events, and earlier dense rows as past events. Because the anchor is persisted at confirmation time, a long benchmark suite crossing midnight still uses one anchor date from start to finish.

Using today's date does not meaningfully slow seeding. Dense generation still computes a half-open range from the persisted anchor and bulk-imports deterministic chunks. The number of generated days can vary by leap years in the selected span, which is why the copied output records the anchor date.

## Lazy loading

Normal app startup must not import benchmark scenario implementation code. The title bar may load only `benchmarkStatus` and the normal UI shell. The performance popover may load lightweight scenario metadata for button labels, but it must not import the runner store, dense data generator, scenario modules, or operation benchmark helpers until a user starts a benchmark.

Benchmark resume is the other allowed load path. On boot, `App.svelte` reads the persisted benchmark state through a small Tauri command. If no state exists, the runner is not imported. If pending state exists, the benchmark overlay and runner load, then `registry.ts` dynamically imports only the scenario named in the state file.

`lib/benchmark/registry.ts` is the boundary. `BENCHMARK_SCENARIOS` contains metadata only. `loadScenarioById()` owns dynamic imports for executable scenario modules.

## Scenario contract

A scenario has lightweight metadata in `registry.ts` and one executable module exporting a `BenchmarkScenario`.

```ts
export interface BenchmarkScenarioContext {
  anchorDate: string;
}

export interface BenchmarkScenarioMetadata {
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
  defaultDataset: BenchmarkDatasetProfile;
  benchmarkDatasets?: BenchmarkDatasetProfile[];
  runMode?: "baseline-and-dense" | "dense-only";
}

export interface BenchmarkScenario extends BenchmarkScenarioMetadata {
  setup(context: BenchmarkScenarioContext): Promise<void>;
  runWorkload(
    signal: AbortSignal,
    context: BenchmarkScenarioContext,
  ): Promise<void | BenchmarkMetric[]>;
  seed(
    dataset: BenchmarkDatasetProfile,
    context: BenchmarkScenarioContext,
  ): Promise<BenchmarkSeedHandle>;
  cleanup(seedHandle: BenchmarkSeedHandle): Promise<void>;
}
```

Implementation rules:

- Metadata must stay dependency-light. Do not import scenario modules, stores, dense generators, or operation helpers from the metadata path.
- `setup()` places the app in the deterministic starting state for both passes.
- Calendar scenarios must use `context.anchorDate`, not a fixed date or a fresh `new Date()`.
- `runWorkload()` performs the measured action and must honor the abort signal.
- Scenarios that need a fixed measurement window should keep the workload alive for `workload.durationMs`.
- Interaction scenarios should run enough repetitions to report an average, median, p95, min, and max when practical.
- Scenario metrics must be scalar and non-sensitive. Do not record titles, notes, URLs, or other user content.
- `seed()` writes only to the isolated benchmark DB.
- `cleanup()` is usually a no-op because the benchmark DB is deleted wholesale after the run.

## Registered scenarios

Registered suites:

| Suite | Scenarios | Purpose |
|---|---|---|
| Core benchmarks | `startup-boot`, `idle-memory`, `calendar-nav`, `event-panel-open`, `calendar-create-cancel` | User-perceived startup, memory, and interaction latency |
| Backend benchmarks | `calendar-write-ops`, `calendar-import-ops` | Rust-backed calendar write and import latency |
| All benchmarks | Core plus backend | Complete release baseline or broad refactor validation |

Registered scenarios:

| Scenario | Module | Primary measurement |
|---|---|---|
| `startup-boot` | `lib/benchmark/scenarios/startup-boot.ts` | Repeated launch to usable calendar paint |
| `idle-memory` | `lib/benchmark/scenarios/idle-memory.ts` | Anchored week idle RAM |
| `calendar-nav` | `lib/benchmark/scenarios/calendar-nav.ts` | Physical right-arrow hold week-view RAM |
| `event-panel-open` | `lib/benchmark/scenarios/event-panel-open.ts` | Existing-event panel open and switch latency |
| `calendar-create-cancel` | `lib/benchmark/scenarios/calendar-create-cancel.ts` | Create-panel open and cancel latency |
| `calendar-write-ops` | `lib/benchmark/scenarios/calendar-write-ops.ts` | Rust-backed calendar create, patch, delete, detach, and split latency |
| `calendar-import-ops` | `lib/benchmark/scenarios/calendar-import-ops.ts` | Rust-backed calendar bulk import latency |

`calendar-nav` dispatches `ArrowRight` keydown and keyup events on `window` for a 3-second hold. That enters CalendarView's real keyboard listener and real held-navigation controller, so the benchmark follows the same path as a physical right-arrow hold. Setup waits for the anchored week and adjacent window prefetch to finish. Held repeats use the app's normal readiness gate: the current render window must be applied, and the next target window must already be current or cached. If not, the repeat tick is skipped. The scenario observes the real controller to count moves, repeats, and skipped ticks.

## Dense calendar dataset generator

`benchmark-dense-v1-s1-d1` is deterministic for a given anchor date. Dataset ids add the year radius: `dense-v1-r1y-s1-d1` covers one year before and one year after the run anchor date, while `dense-v1-r10y-s1-d1` covers ten years before and ten years after it.

Week-view memory scenarios load the visible Monday to Sunday week plus one day before and one day after. With dense v1, stack count 1, and detail profile 1, the visible week has 168 timed events and 21 all-day events, while the loaded benchmark week has 216 timed rows and 27 all-day rows. This is intentional because it matches the calendar store's real render window.

Dataset v1 uses a half-open date range from `anchor - yearRadius` through, but not including, `anchor + yearRadius`. Event counts depend on the persisted anchor date because leap years may be included or excluded by the radius.

Every day has one timed event at `HH:00` for every hour from `00:00` through `23:00`; each timed event lasts one hour and has the default Pomodoro config. Every day also has three all-day events. Detail profile `d1` gives timed events a title, description, notification, rich alarm, location, URL, categories, organizer, guest permissions, extended benchmark metadata, and one attendee. All-day events carry title, description, color, status, visibility, priority, categories, organizer, guest permissions, and extended benchmark metadata. The generator intentionally avoids recurrence so the benchmark isolates dense visible windows and old or future non-recurring history.

Timed events before `${anchorDate} 00:00` get completed Pomodoro history. A one-hour event with the default 40/5/10 config produces three completed segments: 40 minutes of focus, 5 minutes of short break, and 15 minutes of focus. The two focus segments also create completed Pomodoro session rows with a focus score of 1.

Source UIDs do not include the year radius. Seeding the 10-year dataset after the 1-year dataset updates the overlapping events and adds only the extra outer years instead of duplicating the shared range. After dense rows are recorded, changing the generator requires a new dense dataset version and a fresh row series in `docs/PERFORMANCE.md`.

## Output format

The summary overlay has two outputs:

- A readable on-screen preview rendered from `BenchmarkResult` data as normal HTML tables.
- A `Copy markdown` action that copies plain canonical markdown. This markdown is agent input for placing rows in `docs/PERFORMANCE.md`, not HTML, not raw scenario diagnostics, and not a dump of every collected metric.

While the benchmark overlay is active, in-app close affordances are blocked, including the title-bar close button, `Ctrl+Shift+W`, and Tauri close requests. A forced OS process kill cannot be blocked; the `*-running` state handles that case on the next boot.

During memory scenarios, the running overlay labels the scenario action first, then `Memory observation` while the 30 second sample window runs. Idle memory has no fake action window; observation starts after the anchored calendar window is ready. Held navigation still performs the fixed real right-arrow hold first, then observes post-navigation memory after key release.

The copied markdown is one suite-level block. It contains:

- Header with the unresolved run placeholder, such as `YYYY-MM-DD-ID` or the current date plus `-ID`.
- One `Run metadata` table with run id, harness, anchor date, build ref, platform, and notes.
- One canonical section per recorded scenario in the run.

The placeholder exists because the app cannot know which sequence number the canonical record will use. When adding copied rows to `docs/PERFORMANCE.md`, replace `-ID` with the next zero-padded suffix for that date, such as `-01` or `-02`. Do not leave `-ID` in canonical rows.

Each scenario section contains the table that matches the scenario's primary long-run measurement:

- `startup` emits repeated launch stats for each benchmark dataset. `Launch median ms` is the headline value for app-open comparisons. It measures Rust process start through `boot.usable-paint`, when calendar data has loaded and the calendar has rendered a frame. Harness v1 and later wait 10 seconds while the app is closed before each startup sample, reducing instant-relaunch cache bias without pretending to be a first launch after OS reboot.
- `idle-memory` emits `Min`, `Max`, and `End` memory rows for the baseline and each dense dataset so total-history scale remains visible.
- `stress-memory` emits `Min`, `Max`, and `End` memory rows for the datasets the scenario actually runs. Calendar held navigation is dense-only and records the practical dense current-window dataset. Held-navigation move counts, repeat counts, and skipped ticks are diagnostics and are not copied into the canonical markdown.
- `interaction-latency` and `operation-latency` emit repeated latency rows only for their canonical primary metrics. Current practical scenarios are dense-only and run against the practical dense current-window dataset.
- Scalar metrics without run statistics emit a compact scalar table only when the one-off value is itself canonical. Calendar import keeps 1000-event add and update timings; smaller repeated import rows are diagnostics.

The copied markdown intentionally avoids slash-packed memory cells, repeated global metadata, empty stat columns, redundant dataset levels, diagnostic counters, and measurement-level notes. Run metadata is the only generated table with a `Notes` column. Fixed scenario details belong in this harness spec, while `docs/PERFORMANCE.md` should record rows and minimal column interpretation. A future comparable detail should become a dedicated typed column instead of a generic note.

`buildRef` is generated at frontend build time from the app version and short git commit, such as `0.1.0+a7451de`. A dirty worktree adds `-dirty`. The platform label comes from the native memory-report command and should include useful OS detail, such as `Linux Ubuntu 24.04.4 LTS` or `Windows 11 (10.0.22631)`.

## Critical files

- `lib/benchmark/types.ts`: scenario contract, pass result types, suite state, versions, sampling constants.
- `lib/benchmark/dense.ts`: deterministic dense calendar dataset generation.
- `lib/benchmark/registry.ts`: lightweight scenario metadata and dynamic scenario loaders.
- `lib/benchmark/runner.ts`: pass orchestration, persisted state, restart wiring.
- `lib/benchmark/sampler.ts`: memory sampling and boot timing capture.
- `lib/benchmark/output.ts`: benchmark result markdown formatter.
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

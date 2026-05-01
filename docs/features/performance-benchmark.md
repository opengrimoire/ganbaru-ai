# Performance benchmark harness

The benchmark harness is a dev-visible mechanism inside the app for taking deterministic, comparable performance measurements. It exists because the prior workflow (a human holding right-arrow for an imprecise ~2 seconds, then eyeballing a panel and copying a 250-line ring buffer) made cross-build comparisons unreliable. Two specific failure modes drove the design:

1. **GC timing dominates single-shot readings.** Identical state can read 478 MB right after an action and 263 MB after the app sits idle. WebKit and V8 defer garbage collection aggressively, and a snapshot taken at one arbitrary moment captures whatever the collector has not yet released. Comparing builds across single-snapshot readings hides real wins under GC variance and invents fake ones.
2. **Boot timings need a controlled dataset.** Some predicted boot wins (slimmer SQL reads, fewer JSON parses) only show on inputs with rich heavy fields. The user's null-heavy 968-event Google Calendar import already had cheap parses, so a refactor with no measurable boot improvement on that dataset might still be a meaningful win on a different shape. Without a synthesized dataset under our control, every measurement run sits on whatever the user happened to import.

Harness v2 solves both problems while keeping the user's real database completely out of the run. Both phases boot cold against an isolated benchmark database file that is created at the start of the run and deleted when the user closes the summary. Phase A is an empty baseline. Phase B is a 1000-event synthetic dataset. The harness drives a deterministic stress sequence (no human pacing), samples memory at peak plus a +30 s post-stress reading, and emits a compact markdown block ready to paste into `docs/PERFORMANCE.md` as a historical row.

This doc is the spec. The first scenario (calendar week-view nav) is the worked example. New scenarios for kanban drag, pomodoro state churn, notes editor stress, and so on plug in by implementing the contract described under "Adding a scenario".

## When to run a benchmark

The benchmark is **not** a CI tool. One full run takes about 80 seconds (3 cold restarts, two ~33 s phases, one seed bridge), and the readings depend on WebKit GC heuristics that are not reproducible across machines or window-manager states. Treat it as a release-candidate gate, not a per-PR check.

Because the run blocks user interaction with the app, the harness fires an OS desktop notification (with the system message-tone) when the run reaches the summary state or fails. The notification means you can step away during the 80 seconds without missing the moment the result is ready to copy.

Good times to run:

- Before tagging a release that touches the calendar render path, recurrence expansion, or the SQL boot path.
- After a refactor that targeted memory or boot time, to verify the predicted win materialized.
- When investigating a user report of "the app got slow" against a representative dataset.

Bad times to run:

- During active development of unrelated features. The numbers will fluctuate from window-manager noise alone.
- On battery, with throttling, with a heavy load on the same machine, or with browser dev tools open. Any of these contaminate the reading.

## Data safety

The harness uses an isolated database file (`app_config_dir/ganbaruai-benchmark.db`) for the entire run. The user's real database (`ganbaruai.db`) and vault directory are never opened. Every step of the run lands in the benchmark file:

- The state-file flag `vaultMode: "benchmark"` rides through every restart and tells the boot path which database URL to open.
- `prepare_benchmark_db` deletes the benchmark file and its `-wal` / `-shm` sidecars before the first restart, so a stale leftover from an aborted prior run cannot pollute a fresh measurement.
- `teardown_benchmark_db` deletes the same three files when the user closes the summary, and also runs from the cancel and stale-state-recovery paths.
- A separate `restart_app` after teardown returns the app to the user's real database for normal operation.

Under this isolation the synthetic dataset is unreachable from any code that touches the user's real data. The seed step writes events into the benchmark database. The calendar-nav scenario's `cleanup` is a no-op (the entire database file is deleted in the next step). A future sync layer would only see the user database, never the benchmark database, so synth events never propagate to other devices.

Crash recovery is straightforward. A stale benchmark file left behind by a crash is harmless because the app boots into the user database on the next normal launch (no benchmark state file means no `vaultMode` override). The next benchmark run executes `prepare_benchmark_db` which deletes the leftover. The stale-state TTL guard also deletes it on the next boot if more than `STATE_TTL_MS` has elapsed.

## Phase intent

**Phase A is an empty baseline.** Both phases boot cold against the isolated benchmark database. Phase A runs immediately after the first restart, so the database has no events. Phase A is reproducible across runs and across users.

**Phase B is the synth-1000 dataset.** Between phases the runner seeds 1000 deterministic events into the benchmark database, persists state, and triggers the second restart. Phase B boots cold against the seeded database.

The delta between Phase A and Phase B is the cost of having 1000 events in the calendar, not the cost of one user's specific data. Cross-build comparisons in PERFORMANCE.md are valid because every build runs against the same baseline (empty) and the same controlled load (synth-1000).

## Scenario contract

A scenario is one TypeScript module exporting a `BenchmarkScenario` value. The contract is:

```ts
export interface BenchmarkScenario {
  /** Stable identifier. Used for the persisted state file and in markdown output. */
  id: string;
  /** Human label shown on the perf-panel Run button. */
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
   * starts a peak-sampling timer before calling this and stops it after. The
   * scenario only needs to keep the work loop going for the full window.
   */
  runStress(signal: AbortSignal): Promise<void>;
  /**
   * Seed the synthetic dataset into the (isolated) benchmark database between
   * Phase A and the second restart. The dataset version tag goes into the
   * markdown output so seeds stay traceable across builds.
   */
  seed(version: string): Promise<{ calendarId: string; eventCount: number }>;
  /**
   * Undo whatever `seed()` created. In v2 this is typically a no-op because
   * the benchmark database is dropped wholesale at the end of the run. The
   * hook stays in the contract for scenarios that want finer-grained cleanup.
   */
  cleanup(seedHandle: { calendarId: string }): Promise<void>;
}
```

The runner orchestrates two phases around this contract. Each phase is one cold boot of the app:

- **Phase A** runs `setup()` then `runStress()` against the empty benchmark database. Memory is sampled at 200 ms cadence during the 3000 ms stress burst (peak buffer), then once at +30 s afterward. Boot marks already captured by `lib/stores/perflog.svelte.ts` and the process-spawn-anchored `get_startup_elapsed_ms` are folded into the result.
- **Phase B** runs the same shape on the next cold boot, with `seed()` having populated the benchmark database between the phases.

Each phase therefore captures a memory curve, a peak, and the boot timings of the cold run that produced it.

## State machine

The harness drives three cold restarts per run. State persists to `app_config_dir/benchmark-state.json` between them. The boot path (`lib/api/db.ts`) reads the `vaultMode` flag to decide which database URL to open.

```
[idle]
  user clicks Run
  user confirms
  -> prepare_benchmark_db (idempotent delete of ganbaruai-benchmark.db{,-wal,-shm})
  -> write { vaultMode: benchmark, stage: phase-a-pending, ... }
  -> restart_app                                (restart 1)
[boot, vaultMode=benchmark, stage=phase-a-pending]
  -> SQL plugin opens ganbaruai-benchmark.db (empty, migrations run)
  -> checkAndResume picks up state
  -> run Phase A (3 s stress + ~30 s sampling)
  -> scenario.seed(synth-1000)
  -> write { vaultMode: benchmark, stage: phase-b-pending, phaseA, seedHandle }
  -> restart_app                                (restart 2)
[boot, vaultMode=benchmark, stage=phase-b-pending]
  -> SQL plugin opens ganbaruai-benchmark.db (now has synth events)
  -> checkAndResume picks up state
  -> run Phase B (3 s stress + ~30 s sampling)
  -> show summary
[summary]
  user clicks Close
  -> teardown_benchmark_db
  -> clear_benchmark_state
  -> restart_app                                (restart 3)
[boot, no state, default]
  -> SQL plugin opens ganbaruai.db (user's real DB, untouched throughout)
[idle]
```

Total wall time: 3 restarts plus 2 phases plus seed bridge, about 80 seconds.

## Sampling cadence

The cadence is pinned in `lib/benchmark/types.ts` (`SAMPLE_OFFSETS_MS`) and reproduced here so historical entries in PERFORMANCE.md remain readable:

| Sample point | What it captures |
|---|---|
| `peak`        | Maximum total observed during the 3000 ms stress burst (200 ms sampling). |
| `t0`          | First reading after `runStress` resolves. Includes any unreleased GC residue. |
| `+30s`        | One major-GC window after the burst. The bounded-window asymptote we report as the "settled floor." |

The +30 s point is an empirical asymptote, not a true settled value. WebKit GC is non-deterministic and a late full collection can fire 10+ minutes after the burst (we observed a 49 MB drop at +5 m on Phase A in one run, and no drop at all in another). v1 of the harness sampled out to +5 m. That data showed everything past +30 s sat in a flat ±13 MB jitter band; the additional five minutes of wall time bought no signal. For cross-build comparison the +30 s budget is consistent, which is the property that matters.

If real runs ever show the +30 s point lands inside a different jitter band on a future codebase, revisit the offset rather than shipping a runtime toggle. Cadence drift across runs invalidates historical comparisons.

## What the harness does and does not measure

The calendar-nav scenario drives `nav-handle.svelte.ts` `navigate("forward")` once per `requestAnimationFrame` tick for `STRESS_DURATION_MS` (3000 ms). At a 60 Hz display this fires roughly 180 times per phase.

After the held-arrow regression fix (commit `18cbfae`), real-key holding is throttled to one navigation per frame on keydown auto-repeat. Post-fix measurements of the user's real key-held nav peaks (460 MB on a 968-event Google Calendar import) sit within ~1 MB of the harness rAF Phase A peak on equivalent data. Pre-fix the gap was about 187 MB because nav events queued past the keyup release and drained over ~9 seconds. The harness peak is therefore representative of real-key sustained use, not a pathological synthetic stress.

The harness's job is cross-build comparison. Absolute "this is how much memory the app actually uses on my machine" claims should reference live perf-panel readings on the user's real data, not harness rows.

The harness does not measure:

- Late GC behavior beyond the +30 s window. See sampling cadence.
- Headless or CI runs. WebKit's GC heuristics need a real graphical environment to behave consistently. The harness is interactive only.
- Real-world keyboard or pointer event handling. The rAF loop bypasses event-loop queue dynamics.

## Synthetic event generator (calendar scenario)

The first scenario seeds events into a dedicated calendar inside the benchmark database. Because the benchmark database is dropped wholesale at the end of the run, the scenario does not need its own delete-the-calendar cleanup path. User-data isolation is enforced one level up by the benchmark-database-file boundary. The dataset is versioned: `benchmark-synth-v1` ships first, and any change to the generator's distribution or shape requires bumping to `v2`. The version string is part of the markdown output, so historical rows in PERFORMANCE.md stay clearly tagged with the dataset that produced them.

`v1` distribution (1000 events by default, parameterizable per scenario), spread across `[today - 365d, today + 365d]`, generated from a `mulberry32` PRNG seeded with `0x1234`:

| Share | Shape |
|---|---|
| 70% | Timed plain. Random start snapped to a 15-minute boundary, duration in `{30, 60, 90}` minutes, no description. |
| 10% | Timed with description. Same start/duration distribution, plus a 50 to 200 character synthetic description. |
| 10% | Recurring. Split among `FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=MO,WE,FR`, `FREQ=MONTHLY`. Half capped with `COUNT=20`, half open-ended. |
| 5%  | All-day, single-date span. |
| 5%  | One alarm or one to three attendees. |

Determinism is the contract. For a given seed, the first N events must be byte-identical across runs and across machines. The vitest suite in `lib/benchmark/synth.test.ts` locks the first five events in golden form so silent generator drift fails the build.

Bumping to `v2` means renaming the constant and starting a fresh row series in PERFORMANCE.md. Old rows tagged `v1` stay readable. New rows tagged `v2` are not directly comparable to them, and the doc should call that out.

## Output format

The summary overlay emits a single markdown block. The shape is pinned so historical rows in PERFORMANCE.md remain comparable. Numbers below come from the worked example tested in `lib/benchmark/output.test.ts` (not a real run).

````markdown
## Benchmark 2026-05-01 (build 9815ea5, Linux Ubuntu 25.10, WebKitGTK 2.46)

Scenario: calendar-nav, dataset benchmark-synth-v1 (1000 events).
Methodology: cold-cold against an isolated benchmark DB; 3000 ms programmatic stress; sampled at 200 ms during stress, then once at +30 s post-stress.

### Boot (ms from process start)

| Mark              | Phase A (0 events) | Phase B (1000 events) |
|-------------------|--------------------|-----------------------|
| launch-total      | 1430               | 1612                  |
| sql-main-done     | 412                | 609                   |
| maprow-done       | 415                | 783                   |
| first-paint       | 542                | 921                   |

### Memory PSS, MB (backend / frontend / network / total)

| t     | Phase A (0 events)          | Phase B (1000 events)       |
|-------|-----------------------------|-----------------------------|
| peak  | 87.0 / 261.0 / 16.0 / 348   | 87.0 / 430.0 / 16.0 / 517   |
| t0    | 87.0 / 231.0 / 16.0 / 318   | 87.0 / 400.0 / 16.0 / 487   |
| +30s  | 87.0 / 191.0 / 16.0 / 278   | 87.0 / 231.0 / 16.0 / 318   |

Settled floor: empty 278 MB at +30s, synth 318 MB at +30s. 1000-event delta over empty: +40 MB at floor, +169 MB at peak.
````

The boot table's first row, `launch-total`, comes from `get_startup_elapsed_ms` (anchored to Rust process spawn) and surfaces shell-startup wins that script-anchored boot marks miss. The remaining boot rows are perflog marks fired from the WebKit document.

The format is deliberately one block, not two. Phase A and Phase B share rows so the reader can compare the same sample point across phases at a glance. Phase columns are labeled with the actual event count (`Phase A (0 events)`, `Phase B (1000 events)`) so legacy rows that ran against non-empty data are visibly distinguishable.

The settled floor footer summarizes the takeaway: the asymptote and the dataset cost.

The markdown is also legal Markdown for the doc renderer in the summary overlay, so the user sees the same shape in-app that they paste into PERFORMANCE.md.

## How to add a scenario

1. **Create the module** at `apps/client/src/lib/benchmark/scenarios/<scenario-id>.ts`. Implement the `BenchmarkScenario` interface. The `id` becomes part of the persisted state filename and the markdown output, so pick something stable.
2. **Decide what `runStress` does.** It must keep the JS event loop working for the full `STRESS_DURATION_MS` window. For UI scenarios this typically means scheduling work via `requestAnimationFrame` so the work matches a real user's frame budget. Honor the `AbortSignal` so a cancel from the runner stops the loop promptly.
3. **Seed your data.** `seed()` runs against the isolated benchmark database. Return a handle the runner can hand back to `cleanup()`.
4. **`cleanup()` is usually a no-op.** The benchmark database is dropped wholesale on summary close, so per-calendar / per-table cleanup only matters if your scenario wants to release memory mid-run.
5. **Vault scenarios need vault isolation.** The current isolation only covers the database. A scenario that writes to disk under `vault/` (notes, diary, project files) will leak into the user's vault until vault-directory isolation lands. The slot is reserved in `apps/client/src-tauri/src/vault.rs`. The calendar-nav scenario does not need it.
6. **Register it.** The TitleBar performance panel reads the registry in `lib/benchmark/registry.ts` and renders a Run button per scenario below "Copy all". Adding to the registry surfaces the new scenario in the perf panel without other UI changes.
7. **Lock the synth.** If your scenario seeds a deterministic dataset, add a vitest case under `lib/benchmark/scenarios/<id>.test.ts` that pins the first few generated items in golden form. This is the only protection against silent generator drift.

The runner, sampler, output formatter, and persistence layer are scenario-agnostic. A new scenario does not touch those files.

## Pitfalls and constraints

**GC un-forceability.** WebKit and V8 do not let user code force a major collection. The +30 s sample is an empirical asymptote, not a guarantee. If the curve is non-monotonic, rerun.

**Restart fragility.** `AppHandle::restart()` on Linux spawns a new instance via the original argv. Distros that wrap the binary through a launcher script may break the relaunch. The runner's contract is: if the relaunch fails, the persisted state stays on disk, and the next manual reopen of the app picks up the next phase from where the prior one left off. The persisted state includes the harness version and an ISO 8601 `startedAt`. If either is stale (harness version mismatch, or `startedAt` more than `STATE_TTL_MS` old), the boot-time check deletes the benchmark database and clears the state silently before continuing.

**Synth shape drift.** Bumping the generator without renaming the version invalidates every prior row in PERFORMANCE.md. The contract is: rename the constant in `synth.ts`, write a one-line note in PERFORMANCE.md when the new version's first row lands. Old rows then read as historical context for the prior shape, not as comparable data points to the new shape.

**Cross-build comparability.** Even within a single dataset version, comparing two runs requires holding constant: the host machine, the OS and WebKitGTK version, the window manager state, the absence of dev tools, and ideally a fresh boot. The harness does not enforce these. Document them in the row's prefix line so the reader can spot apples-to-oranges comparisons.

**Stale benchmark file.** If the app crashes between restart 1 and restart 3, the benchmark database file lives on disk indefinitely. The next benchmark run's `prepare_benchmark_db` overwrites it. The stale-state TTL guard also deletes it on the next normal boot. Worst case is wasted disk space on the order of a few MB until the next run.

**Migrations on the benchmark database.** First open of `ganbaruai-benchmark.db` runs all migrations. A migration with a bug that only shows on a fresh schema would surface during Phase A boot. This is a useful side effect: the harness exercises a fresh DB schema every run.

**Bounded-window asymptote, not true floor.** The +30 s reading captures most of the post-stress decay but not late GC events. Cross-build comparison still works because every build pays the same +30 s budget. Absolute claims should not lean on the +30 s number as a steady-state ceiling.

## Versioning

`HARNESS_VERSION` is `"2"`. v1 markdown rows in PERFORMANCE.md are not directly comparable to v2 rows because v1 ran Phase A inline against the user's data (not isolated, not a clean baseline) and sampled out to +5 m. v1 rows live under their own heading in PERFORMANCE.md so the reader can tell at a glance which harness produced a row.

A v1 state file left over from an interrupted v1 run is invalidated automatically. `loadPersistedState()` in `runner.ts` checks `harnessVersion` and returns `null` (with `discardStaleArtifacts` cleanup) if the version does not match. The same path handles `synthVersion` mismatches.

## Critical files

- `lib/benchmark/types.ts`: `BenchmarkScenario`, `PhaseResult`, `SamplePoint`, `BenchmarkState` (with `vaultMode` and `stage`), `HARNESS_VERSION`, `SAMPLE_OFFSETS_MS`.
- `lib/benchmark/sampler.ts`: peak-sampling and idle-curve sampling. Wraps `get_memory_report` invokes and the `snapshot()` helper from `lib/stores/perflog.svelte.ts`.
- `lib/benchmark/runner.ts`: phase orchestration, `persistPhaseAPending` / `persistPhaseBPending`, `loadPersistedState` / `clearPersistedState`, restart wiring. Captures `startupMs` per phase via `get_startup_elapsed_ms`.
- `lib/benchmark/synth.ts`: `mulberry32` PRNG plus the `v1` distribution. Pure logic; tested.
- `lib/benchmark/output.ts`: `BenchmarkResult` to markdown. Renders the `launch-total` row from `startupMs`. Pure logic; tested.
- `lib/benchmark/registry.ts`: list of installed scenarios. Adding to this array surfaces the scenario in the UI.
- `lib/benchmark/scenarios/calendar-nav.ts`: first scenario, worked example. v2 cleanup is a no-op.
- `lib/api/db.ts`: resolves the SQLite URL once per process by reading the benchmark state file. `vaultMode === "benchmark"` returns `sqlite:ganbaruai-benchmark.db`. Otherwise it returns the user database name.
- `lib/stores/benchmarkRunner.svelte.ts`: drives the state machine. `confirm`, `checkAndResume`, `closeSummary`, `cancel`.
- `apps/client/src-tauri/src/lib.rs`: `read_benchmark_state`, `write_benchmark_state`, `clear_benchmark_state`, `restart_app`, `prepare_benchmark_db`, `teardown_benchmark_db`, `get_startup_elapsed_ms`, `get_memory_report`. Registers SQL migrations for both the user database and `sqlite:ganbaruai-benchmark.db`.
- `lib/components/calendar/nav-handle.svelte.ts`: shared store exposing `navigate(dir)` and `setViewMode(mode)` for headless drivers.
- `lib/components/TitleBar.svelte`: performance panel hosts the Run buttons for every scenario in the registry.
- `lib/components/benchmark/BenchmarkOverlay.svelte`: full-screen overlay during a run, renders the summary tables on completion.

The harness reuses the existing memory and perf-mark infrastructure verbatim: `get_memory_report` (Tauri command in `lib.rs`), `mark()` and `snapshot()` (in `lib/stores/perflog.svelte.ts`), and the boot/nav marks already firing from `App.svelte` and `CalendarView.svelte`. None of those files change for the harness.

# Performance

This file is the canonical performance record for GanbaruAI. It exists so future agents can reason about RAM, startup time, interaction speed, and package size without reconstructing old debugging sessions.

## Index

- [How to capture new results](#how-to-capture-new-results)
- [Canonical tracking rules](#canonical-tracking-rules)
- [Benchmark identifiers](#benchmark-identifiers)
- [Benchmark records](#benchmark-records)
- [Historical context](#historical-context)
- [Package size](#package-size)
- [Output rules](#output-rules)
- [Performance principles](#performance-principles)
- [Measurement notes](#measurement-notes)

## How to capture new results

Use benchmark-generated output as the source of truth. Manual copies from the performance panel are diagnostic only, because they can mix real user data, warm boots, open diagnostics UI, and human timing.

To capture a comparable run:

1. Build and install a release package.
2. Open GanbaruAI from the installed app, not `pnpm tauri dev`. **This is important! Tauri uses more resources in dev mode.**
3. Open the title-bar performance panel.
4. Under Benchmarks, click `Run core benchmarks`, `Run backend benchmarks`, or `Run all benchmarks` depending on the change being measured.
5. Do not interact with the app while the overlay is running.
6. When the summary appears, review the readable tables, copy the markdown, and send it to an agent for careful placement here.

The app runs every benchmark against isolated benchmark databases. The user's real database is not opened during a benchmark pass.
The markdown output is an interchange format for the agent. Do not paste it verbatim into this file; place its rows into the matching canonical tables below.
Generated run ids ending in `-ID` are unresolved placeholders. Before recording rows here, replace `YYYY-MM-DD-ID` with the next zero-padded run id for that date, such as `YYYY-MM-DD-01` or `YYYY-MM-DD-02`. No canonical row should keep `-ID`.

## Canonical tracking rules

Run metadata must identify:

- Harness version.
- Platform, including OS family plus distro/version or Windows version.
- Build reference in `version+git-ref` form, with `-dirty` when the app was built from a dirty worktree.
- Notes, only when the run needs context that affects interpretation. Blank is normal. Do not use notes for generic labels such as "current baseline".

Measurement rows must identify:

- Run id.
- Dataset id.
- The primary measurement type: startup boot, idle memory, stress memory, interaction latency, or operation latency.

Measurement tables must not include a generic `Notes` column. Keep fixed scenario methodology in the harness spec. If a future detail becomes important enough to compare across runs, add a dedicated typed column instead of hiding it in prose.

Do not paste ad hoc `Live RAM`, `Startup RAM snapshot`, or `Speed log` panel copies into the canonical tables. Use those while investigating, then run the benchmark suite when a change needs to be recorded.

## Benchmark identifiers

This section defines identifiers used by recorded rows. Harness behavior, suite membership, scenario definitions, dataset generation, and version-specific methodology live in [performance-benchmark.md](features/performance-benchmark.md).

### Dataset ids

Benchmark rows use compact dataset ids. Do not write prose dataset labels in measurement tables. Dataset id semantics are defined in the harness spec.

| Pattern | Meaning |
|---|---|
| `base-N` | The isolated benchmark DB after scenario setup and before dense dataset seeding. `N` is the number of calendar events present at measurement start. Use `base-0` for a truly empty benchmark DB. |
| `dense-vX-rYy-sZ-dP` | Dense calendar dataset version `X`, seeded from `Y` years before through `Y` years after the benchmark anchor. `sZ` is the number of timed events stacked at each hour; `dP` is the dense detail profile. For example, `dense-v1-r1y-s1-d1` means dense dataset v1, one year back and forward, one timed event per hour, and detail profile 1. |
| `synth-vX-N` | Historical synthetic benchmark dataset. Do not use this pattern for new v3 rows. |

Keep dataset ids stable and mechanical. If a future benchmark needs non-calendar setup data, record that context in run metadata or the harness spec instead of expanding the dataset id into prose.

## Benchmark records

Latest canonical baseline: `2026-05-11-01` on harness `v3` with dense `v1` datasets. Canonical rows keep medians, P95 values, and memory buckets that can support long-run comparisons. Raw harness diagnostics such as per-action counters, fixed guard timings, min/max outliers, and redundant averages are not preserved here unless they answer a specific performance question. Interaction rows use the realistic dense current-window dataset unless the benchmark is explicitly asking about empty-state or total-history behavior.

### Run metadata

| Run | Harness | Build ref | Platform | Notes |
|---|---|---|---|---|
| 2026-05-05-01 | v1 | 0.1.0+889cc3c | Linux Ubuntu 24.04.4 LTS |  |
| 2026-05-09-01 | v1 | 0.1.0+e3c35c7 | Linux Ubuntu 24.04.4 LTS |  |
| 2026-05-10-01 | v1 | 0.1.0+5589e3f | Linux Ubuntu 24.04.4 LTS |  |
| 2026-05-10-02 | v1 | 0.1.0+f3bd22b | Linux Ubuntu 24.04.4 LTS |  |
| 2026-05-10-03 | v2 | 0.1.0+bf7b282 | Linux Ubuntu 24.04.4 LTS |  |
| 2026-05-10-04 | v2 | 0.1.0+5a5f19c | Linux Ubuntu 24.04.4 LTS |  |
| 2026-05-11-01 | v3 | 0.1.0+2c94f8a | Linux Ubuntu 24.04.4 LTS |  |

### Startup boot

Use `Launch median ms` as the headline app-open comparison value. `Usable paint median ms` marks when the app is ready for interaction.

| Run | Dataset | Runs | Usable paint median ms | Launch median ms | Launch P95 ms |
|---|---|---:|---:|---:|---:|
| 2026-05-05-01 | base-0 | 5 | 215 | 868 | 987 |
| 2026-05-05-01 | synth-v1-1000 | 5 | 722 | 1444 | 1550 |
| 2026-05-09-01 | base-0 | 5 | 190 | 691 | 810 |
| 2026-05-09-01 | synth-v1-1000 | 5 | 576 | 1060 | 1517 |
| 2026-05-10-01 | base-0 | 5 | 237 | 759 | 1230 |
| 2026-05-10-01 | synth-v1-1000 | 5 | 642 | 1132 | 1171 |
| 2026-05-10-02 | base-0 | 5 | 231 | 768 | 1197 |
| 2026-05-10-02 | synth-v1-1000 | 5 | 630 | 1143 | 1530 |
| 2026-05-10-03 | base-0 | 5 | 247 | 728 | 827 |
| 2026-05-10-03 | synth-v1-1000 | 5 | 501 | 995 | 1007 |
| 2026-05-10-03 | synth-v1-10000 | 5 | 1969 | 2470 | 2883 |
| 2026-05-10-04 | base-0 | 5 | 254 | 749 | 819 |
| 2026-05-10-04 | synth-v1-1000 | 5 | 497 | 1001 | 1395 |
| 2026-05-10-04 | synth-v1-10000 | 5 | 2180 | 2647 | 2702 |
| 2026-05-11-01 | base-0 | 5 | 254 | 736 | 830 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | 5 | 518 | 1075 | 1302 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | 5 | 515 | 994 | 1407 |

### Idle memory

Memory is PSS on Linux. On platforms that cannot report PSS, record the metric used in the run notes.

| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|
| 2026-05-05-01 | base-0 | workload peak | 110.9 | 208.9 | 17.5 | 337 |
| 2026-05-05-01 | base-0 | workload end | 110.6 | 188.4 | 17.5 | 317 |
| 2026-05-05-01 | base-0 | +30s | 110.8 | 191.4 | 17.5 | 320 |
| 2026-05-05-01 | synth-v1-1000 | workload peak | 113.7 | 272.1 | 17.7 | 404 |
| 2026-05-05-01 | synth-v1-1000 | workload end | 113.7 | 236.9 | 17.7 | 368 |
| 2026-05-05-01 | synth-v1-1000 | +30s | 112.9 | 242.8 | 17.7 | 373 |
| 2026-05-09-01 | base-0 | workload peak | 103.5 | 188.4 | 17.0 | 309 |
| 2026-05-09-01 | base-0 | workload end | 103.3 | 184.7 | 17.0 | 305 |
| 2026-05-09-01 | base-0 | +30s | 102.7 | 183.3 | 17.0 | 303 |
| 2026-05-09-01 | synth-v1-1000 | workload peak | 109.1 | 257.5 | 16.8 | 383 |
| 2026-05-09-01 | synth-v1-1000 | workload end | 108.9 | 234.1 | 16.8 | 360 |
| 2026-05-09-01 | synth-v1-1000 | +30s | 108.3 | 238.8 | 16.9 | 364 |
| 2026-05-10-01 | base-0 | workload peak | 110.5 | 194.7 | 19.0 | 324 |
| 2026-05-10-01 | base-0 | workload end | 110.3 | 191.3 | 19.0 | 321 |
| 2026-05-10-01 | base-0 | +30s | 109.7 | 189.7 | 19.0 | 318 |
| 2026-05-10-01 | synth-v1-1000 | workload peak | 115.1 | 266.6 | 19.0 | 401 |
| 2026-05-10-01 | synth-v1-1000 | workload end | 115.0 | 243.0 | 19.0 | 377 |
| 2026-05-10-01 | synth-v1-1000 | +30s | 114.4 | 244.6 | 19.1 | 378 |
| 2026-05-10-02 | base-0 | workload peak | 112.5 | 198.6 | 20.9 | 332 |
| 2026-05-10-02 | base-0 | workload end | 112.2 | 196.4 | 19.9 | 328 |
| 2026-05-10-02 | base-0 | +30s | 111.6 | 194.9 | 20.0 | 327 |
| 2026-05-10-02 | synth-v1-1000 | workload peak | 119.2 | 270.3 | 19.9 | 409 |
| 2026-05-10-02 | synth-v1-1000 | workload end | 119.0 | 245.1 | 19.9 | 384 |
| 2026-05-10-02 | synth-v1-1000 | +30s | 118.4 | 249.4 | 20.0 | 388 |
| 2026-05-10-03 | base-0 | workload peak | 106.4 | 196.3 | 17.4 | 320 |
| 2026-05-10-03 | base-0 | workload end | 106.0 | 191.9 | 17.4 | 315 |
| 2026-05-10-03 | base-0 | +30s | 105.4 | 190.2 | 17.5 | 313 |
| 2026-05-10-03 | synth-v1-1000 | workload peak | 107.1 | 272.3 | 17.4 | 397 |
| 2026-05-10-03 | synth-v1-1000 | workload end | 107.0 | 233.8 | 17.4 | 358 |
| 2026-05-10-03 | synth-v1-1000 | +30s | 106.3 | 234.9 | 17.5 | 359 |
| 2026-05-10-03 | synth-v1-10000 | workload peak | 112.8 | 406.0 | 17.3 | 536 |
| 2026-05-10-03 | synth-v1-10000 | workload end | 112.9 | 397.0 | 17.4 | 527 |
| 2026-05-10-03 | synth-v1-10000 | +30s | 112.3 | 366.0 | 17.4 | 496 |
| 2026-05-10-04 | base-0 | workload peak | 107.3 | 198.6 | 18.0 | 324 |
| 2026-05-10-04 | base-0 | workload end | 107.0 | 193.6 | 17.9 | 319 |
| 2026-05-10-04 | base-0 | +30s | 106.4 | 191.9 | 18.0 | 316 |
| 2026-05-10-04 | synth-v1-1000 | workload peak | 107.1 | 272.4 | 17.7 | 397 |
| 2026-05-10-04 | synth-v1-1000 | workload end | 107.0 | 235.8 | 17.7 | 360 |
| 2026-05-10-04 | synth-v1-1000 | +30s | 106.4 | 236.5 | 17.8 | 361 |
| 2026-05-10-04 | synth-v1-10000 | workload peak | 116.3 | 452.2 | 17.9 | 586 |
| 2026-05-10-04 | synth-v1-10000 | workload end | 116.3 | 420.9 | 18.0 | 555 |
| 2026-05-10-04 | synth-v1-10000 | +30s | 115.7 | 416.9 | 18.1 | 551 |
| 2026-05-11-01 | base-0 | workload peak | 108.1 | 199.9 | 17.9 | 326 |
| 2026-05-11-01 | base-0 | workload end | 107.8 | 195.3 | 17.9 | 321 |
| 2026-05-11-01 | base-0 | +30s | 107.1 | 193.9 | 18.0 | 319 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | workload peak | 111.3 | 261.3 | 17.7 | 390 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | workload end | 111.0 | 241.6 | 17.7 | 370 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | +30s | 110.3 | 243.2 | 17.8 | 371 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | workload peak | 112.4 | 260.3 | 17.9 | 391 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | workload end | 112.2 | 243.6 | 17.9 | 374 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | +30s | 111.6 | 241.9 | 18.0 | 371 |

### Calendar held navigation memory

This records memory while reproducing real held right-arrow navigation in week view against a practical full visible window. Harness counters for moves, repeats, and skipped ticks are useful while debugging the benchmark, but they are not kept in the long-run record because the benchmark scenario is already fixed by harness version and duration.

| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | workload peak | 111.9 | 319.5 | 17.7 | 449 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | workload end | 111.9 | 319.9 | 17.7 | 449 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | +30s | 110.8 | 311.1 | 17.8 | 440 |

### Event panel latency

Rows report user-visible elapsed time with a practical full visible window. Internal module, detail-load, state, and flush breakdowns are diagnostic and are not canonical.

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | edit open from closed | 10 | 83 | 188 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | edit switch while open | 10 | 27 | 32 |

### Create panel latency

This table keeps panel-open latency only, measured with a practical full visible window. Cancel-after-guard timing is a harness control path, so it is not part of the long-run performance record.

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | create panel open | 6 | 99 | 206 |

### Calendar write operations

These backend timings track representative user-facing calendar mutations against the practical dense dataset. Lower-level command variants, empty-DB controls, theme operations, and Pomodoro operations are diagnostic output and are not recorded here unless a run is explicitly focused on those subsystems.

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | event create save | 8 | 7 | 341 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | event patch save | 8 | 6 | 9 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | recurring split | 5 | 5 | 8 |

### Calendar import operations

Rows report one 1000-event add or update pass against the practical dense dataset. Smaller repeated import rows are diagnostic variance checks and are not part of the long-run record.

| Run | Dataset | Metric | Value ms |
|---|---|---|---:|
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | bulk import 1000 add | 315 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | bulk import 1000 update | 352 |

## Historical context

These runs are useful context but are not mixed into the current tables because their output shape measured incidental boot and RAM for every scenario or used an obsolete startup target.

| Run | Date | Legacy harness | Scope | Status |
|---|---|---|---|---|
| 2026-05-04-01 | 2026-05-04 | pre-canonical | `calendar-nav` only | Superseded by canonical question-oriented records |
| 2026-05-04-02 | 2026-05-04 | pre-canonical | Full suite | Superseded by canonical question-oriented records |
| 2026-05-04-03 | 2026-05-04 | pre-canonical | Full suite | Superseded by v1 startup methodology and scenario set |

## Package size

Package size is not produced by the benchmark harness, but it is deterministic enough to track here. Use decimal MB from byte size.

```bash
stat -c "%n %s" target/release/bundle/deb/*.deb target/release/bundle/rpm/*.rpm target/release/bundle/appimage/*.AppImage
```

| Date | Phase | What changed | Artifact | MB | Build host |
|---|---|---|---|---:|---|
| 2026-04-02 | Phase 1 | Baseline: calendar, pomodoro, kanban, performance panel | .deb | 7.0 | Linux |
| 2026-05-03 | Phase 1 | Event panel polish and startup memory work | .deb | 7.4 | Linux |
| 2026-05-03 | Phase 1 | Event panel polish and startup memory work | .rpm | 7.4 | Linux |
| 2026-05-03 | Phase 1 | Event panel polish and startup memory work | .AppImage | 80.9 | Linux |

## Output rules

Prefer normalized tables over compact cells. Good:

| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|

Avoid cells like `104.8 / 339.2 / 17.3 / 461`, because they are hard to diff, sort, and scan.

Use the latency table for repeated measurements. Keep median and P95 as the canonical statistics; raw averages, min, and max can stay in copied benchmark output but should not be recorded here unless a run is specifically analyzing tail behavior:

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|

For visible-window interaction benchmarks, record the practical dense current-window dataset (`dense-v1-r1y-s1-d1`) unless the benchmark question is specifically about empty-state behavior or total stored-history scale.

Use the startup table only for repeated process launches with the harness-defined closed-process cooldown. Launch median is the headline app-open value; P95 keeps the tail visible:

| Run | Dataset | Runs | Usable paint median ms | Launch median ms | Launch P95 ms |
|---|---|---:|---:|---:|---:|

Use the compact scalar table for one-off values that are themselves the measurement. Do not record harness-internal counters such as held-navigation repeat counts, skipped ticks, or deterministic dataset math unless they are the subject of the benchmark:

| Run | Dataset | Metric | Value | Unit |
|---|---|---|---:|---|

Only bump `HARNESS_VERSION`, `DENSE_DATASET_VERSION`, or dense detail profile names after the current version has at least one run recorded in the run metadata. During unrecorded benchmark iteration, edit the current version in place. Once a version has recorded rows, bump only when numeric comparability changes: measurement methodology, sampling cadence, scenario workload, or benchmark dataset generation. Do not bump for markdown layout, rendered-preview layout, wording, docs-only changes, column order, or removing helper sections such as a generated index. When the measurement method changes after recorded rows exist, explain whether old rows remain comparable; if not, old rows become historical context instead of direct comparison data.

## Performance principles

GanbaruAI should feel lightweight even though it uses Tauri plus a WebView. The floor is higher than a fully native UI, so app code should avoid adding avoidable RAM and startup cost.

General rules:

- Measure release builds, not dev mode.
- Keep benchmark data isolated from the user's real database.
- Compare runs on the same machine, OS, WebKit or WebView2 version, window state, and power mode.
- Prefer PSS for memory when available.
- Treat startup, idle memory, stress memory, and interaction speed as different questions. Do not let one benchmark stand in for all of them.
- Prefer fixing real cost over hiding warnings or increasing thresholds.
- Lazy-load inactive surfaces by default.
- Preload only when the UX gain is concrete and the RAM cost is measured.
- Keep hot render paths bounded by the visible window, not total database size.
- Keep large or rarely used fields out of always-resident frontend state.
- Use Rust for native I/O, filesystem safety, compression, and data work that already crosses IPC or is proven expensive. Keep UI state, layout, and Svelte component logic in TypeScript.

## Measurement notes

### Memory metrics

| Metric | Meaning | Use |
|---|---|---|
| USS | Private memory only | Useful for process internals, undercounts app cost |
| PSS | Private memory plus fair share of shared libraries | Preferred total on Linux |
| RSS | Private memory plus full shared libraries per process | Often available, overcounts shared libraries |

Linux currently reads PSS from `/proc/{pid}/smaps_rollup`. Windows uses Working Set through Win32 APIs, which is closer to RSS. macOS memory reporting is not implemented yet.

### Process buckets

| Bucket | Meaning |
|---|---|
| Backend | Rust process, Tauri runtime, SQLite, native commands |
| Frontend | WebKit or WebView2 renderer plus Svelte app, DOM, CSS, JS heap |
| Network | WebKit or WebView2 network process |

The frontend number includes the browser engine. It cannot be split cleanly into "WebKit baseline" and "GanbaruAI app code" at runtime.

### Performance panel

The title-bar performance panel is a diagnostic tool. It can copy live RAM, startup RAM, charts, speed logs, and benchmark summaries. Only benchmark summaries should become canonical rows in this file.

The panel itself is lazy-loaded. Live memory polling starts only while the panel is mounted. The startup RAM snapshot is captured before the panel needs to be opened, so it remains useful for quick local diagnosis even if it is not the canonical record.

### Current architecture notes

These notes explain the broad shape of current performance work. They should stay conceptual, not incident-specific.

- Calendar render state is loaded through a Rust window query. Non-recurring rows are bounded by the visible date window, and recurring templates are expanded through a Rust render command after row mapping. TypeScript recurrence remains for unsaved edit previews.
- Calendar window loading is latest-wins. Rapid navigation can leave an already-started native query in flight, but stale requests should not continue through mapping, recurrence expansion, state application, and paint once a newer target exists. A small bounded cache keeps recent day/week render windows available for adjacent navigation.
- Held keyboard navigation fires once immediately, then repeats through gated timer ticks and native repeated keydown events. Repeat cadence is gated by pending anchor commits, not foreground window loads. Keyup cancels future repeat intent, and missed repeat ticks are not replayed later.
- Calendar render state uses slim event rows. Heavy fields such as description, attendees, alarms, extended properties, and organizer stay in SQLite until a workflow needs them.
- EventPanel is dynamically imported and can be parked offscreen after first paint to trade a small measured RAM cost for faster first interaction.
- Event detail loading uses a lighter `loadPanelEvent` path for panel opens and `loadFullEvent` only where full fidelity is required, such as ICS export and undo snapshots.
- Timezone search metadata is lazy. Startup only builds active-zone labels.
- The performance and benchmark UI should stay lazy so measuring the app does not significantly change the app being measured.

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
| `dense-vX-rYy-sZ-dP` | Dense calendar benchmark dataset. |
| `synth-vX-N` | Historical synthetic benchmark dataset. Do not use this pattern for new v3 rows. |

Keep dataset ids stable and mechanical. If a future benchmark needs non-calendar setup data, record that context in run metadata or the harness spec instead of expanding the dataset id into prose.

## Benchmark records

Latest recorded canonical baseline: `2026-05-11-01` with harness v3. The run metadata table below is the source of truth for recorded harness versions.

Do not bump `HARNESS_VERSION`, `DENSE_DATASET_VERSION`, or dense detail profiles for iteration alone. While tuning a benchmark before recording a run, edit the current version in place. Bump only when at least one run using the current version has been recorded in the run metadata and a later change would make new numbers incomparable with those recorded rows.

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

### Core benchmarks

Core benchmark rows measure user-perceived startup, memory, and interaction latency.

#### Startup boot

Use `Launch median ms` as the headline app-open comparison value. `First paint median ms` and `Usable paint median ms` are diagnostic timing marks from the harness.

| Run | Dataset | Runs | First paint median ms | Usable paint median ms | Launch min ms | Launch P95 ms | Launch max ms | Launch median ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-05-05-01 | base-0 | 5 | 120 | 215 | 855 | 987 | 987 | 868 |
| 2026-05-05-01 | synth-v1-1000 | 5 | 121 | 722 | 1370 | 1550 | 1550 | 1444 |
| 2026-05-09-01 | base-0 | 5 | 113 | 190 | 671 | 810 | 810 | 691 |
| 2026-05-09-01 | synth-v1-1000 | 5 | 113 | 576 | 1022 | 1517 | 1517 | 1060 |
| 2026-05-10-01 | base-0 | 5 | 143 | 237 | 730 | 1230 | 1230 | 759 |
| 2026-05-10-01 | synth-v1-1000 | 5 | 144 | 642 | 1125 | 1171 | 1171 | 1132 |
| 2026-05-10-02 | base-0 | 5 | 141 | 231 | 746 | 1197 | 1197 | 768 |
| 2026-05-10-02 | synth-v1-1000 | 5 | 142 | 630 | 1119 | 1530 | 1530 | 1143 |
| 2026-05-10-03 | base-0 | 5 | 149 | 247 | 725 | 827 | 827 | 728 |
| 2026-05-10-03 | synth-v1-1000 | 5 | 146 | 501 | 978 | 1007 | 1007 | 995 |
| 2026-05-10-03 | synth-v1-10000 | 5 | 143 | 1969 | 2452 | 2883 | 2883 | 2470 |
| 2026-05-10-04 | base-0 | 5 | 147 | 254 | 729 | 819 | 819 | 749 |
| 2026-05-10-04 | synth-v1-1000 | 5 | 147 | 497 | 999 | 1395 | 1395 | 1001 |
| 2026-05-10-04 | synth-v1-10000 | 5 | 147 | 2180 | 2598 | 2702 | 2702 | 2647 |
| 2026-05-11-01 | base-0 | 5 | 147 | 254 | 714 | 830 | 830 | 736 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | 5 | 144 | 518 | 882 | 1302 | 1302 | 1075 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | 5 | 148 | 515 | 984 | 1407 | 1407 | 994 |

#### Idle memory

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

#### Calendar held navigation memory

Rows record memory plus scalar move counts emitted by the calendar navigation scenario. The exact key-event path and repeat cadence are defined in the harness spec.

| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|
| 2026-05-11-01 | base-0 | workload peak | 107.8 | 207.9 | 17.8 | 334 |
| 2026-05-11-01 | base-0 | workload end | 107.8 | 210.6 | 17.8 | 336 |
| 2026-05-11-01 | base-0 | +30s | 107.1 | 207.4 | 18.0 | 333 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | workload peak | 111.9 | 319.5 | 17.7 | 449 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | workload end | 111.9 | 319.9 | 17.7 | 449 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | +30s | 110.8 | 311.1 | 17.8 | 440 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | workload peak | 112.5 | 352.4 | 17.9 | 483 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | workload end | 112.6 | 352.4 | 18.0 | 483 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | +30s | 111.8 | 301.6 | 18.0 | 431 |

| Run | Dataset | Metric | Value | Unit |
|---|---|---|---:|---|
| 2026-05-11-01 | base-0 | held navigation moves | 24 | count |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | held navigation moves | 8 | count |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | held navigation moves | 9 | count |
| 2026-05-11-01 | base-0 | held navigation repeats | 23 | count |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | held navigation repeats | 7 | count |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | held navigation repeats | 8 | count |
| 2026-05-11-01 | base-0 | held navigation skipped ticks | 0 | count |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | held navigation skipped ticks | 7 | count |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | held navigation skipped ticks | 7 | count |

#### Historical calendar navigation stress memory

Rows below predate the held-key v3 methodology and are not directly comparable with new `calendar-nav` rows.

| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|
| 2026-05-05-01 | base-0 | workload peak | 108.6 | 324.7 | 17.7 | 451 |
| 2026-05-05-01 | base-0 | workload end | 108.6 | 330.2 | 17.7 | 456 |
| 2026-05-05-01 | base-0 | +30s | 108.0 | 324.2 | 17.7 | 450 |
| 2026-05-05-01 | synth-v1-1000 | workload peak | 114.7 | 359.9 | 17.7 | 492 |
| 2026-05-05-01 | synth-v1-1000 | workload end | 114.7 | 332.1 | 17.7 | 464 |
| 2026-05-05-01 | synth-v1-1000 | +30s | 114.0 | 301.4 | 17.8 | 433 |
| 2026-05-09-01 | base-0 | workload peak | 102.5 | 221.5 | 16.6 | 341 |
| 2026-05-09-01 | base-0 | workload end | 102.5 | 221.5 | 16.6 | 341 |
| 2026-05-09-01 | base-0 | +30s | 102.0 | 218.3 | 16.7 | 337 |
| 2026-05-09-01 | synth-v1-1000 | workload peak | 112.5 | 310.8 | 16.6 | 440 |
| 2026-05-09-01 | synth-v1-1000 | workload end | 112.5 | 314.7 | 16.6 | 444 |
| 2026-05-09-01 | synth-v1-1000 | +30s | 111.9 | 278.7 | 16.7 | 407 |
| 2026-05-10-01 | base-0 | workload peak | 110.1 | 223.0 | 19.0 | 352 |
| 2026-05-10-01 | base-0 | workload end | 110.1 | 220.1 | 19.0 | 349 |
| 2026-05-10-01 | base-0 | +30s | 109.6 | 217.2 | 19.1 | 346 |
| 2026-05-10-01 | synth-v1-1000 | workload peak | 119.0 | 326.6 | 19.0 | 465 |
| 2026-05-10-01 | synth-v1-1000 | workload end | 119.0 | 319.9 | 19.0 | 458 |
| 2026-05-10-01 | synth-v1-1000 | +30s | 118.4 | 296.4 | 19.1 | 434 |
| 2026-05-10-02 | base-0 | workload peak | 116.4 | 223.7 | 19.9 | 360 |
| 2026-05-10-02 | base-0 | workload end | 116.4 | 220.9 | 19.9 | 357 |
| 2026-05-10-02 | base-0 | +30s | 115.8 | 218.2 | 20.0 | 354 |
| 2026-05-10-02 | synth-v1-1000 | workload peak | 118.5 | 328.4 | 19.7 | 467 |
| 2026-05-10-02 | synth-v1-1000 | workload end | 118.5 | 319.3 | 19.7 | 458 |
| 2026-05-10-02 | synth-v1-1000 | +30s | 117.8 | 294.3 | 19.8 | 432 |
| 2026-05-10-03 | base-0 | workload peak | 106.0 | 231.0 | 17.4 | 354 |
| 2026-05-10-03 | base-0 | workload end | 106.0 | 235.8 | 17.4 | 359 |
| 2026-05-10-03 | base-0 | +30s | 105.4 | 221.9 | 17.5 | 345 |
| 2026-05-10-03 | synth-v1-1000 | workload peak | 106.4 | 376.5 | 17.2 | 500 |
| 2026-05-10-03 | synth-v1-1000 | workload end | 106.3 | 331.9 | 17.2 | 455 |
| 2026-05-10-03 | synth-v1-1000 | +30s | 105.5 | 321.3 | 17.3 | 444 |
| 2026-05-10-03 | synth-v1-10000 | workload peak | 113.9 | 414.0 | 17.1 | 545 |
| 2026-05-10-03 | synth-v1-10000 | workload end | 116.2 | 613.8 | 17.2 | 747 |
| 2026-05-10-03 | synth-v1-10000 | +30s | 115.3 | 815.2 | 17.2 | 948 |
| 2026-05-10-04 | base-0 | workload peak | 107.0 | 231.1 | 18.0 | 356 |
| 2026-05-10-04 | base-0 | workload end | 106.9 | 235.1 | 18.0 | 360 |
| 2026-05-10-04 | base-0 | +30s | 106.3 | 225.8 | 18.1 | 350 |
| 2026-05-10-04 | synth-v1-1000 | workload peak | 106.9 | 338.8 | 17.7 | 463 |
| 2026-05-10-04 | synth-v1-1000 | workload end | 107.0 | 319.3 | 17.7 | 444 |
| 2026-05-10-04 | synth-v1-1000 | +30s | 106.2 | 311.5 | 17.8 | 436 |
| 2026-05-10-04 | synth-v1-10000 | workload peak | 115.5 | 454.1 | 17.9 | 588 |
| 2026-05-10-04 | synth-v1-10000 | workload end | 115.7 | 930.8 | 18.0 | 1065 |
| 2026-05-10-04 | synth-v1-10000 | +30s | 115.1 | 1089.1 | 18.0 | 1222 |

#### Event panel latency

Rows report user-visible elapsed time. Internal module, detail-load, state, and flush breakdowns are diagnostic and are not canonical.

| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| 2026-05-05-01 | base-2 | edit open from closed avg | 29 | ms | 10 | 16 | 18 | 74 | 74 |
| 2026-05-05-01 | synth-v1-1002 | edit open from closed avg | 105 | ms | 10 | 87 | 95 | 169 | 169 |
| 2026-05-05-01 | base-2 | edit switch while open avg | 17 | ms | 10 | 15 | 16 | 28 | 28 |
| 2026-05-05-01 | synth-v1-1002 | edit switch while open avg | 52 | ms | 10 | 43 | 46 | 62 | 62 |
| 2026-05-09-01 | base-2 | edit open from closed avg | 25 | ms | 10 | 19 | 20 | 72 | 72 |
| 2026-05-09-01 | synth-v1-1002 | edit open from closed avg | 94 | ms | 10 | 74 | 83 | 184 | 184 |
| 2026-05-09-01 | base-2 | edit switch while open avg | 19 | ms | 10 | 16 | 19 | 20 | 20 |
| 2026-05-09-01 | synth-v1-1002 | edit switch while open avg | 50 | ms | 10 | 39 | 49 | 57 | 57 |
| 2026-05-10-01 | base-2 | edit open from closed avg | 24 | ms | 10 | 18 | 19 | 69 | 69 |
| 2026-05-10-01 | synth-v1-1002 | edit open from closed avg | 84 | ms | 10 | 79 | 83 | 95 | 95 |
| 2026-05-10-01 | base-2 | edit switch while open avg | 18 | ms | 10 | 16 | 18 | 19 | 19 |
| 2026-05-10-01 | synth-v1-1002 | edit switch while open avg | 46 | ms | 10 | 33 | 47 | 54 | 54 |
| 2026-05-10-02 | base-2 | edit open from closed avg | 23 | ms | 10 | 16 | 16 | 65 | 65 |
| 2026-05-10-02 | synth-v1-1002 | edit open from closed avg | 79 | ms | 10 | 66 | 80 | 85 | 85 |
| 2026-05-10-02 | base-2 | edit switch while open avg | 16 | ms | 10 | 15 | 16 | 17 | 17 |
| 2026-05-10-02 | synth-v1-1002 | edit switch while open avg | 46 | ms | 10 | 33 | 47 | 62 | 62 |
| 2026-05-10-03 | base-2 | edit open from closed avg | 32 | ms | 10 | 16 | 29 | 65 | 65 |
| 2026-05-10-03 | synth-v1-1002 | edit open from closed avg | 73 | ms | 10 | 50 | 67 | 141 | 141 |
| 2026-05-10-03 | synth-v1-10002 | edit open from closed avg | 396 | ms | 10 | 351 | 364 | 671 | 671 |
| 2026-05-10-03 | base-2 | edit switch while open avg | 16 | ms | 10 | 15 | 16 | 17 | 17 |
| 2026-05-10-03 | synth-v1-1002 | edit switch while open avg | 24 | ms | 10 | 16 | 20 | 34 | 34 |
| 2026-05-10-03 | synth-v1-10002 | edit switch while open avg | 94 | ms | 10 | 84 | 94 | 101 | 101 |
| 2026-05-10-04 | base-2 | edit open from closed avg | 24 | ms | 10 | 18 | 19 | 69 | 69 |
| 2026-05-10-04 | synth-v1-1002 | edit open from closed avg | 72 | ms | 10 | 63 | 65 | 141 | 141 |
| 2026-05-10-04 | synth-v1-10002 | edit open from closed avg | 408 | ms | 10 | 362 | 365 | 709 | 709 |
| 2026-05-10-04 | base-2 | edit switch while open avg | 18 | ms | 10 | 17 | 18 | 19 | 19 |
| 2026-05-10-04 | synth-v1-1002 | edit switch while open avg | 24 | ms | 10 | 16 | 20 | 33 | 33 |
| 2026-05-10-04 | synth-v1-10002 | edit switch while open avg | 99 | ms | 10 | 87 | 98 | 113 | 113 |
| 2026-05-11-01 | base-2 | edit open from closed avg | 25 | ms | 10 | 16 | 17 | 69 | 69 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | edit open from closed avg | 97 | ms | 10 | 82 | 83 | 188 | 188 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | edit open from closed avg | 104 | ms | 10 | 82 | 86 | 233 | 233 |
| 2026-05-11-01 | base-2 | edit switch while open avg | 16 | ms | 10 | 15 | 16 | 17 | 17 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | edit switch while open avg | 24 | ms | 10 | 15 | 27 | 32 | 32 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | edit switch while open avg | 26 | ms | 10 | 16 | 29 | 36 | 36 |

#### Create panel latency

The cancel timing includes the fixed 500 ms guard used by the scenario before closing the draft panel.

| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| 2026-05-05-01 | base-0 | create panel open avg | 51 | ms | 6 | 27 | 29 | 100 | 100 |
| 2026-05-05-01 | synth-v1-1000 | create panel open avg | 69 | ms | 6 | 53 | 68 | 78 | 78 |
| 2026-05-05-01 | base-0 | create cancel after guard avg | 63 | ms | 6 | 59 | 60 | 72 | 72 |
| 2026-05-05-01 | synth-v1-1000 | create cancel after guard avg | 98 | ms | 6 | 92 | 93 | 110 | 110 |
| 2026-05-09-01 | base-0 | create panel open avg | 48 | ms | 6 | 32 | 33 | 100 | 100 |
| 2026-05-09-01 | synth-v1-1000 | create panel open avg | 66 | ms | 6 | 50 | 66 | 95 | 95 |
| 2026-05-09-01 | base-0 | create cancel after guard avg | 59 | ms | 6 | 55 | 59 | 61 | 61 |
| 2026-05-09-01 | synth-v1-1000 | create cancel after guard avg | 83 | ms | 6 | 75 | 77 | 91 | 91 |
| 2026-05-10-01 | base-0 | create panel open avg | 38 | ms | 6 | 29 | 30 | 76 | 76 |
| 2026-05-10-01 | synth-v1-1000 | create panel open avg | 58 | ms | 6 | 49 | 50 | 81 | 81 |
| 2026-05-10-01 | base-0 | create cancel after guard avg | 59 | ms | 6 | 59 | 59 | 60 | 60 |
| 2026-05-10-01 | synth-v1-1000 | create cancel after guard avg | 81 | ms | 6 | 76 | 76 | 93 | 93 |
| 2026-05-10-02 | base-0 | create panel open avg | 38 | ms | 6 | 28 | 30 | 74 | 74 |
| 2026-05-10-02 | synth-v1-1000 | create panel open avg | 58 | ms | 6 | 50 | 50 | 67 | 67 |
| 2026-05-10-02 | base-0 | create cancel after guard avg | 59 | ms | 6 | 58 | 59 | 59 | 59 |
| 2026-05-10-02 | synth-v1-1000 | create cancel after guard avg | 82 | ms | 6 | 75 | 76 | 97 | 97 |
| 2026-05-10-03 | base-0 | create panel open avg | 36 | ms | 6 | 24 | 27 | 74 | 74 |
| 2026-05-10-03 | synth-v1-1000 | create panel open avg | 50 | ms | 6 | 32 | 33 | 135 | 135 |
| 2026-05-10-03 | synth-v1-10000 | create panel open avg | 434 | ms | 6 | 383 | 385 | 649 | 649 |
| 2026-05-10-03 | base-0 | create cancel after guard avg | 61 | ms | 6 | 58 | 60 | 66 | 66 |
| 2026-05-10-03 | synth-v1-1000 | create cancel after guard avg | 62 | ms | 6 | 59 | 59 | 74 | 74 |
| 2026-05-10-03 | synth-v1-10000 | create cancel after guard avg | 427 | ms | 6 | 417 | 420 | 456 | 456 |
| 2026-05-10-04 | base-0 | create panel open avg | 37 | ms | 6 | 18 | 32 | 77 | 77 |
| 2026-05-10-04 | synth-v1-1000 | create panel open avg | 50 | ms | 6 | 30 | 33 | 137 | 137 |
| 2026-05-10-04 | synth-v1-10000 | create panel open avg | 448 | ms | 6 | 385 | 400 | 691 | 691 |
| 2026-05-10-04 | base-0 | create cancel after guard avg | 59 | ms | 6 | 58 | 59 | 61 | 61 |
| 2026-05-10-04 | synth-v1-1000 | create cancel after guard avg | 62 | ms | 6 | 59 | 59 | 75 | 75 |
| 2026-05-10-04 | synth-v1-10000 | create cancel after guard avg | 443 | ms | 6 | 430 | 442 | 451 | 451 |
| 2026-05-11-01 | base-0 | create panel open avg | 39 | ms | 6 | 17 | 34 | 78 | 78 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | create panel open avg | 117 | ms | 6 | 98 | 99 | 206 | 206 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | create panel open avg | 127 | ms | 6 | 96 | 98 | 256 | 256 |
| 2026-05-11-01 | base-0 | create cancel after guard avg | 60 | ms | 6 | 58 | 59 | 62 | 62 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | create cancel after guard avg | 130 | ms | 6 | 126 | 127 | 142 | 142 |
| 2026-05-11-01 | dense-v1-r10y-s1-d1 | create cancel after guard avg | 130 | ms | 6 | 125 | 127 | 142 | 142 |

### Backend benchmarks

Backend benchmark rows measure Rust-backed persistence, import, and storage command latency.

#### Calendar write operations

Rows report Tauri IPC round-trip time for Rust-backed calendar write commands against the isolated benchmark database.

| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| 2026-05-10-02 | base-0 | event create save avg | 6 | ms | 8 | 3 | 4 | 16 | 16 |
| 2026-05-10-02 | synth-v1-1000 | event create save avg | 9 | ms | 8 | 3 | 4 | 38 | 38 |
| 2026-05-10-02 | base-0 | event patch save avg | 4 | ms | 8 | 3 | 3 | 6 | 6 |
| 2026-05-10-02 | synth-v1-1000 | event patch save avg | 4 | ms | 8 | 3 | 4 | 7 | 7 |
| 2026-05-10-02 | base-0 | event delete avg | 4 | ms | 8 | 3 | 3 | 8 | 8 |
| 2026-05-10-02 | synth-v1-1000 | event delete avg | 3 | ms | 8 | 2 | 3 | 4 | 4 |
| 2026-05-10-02 | base-0 | recurring detach avg | 5 | ms | 5 | 3 | 4 | 6 | 6 |
| 2026-05-10-02 | synth-v1-1000 | recurring detach avg | 4 | ms | 5 | 3 | 4 | 4 | 4 |
| 2026-05-10-02 | base-0 | recurring split avg | 4 | ms | 5 | 3 | 4 | 4 | 4 |
| 2026-05-10-02 | synth-v1-1000 | recurring split avg | 4 | ms | 5 | 3 | 4 | 4 | 4 |
| 2026-05-11-01 | base-0 | event create save avg | 8 | ms | 8 | 5 | 6 | 26 | 26 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | event create save avg | 53 | ms | 8 | 5 | 7 | 341 | 341 |
| 2026-05-11-01 | base-0 | event patch save avg | 5 | ms | 8 | 5 | 5 | 6 | 6 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | event patch save avg | 6 | ms | 8 | 5 | 6 | 9 | 9 |
| 2026-05-11-01 | base-0 | event delete avg | 6 | ms | 8 | 4 | 5 | 8 | 8 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | event delete avg | 12 | ms | 8 | 10 | 11 | 15 | 15 |
| 2026-05-11-01 | base-0 | recurring detach avg | 6 | ms | 5 | 5 | 6 | 7 | 7 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | recurring detach avg | 5 | ms | 5 | 5 | 5 | 6 | 6 |
| 2026-05-11-01 | base-0 | recurring split avg | 6 | ms | 5 | 5 | 5 | 7 | 7 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | recurring split avg | 6 | ms | 5 | 5 | 5 | 8 | 8 |

#### Calendar import operations

Repeated rows report 100-event import command timing. Scalar rows report one 1000-event add or update pass.

| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| 2026-05-10-02 | base-0 | bulk import 100 add avg | 38 | ms | 3 | 29 | 31 | 54 | 54 |
| 2026-05-10-02 | synth-v1-1000 | bulk import 100 add avg | 56 | ms | 3 | 29 | 31 | 107 | 107 |
| 2026-05-10-02 | base-0 | bulk import 100 update avg | 33 | ms | 3 | 32 | 33 | 35 | 35 |
| 2026-05-10-02 | synth-v1-1000 | bulk import 100 update avg | 33 | ms | 3 | 31 | 32 | 36 | 36 |
| 2026-05-11-01 | base-0 | bulk import 100 add avg | 43 | ms | 3 | 36 | 39 | 55 | 55 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | bulk import 100 add avg | 60 | ms | 3 | 38 | 58 | 85 | 85 |
| 2026-05-11-01 | base-0 | bulk import 100 update avg | 40 | ms | 3 | 35 | 40 | 45 | 45 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | bulk import 100 update avg | 42 | ms | 3 | 39 | 40 | 47 | 47 |

| Run | Dataset | Metric | Value | Unit |
|---|---|---|---:|---|
| 2026-05-10-02 | base-0 | bulk import 1000 add | 261 | ms |
| 2026-05-10-02 | synth-v1-1000 | bulk import 1000 add | 234 | ms |
| 2026-05-10-02 | base-0 | bulk import 1000 update | 277 | ms |
| 2026-05-10-02 | synth-v1-1000 | bulk import 1000 update | 289 | ms |
| 2026-05-11-01 | base-0 | bulk import 1000 add | 295 | ms |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | bulk import 1000 add | 315 | ms |
| 2026-05-11-01 | base-0 | bulk import 1000 update | 318 | ms |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | bulk import 1000 update | 352 | ms |

#### Theme persistence operations

Rows report Tauri IPC round-trip time for Rust-backed theme persistence commands.

| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| 2026-05-10-02 | base-0 | theme snapshot insert avg | 8 | ms | 8 | 6 | 7 | 16 | 16 |
| 2026-05-10-02 | synth-v1-1000 | theme snapshot insert avg | 12 | ms | 8 | 7 | 7 | 42 | 42 |
| 2026-05-10-02 | base-0 | theme snapshot replace avg | 7 | ms | 8 | 6 | 7 | 10 | 10 |
| 2026-05-10-02 | synth-v1-1000 | theme snapshot replace avg | 7 | ms | 8 | 6 | 7 | 9 | 9 |
| 2026-05-10-02 | base-0 | theme load all avg | 5 | ms | 8 | 4 | 5 | 7 | 7 |
| 2026-05-10-02 | synth-v1-1000 | theme load all avg | 5 | ms | 8 | 4 | 5 | 8 | 8 |
| 2026-05-10-02 | base-0 | theme source cascade avg | 5 | ms | 8 | 3 | 4 | 6 | 6 |
| 2026-05-10-02 | synth-v1-1000 | theme source cascade avg | 4 | ms | 8 | 4 | 4 | 5 | 5 |
| 2026-05-10-02 | base-0 | theme reset to seed avg | 4 | ms | 8 | 3 | 4 | 5 | 5 |
| 2026-05-10-02 | synth-v1-1000 | theme reset to seed avg | 3 | ms | 8 | 3 | 3 | 4 | 4 |
| 2026-05-11-01 | base-0 | theme snapshot insert avg | 18 | ms | 8 | 9 | 11 | 68 | 68 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | theme snapshot insert avg | 56 | ms | 8 | 9 | 11 | 340 | 340 |
| 2026-05-11-01 | base-0 | theme snapshot replace avg | 9 | ms | 8 | 8 | 9 | 11 | 11 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | theme snapshot replace avg | 10 | ms | 8 | 9 | 9 | 13 | 13 |
| 2026-05-11-01 | base-0 | theme load all avg | 5 | ms | 8 | 3 | 4 | 7 | 7 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | theme load all avg | 6 | ms | 8 | 3 | 6 | 10 | 10 |
| 2026-05-11-01 | base-0 | theme source cascade avg | 7 | ms | 8 | 6 | 6 | 8 | 8 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | theme source cascade avg | 7 | ms | 8 | 5 | 6 | 9 | 9 |
| 2026-05-11-01 | base-0 | theme reset to seed avg | 5 | ms | 8 | 4 | 5 | 6 | 6 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | theme reset to seed avg | 6 | ms | 8 | 4 | 5 | 9 | 9 |

#### Pomodoro persistence operations

Rows report Tauri IPC round-trip time for Rust-backed Pomodoro persistence commands.

| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| 2026-05-10-02 | base-0 | pomodoro insert segments avg | 4 | ms | 8 | 3 | 3 | 5 | 5 |
| 2026-05-10-02 | synth-v1-1000 | pomodoro insert segments avg | 13 | ms | 8 | 3 | 3 | 80 | 80 |
| 2026-05-10-02 | base-0 | pomodoro update segments avg | 5 | ms | 8 | 3 | 4 | 7 | 7 |
| 2026-05-10-02 | synth-v1-1000 | pomodoro update segments avg | 5 | ms | 8 | 3 | 4 | 7 | 7 |
| 2026-05-10-02 | base-0 | pomodoro cleanup event segments avg | 3 | ms | 8 | 2 | 3 | 3 | 3 |
| 2026-05-10-02 | synth-v1-1000 | pomodoro cleanup event segments avg | 4 | ms | 8 | 3 | 3 | 6 | 6 |
| 2026-05-10-02 | base-0 | pomodoro cleanup orphans avg | 10 | ms | 8 | 3 | 4 | 48 | 48 |
| 2026-05-10-02 | synth-v1-1000 | pomodoro cleanup orphans avg | 3 | ms | 8 | 3 | 3 | 5 | 5 |
| 2026-05-10-02 | base-0 | pomodoro save session avg | 5 | ms | 8 | 3 | 3 | 7 | 7 |
| 2026-05-10-02 | synth-v1-1000 | pomodoro save session avg | 3 | ms | 8 | 3 | 3 | 6 | 6 |
| 2026-05-11-01 | base-0 | pomodoro insert segments avg | 6 | ms | 8 | 5 | 6 | 8 | 8 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | pomodoro insert segments avg | 17 | ms | 8 | 5 | 6 | 59 | 59 |
| 2026-05-11-01 | base-0 | pomodoro update segments avg | 6 | ms | 8 | 5 | 6 | 6 | 6 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | pomodoro update segments avg | 6 | ms | 8 | 5 | 6 | 9 | 9 |
| 2026-05-11-01 | base-0 | pomodoro cleanup event segments avg | 6 | ms | 8 | 5 | 6 | 7 | 7 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | pomodoro cleanup event segments avg | 6 | ms | 8 | 5 | 5 | 7 | 7 |
| 2026-05-11-01 | base-0 | pomodoro cleanup orphans avg | 5 | ms | 8 | 4 | 5 | 6 | 6 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | pomodoro cleanup orphans avg | 16 | ms | 8 | 14 | 14 | 25 | 25 |
| 2026-05-11-01 | base-0 | pomodoro save session avg | 6 | ms | 8 | 5 | 5 | 10 | 10 |
| 2026-05-11-01 | dense-v1-r1y-s1-d1 | pomodoro save session avg | 6 | ms | 8 | 5 | 5 | 8 | 8 |

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

Use the full latency table only for repeated measurements:

| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |
|---|---|---|---:|---|---:|---:|---:|---:|---:|

Use the startup table only for repeated process launches with the harness-defined closed-process cooldown. The final column is the headline app-open value:

| Run | Dataset | Runs | First paint median ms | Usable paint median ms | Launch min ms | Launch P95 ms | Launch max ms | Launch median ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|

Use the compact scalar table for one-off values and counts:

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

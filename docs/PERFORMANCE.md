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
2. Open GanbaruAI from the installed app, not `pnpm tauri dev`. This is important because Tauri uses more resources in dev mode.
3. Open the title-bar performance panel.
4. Under Benchmarks, click `Run core benchmarks`, `Run backend benchmarks`, or `Run all benchmarks` depending on the change being measured.
5. Do not interact with the app while the overlay is running.
6. When the summary appears, review the readable tables, copy the markdown, and send it to an agent for careful placement here.

The app runs every benchmark against an isolated benchmark database. The user's real database is not opened during a benchmark pass.

The markdown output is an interchange format for the agent. Do not paste it verbatim into this file; place its rows into the matching canonical tables below. Generated run ids ending in `-ID` are unresolved placeholders. Before recording rows here, replace `YYYY-MM-DD-ID` with the next zero-padded run id for that date, such as `YYYY-MM-DD-01` or `YYYY-MM-DD-02`. No canonical row should keep `-ID`.

## Canonical tracking rules

Run metadata must identify:

- Harness version.
- Anchor date.
- Platform, including OS family plus distro/version or Windows version.
- Build reference in `version+git-ref` form, with `-dirty` when the app was built from a dirty worktree.
- Notes, only when the run needs context that affects interpretation. Blank is normal. Do not use notes for generic labels such as "current baseline".

Measurement rows must identify:

- Run id.
- Dataset id.
- The primary measurement type: startup boot, idle memory, navigation memory, interaction latency, or operation latency.

Measurement tables must not include a generic `Notes` column. Keep fixed scenario methodology in the harness spec. If a future detail becomes important enough to compare across runs, add a dedicated typed column instead of hiding it in prose.

Do not paste ad hoc `Live RAM`, `Startup RAM snapshot`, or `Speed log` panel copies into the canonical tables. Use those while investigating, then run the benchmark suite when a change needs to be recorded.

Only bump `HARNESS_VERSION`, `DENSE_DATASET_VERSION`, or dense detail profile names after the current version has at least one run recorded in the run metadata. During unrecorded benchmark iteration, edit the current version in place. Once a version has recorded rows, bump only when numeric comparability changes: measurement methodology, sampling cadence, scenario workload, or benchmark dataset generation. Do not bump for markdown layout, rendered-preview layout, wording, docs-only changes, column order, or removing helper sections such as generated diagnostic counters. When the measurement method changes after recorded rows exist, explain whether old rows remain comparable; if not, old rows become historical context instead of direct comparison data.

## Benchmark identifiers

This section defines identifiers used by recorded rows. Harness behavior, suite membership, scenario definitions, dataset generation, and version-specific methodology live in [performance-benchmark.md](features/performance-benchmark.md).

### Dataset ids

Benchmark rows use compact dataset ids. Do not write prose dataset labels in measurement tables. Dataset id semantics are defined in the harness spec.

| Pattern | Meaning |
|---|---|
| `base-N` | The isolated benchmark DB after scenario setup and before dense dataset seeding. `N` is the number of calendar events present at measurement start. Use `base-0` for a truly empty benchmark DB. |
| `dense-vX-rYy-sZ-dP` | Dense calendar dataset version `X`, seeded from `Y` years before through `Y` years after the run anchor date. `sZ` is the number of timed events stacked at each hour; `dP` is the dense detail profile. For example, `dense-v1-r1y-s1-d1` means dense dataset v1, one year back and forward, one timed event per hour, and detail profile 1. |
| `synth-vX-N` | Historical synthetic benchmark dataset. Do not use this pattern for new rows. |

Keep dataset ids stable and mechanical. If a future benchmark needs non-calendar setup data, record that context in run metadata or the harness spec instead of expanding the dataset id into prose.

## Benchmark records

Latest canonical baseline: none yet after the 2026-05-12 harness reset. The next recorded run should use harness `v1` and include an anchor date in run metadata.

Canonical rows keep the statistics and memory buckets that can support long-run comparisons. Raw harness diagnostics such as per-action counters, fixed guard timings, and redundant averages are not preserved here unless they answer a specific performance question. Interaction rows use the realistic dense current-window dataset unless the benchmark is explicitly asking about empty-state or total-history behavior.

### Run metadata

| Run | Harness | Anchor date | Build ref | Platform | Notes |
|---|---|---|---|---|---|

### Startup boot

Use `Launch median ms` as the headline app-open comparison value. `Usable paint median ms` marks when the app is ready for interaction.

| Run | Dataset | Runs | Usable paint median ms | Launch median ms | Launch P95 ms |
|---|---|---:|---:|---:|---:|

### Idle memory

Memory is PSS on Linux. On platforms that cannot report PSS, record the metric used in the run notes. The harness samples idle memory once per second for 30 seconds after the anchored calendar window is ready. `Min` and `Max` are the lowest and highest values observed during that window. `End` is the final sample.

| Run | Dataset | Statistic | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|

### Calendar held navigation memory

This records post-action memory after reproducing real held right-arrow navigation in week view against a practical full visible window. The harness holds right arrow for the fixed duration, releases it, then samples memory once per second for 30 seconds. `Min` and `Max` are the lowest and highest values observed during that window. `End` is the final sample.

| Run | Dataset | Statistic | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|

### Event panel latency

Rows report user-visible elapsed time with a practical full visible window. Internal module, detail-load, state, and flush breakdowns are diagnostic and are not canonical.

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|

### Create panel latency

This table keeps panel-open latency only, measured with a practical full visible window. Cancel-after-guard timing is a harness control path, so it is not part of the long-run performance record.

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|

### Calendar write operations

These backend timings track representative user-facing calendar mutations against the practical dense dataset. Lower-level command variants and empty-DB controls are diagnostic output and are not recorded here unless a run is explicitly focused on those paths.

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|

### Calendar import operations

Rows report one 1000-event add or update pass against the practical dense dataset. Smaller repeated import rows are diagnostic variance checks and are not part of the long-run record.

| Run | Dataset | Metric | Value ms |
|---|---|---|---:|

## Historical context

These rows summarize superseded benchmark records. They are useful context but are not mixed into the current canonical tables because their harnesses used obsolete anchors, obsolete synthetic datasets, or benchmark boot behavior that could preload a different calendar window before the measured window.

| Run range | Dates | Legacy harness | Scope | Status |
|---|---|---|---|---|
| 2026-05-04-01 to 2026-05-04-03 | 2026-05-04 | pre-canonical | Early calendar-nav and full-suite experiments | Superseded by question-oriented records |
| 2026-05-05-01 to 2026-05-10-04 | 2026-05-05 to 2026-05-10 | v1 to v2 | Startup, idle memory, synthetic datasets, and early stress memory | Historical only because the synthetic dataset shape and startup target are obsolete |
| 2026-05-11-01 | 2026-05-11 | v3 | First reduced dense-dataset output | Historical only because the calendar anchor was fixed to a past date and benchmark boots could preload a separate current-week window |

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

| Run | Dataset | Statistic | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|

Avoid cells like `104.8 / 339.2 / 17.3 / 461`, because they are hard to diff, sort, and scan.

Use the latency table for repeated measurements. Keep median and P95 as the canonical statistics; raw averages, min, and max are diagnostics and should not appear in the canonical copied output unless a run is specifically analyzing tail behavior:

| Run | Dataset | Metric | Runs | Median ms | P95 ms |
|---|---|---|---:|---:|---:|

For visible-window interaction benchmarks, record the practical dense current-window dataset (`dense-v1-r1y-s1-d1`) unless the benchmark question is specifically about empty-state behavior or total stored-history scale.

Use the startup table only for repeated process launches with the harness-defined closed-process cooldown. Launch median is the headline app-open value; P95 keeps the tail visible:

| Run | Dataset | Runs | Usable paint median ms | Launch median ms | Launch P95 ms |
|---|---|---:|---:|---:|---:|

Use the compact scalar table for one-off values that are themselves the measurement. If every scalar value is milliseconds, put the unit in the value header, such as `Value ms`. Otherwise keep `Value` and `Unit` separate. Do not record harness-internal counters such as held-navigation repeat counts, skipped ticks, or deterministic dataset math unless they are the subject of the benchmark:

| Run | Dataset | Metric | Value | Unit |
|---|---|---|---:|---|

## Performance principles

GanbaruAI should feel lightweight even though it uses Tauri plus a WebView. The floor is higher than a fully native UI, so app code should avoid adding avoidable RAM and startup cost.

General rules:

- Measure release builds, not dev mode.
- Keep benchmark data isolated from the user's real database.
- Compare runs on the same machine, OS, WebKit or WebView2 version, window state, and power mode.
- Prefer PSS for memory when available.
- Treat startup, idle memory, navigation memory, interaction speed, and operation speed as different questions. Do not let one benchmark stand in for all of them.
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

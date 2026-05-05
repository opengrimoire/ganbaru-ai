# Performance

This file is the canonical performance record for GanbaruAI. It exists so future agents can reason about RAM, startup time, interaction speed, and package size without reconstructing old debugging sessions.

## How to capture new results

Use benchmark-generated output as the source of truth. Manual copies from the performance panel are diagnostic only, because they can mix real user data, warm boots, open diagnostics UI, and human timing.

To capture a comparable run:

1. Build and install a release package.
2. Open GanbaruAI from the installed app, not `pnpm tauri dev`.
3. Open the title-bar performance panel.
4. Under Benchmarks, click `Run all benchmarks`.
5. Do not interact with the app while the overlay is running.
6. When the summary appears, copy the markdown and paste it back into the thread for placement here.

The app runs every benchmark against isolated benchmark databases. The user's real database is not opened during a benchmark phase.

## Canonical tracking rules

Canonical rows must identify:

- Harness version.
- Scenario id.
- Phase A and Phase B datasets.
- Platform and build reference when available.
- The primary measurement type: startup boot, idle memory, stress memory, interaction latency, or operation latency.

Do not paste ad hoc `Live RAM`, `Startup RAM snapshot`, or `Speed log` panel copies into the canonical tables. Use those while investigating, then run the benchmark suite when a change needs to be recorded.

## Benchmark questions

Harness v4 exposes individual buttons plus one `Run all benchmarks` button. Each scenario answers one primary question, and only memory scenarios wait for the post-workload `+30s` sample.

| Scenario | Primary question | Primary output | Post-workload RAM wait |
|---|---|---|---|
| `startup-boot` | How fast does the app launch into the calendar? | Boot marks | No |
| `idle-memory` | How much memory does the calendar hold while idle? | PSS memory by process | Yes |
| `calendar-nav` | How much memory does repeated week navigation use? | PSS memory by process | Yes |
| `event-panel-open` | How quickly does the event panel paint for existing events? | Average panel open and switch timings | No |
| `calendar-create-cancel` | How quickly does the create panel open and cancel? | Average create open and cancel timings | No |
| `ics-import` | How quickly can committed ICS fixtures be parsed and imported? | Average parse time, write time, counts | No |
| `theme-editor-open` | How quickly do settings and the theme editor open? | Module load and average open timings | No |

Every scenario runs two cold phases:

| Phase | Dataset |
|---|---|
| A | Empty isolated benchmark DB, plus any scenario setup rows needed by that scenario |
| B | Isolated DB seeded with `benchmark-synth-v1` at 1000 events, plus any scenario setup rows needed by that scenario |

## Benchmark records

No v4 canonical run has been recorded yet. The next suite output should be added as a new run id, starting with `2026-05-04-03` unless a later date applies.

### Startup boot

| Run | Date | Harness | Scenario | Phase | Dataset | Platform | Build ref | Launch total ms | App mount ms | Tz hydrated ms | SQL start ms | SQL main done ms | Map row done ms | First paint ms |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|

### Idle memory

Memory is PSS on Linux. On platforms that cannot report PSS, record the metric used in the run notes.

| Run | Date | Harness | Scenario | Phase | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB | Platform | Build ref |
|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---|

### Calendar navigation stress memory

| Run | Date | Harness | Scenario | Phase | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB | Platform | Build ref |
|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---|

### Event panel latency

| Run | Date | Harness | Scenario | Metric | Unit | Phase A | Details A | Phase B | Details B | Platform | Build ref |
|---|---|---|---|---|---|---:|---|---:|---|---|---|

### Create panel latency

| Run | Date | Harness | Scenario | Metric | Unit | Phase A | Details A | Phase B | Details B | Platform | Build ref |
|---|---|---|---|---|---|---:|---|---:|---|---|---|

### ICS import latency

| Run | Date | Harness | Scenario | Metric | Unit | Phase A | Details A | Phase B | Details B | Platform | Build ref |
|---|---|---|---|---|---|---:|---|---:|---|---|---|

### Theme editor latency

| Run | Date | Harness | Scenario | Metric | Unit | Phase A | Details A | Phase B | Details B | Platform | Build ref |
|---|---|---|---|---|---|---:|---|---:|---|---|---|

## Historical context

These runs are useful context but are not mixed into the v4 tables because their output shape measured incidental boot and RAM for every scenario.

| Run | Date | Harness | Scope | Status |
|---|---|---|---|---|
| 2026-05-04-01 | 2026-05-04 | v2 | `calendar-nav` only | Superseded by v4 question-oriented records |
| 2026-05-04-02 | 2026-05-04 | v3 | Full suite | Superseded by v4 question-oriented records |

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

| Phase | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---:|---:|---:|---:|

Avoid cells like `104.8 / 339.2 / 17.3 / 461`, because they are hard to diff, sort, and scan.

When the benchmark harness changes output shape, bump `HARNESS_VERSION` and start a new row series. Old rows remain historical context, not directly comparable data.

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

- Calendar event expansion is window-bounded through `calendar-index.ts`, with recurring templates handled separately from sorted non-recurring events.
- Calendar render state uses slim event rows. Heavy fields such as description, attendees, alarms, extended properties, and organizer stay in SQLite until a workflow needs them.
- EventPanel is dynamically imported and can be parked offscreen after first paint to trade a small measured RAM cost for faster first interaction.
- Event detail loading uses a lighter `loadPanelEvent` path for panel opens and `loadFullEvent` only where full fidelity is required, such as ICS export and undo snapshots.
- Timezone search metadata is lazy. Startup only builds active-zone labels.
- The performance and benchmark UI should stay lazy so measuring the app does not significantly change the app being measured.

# Performance

This file is the canonical performance record for GanbaruAI. It should stay useful to future agents that need to reason about RAM, startup time, and interaction speed without reconstructing old debugging sessions.

## Canonical tracking

Use benchmark-generated results as the source of truth. Manual copies from the performance panel are diagnostic only: useful during investigation, but not stable enough for the historical record because they can mix real user data, empty databases, warm boots, open diagnostics UI, and human timing.

Canonical rows must identify:

- Harness version.
- Scenario id.
- Dataset version and event count.
- Platform and build reference when available.
- Whether the number is idle, startup, stress peak, or post-stress.

The performance panel remains useful for quick checks, especially while iterating on a bug. Do not paste those ad hoc readings into the benchmark tables.

## Benchmark runs

### Run metadata

| Run | Date | Harness | Scenario | Dataset A | Dataset B | Platform | Build ref | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-05-04-01 | 2026-05-04 | v2 | calendar-nav-stress | empty | benchmark-synth-v1, 1000 events | Linux | not recorded | Current stress harness, 3000 ms week-view navigation |

### Boot

| Run | Phase | Dataset | Launch total ms | SQL main done ms | Map row done ms | First paint ms |
|---|---|---|---:|---:|---:|---:|
| 2026-05-04-01 | A | empty | 800 | 157 | 157 | 90 |
| 2026-05-04-01 | B | benchmark-synth-v1, 1000 events | 571 | 162 | 329 | 91 |

### Memory

Memory is PSS on Linux. On platforms that cannot report PSS, record the metric used in the run metadata notes.

| Run | Phase | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---|---:|---:|---:|---:|
| 2026-05-04-01 | A | empty | stress peak | 104.8 | 339.2 | 17.3 | 461 |
| 2026-05-04-01 | A | empty | stress end | 104.8 | 347.3 | 17.3 | 469 |
| 2026-05-04-01 | A | empty | +30s | 104.2 | 338.7 | 17.3 | 460 |
| 2026-05-04-01 | B | benchmark-synth-v1, 1000 events | stress peak | 108.6 | 360.6 | 17.6 | 487 |
| 2026-05-04-01 | B | benchmark-synth-v1, 1000 events | stress end | 108.6 | 329.7 | 17.6 | 456 |
| 2026-05-04-01 | B | benchmark-synth-v1, 1000 events | +30s | 107.9 | 302.4 | 17.6 | 428 |

### Package size

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

## Scenario registry

### Existing

**calendar-nav-stress**

Purpose: stress week-view rendering, recurrence expansion, visible-window bucketing, layout, and WebKit memory under repeated navigation.

Current shape:

- Phase A: isolated empty benchmark DB.
- Phase B: isolated `benchmark-synth-v1` database with 1000 events.
- Stress: programmatic forward week navigation for 3000 ms.
- Samples: stress peak, stress end, and +30s.

This is not an idle startup benchmark. Its memory rows include stress behavior.

### Next benchmarks

**startup-idle**

Purpose: canonical baseline for launch time and idle RAM.

Recommended shape:

- Phase A: isolated empty benchmark DB.
- Phase B: isolated `benchmark-synth-v1` database with 1000 events.
- No navigation stress and no panel interaction.
- Samples: first paint, +10s, +30s, optionally +60s.
- Boot rows: launch total plus every startup segment currently shown by the panel.
- Preferred output: one row per phase and sample point, same tabular style as this file.

This should replace manual startup RAM snapshots as the canonical baseline.

**event-panel-open**

Purpose: track create/edit panel responsiveness without relying on manual clicking.

Recommended shape:

- Phase A: empty DB with one deterministic event created by setup.
- Phase B: `benchmark-synth-v1` with a deterministic target event.
- Actions: create open, edit open from closed panel, edit switch while panel is open, close by outside click.
- Samples: panel total, module, details, state, flush, paint.

This benchmark should explicitly distinguish `open`, `unpark`, and `switch`.

**calendar-create-cancel**

Purpose: guard against regressions in empty-slot creation, create preview teardown, and outside-click dismissal.

Recommended shape:

- Create a preview block.
- Open the create panel.
- Try immediate outside click inside the guard window.
- Try outside click after the guard window.
- Record panel close time, preview removal time, and whether a second calendar action was triggered.

This exists because create-panel teardown can have different behavior from editing an existing event.

**ics-import**

Purpose: track import time, memory peak, and resulting database shape for Google and Outlook files.

Recommended shape:

- Use committed fixtures or generated `.ics` / `.ics.zip` files.
- Measure parse time, DB write time, total import time, memory peak, and row counts.
- Keep fixture versions explicit.

**theme-editor-open**

Purpose: track settings/theme editor load cost as the theme system grows.

Recommended shape:

- Open settings.
- Open theme editor on built-in dark.
- Open a generated user theme with many isolated tokens.
- Record first paint and memory delta.

## Benchmark output rules

Prefer normalized tables over compact slash cells. Good:

| Run | Phase | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |
|---|---|---|---|---:|---:|---:|---:|

Avoid cells like `104.8 / 339.2 / 17.3 / 461`, because they are hard to diff, sort, and scan.

Do not repeat long methodology paragraphs for every run. Put the methodology once under the scenario description, then keep run rows compact.

When the benchmark harness changes output shape, bump `HARNESS_VERSION` and start a new row series. Old rows remain historical context, not directly comparable data.

## Performance principles

GanbaruAI should feel lightweight even though it uses Tauri plus a WebView. The floor is higher than a fully native UI, so the app code should avoid adding avoidable RAM and startup cost.

General rules:

- Measure release builds, not dev mode.
- Keep benchmark data isolated from the user's real database.
- Compare runs on the same machine, OS, WebKit/WebView2 version, window state, and power mode.
- Prefer PSS for memory when available.
- Treat startup and interaction speed separately. A change can improve one and hurt the other.
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
| Frontend | WebKit/WebView2 renderer plus Svelte app, DOM, CSS, JS heap |
| Network | WebKit/WebView2 network process |

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

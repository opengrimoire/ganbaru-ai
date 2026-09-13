# Performance

Performance documentation separates repeatable methodology from historical evidence.

- [Benchmark harness](harness.md): dataset versions, scenarios, state machine, and copied output contract.
- [Performance records](results.md): immutable benchmark rows and package-size history.

The latest recorded benchmark baseline is from 2026-06-02. It is historical evidence and should not be presented as the performance of the August 2026 repository head without a new comparable run.

## Principles

- Measure installed release builds, not development mode.
- Keep benchmark data isolated from the user's active vault.
- Compare runs only when machine, operating system, WebView, power mode, window state, harness version, and dataset are compatible.
- Treat startup, idle memory, post-interaction memory, visible latency, and operation throughput as different questions.
- Prefer fixing measured cost over hiding warnings or raising limits.
- Bound hot paths by the visible window or requested page, not total stored history.
- Keep uncommon diagnostics, editors, transfer flows, grammars, and large catalogs lazy unless a measured common interaction justifies residency.
- Record exact methodology changes before comparing results across versions.

## Recording a run

1. Build and install a release package, then open diagnostics as described in the [benchmark harness](harness.md).
2. Use the isolated benchmark vault and one registered dataset identifier.
3. Run the complete scenario contract for the measurement being recorded.
4. Copy the normalized Markdown produced by the harness.
5. Replace the `YYYY-MM-DD-ID` placeholder with the next zero-padded run suffix for that date.
6. Add rows to [performance records](results.md) without rewriting earlier runs.
7. Record the platform metric and environment notes needed for comparison.

Do not bump `HARNESS_VERSION`, `DENSE_DATASET_VERSION`, or a recorded dataset profile while tuning an unrecorded shape. Bump only when a later methodology or workload change makes new rows incomparable with existing records.

## Current first-use contracts

First-use contracts are deterministic structural budgets, not elapsed-time benchmarks.

| Surface | Critical IPC calls | SQL reads | SQL writes | Serialized response bytes | Source-module ceiling |
| --- | ---: | ---: | ---: | ---: | ---: |
| Projects | 1 | 6 | 0 | 13,142 | 360 |
| Notes | 1 | 7 | 0 | 323 | 360 |
| Chat | Not baselined | Not baselined | Not baselined | Not baselined | 360 |

The machine-readable frontend ceiling is authoritative in `apps/client/scripts/first-use-bundle-baseline.json`. Rust tests own backend call, statement, and payload limits. Bundle contracts own route closures, required resident modules, and forbidden platform imports.

The route ceiling includes the shared vault ownership store and read-only ownership banner so ownership handoffs are visible on every primary surface. The module count is a ceiling, not a target to fill. A change that raises it must explain the user-visible benefit and preserve intentional lazy boundaries.

## Memory metrics

Use the most meaningful implemented platform metric:

| Platform | Metric | Interpretation |
| --- | --- | --- |
| Linux | Proportional set size, with RSS fallback | Preferred estimate of total physical cost including a fair share of shared pages |
| Windows | Working set | Resident physical pages, with shared pages potentially counted per process |
| macOS | Physical footprint | Required future metric; do not record misleading substitutes as canonical rows |

Do not compare Linux PSS and Windows Working Set as if they were identical measures.

Process buckets are:

- Backend: Rust, Tauri, SQLite, and native services.
- Frontend: WebView renderer, Svelte, DOM, CSS, and JavaScript heap.
- Network: WebView network process where the platform exposes it.

The frontend bucket includes the browser engine and cannot be cleanly divided into an engine baseline and Ganbaru code at runtime.

## Output rules

Use normalized tables with one value per column. Keep median and P95 for repeated latency. Use min, max, and end for sampled memory windows. Keep raw averages and internal counters as diagnostics unless the benchmark question specifically concerns them.

Fixed scenario details belong in the harness specification. Historical rows should contain only the identifiers and context required to interpret the measurement.

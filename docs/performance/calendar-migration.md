# Calendar migration CPU measurements

**Reference:** these are isolated engine diagnostics. They do not measure installed-app interaction latency, WebView work, Tauri transport, SQLite reads, painting, or memory retained by the real app. The canonical release benchmark records remain in [performance records](results.md).

## Pre-cutover record, 2026-10-03

Recorded at `2026-10-03T18:11:10.110Z` on Linux `7.0.0-31-generic`, AMD Ryzen 3 7320U, 5,926,703,104 bytes of physical RAM, and Node `v24.15.0`. One Vitest worker ran with `TZ=UTC`. Repository base was `6b7c01c7cb0758ea732ba14a008154f7e033fbab`, with the active migration worktree. No Rust or other frontend validation ran concurrently.

The workload contains 64 UTC daily templates, each starting at `2026-05-01 09:00`, ending at `10:00`, and limited to 365 rule instances. Each template has a unique `baseline-{index}` identity, a title, and the local calendar. It has no exclusions, additional dates, overrides, imported components, or Focus evidence. The visible window is May 11 through May 17, inclusive.

The navigation diagnostic expands 12 consecutive seven-day windows, advancing seven days between steps. One measured sample includes all 12 expansions and emits 5,376 occurrences. The preview diagnostic starts with 448 cached visible occurrences, selects `baseline-0::2026-05-15`, and applies a title edit to the whole series with unchanged selected start/end. The scope clock is May 8 at midnight, with no active occurrence. It calls the existing `computeEditDisplay` path and returns 448 visible events. Each diagnostic records one initial invocation, five warmups, then 30 measured samples. Sorted samples at indices 15 and 28 supply the reported P50 and P95.

| Existing TypeScript CPU path | Initial invocation, ms | Warm P50, ms | Warm P95, ms |
| --- | ---: | ---: | ---: |
| Twelve navigation-window expansions | 178.461 | 144.522 | 154.670 |
| Scoped title-edit preview over cached events | 3.198 | 0.631 | 1.208 |

The measured source versions have these SHA-256 hashes:

| Source under `apps/client/src/lib/components/calendar/` | SHA-256 |
| --- | --- |
| `recurrence.ts` | `ee0b206fcb06bad0e408357cd8c2dcfeeff6197d060e1cb04422e3318e831dd9` |
| `display-events.ts` | `1c376794deeaa3be80b5b4d6fcebb7a2b48cdcf8d323acd70041496bd6d43304` |
| `recurrence-edit-plan.ts` | `774d613cf0c152fad5fa091ce57587febffda2fa490cb7c808dbfe9cf7897732` |

The worktree's recurrence source already contains the staged COUNT/exclusion, independent RDATE, and multi-day-overlap corrections. This fixture exercises none of the altered exceptional cases. A temporary focused test checked both output counts and wrote the measurements; it was removed after capture so the normal correctness suite does not acquire timing or filesystem side effects.

## Native record, 2026-10-04 UTC

Recorded at `2026-10-04T03:20:35.134751598Z` on the same Linux kernel and machine as the pre-cutover record, with Rust `1.98.0 (88d9e12ae 2026-08-18)`. This run uses the unoptimized Cargo test profile. One Cargo job and one test thread ran; no frontend validation or other Rust validation ran concurrently.

The fixture retains the same 64 identities, UTC anchor, one-hour duration, daily COUNT of 365, twelve navigation windows, selected May 15 occurrence, May 8 scope clock, whole-series title edit, initial invocation, five warmups and thirty samples. Navigation checks all 5,376 emitted occurrences. Preview checks its seven native source-family occurrences plus the 441 unchanged cached occurrences, preserving 448 visible cards. SQL snapshot preparation and complete native draft, scope, metadata and visible projection CPU are timed separately. Serialization occurs after the CPU timer and produces a stable 6,613-byte preview body. That byte count excludes the outer vault response and Tauri transport framing.

| Native diagnostic | Initial invocation, ms | Warm P50, ms | Warm P95, ms |
| --- | ---: | ---: | ---: |
| Twelve canonical geometry-window expansions | 71.802 | 70.040 | 75.971 |
| Complete bounded native preview CPU | 4.633 | 3.363 | 4.167 |
| Preview SQLite snapshot read | 9.277 | 2.952 | 3.672 |

The canonical geometry diagnostic spends less CPU than the recorded TypeScript expansion on this fixture. The native preview performs consistent protection and complete metadata preparation that the earlier cached frontend display calculation does not perform, and costs more CPU in this diagnostic. Compiler profiles and the returned projection shapes also differ. These measurements establish neither installed-app latency nor a universal Rust speedup. Owner queueing, worker scheduling, Tauri transport, frontend decoding, painting and retained app memory are outside these timers.

The native source versions captured at measurement time have these SHA-256 hashes:

| Source under `apps/client/src-tauri/app/src/` | SHA-256 |
| --- | --- |
| `recurrence/canonical.rs` | `21733d637d5dcf0b386eef14176c87c759736664b11c9f6c8edd4cf0699f0968` |
| `recurrence/engine.rs` | `c1b7179e329910d552de3f42c552e68018c9c4550f2e483af7317be179a7bea6` |
| `recurrence/rule.rs` | `7b66360e7f975d79e0f3d79df0b4ce54081e4008de4d390e3aacd990eafc2d2f` |
| `recurrence/time.rs` | `30614445c376e5c4efd1add77c906dc2463e492c9639d4c10a9a92d5d9196946` |
| `calendar_events/preview.rs` | `b808f66873cb1916ac7e52864b5497f62bee503104ae9c116153a4550654770f` |
| `calendar_events/tests/migration_measurements.rs` | `5f51b056fb0e17696cae2f0a7eaaeba21ab9e0063f95c93624af9b1ab4bd4f16` |

The reproducible diagnostic is an ignored Rust test and adds no timing gate to ordinary correctness validation. Run it explicitly with `cargo test -p ganbaru-tauri-app --lib -j 1 calendar_migration_cpu_measurements -- --ignored --nocapture --test-threads=1` while other validation is idle. Subsequent retirement removed the unused flattened native DTO endpoint and duplicate frontend expander. Canonical geometry fixtures, import parsing, and frontend projection tests remain at their respective boundaries.

## Remaining platform acceptance

Before completing migration acceptance, run held navigation and editing in an installed desktop release and on Android through the existing isolated benchmark harness. Record the UI-visible statistics and platform conditions according to the [performance methodology](README.md). This environment cannot provide that physical app acceptance.

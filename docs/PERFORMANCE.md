# Performance

## Calendar event expansion

The calendar's hot path is `eventsInWindow(start, end)`: every viewport render and every reactive consumer (active pomodoro lookup, notification scheduler, edit-mode preview, etc.) calls it. Per-call cost has to stay flat for any reasonable event count, since week-view navigation and edit-mode keystrokes call it on every frame.

### Architecture

`lib/components/calendar/calendar-index.ts` builds a sorted index once per mutation:

- `recurring: CalendarEvent[]`: events with `recurrence` or non-empty `rdate`. Bounded in practice (tens, even for power users) and walked exhaustively per query.
- `nonRecurringSorted: CalendarEvent[]`: every other event, sorted ascending by `start` (lexicographic order on `YYYY-MM-DD HH:MM` matches chronological order).
- `nonRecurringStarts: string[]`: parallel `start` strings for allocation-free binary search in the hot path.
- `maxNonRecurringSpanDays: number`: largest `(end - start)` in days across non-recurring events. Bounds the walk-back so day-spanning events whose `start` lies before the window are still discovered.

`eventsInWindowFromIndex(index, windowStart, windowEnd)`:

1. Bisect `nonRecurringStarts` for the upper bound (`start > windowEnd`).
2. Walk backward from the upper bound, emitting events whose `end >= windowStart`. Stop once `start < windowStart - maxNonRecurringSpanDays`.
3. For each `recurring` template, call `expandTemplate(evt, windowStart, windowEnd, result)` from `recurrence.ts`.

Per-call cost is `O(log N + K)` where `K` is the number of events in the window plus the bounded walk-back, plus the recurring template count times their per-template expansion cost. For a typical week-view window over thousands of non-recurring events, the non-recurring path is sub-millisecond and recurring expansion runs in roughly one millisecond.

### Reactivity

`stores/calendar.svelte.ts` exposes `eventsInWindow(start, end)` and an `indexVersion` $state token. Mutations call `invalidate()`, which drops the cached index and bumps `indexVersion`; the next read rebuilds the index lazily. Effects that need to react to mutations without forcing a wide expansion subscribe via `void calendar.indexVersion`. There is no longer a wide-window `events` getter or window cache.

### What was removed

- The LRU `windowCache` plus `WINDOW_CACHE_LIMIT` plus `expandWindow` plus `defaultEventsWindow`. With per-call expansion in the millisecond range the cache never paid for itself: sliding navigation produces a fresh window every frame, so the cache key never hits.
- The adjacent-window prewarm `$effect` in `CalendarView.svelte` (and its `whenIdle` / `adjacentAnchor` helpers). Each `anchorDate` change scheduled idle prev / next expansions; held arrow-key navigation queued hundreds of them that drained after release.
- `App.svelte`'s reads of the wide-window `events` getter at mount and on every mutation. `findActiveBlock` and `checkEventNotifications` now scope to the date range each actually needs (one day around now, seven days around now respectively).

### Edit-mode preview

`display-events.ts` `applyAll` and `applyFollowing` previously expanded the entire `rawBlocks` array on every keystroke during recurring edits. They now expand only the patched template (and the capped / virtual templates for "following" splits); sibling instances are stripped from `storeEvents` via `belongsToSeries` and re-added from this single-template expansion. Preview cost is now constant regardless of total event count.

### Slim in-memory event shape

`rawBlocks` now carries a slim subset of columns: every field the render path, recurrence expander, notification scheduler, and active-block tracker reads, and nothing more. Heavy fields (`description`, `url`, `organizer`, `attendees`, `alarms`, `geo`, `extendedProperties`, `guestPermissions`, `categories`, `sequence`, `sourceUid`, `visibility`, `priority`) and the matching slim-override fields stay in SQLite and are loaded on demand by `calendar.loadFullEvent(id)` when the EventPanel opens or the ICS exporter serializes a calendar.

- Boot (`load()` in `stores/calendar.svelte.ts`): one `SELECT` over `calendar_events` joined with `pomodoro_configs`, plus one slim `SELECT` over `calendar_event_overrides`. The previous boot also pulled every row from `calendar_event_attendees` and `calendar_event_alarms` plus the heavy override columns; those reads are gone.
- `mapRow` only assigns keys with meaningful values, so V8 hidden classes stay compact and `{...slimEvent}` patch payloads do not accidentally clear DB columns through `updateBlock` (which Step 1 changed to a key-driven `SET` clause).
- `EventPanel.svelte` paints its header from the slim event prop on the same frame as the open click. Heavy sections (description editor, meeting block, visibility button) gate behind `{#if mode === "create" || fullEvent}`, so the user cannot edit a heavy field before the async `loadFullEvent` resolves; once it does, a separate init effect emits a heavy-only payload through `setInitialChanges` so the existing dirty diff still works without re-clobbering slim edits.
- ICS export (`exportCalendarAsIcs`) and undo / redo of create / delete materialize the full event before they need it: `Promise.all(slim.map((e) => store.loadFullEvent(e.id)))` before serialize, `loadFullEvent` before `pushUndo` for delete actions and after `addBlock` for add actions, and `loadFullEvent(s.originalEvent.id)` before edit-mode update so the undo snapshot can revert heavy edits the user just made. Drag commits and the App-level revert path stay slim because Step 1's patch-based update preserves untouched DB columns.

Production traces from a release `.deb` should be re-run on a 968-event Google Calendar import to confirm the expected drops (idle frontend RAM, nav-peak frontend RAM, and `boot.maprow-done - boot.sql-main-done` plus `boot.sql-children-done - boot.sql-main-done`). Numbers will be added to the RAM and startup tables below once measured on the new build.

### Fast-forward for far-past origins

Imported templates often have origins years before the current viewport (a daily standup with `DTSTART=2020-01-15` viewed in 2026). The cursor walk in `expandTemplate` would advance from `origStart` to `windowEnd` one interval at a time, allocating Temporal.PlainDate objects on each step. For a 6-year-old daily template, that is ~2200 cursor advances per `eventsInWindow` call, dominating the per-frame cost during held-arrow navigation.

`fastForwardSimple` and `fastForwardWeeklyByDay` in `recurrence.ts` jump the cursor directly to the first instance at or after `windowStart` using closed-form arithmetic, then set the `generated` counter so COUNT semantics are preserved. The simple helper covers daily / weekly / monthly (day <= 28) / yearly (non-Feb-29) frequencies. The weekly-BYDAY helper handles the `RRULE:FREQ=WEEKLY;BYDAY=...` shape produced by typical iCal exports, mapping advance count `N` to position `(N + k0) mod M` of period `floor((N + k0) / M)` where `M = sortedDays.length` and `k0` is the origin's index in `sortedDays`. Other complex BY- rules (monthly BYMONTHDAY, monthly ordinal BYDAY, yearly BYMONTH+BYMONTHDAY) fall back to the iterative walk; their effective cadence is already sparse, so the wasted iterations from far-past origins are a smaller share of the total.

EXDATE, RDATE, COUNT, and UNTIL semantics are preserved: the loop body that follows the fast-forward is unchanged, and instances skipped by fast-forward are by construction entirely before `windowStart`, so they never would have been emitted.

## How to read performance data

Click the gauge icon in the title bar to open the performance panel. It shows a per-process memory breakdown (updated every 5 seconds) and the startup time captured when the app launched. The "Copy" button copies all values as plain text.

## Memory measurement

The performance panel shows each process's memory in MB. This includes the main process and all child processes (WebKit/WebView2 renderers, network processes, etc.).

### What is measured

A Tauri app runs as multiple OS processes:

- **Backend (Rust):** the Rust backend only (Tauri runtime, SQLite, system tray, native notifications). No JavaScript runs here.
- **Frontend (WebKit/WebView2):** the system browser engine plus the entire Svelte 5 app (compiled JS, DOM, CSS, app state). On Linux this is WebKitWebProcess, on Windows it is msedgewebview2.exe.
- **Network (WebKit/WebView2):** handles network requests. Pure browser engine, no app code runs here.

The panel sums all of these. Other apps (browsers, editors, etc.) are never counted. Only processes in the app's own process tree are included.

### About the frontend number

The frontend process includes both the WebKitGTK/WebView2 browser engine and the Svelte 5 app. There is no API or OS-level mechanism to separate the two at runtime; they share the same process memory space, and DOM nodes, JS heap objects, CSS state, and engine internals are all interleaved.

A rough estimate based on typical WebKitGTK baselines on Linux: the engine itself accounts for approximately 150-170 MB, with the remaining 40-60 MB attributable to the Svelte 5 app (JS heap, DOM tree, component state). This ratio will shift as features are added, since new code grows the app portion while the engine baseline stays roughly fixed. The exact engine baseline varies by distro, WebKitGTK version, and GTK theme, so these numbers are approximate.

When tracking the frontend number over time, the growth between milestones reflects app code, not the engine getting larger.

### Metrics explained

There are three common ways to measure a process's memory. They give different numbers for the same process because of shared libraries (like libwebkit2gtk) that multiple processes load from the same physical RAM.

| Metric | What it counts | Result |
|---|---|---|
| **USS** (unique set size) | Only memory private to the process. Ignores shared libraries entirely. | Lowest number. What GNOME System Monitor typically shows. Undercounts because it pretends shared libraries are free. |
| **PSS** (proportional set size) | Private memory + a fair share of shared memory. If 3 processes share a 300 MB library, each gets credited 100 MB. | Middle number. Most accurate for "how much RAM does this app actually use." Used by `smem` and the app's performance panel. |
| **RSS** (resident set size) | Private memory + the full size of every shared library, counted separately for each process. | Highest number. What `htop` shows per process. Overcounts because the same library is tallied multiple times across processes. |

### Platform implementation

**Linux:** reads PSS from `/proc/{pid}/smaps_rollup` for each process in the tree. Falls back to VmRSS from `/proc/{pid}/status` if smaps_rollup is unavailable. Child processes are found by matching parent PID in `/proc/{pid}/stat`.

**Windows:** uses `GetProcessMemoryInfo` (WorkingSetSize) from the Win32 API. Equivalent to RSS, not PSS (Windows does not expose PSS). Child processes are found by recursive tree walk via `CreateToolhelp32Snapshot`. This captures WebView2 renderer processes which are grandchildren of the main process.

**macOS:** not implemented yet (returns 0).

### How to verify

Install `smem` and compare its PSS total against the performance panel:

```bash
sudo apt install smem
smem -t -P "ganbaruai|WebKit"
```

Ignore the Python/smem process in the output. The PSS total of the remaining processes should match the panel's total. The app reads the same `/proc/{pid}/smaps_rollup` files as `smem`, so the values are identical.

## Startup time

Measures elapsed time from process start (Rust `main()`) to the Svelte frontend fully mounted and interactive. Shown in the performance panel.

### Startup time log

For the log, use the release build (installed .deb), cold start (no prior instance running), and take the value from the first launch after a reboot or at least 30 seconds after closing a previous instance so disk caches settle.

| Date | Phase | What changed | Time to interactive (ms) | Platform |
|---|---|---|---|---|

## RAM usage log

Record measurements after each significant feature or milestone. Use the release build (`pnpm tauri build` + installed .deb), not dev mode. Close other apps to reduce noise. Take the reading after the app has been open for at least 10 seconds to let initialization settle.

| Date | Phase | What changed | Backend (MB) | Frontend (MB) | Network (MB) | Total PSS (MB) | Platform |
|---|---|---|---|---|---|---|---|
| 2026-04-01 | Phase 1 | Baseline: calendar, pomodoro, kanban | 87.5 | 205.0 | 15.9 | 308 | Linux (Ubuntu) |

## Package size log

Record the installer size after each milestone build. Run `ls -lh target/release/bundle/deb/*.deb` (or equivalent for other formats) after `pnpm tauri build`.

| Date | Phase | What changed | .deb (MB) | Platform |
|---|---|---|---|---|
| 2026-04-02 | Phase 1 | Baseline: calendar, pomodoro, kanban, performance panel | 7.0 | Linux (Ubuntu) |

## Benchmark harness rows

Each row below is the markdown block emitted by the in-app benchmark harness (TitleBar performance panel, Run button under "Copy all"). The harness is documented in `docs/features/performance-benchmark.md`. Always run a release `.deb`, on a fresh boot, with no other heavy apps open and no dev tools attached.

The harness has shipped two formats. v1 runs are not directly comparable to v2 runs: v1 ran Phase A inline against whatever was in the user's database (not an empty baseline, not isolated) and sampled out to +5 m. v2 runs both phases cold against an isolated benchmark database, with Phase A always empty and one +30 s sample.

### V2 baseline (harness v2)

`HARNESS_VERSION = "2"`. Cold-cold isolated benchmark DB. Phase A is the empty baseline, Phase B is the synth-1000 dataset. Sampling at peak + t0 + +30 s. Boot table includes `launch-total` (process-spawn-anchored).

(no rows yet, paste v2 markdown blocks from release-build runs here.)

### V1 baseline (harness v1)

`HARNESS_VERSION = "1"`. Phase A ran inline against the user's data, Phase B was a cold restart against the synth-1000 dataset seeded into the user's database. Sampling at peak / t0 / +5s / +30s / +60s / +3m / +5m. Kept here as historical context only; the format is not directly comparable to v2.

(no rows yet, paste any v1 markdown blocks recorded before the v2 cutover here.)

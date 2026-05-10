# Optimization plan

This document records the performance direction I would execute for GanbaruAI after reviewing the current benchmark record and the calendar, benchmark, persistence, and boot paths.

The target is simple: lower startup time and lower RAM, including empty databases and users with 10,000 or more calendar events. The optimization work must show up in the core benchmarks in `docs/PERFORMANCE.md`, not only in backend microbenchmarks.

## Decision

I do not need another benchmark scenario before deciding the refactor direction.

The existing core benchmark suite already measures the outcomes that matter:

- Startup to usable calendar paint.
- Idle RAM.
- Calendar navigation stress RAM.
- Event panel open latency.
- Create panel open and cancel latency.

One benchmark change is required for verification: the existing core scenarios need a 10,000-event synthetic dataset in addition to the current 1,000-event dataset. This is not a new kind of benchmark. It is the same final user-facing measurement at the scale the app is expected to handle.

The decided optimization direction is:

1. Move SQLite ownership and calendar read paths fully into Rust.
2. Replace frontend whole-calendar state with Rust-backed viewport windows.
3. Move recurrence expansion for render queries into Rust, with parity tests against the current TypeScript behavior before switching.
4. Remove hot-path frontend memory costs that exist only for convenience, especially global Temporal loading and parked event panel mounting.
5. Keep Svelte responsible for UI rendering, but make it render bounded data and virtualized dense surfaces.

This is the work that will materially reduce core benchmark startup and RAM. Optimizing the existing Rust write commands further is not the priority.

## Current evidence

Latest canonical baseline in `docs/PERFORMANCE.md`: `2026-05-10-02`, harness v6.

### Dataset memory growth is frontend-heavy

Idle memory at `+30s`:

| Dataset | Backend MB | Frontend MB | Network MB | Total MB |
|---|---:|---:|---:|---:|
| `base-0` | 111.6 | 194.9 | 20.0 | 327 |
| `synth-v1-1000` | 118.4 | 249.4 | 20.0 | 388 |

The synthetic 1,000-event dataset adds about 61 MB total. About 54.5 MB of that is frontend memory. Backend grows by about 6.8 MB.

Calendar navigation stress memory at `+30s`:

| Dataset | Backend MB | Frontend MB | Network MB | Total MB |
|---|---:|---:|---:|---:|
| `base-0` | 115.8 | 218.2 | 20.0 | 354 |
| `synth-v1-1000` | 117.8 | 294.3 | 19.8 | 432 |

The synthetic 1,000-event dataset adds about 78 MB total after navigation. About 76.1 MB of that is frontend memory. Backend grows by about 2 MB.

This means the main dataset-scaled RAM problem is not Rust command memory. The main problem is that the WebKit side owns too much calendar state and rendering work.

### Startup slowdown is tied to usable calendar paint

Startup boot:

| Dataset | First paint median ms | Usable paint median ms | Launch median ms |
|---|---:|---:|---:|
| `base-0` | 141 | 231 | 768 |
| `synth-v1-1000` | 142 | 630 | 1143 |

First paint is almost unchanged with 1,000 events. Usable paint is about 399 ms slower, and launch median is about 375 ms slower. The data-dependent startup cost happens after the shell and first frame, when the calendar loads, maps, expands, and renders usable data.

### Backend command latency is already low

The backend benchmark rows show normal write operations in the low single-digit millisecond range, with the latest calendar create, patch, delete, detach, and split medians around 3 to 5 ms. Further tuning those commands will not materially lower startup RAM or calendar navigation RAM.

Bulk import has larger numbers, but import is not part of the core startup or navigation path. It should stay optimized, but it is not the current answer to the core benchmark goal.

## Root causes

### The frontend owns the whole calendar

The current store loads every slim calendar event into `rawBlocks` on boot, then builds a frontend expansion index from that list. The implementation is already better than a naive full scan, but the memory model is still `O(total events)` in WebKit.

For a 10,000-event user, this is the wrong ownership model. The calendar UI only needs the current day, week, or month window plus a bounded cache. The full dataset belongs in SQLite, accessed through Rust.

### Temporal is loaded on the hot path

`main.ts` imports `@js-temporal/polyfill` before app mount and assigns it globally. Calendar utilities, recurrence expansion, timezone conversion, and some boot logic depend on Temporal. Temporal is correct for time semantics, but loading the polyfill globally makes even an empty calendar pay that JS memory and startup cost.

The long-term fix is not to reimplement unsafe date math in ad hoc TypeScript. The fix is to move the calendar date and recurrence work that affects startup into Rust and lazy-load Temporal only for paths that still need it, such as ICS import or export until those paths move too.

### The event panel is parked after first paint

`CalendarView.svelte` schedules a parked event panel after boot. This improves warm panel latency, but it spends RAM on every app open even if the user never opens an event. For the stated goal, default idle RAM wins over always-warm panel state.

The app should preload panel code only from user intent signals, such as pointer enter, pointer down, keyboard focus on an event, or explicit open. If first open latency becomes too high, the panel should be split into a small shell and lazy detail sections rather than mounted invisibly at boot.

### The former frontend SQL plugin kept the database boundary split

The app previously used `@tauri-apps/plugin-sql` from the frontend for reads and custom Rust commands for writes. That split made boot reads, migrations, benchmark DB selection, and persistence ownership more complicated than necessary.

GanbaruAI should own SQLite in Rust. The frontend should call typed commands. The first optimization slice removed frontend SQL plugin usage and gave the Rust side control over pooling, migrations, typed reads, and benchmark database routing. The second slice added Rust calendar window reads so the render path no longer needs to load every non-recurring event on boot.

## Decided refactors

### 1. Rust-owned SQLite service

Replace frontend SQL ownership with a Rust database service.

Work:

- Move migrations out of `tauri-plugin-sql` registration and into an app-owned Rust migration runner.
- Keep one managed SQLite pool per active database mode instead of opening a fresh connection for each command.
- Route user and benchmark database selection through Rust state, not frontend `dbUrl()`.
- Replace frontend `select()` call sites with typed Rust commands.
- Remove `@tauri-apps/plugin-sql` from frontend dependencies after all read paths move.

Expected core impact:

- Lower frontend startup work.
- Lower frontend dependency memory.
- Cleaner benchmark database switching.
- Better foundation for viewport-scoped reads.

This is worth doing even before the windowed calendar work because it eliminates a split ownership model that currently blocks deeper optimization.

### 2. Rust calendar window query

Replace `calendar.load()` plus `rawBlocks` as the render source with a Rust command that returns only the current visible window.

Current status: implemented for non-recurring event windows. The command returns overlapping non-recurring rows, all recurring templates, slim overrides, and total DB event count for benchmark dataset labels. Render-window recurrence expansion now runs through a Rust command after rows are mapped to wall-clock render events; TypeScript recurrence remains for unsaved editor previews.

Proposed command shape:

```ts
interface CalendarWindowRequest {
  startDate: string;
  endDate: string;
  timezone: string;
  visibleCalendarIds: string[];
}

interface CalendarWindowResponse {
  revision: number;
  totalEventCount: number;
  windowStartDate: string;
  windowEndDate: string;
  events: CalendarEvent[];
}
```

Rust will:

- Query non-recurring events by indexed date overlap.
- Query recurring templates that can produce instances in the requested window.
- Load only slim override fields needed for render.
- Expand recurring instances for the requested window.
- Return sorted, slim render events.

Svelte will:

- Store the current window response and a small adjacent-window cache.
- Drop `rawBlocks` as the long-lived render source.
- Request a new window when the calendar anchor or visible calendars change.
- Treat mutations as window invalidations or command-returned patches.

Expected core impact:

- 10,000-event idle memory becomes close to empty-database idle memory, because WebKit no longer owns all 10,000 events.
- Startup with 10,000 events becomes bounded by the visible window, not by total calendar size.
- Navigation stress stops accumulating full-dataset frontend pressure.

This is the most important refactor.

### 3. Rust recurrence expansion for render queries

Port the recurrence expansion used by render queries from TypeScript to Rust.

Current status: implemented for loaded render windows with Rust parity coverage for the main recurrence shapes. TypeScript still owns edit-preview expansion for unsaved changes because that is UI-local state rather than durable render loading.

Work:

- Implement Rust recurrence types equivalent to the current TypeScript `RecurrenceConfig`.
- Port daily, weekly, monthly, yearly, `rdate`, exception, override, count, and until handling.
- Generate parity fixtures from the current TypeScript recurrence tests.
- Add Rust tests that prove the same inputs produce the same instance IDs and dates.
- Keep TypeScript recurrence only where the editor needs local unsaved preview behavior, then remove it from the boot path.

Expected core impact:

- Removes large recurring expansion work from WebKit.
- Allows the frontend to avoid importing the Temporal polyfill for normal boot and navigation.
- Keeps the window query fully backend-owned.

This belongs in Rust because recurrence expansion is data computation, not UI. It is also the key to making calendar memory scale with visible events instead of total events.

### 4. Frontend boot diet

Remove frontend work that currently runs before or shortly after first usable paint but is not required for the initial screen.

Work:

- Remove global Temporal loading from `main.ts` once Rust owns calendar timezone and recurrence work.
- Lazy-load Temporal only for remaining import, export, and migration paths until those move to Rust.
- Stop mounting the parked event panel after boot. Done.
- Keep event panel module prefetch based on intent signals.
- Split the event panel into a lightweight shell and lazy sections if cold open regresses too much.
- Load only the active theme snapshot at boot; load the full theme registry, dismissals, and editor-only theme data when settings or the theme editor opens.

Expected core impact:

- Lower empty-database startup memory.
- Lower empty-database idle memory.
- Lower base launch time.

This work matters because the target includes empty databases, not only large calendars.

### 5. Bounded Svelte rendering

Keep Svelte as the UI layer, but make rendering explicitly bounded.

Work:

- Ensure week and month views render only events in the current window response.
- Add virtualization or compact overflow rendering for dense day columns and all-day rows. Done for timed day and week columns through scroll-window rendering; all-day rows already use compact overflow.
- Avoid retaining previous navigation windows beyond a small cache.
- Keep benchmark, settings, event details, ICS, and theme editor modules out of the boot path.

Expected core impact:

- Lower navigation stress RAM.
- Lower render work when many events fall into one visible range.
- Stable memory after repeated next-week or next-month navigation.

This should stay in TypeScript and Svelte because it is UI rendering and interaction behavior.

### 6. Rust commands for non-render full-data operations

After the render path no longer owns `rawBlocks`, operations that currently depend on all frontend events must move to Rust.

Work:

- Replace `exportCalendarAsIcs` full-event fan-out with a Rust-backed export reader or a streaming backend payload.
- Replace active Pomodoro block lookup with a Rust command that queries only the current time window.
- Replace `rawBlocks` existence checks used by Pomodoro safety flows with specific Rust existence queries.
- Keep calendar import write path in Rust and return enough invalidation data to refresh visible windows.

Expected core impact:

- Prevents hidden reintroduction of full-calendar frontend state.
- Keeps memory flat after the main windowed-calendar refactor.

## What not to do

Do not rewrite Svelte UI logic in Rust for its own sake. DOM rendering, layout, panel interaction, and drag behavior belong in Svelte.

Do not spend time micro-optimizing the current Rust calendar write commands before the calendar read model changes. They are already fast enough that improvements there will not move core startup or RAM.

Do not keep `rawBlocks` as a compatibility layer after the window query lands. A hidden full-calendar cache in the frontend would defeat the point of the refactor.

Do not add new benchmark categories as a prerequisite for starting. The core suite is the acceptance signal.

## Verification

The existing core benchmarks remain the final gate. The benchmark suite needs one scale addition:

- `base-0`
- `synth-v1-1000`
- `synth-v1-10000`

The 10,000-event dataset must run for:

- Startup boot.
- Idle memory.
- Calendar navigation stress memory.
- Event panel latency.
- Create panel latency.

The goal is not only lower numbers. The goal is a flatter curve:

- Startup launch median for 10,000 events should stay close to empty-database launch median.
- Idle frontend RAM for 10,000 events should stay close to empty-database frontend RAM.
- Navigation stress memory should settle back close to its pre-navigation value.
- Event panel and create panel latency should remain responsive after removing boot-time parked panel state.

Concrete acceptance targets for the first optimization pass:

| Metric | Target |
|---|---:|
| 10,000-event startup launch median overhead over `base-0` | 150 ms or less |
| 10,000-event idle `+30s` frontend RAM overhead over `base-0` | 30 MB or less |
| 10,000-event navigation `+30s` frontend RAM overhead over `base-0` | 50 MB or less |
| 10,000-event event panel open P95 | 150 ms or less |
| 10,000-event create panel open P95 | 120 ms or less |

If Tauri and WebKit impose a higher fixed empty-app memory floor than desired, the optimization target becomes flat scaling first, absolute floor second. A Tauri app will not have native-widget memory numbers, but it can stop paying memory proportional to total calendar history.

## Execution order

1. Implement Rust-owned SQLite service and remove frontend SQL reads. Done.
2. Add the 10,000-event scale to the existing core benchmark datasets. Done.
3. Implement Rust calendar window queries for non-recurring events. Done.
4. Port recurrence expansion to Rust and switch render queries to backend expansion. Done for loaded render windows; edit previews intentionally remain TypeScript.
5. Replace frontend `rawBlocks` dependencies with typed window, detail, existence, active-block, import, and export commands. Partly done for render windows, panel details, ICS export, and import refresh; active-block existence cleanup remains follow-up work.
6. Remove global Temporal from the normal boot path. Deferred until edit previews and non-local timezone conversion no longer need synchronous frontend Temporal.
7. Remove parked event panel mounting and replace it with intent-based prefetch. Done for boot mounting; panel reuse after an actual user open remains.
8. Add dense-day virtualization or compact overflow rendering. Done for timed day and week columns.
9. Run the full core benchmark suite and record the final result in `docs/PERFORMANCE.md`.

This is the refactor sequence I would execute. It directly targets the core benchmark rows and the 10,000-event requirement.

# Performance

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

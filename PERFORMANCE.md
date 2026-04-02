# Performance

## Memory measurement

The title bar shows the app's total memory usage in MB, updated every 5 seconds. This includes the main process and all child processes (WebKit/WebView2 renderers, network processes, etc.).

### What is measured

A Tauri app runs as multiple OS processes:

- **Main process:** the Rust backend (Tauri core, SQLite, commands)
- **WebKitWebProcess (Linux)** / **msedgewebview2.exe (Windows):** renders the Svelte frontend
- **WebKitNetworkProcess (Linux):** handles network requests

The title bar sums all of these. Other apps (browsers, editors, etc.) are never counted. Only processes in the app's own process tree are included.

### Metrics explained

There are three common ways to measure a process's memory. They give different numbers for the same process because of shared libraries (like libwebkit2gtk) that multiple processes load from the same physical RAM.

| Metric | What it counts | Result |
|---|---|---|
| **USS** (unique set size) | Only memory private to the process. Ignores shared libraries entirely. | Lowest number. What GNOME System Monitor typically shows. Undercounts because it pretends shared libraries are free. |
| **PSS** (proportional set size) | Private memory + a fair share of shared memory. If 3 processes share a 300 MB library, each gets credited 100 MB. | Middle number. Most accurate for "how much RAM does this app actually use." Used by `smem` and the app's title bar. |
| **RSS** (resident set size) | Private memory + the full size of every shared library, counted separately for each process. | Highest number. What `htop` shows per process. Overcounts because the same library is tallied multiple times across processes. |

### Platform implementation

**Linux:** reads PSS from `/proc/{pid}/smaps_rollup` for each process in the tree. Falls back to VmRSS from `/proc/{pid}/status` if smaps_rollup is unavailable. Child processes are found by matching parent PID in `/proc/{pid}/stat`.

**Windows:** uses `GetProcessMemoryInfo` (WorkingSetSize) from the Win32 API. Equivalent to RSS, not PSS (Windows does not expose PSS). Child processes are found by recursive tree walk via `CreateToolhelp32Snapshot`. This captures WebView2 renderer processes which are grandchildren of the main process.

**macOS:** not implemented yet (returns 0).

### How to verify

Install `smem` and compare its PSS total against the title bar:

```bash
sudo apt install smem
smem -t -P "ganbaruai|WebKit"
```

Ignore the Python/smem process in the output. The PSS total of the remaining processes should match the title bar value.

## RAM usage log

Record measurements after each significant feature or milestone. Use the release build (`pnpm tauri build` + installed .deb), not dev mode. Close other apps to reduce noise. Take the reading after the app has been open for at least 30 seconds to let initialization settle.

| Date | Phase | What changed | Main (MB) | Renderer (MB) | Network (MB) | Total PSS (MB) | Platform |
|---|---|---|---|---|---|---|---|
| 2026-04-01 | Phase 1 | Baseline: calendar, pomodoro, kanban | 87.5 | 205.0 | 15.9 | 308 | Linux (Ubuntu) |

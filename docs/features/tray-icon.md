# Tray icon

The tray icon is Ganbaru AI's OS-level glance surface. It stays available when the main window is hidden, minimized, or behind other windows, and it exposes compact Pomodoro and Music controls without requiring the user to return to the app.

This doc covers the tray icon's user-visible behavior and the platform-specific implementation details that are easy to lose during maintenance.

## Purpose

The tray icon answers two quick questions:

- Is there an active focus session?
- How much usable focus time remains before the next transition?

It also gives access to common controls:

- Pause or resume the active focus phase.
- Extend the current focus period by 3 minutes when the event window has room.
- Advance to break or start focus, depending on the current phase.
- Play or pause Music.
- Move to previous or next Music item.
- Open the Music view.

The tray is not a stats surface. It does not show cycle count, total focus today, future breaks, or detailed session history.

## Pomodoro ring behavior

The tray icon mirrors the title bar Pomodoro ring. It uses the same metric: progress through the current focus opportunity, clipped by the calendar event end when the event is shorter than the configured focus duration.

Visual states:

| State | Tray ring |
|-------|-----------|
| No active focus session | Empty gray ring |
| Focus starts | Full white remaining-time ring |
| Focus running | White remaining arc shrinks as progress increases |
| Focus manually paused | Remaining arc gently pulses between white and empty-ring gray |
| Focus complete or stopped | Empty gray ring |

The active `0%` state is intentionally distinct from idle. Idle means no focus session is active, so the icon is an empty gray ring. Active `0%` means the user has just started focus, so the icon is a full remaining-time ring. This keeps the tray synchronized with the title bar at session start.

The active `100%` state maps back to the empty ring. At that point the current focus opportunity is over, and keeping a separate completed icon would add another tray icon replacement with no useful user-facing meaning.

The ring redraw is quantized to 1% progress steps. That is frequent enough to feel current while avoiding needless tray icon churn.

While a focus session is manually paused, the tray ring animates a slow color beat so the user can notice that focus is waiting to resume. The beat is limited to the focus phase and stops immediately on resume, stop, phase change, idle pause, or suspend pause. The tray cannot animate like the title bar SVG, so Ganbaru AI switches between a small set of cached PNG frames instead of trying to drive a high-frame-rate animation. The pulse holds at the full white and dim gray endpoints, with smoother transitions between them.

## Menu behavior

The tray menu has two sections.

Pomodoro section:

- Status row: remaining time while active, or `No active session`.
- `Pause focus` or `Resume focus`, enabled only during an active focus phase.
- `Extend focus 3 minutes`, enabled once per focus period when the current event window has room.
- `Go to break now` during focus, or `Start focus now` during breaks.

Music section:

- Status row: active media title when one is loaded, otherwise the current player status or `No music loaded`.
- `Play music` or `Pause music`.
- `Previous music`.
- `Next music`.
- `Open music`.

Controls remain visible but disabled when unavailable. This keeps the menu stable and avoids controls appearing and disappearing while the user is trying to click.

## Linux AppIndicator behavior

Linux tray support goes through Tauri's `tray-icon` stack and AppIndicator. On Ubuntu, AppIndicator resolves tray images from PNG paths. Tauri's normal Linux `set_icon` path removes the previous PNG before publishing the next one. During that gap, Ubuntu can briefly show its missing-icon placeholder, which appears as three dots.

Ganbaru AI avoids that gap on Linux:

1. Render the next tray icon as RGBA pixels.
2. Convert it to a PNG in the app cache under `tray-icons`.
3. Reuse the PNG if it already exists.
4. Point AppIndicator at the already-written PNG.

This means the old icon remains resolvable until the new icon is ready. The user should see a direct transition from one ring state to the next, without the three-dot placeholder. The paused pulse uses the same path: each pulse frame is written or reused before AppIndicator is pointed at it.

The cache filenames include a tray icon renderer version. Bump `LINUX_TRAY_ICON_VERSION` in `apps/client/src-tauri/src/tray.rs` when a renderer change makes existing cached PNGs visually obsolete.

Generated tray PNGs live in the app cache, not the Ganbaru AI folder. They are derived UI assets, not user data. The cache footprint is small: one empty icon, up to 101 normal progress icons, and up to 22 paused pulse frames per progress step per renderer version.

## Tauri version pinning

The Linux update path uses Tauri's `with_inner_tray_icon` escape hatch to access the underlying AppIndicator. Tauri documents that this lower-level tray access can be affected by minor Tauri updates because the internal `tray-icon` crate may change.

For that reason, `apps/client/src-tauri/Cargo.toml` pins Tauri to the current minor range:

- `tauri = "~2.11.1"`
- `tauri-build = "~2.6.1"`

Patch updates within those minor versions are allowed. Moving to a newer Tauri minor version should be an explicit maintenance task that verifies the Linux tray icon path still works.

## Platform notes

Linux:

- Tooltip text is not reliable because Tauri's Linux tray tooltip API is unsupported.
- The menu remains the primary accessible description of current tray state.
- The AppIndicator update path is Linux-only. Other platforms use Tauri's normal tray icon API.

macOS:

- The tray icon lives in the menu bar.
- Tauri's normal icon API remains in use.

Windows:

- The tray icon uses Tauri's normal icon API.
- Tooltip support should work through the normal platform backend.

## Related docs

- `docs/features/pomodoro-progress-displays.md`: progress surface semantics shared by the title bar ring, tray ring, and calendar rail.
- `docs/features/music.md`: Music behavior exposed through the tray menu.
- `docs/TECH_STACK.md`: why Rust and Tauri own OS-level surfaces like the tray.

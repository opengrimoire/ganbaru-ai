# Music

The music player is the audio side of the work environment. Playlists are tied to session blocks and to environments, so the right audio plays automatically when a block activates. Two sources are supported: local files and YouTube. Spotify is explicitly out of scope.

This doc is a placeholder. Deeper design comes in a later pass.

The main app already reserves an empty Music area. It is opened only from the title bar music icon and is not part of the primary Calendar / To-do tab cycle.

## Sources

**Local files.** Audio and video files on the user's disk, played by a Rust media engine using Symphonia and FFmpeg (via `ffmpeg-next`). The engine is shipped as a separate plugin under LGPL 2.1, decoupled from the AGPL 3.0 main app to keep license obligations clean.

**YouTube via the IFrame Player API.** Officially supported, free, no developer key required, no user registration. The IFrame API offers programmatic control: load by ID or URL, set start/end timestamps, control volume and playback speed, and seek. A transparent overlay covers the iframe to block direct user interaction; all control is programmatic based on the user's preconfiguration. The video remains visible and ads play normally (or do not, if the user has YouTube Premium). Playback position persists to SQLite and restores on app restart via the `start` URL parameter.

**Spotify is not supported.** As of 2025-2026, Spotify's API policies make indie integration impractical: development mode caps at 5 users, extended quota requires 250,000 MAU and a registered business, and the gap is a deliberate exclusion of indie developers. This is documented publicly so users understand the gap is policy-driven, not a missing feature.

## Per-session-block configuration

Each calendar event with a music assignment carries: which video, playlist, or local file to load; start and end timestamps; parts to skip (timestamp ranges); volume; playback speed; and whether to switch to a different source during breaks.

Playlists tied to work environments inherit to all session blocks using that environment, with per-block overrides.

## Linkage to other systems

- **Calendar:** when a session block activates, the assigned playlist starts (see `features/calendar.md` and `features/work-environments.md`).
- **Pomodoro:** the player can switch between focus and break playlists based on the active phase (see `features/pomodoro.md`).
- **Sleep alarm (mobile):** the morning alarm dismissal can start a wake-up playlist (see `features/sleep-alarm.md`).
- **Edge panel (desktop):** quick controls (play/pause, skip, volume) without leaving the current context (see `features/edge-panel.md`).

## Storage

Music files stay wherever the user keeps them; the vault stores only playlist definitions (lists of file paths, YouTube IDs, and per-track config). Backups go to the user's chosen path, not into the vault.

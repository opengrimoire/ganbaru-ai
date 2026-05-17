# Music

The music player is the audio side of the work environment. Playlists are tied to session blocks and to environments, so the right audio plays automatically when a block activates. Two sources are supported: local files and YouTube. Spotify is explicitly out of scope.

The main app opens the Music area from the title bar music icon. It is not part of the primary Calendar / To-do tab cycle.

Playback is owned by a persistent app-level player host, not by the Music route. Leaving the Music view hides the visible media surface but keeps local and YouTube playback, queue state, volume, rate, shuffle mode, and resume persistence alive.

## Sources

**Local files.** Audio and video files on the user's disk. Current desktop builds validate local files through the Rust `plugins/media-player` boundary and play them in the WebView through a token-gated loopback media host on `127.0.0.1`. The host streams only registered local files and serves byte-range responses with media content types so WebView media playback can seek and buffer normally. This avoids requiring GStreamer development libraries before basic local playback works. This fallback supports the codecs available to the platform WebView. The production native backend should use GStreamer as the primary Rust-controlled engine, with FFmpeg/libav support through an LGPL-compatible build path for broader format coverage. A build must not enable GPL or nonfree FFmpeg components unless the licensing impact is intentionally accepted.

The current local playback path is not VLC-class native playback yet. It does not decode through FFmpeg or GStreamer today. Pause, seek, codec coverage, and memory use are therefore limited by the platform WebView media element. Local volume and pause silence are controlled through a Web Audio gain stage when available, so the app can mute local playback immediately even if the WebView media pipeline is slower to finish pausing. The native backend target remains the path for consistently instant transport controls, lower overhead, and broader codec support.

**YouTube via the IFrame Player API.** Officially supported, free, no developer key required, no user registration. The IFrame API offers programmatic control: load by ID or URL, set start/end timestamps, control volume and playback speed, and seek. Desktop builds serve a tiny loopback HTTP player host on `127.0.0.1` and embed that host in the Music view. The host then embeds YouTube with `strict-origin-when-cross-origin`, `origin`, and `widget_referrer` so YouTube receives a real HTTP referrer even though the main Tauri app uses a custom protocol. The video remains visible and ads play normally (or do not, if the user has YouTube Premium). Playback position persists to SQLite and restores on app restart via the `start` URL parameter.

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

The Music view can scan a user-selected local folder recursively for common audio and video extensions. The scan runs outside the UI thread, skips symlinks, and caps the first queue at 5000 files to avoid blocking on unexpectedly large folders. Loading a folder starts playback immediately. If shuffle is enabled, the initial track is selected from the shuffled queue instead of always using the first file.

Local queue playback advances automatically to the next folder track when the current track ends. Clicking a different track in the local folder queue starts it immediately from the beginning, while clicking the active track is ignored. Queue rows show clean track names without file extensions or raw source labels.

When local tracks are loaded from a folder, the scanner looks for cover images beside the track, nearby artwork subfolders, and parent album folders up to the selected scan root. It prefers sidecar images that match the track name, then common names such as `cover`, `folder`, `front`, `album`, and `albumart`, with common image extensions such as `jpg`, `png`, and `webp`. If no folder artwork is found, local playback falls back to embedded ID3, MP4/M4A, or FLAC picture metadata. The detected image is shown for audio tracks that do not have video.

The visible Music view is a player plus queue surface. It shows track title, seek state, transport controls, shuffle, volume, speed, and clean queue rows. Clicking the media surface toggles play and pause. It does not show selected folder paths, raw local paths, YouTube URLs, source labels, queue source-kind labels, or path tooltips in the normal playback surface.

Keyboard controls are Music-view-only and do not run while focus is inside an input, textarea, select, or editable text area. Space toggles play and pause. Left and Right seek by 10 seconds. Up and Down adjust volume. Shift+Left loads the last played or previous track. Shift+Right loads the next track. Shuffle is enabled by default and avoids immediate repeats until the shuffled queue is exhausted.

Playback speed is chosen from presets (`0.5x`, `1x`, `1.25x`, `1.5x`, `2x`) or a custom value clamped to the supported range. The speed button always shows the active speed.

Volume shows one exact percent value. Local playback supports `0%` to `150%`: local audible output is routed through a Web Audio gain stage when available, including the boosted range above `100%`. YouTube playback remains capped at `100%`. Clicking the volume icon toggles mute without moving the saved volume slider position.

The existing `main` tray icon owns both Pomodoro and Music controls. The menu has separated Pomodoro and Music sections, shows Music status without track titles, and emits prefixed Music tray events for play/pause, previous, next, shuffle, and opening the Music view.

SQLite owns playlist definitions and playback resume state:

- `music_playlists`: user playlists.
- `music_playlist_tracks`: ordered source entries with source URI, stable identity, timestamps, skip ranges, volume, rate, and optional break override.
- `music_playback_states`: last position, duration, status, and update time per stable source identity.

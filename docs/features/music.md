# Music

The music player is the audio side of the work environment. Playlists are tied to session blocks and to environments, so the right audio plays automatically when a block activates. Two sources are supported: local files and YouTube. Spotify is explicitly out of scope.

The main app opens the Music area from the title bar music icon. It is not part of the primary Calendar / To-do tab cycle.

Playback is owned by a persistent app-level player host, not by the Music route. Leaving the Music view hides the visible media surface but keeps local and YouTube playback, playlist state, volume, rate, shuffle mode, and resume persistence alive.

## Sources

**Local files.** Audio and video files on the user's disk. Current desktop builds validate local files through the Rust `plugins/media-player` boundary. Common local audio files play through the native Rodio and Symphonia backend in `plugins/media-player`. Local video uses native GStreamer on desktop builds compiled with the `native-video-gstreamer` Cargo feature when GStreamer initializes and the main window exposes a compatible native handle. If native video is not compiled in, is unavailable at runtime, or fails to load a file, local video uses the token-gated loopback WebView fallback on `127.0.0.1`. The fallback streams only registered local files and serves byte-range responses with media content types so WebView media playback can seek and buffer normally. The fallback supports the codecs available to the platform WebView.

The selected native playback direction is audio first, then desktop video. The native plugin includes a Rodio backend with default features disabled and only playback plus the needed Symphonia decoding features enabled for common music formats. This keeps normal local music playback lighter than a full multimedia framework while avoiding WebView media elements for audio. GStreamer is the first native local video backend and is kept behind an explicit Cargo feature so normal builds do not require system multimedia development packages. A build must not enable GPL or nonfree GStreamer plugin sets, FFmpeg components, or codec packs unless the licensing impact is intentionally accepted.

Native local audio decodes through Rodio and Symphonia. Supported native audio formats are MP3, FLAC, M4A/MP4 with AAC or ALAC, OGG Vorbis, and WAV/PCM. Unsupported audio formats fail explicitly until a broader native multimedia fallback is added. Pause, seek, codec coverage, and memory use for supported local audio are controlled by the native plugin rather than the platform WebView media element. Native local video uses GStreamer `playbin` with a window overlay rectangle driven by the measured Music surface. Visualizations and an audio-only video mode remain planned follow-ups.

**YouTube via the IFrame Player API.** Officially supported, free, no developer key required, no user registration. The IFrame API offers programmatic control: load by ID or URL, load playlists, set start/end timestamps, control volume and playback speed, and seek. Desktop builds serve a tiny loopback HTTP player host on `127.0.0.1` and embed that host in the Music view. The host then embeds YouTube with `strict-origin-when-cross-origin`, `origin`, and `widget_referrer` so YouTube receives a real HTTP referrer even though the main Tauri app uses a custom protocol. The host also uses supported IFrame parameters to hide normal YouTube controls, disable iframe keyboard handling, hide annotations, and remove fullscreen chrome from the embedded player. The Music view places its own transparent hit target over visible YouTube and local video surfaces, so pointer input goes to GanbaruAI controls instead of YouTube's UI. The video remains visible, and required YouTube surfaces such as branding, ads, consent prompts, owner restrictions, and error messages are not removed. Playback position persists to SQLite and restores on app restart via the `start` URL parameter.

YouTube IFrame errors `101` and `150` mean the owner does not allow the video to play in embedded players. GanbaruAI must not bypass that restriction by scraping streams, proxying playback, impersonating YouTube clients, or using download tools behind the scenes. The supported fallback is to tell the user that embedded playback is blocked and let them open the video on YouTube.

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

The Music view can scan a user-selected local folder recursively for common audio and video extensions. When opening the folder picker, desktop builds seed the dialog with Tauri's platform audio directory when it exists, so localized Music folder names come from the OS user directory API instead of a hardcoded path. The scan runs outside the UI thread, skips symlinks, and caps the first playlist at 5000 files to avoid blocking on unexpectedly large folders. Loading a folder starts playback immediately. If shuffle is enabled, the initial track is selected from the shuffled playlist instead of always using the first file.

Local playlist playback advances automatically to the next folder track when the current track ends. Clicking a different track in the local folder playlist starts it immediately from the beginning, while clicking the active track is ignored. Playlist rows show clean track names without file extensions or raw source labels. Automatic playlist transitions should keep the transport and source buttons visually stable, and unknown media duration is displayed as `0:00` with an empty seek bar until metadata is available.

Local video files with a non-playable prefix, such as some lossless cuts made away from keyframes, should not stall when playback starts. For MP4, M4V, and MOV files, the native media probe reads leading empty edit-list entries and passes that playable start to the WebView player, which seeks there before playback and clamps later seeks away from that dead prefix. The Music UI keeps the media element's native timeline and duration for these files. If the WebView still reports no decoded frame data after playback starts, the player also nudges forward as a fallback.

YouTube playlist links resolve through the embedded IFrame player and then expand into the app playlist as individual video entries. The app uses the returned video IDs for playlist order and next/previous controls without requiring a YouTube Data API key. After resolution, playlist entries are stored and loaded as plain single-video sources with fresh YouTube host frames, so GanbaruAI playlist clicks control the current video instead of YouTube's internal playlist state. Playlist resolution has a timeout, so public, private, empty, unavailable, or otherwise non-resolving playlists must surface an error instead of leaving the Music view stuck in loading. When the embedded player exposes metadata for a loaded video, the app replaces the video ID with the resolved video title in the player and playlist. If metadata is unavailable, the video ID remains the fallback label.

When local tracks are loaded from a folder, the scanner looks for cover images beside the track, nearby artwork subfolders, and parent album folders up to the selected scan root. It prefers sidecar images that match the track name, then common names such as `cover`, `folder`, `front`, `album`, and `albumart`, with common image extensions such as `jpg`, `png`, and `webp`. If no folder artwork is found, local playback falls back to embedded ID3, MP4/M4A, or FLAC picture metadata. The detected image is shown for audio tracks that do not have video.

The visible Music view is a player plus playlist surface. It shows seek state, transport controls, shuffle, volume, speed, and clean playlist rows with the active track highlighted. The playlist is hidden by default and can be shown or hidden from an icon button beside the speed control. The top toolbar shows the current media name on the left without a file extension and keeps source entry compact on the right. The media empty state, playlist surface, and compact control strip use the same internal Calendar background, and the playlist uses the same custom scrollbar visuals as the internal Calendar day and week views. The compact control strip spans the media and playlist columns, placing current time and duration at the beginning and end of the progress bar instead of showing a separate title row. Clicking the media surface toggles play and pause. Double-clicking the media surface enters or exits fullscreen for audio, YouTube, and local video without the control strip, fullscreen empty space is black, and the pointer is hidden while fullscreen is active. Fullscreen volume changes briefly show the current sound percent in the bottom-right corner. It does not show selected folder paths, raw local paths, YouTube URLs, source labels, playlist source-kind labels, or path tooltips in the normal playback surface.

Keyboard controls are Music-view-only and do not run while focus is inside an input, textarea, select, or editable text area. Space toggles play and pause. Left and Right seek by 10 seconds. Up and Down adjust volume. Shift+Left loads the last played or previous track. Shift+Right loads the next track. `S` toggles shuffle. `+` and `-` adjust playback speed. `F` enters or exits fullscreen for the current media surface. `Ctrl+L` shows or hides the playlist. Shuffle is enabled by default and avoids immediate repeats until the shuffled playlist is exhausted.

Pointer interaction with the seek and volume sliders does not leave keyboard focus on those sliders. Mouse-clicked Music buttons also release focus after their click action. After using a slider or button, Space, Enter, Left, Right, Up, and Down continue to control playback instead of repeating the focused control.

Playback speed is chosen from presets (`0.5x`, `1x`, `1.25x`, `1.5x`, `2x`) or a custom value clamped to the supported range. The speed button is icon-only, with the active speed available from the button title and the selected menu item.

Volume shows one exact percent value. Native local playback supports `0%` to `150%` through the active Rust backend, including Rodio audio and GStreamer video. Local video fallback is capped at `100%` and stays on the WebView media element volume path, because routing videos through a Web Audio gain graph can bind playback to stale Linux Bluetooth outputs after device changes. When the OS reports an audio device change, active WebView fallback video playback recreates the media element at the current position and resumes if it was playing. YouTube playback remains capped at `100%`. Scrolling over the Music view, including a visible video surface, adjusts volume. Clicking the volume percent text toggles mute without moving the saved volume slider position.

The existing `main` tray icon owns both Pomodoro and Music controls. The menu has separated Pomodoro and Music sections, shows Music status without track titles, and emits prefixed Music tray events for play/pause, previous, next, shuffle, and opening the Music view.

SQLite owns playlist definitions and playback resume state:

- `music_playlists`: user playlists.
- `music_playlist_tracks`: ordered source entries with source URI, stable identity, timestamps, skip ranges, volume, rate, and optional break override.
- `music_playback_states`: last position, duration, status, and update time per stable source identity.

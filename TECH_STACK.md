# Tech stack summary

## Overview

A cross-platform productivity app for desktop and mobile built around a gamified calendar, Kanban board, Pomodoro system, Notion-like note-taking (stored as markdown), real-life skill tree, daily diary, sleep alarm, work environment management, website/app blocking, music player, project management framework with NPC-guided workflows, and collaborative workspaces. All of this is wrapped in an adventure RPG aesthetic with a structurally integrated experience system. Designed as a local-first, privacy-respecting alternative to Notion, ClickUp, and Asana, with an optional paid sync subscription as the primary monetization model alongside donations.

Desktop (Windows, Linux) is the primary target. Mobile (iOS, Android via Tauri v2) is a first-class secondary target sharing the same codebase but offering a focused subset of features.

---

## Languages

### Rust

The backend of the Tauri app. Handles everything that requires OS-level access: process management, global mouse polling, file system operations, native messaging with the browser extension, system tray, local file I/O for the markdown vault, the media player engine (FFmpeg decoding via `ffmpeg-next`), and desktop activity monitoring for the Will system (active window tracking, idle detection, app-switch counting). Rust is not optional here; it is the layer that makes the OS-level features possible from a web-based frontend.

On mobile, Rust still runs as the Tauri core but OS-level features like process management, global mouse events, and desktop activity monitoring are unavailable or sandboxed. The mobile Rust layer focuses on file system access, SQLite, the Yjs persistence layer, and audio playback.

### TypeScript

Used throughout the Svelte frontend. Provides type safety across the heavily interconnected state of the app: calendar triggering environment switches, Pomodoro triggering overlays, XP calculations flowing through the Will system and skill tree, Yjs document updates propagating across the editor and sync layer simultaneously.

### HTML / CSS

Standard web rendering inside the Tauri webview. CSS handles a significant part of the ambient UI: backdrop blur, transitions on the edge panel and overlays, fullscreen break screen aesthetics, the Notion-like editor layout, RPG-style XP screens and battle results displays, visual novel dialogue presentation, skill tree node styling and decay visual effects, and Skill Capsule reveal animations.

---

## Core framework

### Tauri v2

The desktop and mobile shell. Wraps the Svelte frontend in a native window and exposes Rust commands to the JS side. Chosen over Electron for lower memory footprint and binary size, which matters for an always-open app. Tauri v2 adds official iOS and Android support, allowing the same Svelte + Rust codebase to target all four platforms (Windows, Linux, iOS, Android).

Key Tauri v2 capabilities used in this project:

- **Multi-window management.** Separate windows for the main app, the edge panel, the fullscreen break overlay, and custom notifications. Each independently configured (frameless, transparent, always-on-top, positioned to screen edges or center).
- **`set_always_on_top`**. Used for the notification window and fullscreen Pomodoro overlay to appear above all other apps including the Windows taskbar.
- **`set_fullscreen` + `set_decorations(false)` + `set_transparent`**. Combined to produce the fullscreen break screen that covers the taskbar and acts as a custom screen saver during Pomodoro breaks.
- **`setIgnoreCursorEvents`**. Allows the custom notification window to be non-interactive when desired, so it does not interrupt work in other apps.
- **Tray icon API.** The app lives in the system tray when not focused, essential for an always-running productivity tool.
- **`tauri-plugin-native-messaging`**. Bridges the browser extension with the Tauri backend for website blocking and work environment switching.
- **`tauri-plugin-sql`**. SQLite access from the frontend via Tauri commands.
- **File system plugin.** Reading and writing markdown files and vault assets to disk.

**Desktop-only features** (not available on mobile due to OS sandboxing): process management, native messaging, global mouse position polling, always-on-top multi-window, edge panel, work environment switching, fullscreen break overlay, desktop activity monitoring for Will system.

**Mobile** shares the note editor, calendar view and editing, Pomodoro timer, daily diary, sleep alarm, skill tree viewing, app-level procrastination blocking (within platform constraints), and sync layer. The experience is a focused subset of the desktop app, not a separate product.

---

## Frontend

### Svelte 5

The UI framework for both desktop and mobile. Plain Svelte 5 with Vite, not SvelteKit. File-based routing, SSR infrastructure, and adapter abstractions are unnecessary for a Tauri desktop app that is a single-window SPA with navigation handled by a rune store. Chosen over React for this specific project because:

- **Runes (`$state`, `$derived`, `$effect`)** handle fine-grained reactive state without cascading re-renders. For an app where a single event (Pomodoro ending) must simultaneously update the calendar, trigger the overlay, switch the work environment, update the tray, and push a Yjs update, this matters in terms of code clarity and maintainability, not just raw performance.
- **Less boilerplate.** No `useMemo`, `useCallback`, `useRef` patterns needed to avoid re-render storms. Easier to maintain solo long-term as complexity grows.
- **Svelte 5 is the stable default.** New projects scaffold with Svelte 5 + Vite. No version split to navigate.
- **Same codebase for desktop and mobile.** The Svelte frontend runs identically inside Tauri's webview on all platforms.

### Vite

The build tool. Default bundler in the Tauri + Svelte scaffold. Handles HMR during development and production builds. Not a separate choice; it comes with the scaffold.

### pnpm

The package manager. Chosen over npm and yarn for strict dependency isolation (no phantom dependencies, meaning packages can only import what they explicitly declare), disk efficiency via content-addressable storage (shared dependencies are linked, not duplicated across workspaces), and first-class workspace support that Turborepo builds on top of.

### Turborepo

The monorepo task runner. Sits on top of pnpm workspaces and handles build orchestration, task dependency resolution, and local/remote build caching across all packages. When iterating on the Svelte frontend without touching the media player package, Turborepo skips the media player build entirely via cache. Task dependencies are declared in `turbo.json`. For example, the Tauri app's `build` task depends on the media player npm package being built first, and Turborepo ensures the correct execution order and parallelization.

Turborepo does not replace Tauri's build pipeline; it invokes `tauri build`/`tauri dev` as a task. The Rust side of the media player crate builds through cargo as part of Tauri's own process. Turborepo orchestrates the JS/TS side; Rust builds are triggered downstream.

### Workspace structure

> **Note:** this structure represents the intended architectural approach. It should be updated as the project evolves. New modules, renamed directories, or restructured packages should be reflected here so this remains a reliable navigation reference.

```
ganbaruai/
│
├── apps/
│   ├── desktop/                          ← Tauri app (Svelte frontend + Rust backend)
│   │   ├── src/                          ← Svelte frontend
│   │   │   ├── lib/                      ← shared frontend code
│   │   │   │   ├── components/           ← reusable Svelte components
│   │   │   │   │   ├── calendar/         ← calendar wrappers, session block rendering
│   │   │   │   │   ├── kanban/           ← board columns, task cards, drag-and-drop
│   │   │   │   │   ├── pomodoro/         ← timer display, break screen, XP results
│   │   │   │   │   ├── notes/            ← Tiptap editor wrapper, slash commands
│   │   │   │   │   ├── skill-tree/       ← D3/SVG tree rendering, node details
│   │   │   │   │   ├── diary/            ← morning/evening entry forms
│   │   │   │   │   ├── music/            ← player controls, playlist management
│   │   │   │   │   ├── visual-novel/     ← NPC dialogue, conversation state machine
│   │   │   │   │   ├── edge-panel/       ← panel layout, quick-access widgets
│   │   │   │   │   ├── environment/      ← work environment config UI
│   │   │   │   │   ├── contracts/        ← contract creation, tracking, proof UI
│   │   │   │   │   ├── project/          ← project management quest chain phases
│   │   │   │   │   ├── capsules/         ← Skill Capsule reveal animations
│   │   │   │   │   └── ui/              ← shadcn-svelte generated components
│   │   │   │   ├── stores/              ← Svelte runes ($state), global app state
│   │   │   │   ├── api/                ← typed wrappers around Tauri invoke() calls to Rust backend
│   │   │   │   ├── utils/               ← shared helpers, XP formulas, formatters
│   │   │   │   └── types/               ← frontend-specific TypeScript types
│   │   │   ├── windows/                 ← entry points for each Tauri window
│   │   │   │   ├── main/               ← main app window
│   │   │   │   ├── edge-panel/         ← edge panel window
│   │   │   │   ├── break-overlay/      ← fullscreen break screen window
│   │   │   │   └── notification/       ← notification popup window
│   │   │   ├── app.html                 ← HTML shell
│   │   │   ├── app.css                  ← global styles, RPG theme variables
│   │   │   └── app.d.ts                 ← global type declarations
│   │   ├── static/                      ← static assets (fonts, icons, NPC sprites, backgrounds)
│   │   ├── src-tauri/                   ← Rust backend
│   │   │   ├── src/
│   │   │   │   ├── main.rs              ← shared entry point
│   │   │   │   ├── lib.rs               ← shared commands and logic
│   │   │   │   └── mobile.rs            ← mobile-specific Rust logic (optional)
│   │   │   ├── gen/
│   │   │   │   ├── android/             ← auto-generated Android project
│   │   │   │   └── apple/               ← auto-generated iOS/Xcode project
│   │   │   ├── capabilities/
│   │   │   │   ├── desktop.json         ← desktop permission declarations
│   │   │   │   └── mobile.json          ← mobile permission declarations
│   │   │   ├── tauri.conf.json          ← Tauri config (windows, plugins, bundle settings)
│   │   │   └── Cargo.toml
│   │   ├── package.json
│   │   ├── svelte.config.js
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── server/                          ← Hocuspocus sync server (self-hostable)
│       ├── src/
│       └── package.json
│
├── plugins/
│   └── media-player/                    ← LGPL 2.1 Tauri plugin (Rust crate + npm package)
│       ├── src/                         ← Rust source (ffmpeg-next, Symphonia)
│       ├── guest-js/                    ← TypeScript bindings for the frontend
│       ├── Cargo.toml                   ← publishable to crates.io independently
│       └── package.json                 ← publishable to npm independently
│
├── packages/
│   └── shared-types/                    ← TypeScript types shared across app, extension, server
│       ├── src/
│       └── package.json
│
├── extensions/
│   ├── chrome/                          ← Chrome extension (manifest v3)
│   └── firefox/                         ← Firefox extension
│
├── Cargo.toml                           ← cargo workspace root (members: apps/desktop/src-tauri, plugins/media-player)
├── turbo.json                           ← Turborepo task config and dependencies
├── pnpm-workspace.yaml                  ← workspace: apps/*, plugins/*, packages/*, extensions/*
└── package.json                         ← root scripts, shared dev dependencies
```

The cargo workspace and pnpm workspace coexist at the repo root. Turborepo orchestrates the JS/TS tasks across all pnpm workspace members. Cargo handles Rust builds: the Tauri CLI invokes cargo for `apps/desktop/src-tauri`, and the media player plugin is a cargo workspace member that Tauri resolves as a dependency at build time.

---

## UI component libraries

### shadcn-svelte

The primary component source. Generates component source code directly into the project via CLI rather than installing a package. Built on Bits UI primitives. Requires Tailwind CSS v4, which uses CSS-native `@theme` and `@custom-variant` directives via the `@tailwindcss/vite` plugin instead of a `tailwind.config.js` file. Chosen because:

- Components live in your repo and can be freely modified and interconnected without fighting library abstractions.
- Svelte 5 native.
- Covers standard UI needs: dialogs, dropdowns, popovers, calendars, date pickers, command palette, tabs, and more.

### Bits UI

The headless primitive layer under shadcn-svelte. Used directly when shadcn-svelte does not have a specific component or when lower-level control is needed. Svelte 5 native from the start, not an incomplete rewrite like Melt UI's current situation.

### Calendar widget

The calendar and scheduler component. Handles day/week/month views, drag-and-drop event creation and resizing, overlapping event layout, and multi-day event spanning (the parts that would take months to build correctly from scratch). Has a native Svelte adapter and supports injecting custom Svelte components for event rendering, which is how the calendar integrates with the rest of the app's state. Calendar events ("session blocks") carry references to Pomodoro counts,s work environment configs, skill tree branch tags, and playlist assignments.

### svelte-dnd-action

Drag-and-drop library for the Kanban board. Handles column-to-column card movement, priority reordering, and task organization. Used for both personal Kanban (backlog → to do → in progress → done) and per-project Kanban boards within the project management framework.

---

## Note editor

### Tiptap (`@tiptap/core` + `@tiptap/starter-kit`)

The rich text editor engine. Chosen because:

- Produces a Notion-like editing experience (block-based, slash commands, drag-to-reorder blocks) while serializing to standard markdown.
- Headless, with no imposed styles. The visual design is entirely yours.
- First-class Yjs integration via `@tiptap/extension-collaboration`, meaning the editor natively speaks the sync and collaboration protocol without any impedance mismatch.
- Large extension ecosystem for future additions (tables, embeds, code blocks with syntax highlighting, etc.).

### `@tiptap/extension-markdown`

Handles serialization between Tiptap's internal document model and markdown. On every save, the document is serialized to a `.md` file written to disk by the Rust file system layer. Markdown is the canonical on-disk format, not a database or a proprietary format. Users own their files and can open them in Obsidian, VS Code, or any text editor.

### `@tiptap/extension-collaboration`

Connects Tiptap to the Yjs CRDT layer. Every keystroke generates a Yjs binary update rather than replacing the whole document. This is the foundation of both personal multi-device sync and real-time collaborative editing; the same extension handles both cases.

### `@tiptap/extension-collaboration-cursor`

Shows live cursor positions and selections of other collaborators inside a shared document. Used in collaborative workspaces (the ClickUp/Notion alternative tier), not in personal vaults.

---

## Sync, collaboration, and backup architecture

This is one of the most important architectural decisions in the app. The system is designed around three distinct tiers that share the same underlying technology.

### Core principle: local-first

The local file system is always the source of truth. The app works fully offline with zero degradation. Sync is additive: it extends the local-first experience to other devices rather than replacing it. This is the fundamental difference from Notion, which requires internet access to function.

### Yjs

A CRDT (conflict-free replicated data type) library. The core of both sync and collaboration. Every document is a Yjs data structure. Edits generate small binary updates that can be merged from any source in any order and always converge to the same result. This means:

- **No conflict resolution logic to write.** The math handles it at the data structure level.
- **Works offline.** Updates accumulate locally and sync when connection is restored.
- **Real-time collab and async sync use the same primitive.** A Yjs document does not care whether updates arrive 10ms or 10 days later.

Yjs was built specifically for this use case and is used in production by Jupyter, several major Notion alternatives, and Tiptap Cloud itself.

### Hocuspocus

A production-grade Yjs server built specifically for the Tiptap ecosystem. Open source and self-hostable. Chosen over the simpler `y-websocket` because:

- Handles **persistent document state**, so new collaborators can load the full document even if they were offline when edits happened.
- Supports **presence and awareness**: who is online, live cursor positions.
- Has **authentication and authorization hooks**, needed for workspace access control (who can read/write which workspace).
- Designed for exactly this Tiptap + Yjs stack.

Users run their own Hocuspocus instance on a cheap VPS, Raspberry Pi, or any cloud provider. The app includes guided setup instructions to make this as painless as possible.

### E2E encryption (libsodium / `@noble/ciphers`)

All data in transit and at rest on the sync server is end-to-end encrypted. The encryption key is derived client-side from the user's credentials and never leaves their device. The server stores and relays only ciphertext; not even you as the operator can read user data. This is a genuine competitive advantage over Notion and ClickUp, and a strong trust signal to privacy-conscious users.

Two encryption contexts:

- **Personal vault.** Single key per vault, known only to the user's devices. The relay is a blind courier.
- **Collaborative workspace.** One workspace key shared among members, encrypted individually for each member's device using their public key. All members can read the workspace; nobody outside it can, including the server operator.

### The two sync tiers

**Local only (default)**
The app works entirely offline. No sync server involved. The vault lives on the user's file system. Automatic local backups are a scheduled encrypted export (a zip of the vault folder) to a user-specified local path. The user can manually copy this to Google Drive, an external drive, or anywhere they want. The app does not manage this for them but makes the export trivial.

**Self-hosted sync**
The user runs their own Hocuspocus server. The app points to their server URL. Real-time E2E encrypted sync across all devices (desktop + mobile), automatic cloud backups, and collaborative workspaces with live presence. The app provides step-by-step setup guides for common cloud providers and local server options, automated where possible.

### Vault structure on disk

Everything the app produces or manages lives in one folder called the vault: notes, diary entries, calendar data, project files, gamification state, assets, and configuration. This makes backup and sync trivially the same operation regardless of data type.

> **Note:** this structure represents the intended layout. It should be updated as the project evolves. New data types, renamed directories, or restructured storage should be reflected here so this remains a reliable reference.

```
vault/
  notes/
    daily/                ← daily notes (markdown)
    projects/             ← per-project notes and working documents (markdown)
  diary/
    morning/              ← dated morning diary entries (markdown, indexed fields in SQLite)
    evening/              ← dated evening diary entries (markdown, indexed fields in SQLite)
  calendar/               ← calendar event data (session blocks, schedule state)
  projects/
    {project-id}/         ← per-project file attachments (reference docs, research PDFs, competitor screenshots)
  contracts/
    proofs/               ← contract proof attachments (photos for real-life conditions/penalties)
  reports/                ← generated project status reports (markdown, PDF)
  assets/                 ← app assets (fonts, icons, NPC character sprites, backgrounds, UI themes)
  templates/              ← project management phase templates, methodology templates (SWOT, BMC, etc.)
  config.json             ← user settings, work environment definitions, blocker rulesets
  .yjs/                   ← Yjs document state cache (binary, not human-readable)
  app.db                  ← SQLite index (metadata, search, tags, backlinks, XP ledger, Will metrics,
                             skill tree state, contracts, badges, Skill Capsules, streaks, playlist
                             definitions, requirement version diffs, diary indexed fields)
```

**Music files are not stored in the vault.** Local audio files remain wherever the user keeps them on their filesystem. The vault only stores playlist definitions (track paths, ordering, environment associations) in SQLite. This avoids bloating the vault with potentially gigabytes of audio data. If a user syncs across devices, playlists sync but the audio files themselves must exist on each device independently.

**Backups are not stored in the vault.** Scheduled encrypted exports (zip of the vault folder) are written to a user-specified path outside the vault.

---

## Data and state

### SQLite (via `tauri-plugin-sql`)

Local database for all structured data in the app. This includes: metadata and search indexes for notes, tags, and bidirectional backlinks between notes; calendar event indexes and session block configurations; Kanban task state, priority tiers, estimated vs. actual Pomodoro counts, and task-to-session-block links; work environment configs and blocker rulesets; Pomodoro session history with per-session Will metrics (Focus, Clarity, Intensity, Execution scores); XP ledger and skill tree node state (actual levels, displayed levels with decay, unlock status); streak tracking and freeze state; Contract definitions, progress, and penalty state; badge and Skill Capsule inventories; requirement version diffs (timestamped changes to task descriptions, scope, and acceptance criteria within the project management framework); diary entry indexes (the entries themselves are markdown files, but mood, energy, sleep quality fields are indexed for trend analysis); and app settings.

SQLite is never the source of truth for note or diary content; that lives in `.md` files. SQLite is the fast query layer over the vault and the primary store for all gamification and productivity metrics.

### Svelte runes (in-memory state)

Module-level `$state` objects exposed through getter functions (e.g. `getPomodoro()`, `getKanban()`, `getNavigation()`) manage live app state: current Pomodoro phase and timer, active work environment, which overlay is visible (break screen, XP summary, Skill Capsule reveal), current Will metrics accumulating during a focus session, skill tree viewport and zoom level, active Contract progress, current collaborative session, and presence data. The getter pattern keeps the API surface clean and encapsulates mutations. No external state manager or Svelte stores (`writable`/`readable`) needed; runes handle it natively.

---

## OS-level features (Rust crates)

### `sysinfo`

Cross-platform crate for reading running processes and system info. Used for detecting and killing blocked apps and auto-launching apps when switching work environments. Works on Windows and Linux.

### `std::process::Command`

Rust standard library. Spawns desktop applications as part of work environment switching (e.g. "when switching to deep work mode, open VS Code and close Slack").

### `rdev` (or platform-specific Win32 / X11 APIs)

Global mouse position polling to trigger the edge panel. Tauri does not expose a cross-platform API for this natively. On Windows: Win32 `GetCursorPos`. On Linux: X11 or `rdev` as a cross-platform abstraction.

**Wayland limitation:** Wayland's security model fundamentally blocks global input monitoring and foreign window introspection by design. On Wayland compositors (now the default on most Linux distros), the edge panel trigger and active window tracking may not work without compositor-specific extensions (e.g., `wlr-foreign-toplevel-management` for wlroots-based compositors, which does not cover GNOME's Mutter). This is a known limitation on Linux. X11 and Windows work without issue. The app should detect the display server at startup and degrade gracefully: on Wayland without the required extensions, the edge panel falls back to a keyboard shortcut toggle, and Will system activity tracking is limited to in-app signals only (Pomodoro timer adherence, blocker events, task completions).

### Active window tracking

The Will system requires knowing which application the user is actively working in during Pomodoro focus periods. On Windows: Win32 `GetForegroundWindow`. On Linux: X11 `_NET_ACTIVE_WINDOW` (subject to Wayland limitations above). Tracked data includes app-switch count per session, time spent per application, and idle detection (no input events for a configurable threshold). This data feeds directly into Will Focus (distraction events) and Will Intensity (active creation time vs. passive time) scoring. All tracking is local-only and runs exclusively during active Pomodoro focus periods, never in the background.

### `notify`

Rust crate for cross-platform file system watching. Used by the Will Intensity system to detect file saves in the user's project directories during Pomodoro focus periods. This serves as a proxy for active creation output in coding and writing tasks. Also used to watch the vault directory for external changes (e.g., files edited in another app) that need to trigger SQLite reindexing.

---

## Browser extension and website blocking

### Chrome extension (manifest v3) + Firefox equivalent

Installed once during onboarding. Responsibilities:

- Detect current tab URL and report it to Tauri via native messaging.
- Receive blocklist updates from Tauri and enforce them (redirect to a custom branded block page).
- Open and close specific tabs as part of work environment switching.
- Content-specific blocking where possible. For example, blocking unrelated YouTube videos while allowing task-relevant content via keyword/channel matching logic. More sophisticated content analysis is planned for the AI layer (post-MVP).

The custom block page is a minimal, fully designed HTML page served by the extension, not the default browser block UI. Every blocker trigger event during a Pomodoro focus period is logged as Will Focus data (successful block without bypass = positive Focus XP, attempted bypass = negative Focus XP).

### Native Messaging API

The protocol connecting the browser extension to the Tauri backend via stdin/stdout JSON messages. `tauri-plugin-native-messaging` handles the Tauri side. Same mechanism used by RescueTime, 1Password, and similar apps.

---

## Music / media player

A local-first media player licensed separately under LGPL 2.1 and integrated directly into the AGPL 3.0 app. Structured as a Tauri plugin pattern with both a Rust crate (publishable to crates.io) and an npm package, so the media engine is reusable independently of GanbaruAI. Supports two sources: local files (primary) and YouTube via the official IFrame API (secondary).

### `ffmpeg-next`

Rust bindings for FFmpeg. Handles audio and video decoding, format detection, and codec support for local files. This is the primary media engine, covering all formats the user might throw at it. The FFmpeg dependency is linked at build time.

### Symphonia (optional, audio-only path)

A pure-Rust audio decoding library. Used as a lightweight alternative to FFmpeg when only audio playback is needed (Pomodoro playlists, background music, morning alarm audio). Avoids initializing the full FFmpeg stack for audio-only sessions, reducing the memory footprint during typical productivity use. Falls back to `ffmpeg-next` for video or unsupported audio formats.

### YouTube integration (IFrame API)

YouTube is the secondary media source, integrated via the official IFrame Player API. The IFrame API is officially supported, free with no developer key required, and imposes no per-user limits. It works immediately without user registration or setup friction.

The API allows full programmatic control: loading videos by ID or URL, setting start/end times via URL parameters (`start=`, `end=`), controlling volume and playback speed, seeking to specific timestamps, and switching playlists based on Pomodoro phase.

A transparent `<div>` overlay covers the iframe, intercepting all mouse and touch events before they reach the YouTube controls. The user sees the player normally but cannot interact with it; all control is handled programmatically based on the user's preconfiguration. This is not a hidden or headless player. The player remains fully visible and ads play normally. It is simply input-locked. If the user is logged into YouTube Premium in the WebView session, ads do not appear; this is their account's behavior, not the app's doing.

The IFrame API is stateless. Playback position is saved to SQLite before the app closes and restored on next launch by passing the saved timestamp as the `start` parameter when reinitializing the player.

### Spotify: explicitly not supported

Spotify is not supported. As of 2025-2026, their API policies make third-party indie integration effectively impossible: development mode is capped at 5 users with no viable path to scale, extended quota requires 250,000 monthly active users and a legally registered business, and the gap between 5 users and 250,000 MAU is a deliberate policy to shut out indie developers while grandfathering existing large integrations. This decision will be stated publicly in the project's documentation.

### User preconfiguration

Users configure the following per session block or work environment template: which video, playlist, or local file to load; start and end timestamps; parts to skip (defined as timestamp ranges); volume level; playback speed; and whether to switch to a different source during breaks. This configuration is stored in SQLite alongside the session block data and applied automatically when the session block activates.

### Playlist and workflow integration

The media player is not a standalone feature; it is wired into the session lifecycle. Playlists are assigned to work environment templates and calendar session blocks. The Pomodoro system switches between focus and break playlists automatically. The sleep alarm system triggers the morning playlist on dismissal. Quick controls (play/pause, skip, volume) are accessible from the edge panel without leaving the current context.

---

## Notifications and ambient UI

All implemented as secondary Tauri windows for fully custom UI rather than OS notifications:


| Feature                          | Implementation                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pomodoro completion notification | Small frameless always-on-top window at bottom-right corner, auto-dismissed after N seconds                                                                             |
| Fullscreen break screen          | Fullscreen frameless always-on-top window covering the taskbar, semi-transparent dark overlay + looping video background, custom Svelte UI with break timer and options |
| Edge panel                       | Narrow always-on-top window anchored to the right screen edge, shown/hidden based on global cursor position polled from Rust                                            |
| XP battle results screen         | Displayed during Pomodoro breaks and end-of-session-block summaries. RPG-style XP breakdown, Will category scores, streak status, Skill Capsule drops                  |


---

## Skill tree visualization

An RPG-style, cinematic skill tree rendered as SVG within Svelte components. The reference aesthetic is The Rising of the Shield Hero's skill tree: dark background, glowing nodes, discrete center-focused navigation, animated transitions. The tree serves dual purposes: gamification feedback (unlocking skills as the user grows) and personal/professional growth visualization.

### SVG + Svelte components (not D3.js, not Canvas)

D3.js was evaluated and rejected. Its force-directed layout is designed for data visualization, not game-like navigation. It produces unpredictable positions, jittery physics, and defaults to free pan/zoom which fights the intended UX. Canvas was rejected because it loses the Svelte component model and requires manual hit detection.

Instead, nodes are pure Svelte components rendering SVG `<g>` elements (not `<foreignObject>`, which has WebKitGTK rendering quirks). Each node reacts to state changes via Svelte runes. CSS handles all visual states (locked/available/unlocked glows, opacity, filters). Browser hit-testing is free.

### Center-snap navigation

The core interaction contract: **the world moves, the camera does not.** Selecting a node animates the entire graph so that node lands at the viewport center. Navigation is discrete; the user moves one step at a time through the graph via arrow keys or click. No free pan, no free zoom during normal navigation. Users navigate and unlock; they never reposition nodes.

The animation uses a spring (via `svelte/motion`) on the root SVG `<g>` element's `translate` transform. When the focused node changes, the offset is recalculated to center the target node, and the spring interpolates the transition.

Keyboard controls: arrow keys traverse edges to adjacent nodes, Enter/Space opens detail or confirms unlock, Escape exits a sub-layer.

### Neighborhood culling

Instead of virtualizing by viewport rectangle, cull by **graph distance from the focal node**:

- Depth 0 (focal node): render fully, centered
- Depth 1 (direct neighbors): render fully
- Depth 2 (neighbors of neighbors): render at reduced opacity/scale
- Depth 3+: do not render; optionally show a faint indicator

This caps the rendered node count at roughly 15-40 nodes regardless of total tree size. The visible set is a `$derived` computation from BFS on the adjacency list, recomputed only when the focused node changes. SVG filter friction starts around 300-500 nodes; neighborhood culling ensures we never approach that.

### Layered sub-graphs

A node can contain its own skill graph. The top layer shows broad categories (Mind, Body, Craft, Social, Creative), and navigating into a node enters its sub-tree. A navigation stack tracks the current graph context. Going back pops the stack. The renderer always reads from the top of the stack. This is the same mental model as zones in a game.

### Authored graph data

The graph structure is curated static data (TypeScript constants), not user-generated or computed. Node positions are hand-authored within each sub-graph. Only node unlock states are user-specific and persisted to SQLite. The graph definition lives in the codebase and is versioned with the app.

### Visual states

Each node gets a data attribute reflecting its state. All visual differences are CSS-only:

- **Locked**: low opacity, grayscale filter, no interaction
- **Available**: medium opacity, colored glow (`drop-shadow`), cursor pointer
- **Unlocked**: full opacity, bright glow, increased brightness

Edge lines change stroke based on whether the source node is unlocked. Depth-based fading is a CSS variable injected per node.

### Capacity

The tree supports 200+ total nodes across 5-8 first-level branches with arbitrary depth via sub-graphs. Three node visual tiers (basic, notable, keystone) are distinguished by size and glow intensity. Cross-branch connections are rendered as edges that cross sub-graph boundaries or as bridge nodes visible in multiple layers.

---

## Visual novel and NPC layer

NPC interactions in the project management quest chain and onboarding are presented in visual novel style: a background illustration, a character sprite, dialogue text, and interactive options (buttons/form fields).

### Implementation

Built as custom Svelte components, not a third-party visual novel engine. The dialogue system is a state machine driven by JSON-defined conversation trees. Each conversation node contains: the NPC identifier (Fairy, Dwarf, or Drasil), dialogue text, available user responses or form fields, and transition conditions to the next node.

Character sprites and backgrounds are static illustrated assets loaded from the vault's asset directory. Transitions between dialogue states use CSS animations. The visual novel presentation is used exclusively in guided workflows (project management phases, onboarding, tutorial moments) and does not appear in utility interfaces like the Calendar, Kanban, or edge panel.

The Dwarf NPC includes an embedded chatbot interface (powered by the AI layer when available via BYOK) for research discussions during the idea evaluation phase. Drasil is architecturally planned to become the conversational AI assistant in post-MVP development.

---

## Gamification data layer

The experience system (Will, Contracts, Consistency, Streaks, skill tree, Skill Capsules, badges) generates and consumes a significant volume of structured data. All gamification data lives in SQLite alongside the productivity metadata.

### Data stored per Pomodoro session

Start/end timestamps, task ID, project ID, app-switch count, active creation time vs. passive time, distraction events (blocker triggers, extended breaks), Will scores for all four categories (Focus, Clarity, Intensity, Execution), composite focus quality score, and the final computed Session XP.

### Persistent gamification state

Skill tree node unlock status and XP per node, displayed level with decay calculation (`displayed_level = actual_level × e^(-0.03 × days_since_practice)`), tier progression, active and historical Contract state (conditions, duration, penalties, proof attachments), streak count and freeze status, badge inventory, Skill Capsule inventory and pity counters, daily XP caps and diversity bonus tracking, and the user's rolling 30-day output averages per task type (used for Will Intensity personal baseline calibration).

### Anti-grinding enforcement

The XP formula's anti-grinding mechanics (daily caps, logarithmic time conversion, novelty weighting, diversity bonus, competency gates) are enforced at the SQLite query layer. XP is computed and validated against these rules before being committed, not just displayed differently in the UI.

---

## Mobile (Tauri v2)

Tauri v2 has official iOS and Android support. The mobile app shares the Svelte frontend, Tiptap editor, Yjs sync layer, and SQLite database with the desktop app. It is not a separate product; it is the same app with a mobile-appropriate layout and a focused subset of features.

Features available on mobile: note editor, calendar view and editing, Pomodoro timer (with notification-based breaks instead of fullscreen overlay), daily diary (morning and evening entries), sleep alarm (triggers diary flows and morning playlist), skill tree viewing, procrastination stopper (app-level blocking during scheduled focus times and mornings), collaborative workspaces, sync.

Features unavailable on mobile due to OS sandboxing: work environment switching (opening/closing desktop apps, arranging browser tabs), edge panel, fullscreen break overlay, always-on-top windows, desktop activity monitoring for Will system metrics.

### Sleep alarm

The alarm system requires platform-specific APIs: iOS `UNNotificationRequest` with alarm-style scheduling, Android `AlarmManager` with `SCHEDULE_EXACT_ALARM` permission. On alarm dismissal, the app transitions to the morning diary screen and starts the morning playlist. Setting the evening alarm triggers the evening diary flow. Sleep duration (time from setting the alarm to dismissal) is tracked and feeds into diary sleep quality suggestions.

### Mobile app blocking

App-level blocking during focus times uses platform-specific APIs: iOS Screen Time API (Family Controls framework, requires user authorization), Android UsageStatsManager with accessibility services or device admin policies. Both platforms impose significant restrictions on which apps can be blocked and how. The implementation must work within these sandbox constraints and degrade gracefully when permissions are unavailable.

The mobile app also serves as the device that reminds the user to return to their desktop. Calendar notifications for upcoming session blocks function as calls to action.

---

## Report generation

The project management framework generates automatic status reports from Kanban state, calendar data, Pomodoro history, requirement change history, and milestone progress. Reports are exported as markdown (native, just structured text output) or PDF. PDF generation uses Typst, a Rust-native typesetting system that takes structured data and templates as input and produces high-quality PDFs. Invoked via Tauri commands, keeping the rendering pipeline off the frontend thread. For PDF reading and text extraction (importing external documents into the project management framework), `pdfium-render` (Google's PDFium via Rust bindings) handles text extraction and page rendering without requiring a Python runtime.

---

## AI and MCP integration (post-MVP)

All AI features are opt-in and BYOK (bring your own key). The app is fully functional without any AI layer. No API calls leave the device without explicit user consent.

### Planned AI capabilities

Drasil (the primary NPC) as a conversational AI assistant for natural language calendar management and mood-aware motivation. The Dwarf's chatbot for market research and idea validation during project planning phases. Content-specific procrastination detection (analyzing page content, not just URLs, for smarter blocking on platforms like YouTube). Small local LLM models for diary language analysis (detecting goal-setting, reflection quality, mood patterns) without requiring API calls.

### MCP (Model Context Protocol)

The app will expose its data (calendar, tasks, notes, skill tree) via MCP, allowing external AI tools to interact with GanbaruAI's systems. Conversely, GanbaruAI can consume external MCP servers for integrations (email, external calendars, etc.). This is architecturally planned but not part of the initial build.

---

## Monetization model

Everything is free. The project is sustained by donations via GitHub Sponsors.

| Feature       | Cost | Details                                                                     |
| ------------- | ---- | --------------------------------------------------------------------------- |
| Full app      | $0   | All features, local only by default                                         |
| Self-hosted sync | $0 | Bring your own Hocuspocus server (guided setup provided)                   |
| LLM BYOK      | $0   | Bring your own API key for any LLM features, no bill surprises              |

---

## Summary table


| Layer                     | Technology                                           | Reason                                                                             |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Desktop + mobile shell    | Tauri v2                                             | Low footprint, OS access via Rust, multi-window, iOS/Android support               |
| UI framework              | Svelte 5                                             | Fine-grained reactivity, less boilerplate, shared desktop/mobile codebase          |
| Build tool                | Vite                                                 | Default with Tauri + Svelte                                                        |
| Package manager           | pnpm                                                 | Strict dependency isolation, disk efficiency, first-class workspace support        |
| Monorepo orchestration    | Turborepo                                            | Task dependency resolution, build caching, parallel execution across workspaces    |
| Components                | shadcn-svelte + Bits UI                              | Source-owned, headless, Svelte 5 native                                            |
| Calendar UI               | calendar widget                                           | Only mature Svelte calendar with drag-and-drop                                     |
| Kanban drag-and-drop      | svelte-dnd-action                                    | Drag-and-drop for Kanban columns and task reordering                               |
| Note editor               | Tiptap + starter-kit                                 | Notion-like UX, markdown serialization, native Yjs integration                     |
| Markdown serialization    | `@tiptap/extension-markdown`                         | On-save serialization to `.md` files on disk                                       |
| Sync / collaboration      | Yjs + `@tiptap/extension-collaboration`              | CRDT-based, conflict-free, same primitive for sync and real-time collab            |
| Collaboration cursors     | `@tiptap/extension-collaboration-cursor`             | Live presence in shared workspaces                                                 |
| Sync server               | Hocuspocus                                           | Yjs server with persistence, presence, and auth hooks                              |
| Encryption                | libsodium / `@noble/ciphers`                         | E2E encryption, server sees only ciphertext                                        |
| Local DB                  | SQLite via `tauri-plugin-sql`                        | Metadata, search, tags, XP, Will metrics, contracts, streaks, requirement diffs    |
| Skill tree rendering      | SVG + Svelte components                              | Center-snap navigation, neighborhood culling, CSS-driven visual states            |
| Media engine (video)      | `ffmpeg-next`                                        | FFmpeg Rust bindings for full audio/video format support                           |
| Media engine (audio-only) | Symphonia (optional)                                 | Pure-Rust audio decoding, lighter than FFmpeg for playlist-only use                |
| YouTube playback          | IFrame Player API                                    | Official, free, no developer key, full programmatic control, ToS-compliant         |
| File watching             | `notify`                                             | Cross-platform file system events for Will Intensity tracking and vault reindexing |
| Process control           | `sysinfo` + `std::process`                           | App blocking and environment switching                                             |
| Activity monitoring       | Win32 / X11 / `rdev`                                 | Active window tracking, idle detection, app-switch counting for Will system        |
| Mouse tracking            | `rdev` / Win32 / X11                                 | Edge panel trigger                                                                 |
| Browser bridge            | Native Messaging + Chrome/Firefox extension          | Website blocking and tab environment switching                                     |
| PDF generation            | Typst                                                | Rust-native typesetting, structured data → high-quality PDF reports                |
| PDF reading               | `pdfium-render`                                      | Google PDFium Rust bindings for text extraction and page rendering                 |
| Visual novel layer        | Custom Svelte components                             | JSON-driven dialogue state machine, NPC interactions in project management         |
| Mobile alarm              | iOS `UNNotificationRequest` / Android `AlarmManager` | Sleep alarm triggering diary flows and morning routines                            |
| Mobile app blocking       | iOS Screen Time API / Android UsageStatsManager      | App-level blocking during focus times within platform sandbox constraints          |
| Backend language          | Rust                                                 | Required by Tauri, OS-level APIs, media engine                                     |
| Frontend language         | TypeScript                                           | Type safety across interconnected state                                            |

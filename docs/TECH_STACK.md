# Tech stack summary

## Overview

A cross-platform productivity app for desktop and mobile built around a calendar, Kanban board, Pomodoro system, Notion-like note-taking (stored as markdown), daily diary, sleep alarm, work environment management, website/app blocking, music player, project management framework, and collaborative workspaces. Designed as a local-first, privacy-respecting alternative to Notion, ClickUp, and Asana. A gamification layer (skill tree, XP, contracts, NPC-guided workflows) is planned for later phases.

Desktop (Windows, Linux) is the primary target. Mobile (iOS, Android via Tauri v2) is a first-class secondary target sharing the same codebase but offering a focused subset of features.

---

## Languages

### Rust

The backend of the Tauri app. Handles everything that requires OS-level access: process management, global mouse polling, file system operations, native messaging with the browser extension, system tray, local file I/O for the markdown vault, the media player engine (FFmpeg decoding via `ffmpeg-next`), and desktop activity monitoring (active window tracking, idle detection, app-switch counting). Rust is not optional here; it is the layer that makes the OS-level features possible from a web-based frontend.

On mobile, Rust still runs as the Tauri core but OS-level features like process management, global mouse events, and desktop activity monitoring are unavailable or sandboxed. The mobile Rust layer focuses on file system access, SQLite, the Yjs persistence layer, and audio playback.

### TypeScript

Used throughout the Svelte frontend. Provides type safety across the heavily interconnected state of the app: calendar triggering environment switches, Pomodoro triggering overlays, Yjs document updates propagating across the editor and sync layer simultaneously.

### HTML / CSS

Standard web rendering inside the Tauri webview. CSS handles a significant part of the ambient UI: backdrop blur, transitions on the edge panel and overlays, fullscreen break screen aesthetics, the Notion-like editor layout, visual novel dialogue presentation (planned).

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
- **File system plugin.** Reading and writing markdown files and vault assets to disk.

**Desktop-only features** (not available on mobile due to OS sandboxing): process management, native messaging, global mouse position polling, always-on-top multi-window, edge panel, work environment switching, fullscreen break overlay, desktop activity monitoring.

**Mobile** shares the note editor, calendar view and editing, Pomodoro timer, daily diary, sleep alarm, app-level procrastination blocking (within platform constraints), and sync layer. The experience is a focused subset of the desktop app, not a separate product.

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

Development uses Node.js for the Svelte, Vite, TypeScript, Tailwind, Vitest, pnpm, and Tauri CLI toolchain only. Node is not bundled with the shipped Tauri app. Node 24 LTS is the recommended local version through `.nvmrc` and `.node-version`; the package engine accepts Node 22.12.0 or newer on the Node 22 LTS line while it remains maintained.

### Turborepo

The monorepo task runner. Sits on top of pnpm workspaces and handles build orchestration, task dependency resolution, and local/remote build caching across all packages. When iterating on the Svelte frontend without touching the media player package, Turborepo skips the media player build entirely via cache. Task dependencies are declared in `turbo.json`. For example, the Tauri app's `build` task depends on the media player npm package being built first, and Turborepo ensures the correct execution order and parallelization.

Turborepo does not replace Tauri's build pipeline; it invokes `tauri build`/`tauri dev` as a task. The cargo workspace and pnpm workspace coexist at the repo root: Turborepo orchestrates JS/TS tasks across pnpm workspace members, while Cargo handles Rust builds. The Tauri CLI invokes cargo for `apps/client/src-tauri`, and the media player plugin is a cargo workspace member that Tauri resolves as a dependency at build time.

---

## UI component libraries

### shadcn-svelte

The primary component source. Generates component source code directly into the project via CLI rather than installing a package. Requires Tailwind CSS v4, which uses CSS-native `@theme` and `@custom-variant` directives via the `@tailwindcss/vite` plugin instead of a `tailwind.config.js` file. Chosen because:

- Components live in your repo and can be freely modified and interconnected without fighting library abstractions.
- Svelte 5 native.
- Covers standard UI needs: dialogs, dropdowns, popovers, calendars, date pickers, command palette, tabs, and more.

### Calendar widget

The calendar and scheduler component. Handles day/week/month views, drag-and-drop event creation and resizing, overlapping event layout, and multi-day event spanning (the parts that would take months to build correctly from scratch). Has a native Svelte adapter and supports injecting custom Svelte components for event rendering, which is how the calendar integrates with the rest of the app's state. Calendar events ("session blocks") carry references to Pomodoro counts,s work environment configs, and playlist assignments.

### svelte-dnd-action

Drag-and-drop library for the Kanban board. Handles column-to-column card movement, priority reordering, and task organization. Used for both personal Kanban (backlog → to do → in progress → done) and per-project Kanban boards within the project management framework.

### Theming

Registry-based theme system. Each theme is a single frozen object containing the 32-slot event color palette plus optional app and calendar shell token overrides applied via CSS variable injection. Adding a theme (built-in or user-authored) is one object in the registry; no other code needs to change. Events store stable slot IDs, not hex, so switching themes recolors the calendar instantly without migrating data. Theming is intentionally color-deep, not structure-deep: heavier UI edits (layout, typography, new components) are out of scope for themes and route through upstream contributions or a fork. User themes are stored normalized in SQLite alongside calendar events and pomodoro segments (one row per theme, plus per-token rows for sources, app shell, and calendar shell, with seed mirrors for reset and a `derivation_engine_version` stamp); built-in light and dark stay code-pinned. JSON acts as the import/export interchange only. Full design in `docs/features/themes.md`.

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

See the vault directory tree in `AGENTS.md` for the canonical layout. Everything the app produces or manages lives in one folder called the vault, making backup and sync the same operation regardless of data type.

---

## Data and state

### SQLite (via Rust commands)

Local database for all structured data in the app. This includes: metadata and search indexes for notes, tags, and bidirectional backlinks between notes; calendar event indexes and session block configurations; Kanban task state, priority tiers, estimated vs. actual Pomodoro counts, and task-to-session-block links; work environment configs and blocker rulesets; Pomodoro session history; requirement version diffs (timestamped changes to task descriptions, scope, and acceptance criteria within the project management framework); diary entry indexes (the entries themselves are markdown files, but mood, energy, sleep quality fields are indexed for trend analysis); and app settings.

SQLite is never the source of truth for note or diary content; that lives in `.md` files. SQLite is the fast query layer over the vault and the primary store for all productivity metrics.

### Svelte runes (in-memory state)

Module-level `$state` objects exposed through getter functions (e.g. `getPomodoro()`, `getKanban()`, `getNavigation()`) manage live app state: current Pomodoro phase and timer, active work environment, which overlay is visible (break screen), current collaborative session, and presence data. The getter pattern keeps the API surface clean and encapsulates mutations. No external state manager or Svelte stores (`writable`/`readable`) needed; runes handle it natively.

---

## Data architecture: documents vs structured data

GanbaruAI has two fundamentally different categories of data, and each uses the storage format that fits it. Mixing them up (e.g., storing calendar events as markdown, or storing notes in SQLite) would compromise both.

### Documents: markdown on disk, SQLite indexes

Notes, diary entries, and project documentation are markdown files stored in the vault directory. SQLite stores metadata (title, tags, backlinks, mood/energy fields for diary) for fast queries, but the `.md` file is always the source of truth for content.

Why markdown for documents:

- Human-readable. Users can open their notes in Obsidian, VS Code, or any text editor.
- Git-friendly. Diffs are meaningful, merges are possible, history is inspectable.
- Portable. No lock-in. If the user stops using GanbaruAI, their writing is intact.
- AI-agent-friendly. Any AI coding agent can read and write markdown natively, with no tools or plugins required.

Why NOT SQLite for document content: binary format that can't be diffed, can't be opened in external editors, creates lock-in, and makes the vault opaque.

### Structured data: SQLite as source of truth

Everything with fields, relationships, and query requirements lives in SQLite. This includes:

- **Calendar events** with start/end times, recurrence rules, pomodoro config, music playlist, color, project ID, workspace association, attendees, alarms, and overrides.
- **Kanban tasks** with status, priority, column position, estimated/actual pomodoro counts, linked calendar events, and project ID.
- **Workspace configurations** defining which browser tabs to open, which terminal to activate, which apps to launch/close, which blocker ruleset to apply, and which project context to load.
- **Pomodoro sessions and segments** with timestamps, phase, duration, pause log, idle events, and XP computation.
- **Project definitions** linking all of the above: a project references its kanban board, its calendar events, its workspace config, and its notes directory.

Why SQLite for structured data:

- **Relational queries.** "Show all in-progress tasks for project X that have calendar events this week" is a JOIN, not a file-tree traversal.
- **Foreign keys.** A calendar event references a project, a pomodoro config, and a workspace. These relationships are enforced at the schema level.
- **Atomic updates.** Moving a task between columns or updating a recurring event series are transactions that either fully succeed or fully roll back.
- **Fast reads.** Querying today's calendar events or filtering tasks by status is O(index-lookup), not O(parse-every-file).
- **Concurrent access.** The Tauri frontend, background Rust processes (idle detection, file watcher), and the CLI can all query SQLite safely.

### Why NOT markdown (or JSON, or YAML) for structured data

Storing a calendar event as a markdown file would mean:

- **Parsing overhead.** Every query ("what events are today?") requires reading and parsing every event file, extracting YAML frontmatter, and filtering in application code. SQLite does this in microseconds via indexes.
- **No relationships.** A calendar event that references a project, links to kanban tasks, and carries a pomodoro config would need to store IDs as text and resolve them manually. There are no foreign keys, no referential integrity, and no cascading deletes.
- **No atomic updates.** Updating a recurring event series (50+ instances) means writing 50+ files. If the process crashes mid-write, the data is inconsistent. SQLite handles this as a single transaction.
- **No concurrent access.** If the Tauri app and a CLI tool both try to update the same event file simultaneously, one overwrites the other. SQLite handles concurrent writers safely.
- **Query complexity.** "Show all tasks in project X that are in-progress and have a pomodoro session this week" would require reading every task file, every event file, and every session file, parsing each, joining in application code, and filtering. This is a single SQL query with JOINs.

JSON or YAML files have the same fundamental problems. They are slightly more structured than markdown but still lack relationships, transactions, concurrent access, and indexed queries.

A separate SQLite database per project was also rejected: it fragments data, makes cross-project queries impossible (e.g., "show all my events today across all projects"), and complicates backups.

---

## CLI for agent integration

### Why a CLI instead of MCP

All of GanbaruAI's data operations are local: reading SQLite, writing SQLite, reading/writing vault files. For local operations, a CLI is strictly simpler than MCP:

- **No running server.** MCP requires a persistent process listening for connections. A CLI starts, runs the query, returns the result, and exits.
- **Zero setup.** Codex and other CLI agents call CLI tools via Bash natively. No plugin installation, no MCP configuration, no `.mcp.json` files.
- **Universal.** The CLI works with any AI agent (Codex, Cursor, Copilot), any script, any automation. MCP is specific to MCP-compatible clients.
- **No protocol overhead.** MCP adds JSON-RPC framing, capability negotiation, and connection lifecycle management. A CLI call is `ganbaruai task list`, output to stdout.

MCP becomes the right choice later for features that require persistent connections: pushing real-time notifications to agents ("your calendar event starts in 5 minutes"), streaming progress updates, or bidirectional communication between the running Tauri app and an agent session. That is a post-MVP concern. For all CRUD operations and queries, the CLI is the primary interface.

### CLI design

The `ganbaruai` CLI is a Rust binary that links directly to the same SQLite access layer used by the Tauri app. It reads the vault path from the app's config and operates on the same database. Output defaults to human-readable text; JSON output mode returns structured JSON for programmatic consumption by agents.

```bash
# Project management
ganbaruai project list
ganbaruai project info ganbaruai
ganbaruai project create "my-app" --repo /path/to/repo

# Tasks / Kanban
ganbaruai task list --project ganbaruai --status in-progress
ganbaruai task add "Implement auth module" --project ganbaruai --priority high
ganbaruai task move 42 --column in-progress
ganbaruai task done 42
ganbaruai task list --project ganbaruai --json  # structured output for agents

# Calendar
ganbaruai calendar today
ganbaruai calendar week
ganbaruai calendar add "Deep work: auth" --start "2026-04-02 10:00" --duration 2h \
  --project ganbaruai --pomodoro deep --color indigo
ganbaruai calendar next

# Workspace
ganbaruai workspace list
ganbaruai workspace activate ganbaruai-dev
ganbaruai workspace current

# Pomodoro
ganbaruai pomodoro status
ganbaruai pomodoro start --task 42

# Export project state as markdown (for the project's git repo)
ganbaruai export kanban --project ganbaruai
```

### Markdown export for software project repositories

When a user manages a software project with GanbaruAI, the structured data (tasks, calendar events, workspace configs) lives in GanbaruAI's vault SQLite. But the project's git repository also needs project context for:

- **Collaborators who don't use GanbaruAI.** They read exported kanban snapshots and reports to understand what's happening.
- **AI agents without the CLI installed.** They read markdown natively without any tooling.
- **Code review context.** A PR description can reference task numbers from the exported kanban.
- **Onboarding.** New contributors read the project state to orient themselves.

The CLI exports repo-facing views as markdown into the repository:

```bash
# Generate a kanban snapshot
ganbaruai export kanban --project ganbaruai > KANBAN.md
```

Example output of `ganbaruai export kanban`:

```markdown
# Kanban: GanbaruAI

## In progress
- #42: Tiptap rich text editor [high] (assigned calendar: Mon/Wed 10:00-12:00)
- #45: Diary entry forms [medium]

## To do
- #48: Bidirectional backlink index
- #49: Note search and filtering

## Done recently
- #39: Pomodoro segment persistence
- #40: Calendar conflict warnings
```

**This export is a view of the database, not the source of truth.** The flow is:

1. User manages tasks and events in GanbaruAI's UI (or via CLI). SQLite stores the data.
2. `ganbaruai export kanban` writes the current task state as markdown to the project repo.
3. Collaborators and agents read the markdown. It is always up to date because the export runs on commit (via a git hook) or on demand.
4. If a user edits an exported kanban snapshot directly, an explicit import command can validate and apply those changes back to SQLite.

This is the same model as GitHub: the issue database is the source of truth, but issues are viewable as markdown and editable via API. The markdown is portable and useful on its own, but it is derived from the structured data.

### The virtuous cycle: GanbaruAI developing itself

GanbaruAI's own development follows this exact workflow across four stages:

**Stage 1 (now, pre-CLI):** ROADMAP.md, AGENTS.md, and feature docs are hand-maintained markdown files in the repo. Codex agents read and write them directly. This works because markdown is the universal baseline that requires no tooling.

**Stage 2 (CLI exists):** GanbaruAI's project management data moves into its own database. The CLI exports kanban snapshots and generated reports to the repo automatically (via git hook or CI). Agents can use either the CLI's structured output for queries or read the exported markdown for simple context.

**Stage 3 (full UI):** Development sessions are calendar events with pomodoro configs and workspace settings. Starting a "GanbaruAI dev" calendar event auto-opens VS Code at the project root, switches the terminal, loads project notes, and activates the right blocker rules. The kanban tracks features and bugs across phases. Each PR links to a task.

**Stage 4 (agent integration, post-MVP):** Agents query the database via CLI before starting work, create calendar events for their planned work sessions, update task status as they complete items, and export repo-facing context on commit. The developer reviews agent work from the calendar and kanban views in GanbaruAI's UI, not by reading raw git logs.

The feedback loop: every workflow friction discovered while building GanbaruAI with GanbaruAI becomes a feature improvement. The tool's own development is the primary test case for its project management system, its agent integration, and its markdown export format.

The repo-facing markdown format is a portability layer, not the canonical store. The source of truth stays in SQLite; generated markdown exists to make project state readable in tools that only understand files.

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

The custom block page is a minimal, fully designed HTML page served by the extension, not the default browser block UI. Blocker trigger events during Pomodoro focus periods are logged for productivity analytics.

### Native Messaging API

The protocol connecting the browser extension to the Tauri backend via stdin/stdout JSON messages. `tauri-plugin-native-messaging` handles the Tauri side. Same mechanism used by RescueTime, 1Password, and similar apps.

---

## Music / media player

A local-first media player licensed separately under LGPL 2.1 and integrated directly into the AGPL 3.0 app. Structured as a Tauri plugin pattern with both a Rust crate (publishable to crates.io) and an npm package, so the media engine is reusable independently of GanbaruAI. Supports two sources: local files (primary) and YouTube via the official IFrame API (secondary).

### Current local playback path

Desktop local playback currently uses the browser media element inside the Tauri WebView, with file access provided by a token-gated Rust loopback media host on `127.0.0.1`. The Rust side validates the file path, scans user-selected folders outside the UI thread, registers only selected files, and streams byte-range responses with media content types. This keeps local audio and video usable without requiring GStreamer development packages in every developer build.

This path is a compatibility fallback, not the final codec story or the final latency story. It does not currently decode through FFmpeg, libav, GStreamer, or Symphonia. It can play only the formats and codecs supported by the user's platform WebView, and it carries the memory overhead of the WebView media element plus the loopback host and optional Web Audio graph.

Local volume uses the media element directly only when Web Audio is unavailable. When Web Audio is available, local playback is routed through a `GainNode`; normal volume, boosted volume, mute, and pause silence all update that gain synchronously. This avoids waiting on slower WebView pause completion for audible silence, but it is still a fallback around a browser media pipeline rather than a native transport engine.

### Native media backend target

The production local backend should be Rust-controlled through `plugins/media-player`. The selected first implementation target is Rodio with default features disabled and only playback plus the needed Symphonia decoding features enabled for common local music files. This gives the app a small audio-only path before it initializes any video-capable multimedia framework. The backend owns local audio decoding, transport controls, native volume, native mute, seeking, rate changes, duration, position snapshots, and audio device output. Metadata, artwork extraction, frontend event delivery, and full Music view migration are still being wired.

Rodio is the first target because it is a RustAudio playback crate, uses CPAL for cross-platform audio output, supports player controls such as play, pause, seek, volume, and speed, and uses Symphonia as the default decoder backend for common file types. The approved dependency shape is `rodio` with `default-features = false` and features limited to `playback`, `symphonia-flac`, `symphonia-mp3`, `symphonia-isomp4`, `symphonia-aac`, `symphonia-alac`, `symphonia-ogg`, `symphonia-vorbis`, `symphonia-wav`, and `symphonia-pcm`.

GStreamer, libVLC, and an LGPL-compatible FFmpeg/libav path remain fallback candidates for local video, unsupported audio formats, or broader codec coverage. They should be lazy and separate from the default audio-only path so normal background music does not pay their memory cost.

### Rodio and Symphonia audio path

Rodio is the selected first native local audio playback target. Rodio provides the playback controller and audio output path through CPAL. Symphonia provides decoding for common music containers and codecs. This path should replace the WebView audio element for normal local music playback after the frontend migration, and it is optimized for instant pause, instant resume, bounded buffering, and low audio-only RAM usage.

### `ffmpeg-next`

Rust bindings for FFmpeg. Handles audio and video decoding, format detection, and codec support for local files when the native backend needs libav coverage beyond the GStreamer path. The FFmpeg dependency is linked at build time.

### Symphonia fallback role

A pure-Rust audio decoding library. Used through the first native audio backend when only audio playback is needed, such as Pomodoro playlists, background music, and morning alarm audio. Avoids initializing a full video-capable stack for audio-only sessions, reducing the memory footprint during typical productivity use. Broader backends can still handle video or unsupported audio formats later.

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
| Session summary screen           | Displayed during Pomodoro breaks with session completion stats                                                                                                          |


---

## Gamification, skill tree, and NPC layer (deferred)

The skill tree visualization, visual novel NPC interactions, Will system, contracts, badges, Skill Capsules, streaks, and XP formula are all planned for later phases. Full specifications remain in PRODUCT_SPEC.md. No gamification code exists in the current codebase.

---

## Mobile (Tauri v2)

Tauri v2 has official iOS and Android support. The mobile app shares the Svelte frontend, Tiptap editor, Yjs sync layer, and SQLite database with the desktop app. It is not a separate product; it is the same app with a mobile-appropriate layout and a focused subset of features.

Features available on mobile: note editor, calendar view and editing, Pomodoro timer (with notification-based breaks instead of fullscreen overlay), daily diary (morning and evening entries), sleep alarm (triggers diary flows and morning playlist), procrastination stopper (app-level blocking during scheduled focus times and mornings), collaborative workspaces, sync.

Features unavailable on mobile due to OS sandboxing: work environment switching (opening/closing desktop apps, arranging browser tabs), edge panel, fullscreen break overlay, always-on-top windows, desktop activity monitoring.

### Sleep alarm

The alarm system requires platform-specific APIs: iOS `UNNotificationRequest` with alarm-style scheduling, Android `AlarmManager` with `SCHEDULE_EXACT_ALARM` permission. On alarm dismissal, the app transitions to the morning diary screen and starts the morning playlist. Setting the evening alarm triggers the evening diary flow. Sleep duration (time from setting the alarm to dismissal) is tracked and feeds into diary sleep quality suggestions.

### Mobile app blocking

App-level blocking during focus times uses platform-specific APIs: iOS Screen Time API (Family Controls framework, requires user authorization), Android UsageStatsManager with accessibility services or device admin policies. Both platforms impose significant restrictions on which apps can be blocked and how. The implementation must work within these sandbox constraints and degrade gracefully when permissions are unavailable.

The mobile app also serves as the device that reminds the user to return to their desktop. Calendar notifications for upcoming session blocks function as calls to action.

---

## Report generation

The project management framework generates automatic status reports from Kanban state, calendar data, Pomodoro history, requirement change history, and milestone progress. Reports are exported as markdown (native, just structured text output) or PDF. PDF generation uses Typst, a Rust-native typesetting system that takes structured data and templates as input and produces high-quality PDFs. Invoked via Tauri commands, keeping the rendering pipeline off the frontend thread. For PDF reading and text extraction (importing external documents into the project management framework), `pdfium-render` (Google's PDFium via Rust bindings) handles text extraction and page rendering without requiring a Python runtime.

---

## AI integration architecture

All AI features are opt-in and BYOK. The app is fully functional without any AI layer. No API calls leave the device without explicit user consent. Three distinct integration paths serve different user profiles.

### Integrated terminal (developer path)

An xterm.js terminal emulator embedded in the Tauri webview. Runs Codex by default, or another CLI-based AI agent when the user chooses one. This is the power-user path for developers and supports file editing, shell commands, tests, subagents, and repository-aware workflows.

xterm.js is the same terminal emulator used by VS Code. It handles color, Unicode, resize, selection, and all standard terminal behavior. The user installs Codex or another supported agent themselves and signs in with their own account or API key. GanbaruAI provides a specialized terminal that is context-aware, not a redistribution of any agent.

**Context injection from app state.** `AGENTS.md` stays as project-level conventions. Task-specific context comes from GanbaruAI dynamically and is passed through the launch prompt, standard input, or the selected agent's SDK.

```bash
# User clicks "Start" on kanban task #42.
# GanbaruAI assembles project context and launches Codex.
ganbaruai project context ganbaruai | codex exec "Start implementing kanban task #42"

# Background agent for delegated work.
ganbaruai project context ganbaruai | codex exec "Research OAuth2 best practices for Tauri desktop apps"

# Workflow-specific prompt for brainstorming.
codex exec "Help brainstorm a new project. Guide structured ideation, evaluate ideas against criteria, and write results to the project notes directory."
```

Key Codex capabilities for programmatic control:

| Capability | Purpose |
|---|---|
| `codex exec` | Run non-interactive agents from scripts, CI, or GanbaruAI background jobs |
| Codex SDK | Control local Codex agents from an application or internal tool |
| `AGENTS.md` | Load persistent project conventions before work starts |
| Subagents | Delegate specialized work in parallel |
| MCP | Connect Codex to external tools and data sources |
| Sandbox and approval settings | Bound file system access, command execution, and automation risk |
| JSONL output mode | Consume agent progress and results programmatically |

### Session management

Per-project conversation threads stored in SQLite. The calendar drives automatic session switching.

When a calendar event starts (e.g., "Project X: auth module"), GanbaruAI:
1. Saves the current AI session (session ID, conversation state)
2. Checks if a previous session exists for the new event's project
3. Resumes the previous session when the selected agent supports resumable threads, or starts a new one with project context
4. Injects the current task context through the agent launch prompt, standard input, or SDK call

The user sees one AI panel that automatically carries the right conversation for whatever they're working on. Switching between four different projects in a week means four persistent conversation threads, each resuming exactly where the user left off.

Manual override is always available: the user can stay in the current conversation, switch manually, or start a fresh session.

### BYOK chat widget (general user path)

A chat interface inside GanbaruAI's UI for users who don't use the developer terminal. Same session management (calendar-driven switching, per-project threads) but with a web-based chat widget instead of a terminal.

Three LLM provider categories, covering most users:

- **OpenAI API**. Direct API integration for OpenAI-hosted models.
- **OpenAI-compatible APIs** (Groq, Together, Mistral API, and any provider implementing a compatible chat format). A single integration covers dozens of providers.
- **Ollama** (local models via localhost REST API). Runs Llama, Mistral, Gemma, and other open models entirely on the user's machine. No API key needed, no data leaves the device.
- **Other provider APIs** when users supply their own credentials and the integration is implemented explicitly.

Context injection works the same way as the terminal path: GanbaruAI assembles project/task context and sends it as the system prompt in API calls. The chat widget can read/write GanbaruAI data via internal Tauri commands but cannot edit arbitrary files or run bash commands.

BYOK configuration UI: API key management (stored locally, never transmitted except to the configured provider), model selection, provider setup with guided instructions, and consent controls for what context is sent to the LLM.

### Workflow phase prompts

Each project management phase has a structured system prompt that adapts the AI's behavior without requiring specialized agents. One general agent per project carries context across phases:

- **Brainstorming:** "Guide the user through structured ideation. Help them generate ideas, evaluate against criteria, combine or discard. Research existing solutions."
- **Idea evaluation:** "Help evaluate this idea against Want/Can/Need criteria. Research competitors, market size, and feasibility. Fill the market analysis template."
- **Planning:** "Help create a detailed specification. Break down into phases, estimate resources, identify risks, define milestones."
- **Execution:** "Assist with implementation. Review progress against the plan, suggest next steps, help resolve blockers."

These prompts are appended to the base system prompt when the user enters a project management phase. They work with both the terminal and the BYOK chat widget.

### Background agents

Non-interactive agents for delegated or parallel work. The user can delegate a kanban task to a background agent instead of working on it interactively.

- Terminal path: `codex exec` or the Codex SDK runs as a separate process or controlled local agent
- BYOK path: direct LLM API calls from the Rust backend
- Results appear as notifications, update kanban tasks directly, or create PRs
- Multiple background agents can run in parallel, each with isolated context from GanbaruAI's prompt builder

### CLI as the live data bridge

The `ganbaruai` CLI (detailed in the "CLI for agent integration" section above) serves as the bridge between AI agents and GanbaruAI's data. Inside the integrated terminal, Codex calls `ganbaruai task list`, `ganbaruai calendar today`, etc. to query live data. Background agents use the CLI for structured queries. The CLI is also available to any external script or automation.

### MCP (external access only)

MCP is reserved for a single use case: letting external AI clients that don't run locally access GanbaruAI's data. This includes ChatGPT, teammate agents, or any MCP-compatible client that connects remotely.

MCP is not used for:
- How Codex interacts with GanbaruAI (that's the CLI)
- How the integrated terminal works (that's direct process spawning)
- How the BYOK chat widget works (that's direct API calls)

MCP adds value when: a user wants their ChatGPT session to see their GanbaruAI calendar, or a teammate's agent needs to query project tasks without having the CLI installed locally. This is a post-MVP feature.

GanbaruAI can also consume external MCP servers for integrations (email, external calendars, etc.) when those integrations require real-time bidirectional connections.

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
| Components                | shadcn-svelte                                        | Source-owned, Svelte 5 native, customizable                                        |
| Calendar UI               | calendar widget                                           | Only mature Svelte calendar with drag-and-drop                                     |
| Kanban drag-and-drop      | svelte-dnd-action                                    | Drag-and-drop for Kanban columns and task reordering                               |
| Theming                   | Registry-based theme store                           | One frozen object per theme; palette plus optional shell token overrides           |
| Note editor               | Tiptap + starter-kit                                 | Notion-like UX, markdown serialization, native Yjs integration                     |
| Markdown serialization    | `@tiptap/extension-markdown`                         | On-save serialization to `.md` files on disk                                       |
| Sync / collaboration      | Yjs + `@tiptap/extension-collaboration`              | CRDT-based, conflict-free, same primitive for sync and real-time collab            |
| Collaboration cursors     | `@tiptap/extension-collaboration-cursor`             | Live presence in shared workspaces                                                 |
| Sync server               | Hocuspocus                                           | Yjs server with persistence, presence, and auth hooks                              |
| Encryption                | libsodium / `@noble/ciphers`                         | E2E encryption, server sees only ciphertext                                        |
| Local DB                  | SQLite through Rust `sqlx` commands                  | Metadata, search, tags, pomodoro sessions, requirement diffs    |
| Media engine (video)      | GStreamer, libVLC, or `ffmpeg-next` fallback target  | Broader native multimedia path for video or unsupported audio formats              |
| Media engine (audio-only) | Rodio + Symphonia target                             | Native audio playback and decoding path for low-RAM local music                    |
| YouTube playback          | IFrame Player API                                    | Official, free, no developer key, full programmatic control, ToS-compliant         |
| File watching             | `notify`                                             | Cross-platform file system events for vault reindexing |
| Process control           | `sysinfo` + `std::process`                           | App blocking and environment switching                                             |
| Activity monitoring       | Win32 / X11 / `rdev`                                 | Active window tracking, idle detection, app-switch counting        |
| Mouse tracking            | `rdev` / Win32 / X11                                 | Edge panel trigger                                                                 |
| Browser bridge            | Native Messaging + Chrome/Firefox extension          | Website blocking and tab environment switching                                     |
| PDF generation            | Typst                                                | Rust-native typesetting, structured data → high-quality PDF reports                |
| PDF reading               | `pdfium-render`                                      | Google PDFium Rust bindings for text extraction and page rendering                 |
| Visual novel layer (deferred) | Custom Svelte components                         | JSON-driven dialogue state machine, NPC interactions in project management         |
| Integrated terminal       | xterm.js                                             | Embedded terminal for Codex or another CLI coding agent, context injection, session management |
| BYOK chat widget          | OpenAI / OpenAI-compatible / Ollama APIs             | In-app AI chat for non-developer users, same session management as terminal        |
| Mobile alarm              | iOS `UNNotificationRequest` / Android `AlarmManager` | Sleep alarm triggering diary flows and morning routines                            |
| Mobile app blocking       | iOS Screen Time API / Android UsageStatsManager      | App-level blocking during focus times within platform sandbox constraints          |
| Agent integration (CRUD)  | `ganbaruai` CLI (Rust)                               | Direct SQLite access, no server, works with any agent/script                       |
| Agent integration (external) | MCP (post-MVP)                                    | External AI clients accessing GanbaruAI data remotely                              |
| Backend language          | Rust                                                 | Required by Tauri, OS-level APIs, media engine                                     |
| Frontend language         | TypeScript                                           | Type safety across interconnected state                                            |

# Roadmap

Phased development plan for GanbaruAI. Each phase produces a working, testable increment. Phases are sequential; each builds on prior phases.

---

## Phase 1: core loop

The minimum viable cycle: plan sessions, focus with a timer, track tasks.

**Includes:**

- Monorepo scaffold: Turborepo + pnpm workspaces + Tauri v2 + Svelte 5 + Vite
- SQLite setup through Rust commands with initial schema (calendar events, pomodoro configs, pomodoro runs, tasks)
- Calendar with session blocks: day/week/month views, drag-and-drop event creation and resizing, session blocks carrying task references and Pomodoro counts
- Basic Pomodoro timer: configurable focus/break durations, cycle counting per session block, timer state in Svelte runes, auto-start when session block activates
- Basic personal Kanban: four default columns (backlog, to do, in progress, done), task cards with priority tiers (easy/medium/hard/epic), estimated Pomodoro count, drag-and-drop reordering (svelte-dnd-action), task-to-session-block linking
- UI shell: shadcn-svelte component setup, global CSS theme variables, main window layout with navigation between calendar/kanban views

**Depends on:** nothing

**Out of scope:** fullscreen break overlay, edge panel, multi-window, work environments, browser extension, notes, diary, music, contracts, sync, mobile, NPC layer, gamification (XP, skill tree, streaks)

**Complexity:** large

**Platform:** cross-platform (desktop focus, no mobile-specific work)

---

## Phase 2: notes and vault

The local-first knowledge layer. Users can take notes linked to their tasks and projects.

**Includes:**

- Vault directory structure on disk (notes/, diary/, calendar/, projects/, config.json, app.db)
- Tiptap note editor: block-based editing, slash commands, rich formatting, drag-to-reorder blocks
- Markdown serialization via @tiptap/extension-markdown (notes saved as .md files to disk via Tauri file system plugin)
- Bidirectional backlinks tracked in SQLite (note-to-note, note-to-task, note-to-project)
- Note tags and search indexing in SQLite
- Daily notes (auto-created dated markdown files)

**Depends on:** phase 1 (SQLite, Tauri file system access, Kanban tasks for linking)

**Out of scope:** Yjs/collaboration, AI features, diary system (phase 3)

**Complexity:** medium

**Platform:** cross-platform

---

## Phase 3: diary and consistency

Daily touchpoints and engagement mechanics that make the app habit-forming.

**Includes:**

- Daily diary: morning and evening entry forms stored as dated markdown files in vault/diary/
- Diary indexed fields in SQLite: mood (5 options), energy level (5 options), sleep quality (5 options), daily intention, evening reflection
- Consistency tracking: session block completion rate, Pomodoro cycle completion rate

**Depends on:** phase 2 (notes/vault for diary storage and backlinks), phase 1 (Pomodoro/calendar for consistency data)

**Out of scope:** sleep alarm (mobile, phase 10), AI mood analysis (phase 11)

**Complexity:** small

**Platform:** cross-platform

---

## Phase 4: desktop experience

Multi-window desktop features that make GanbaruAI an always-present productivity companion.

**Includes:**

- Tauri multi-window: notification popup (frameless, always-on-top, bottom-right), fullscreen break overlay (frameless, always-on-top, covers taskbar, semi-transparent), edge panel window (narrow, always-on-top, right edge)
- Fullscreen break screen: countdown timer, session completion stats, option to extend break, break playlist placeholder
- Edge panel: quick-access module icons, live Pomodoro timer indicator, active work environment name, quick-add Kanban task, task checkboxes for current session. Initially triggered by keyboard shortcut (global mouse polling added later)
- Work environment management: saved configurations (apps to open/close, browser tabs, blocker rules, playlist assignment), automatic activation when session block starts, app open/close via sysinfo + std::process::Command
- Chrome browser extension (manifest v3): native messaging bridge to Tauri backend, URL blocklist enforcement, redirect to branded block page, tab management for environment switching
- Procrastination stopper: blocker trigger events logged as productivity analytics

**Depends on:** phase 1 (Pomodoro timer, calendar session blocks, Kanban tasks), phase 3 (diary for break screen context)

**Out of scope:** content-specific blocking (phase 11), Firefox extension (phase 11), music playback (phase 6), global mouse edge-panel trigger via rdev (can be added incrementally)

**Complexity:** large

**Platform:** desktop only

---

## Phase 5: gamification system (deferred)

The experience measurement engine, skill tree rewards, and contract system. Consolidated from the original phases 5, 6, and 7 into a single deferred phase.

**Includes:**

- Complete Will system with four categories (Focus, Clarity, Intensity, Execution)
- Full compound Activity XP formula with anti-grinding mechanics
- Skill tree: SVG + Svelte center-snap navigation, neighborhood culling, sub-layer navigation, skill decay, cross-branch connections
- Skill point spending, tier upgrades, badges, Skill Capsules
- Contract system: self-imposed conditions with in-app benefits and penalties
- Desktop activity monitoring for Will metrics (active window tracking, idle detection)
- Endowed progress effect (onboarding-based skill pre-population)
- Profile sharing

**Depends on:** phases 1-4

**Out of scope:** AI-assisted condition suggestions (phase 11)

**Complexity:** large

**Platform:** cross-platform (desktop-only for OS-level monitoring)

---

## Phase 6: music player

Local-first media playback integrated into the productivity workflow.

**Includes:**

- Internal Rust media player module for Rodio/Symphonia audio playback, app-command IPC, and frontend integration
- Local file playback: Rodio and Symphonia backend for common local audio, platform WebView media playback for local video, broader audio fallback candidates for unsupported codecs, lower audio-only memory overhead, and VLC-class transport latency
- YouTube IFrame API integration: load videos by ID/URL, start/end timestamps, volume and speed control, seek, desktop WebView client identity through a loopback HTTP player host plus referrer policy, `origin`, and `widget_referrer`, playback position persistence in SQLite, ad-compatible (YouTube Premium removes ads if user is logged in)
- Playlist management: definitions stored in SQLite (track paths, ordering, environment associations), create/edit/delete playlists, assign playlists to work environment templates and session blocks
- Session block integration: automatic playlist start when block activates, focus/break playlist switching on Pomodoro phase change
- User preconfiguration per session block: source selection, timestamps, skip ranges, volume, playback speed, break source override
- Edge panel music controls: play/pause, skip, volume
- Morning playlist placeholder (actual alarm trigger in phase 10)

**Depends on:** phase 1 (calendar session blocks for playlist assignment, SQLite), phase 4 (edge panel for controls, work environments for playlist association)

**Out of scope:** Spotify (explicitly not supported, as documented in project), collaborative playlists, AI music recommendations, and stream extraction from YouTube or YouTube Music

**Complexity:** medium

**Platform:** cross-platform (desktop primary, mobile audio-only path)

---

## Phase 7: CLI and integrated terminal

The agent integration layer. The `ganbaruai` CLI and an embedded terminal bring AI assistance into the core workflow.

**Includes:**

- `ganbaruai` CLI: Rust binary linking to the same SQLite, human-readable and JSON output, commands for projects, tasks, calendar, workspace, pomodoro, import/export
- Integrated terminal: xterm.js embedded in Tauri webview, runs Codex or another CLI coding agent
- Context injection: GanbaruAI assembles project/task context and passes it through the launch prompt or standard input. `AGENTS.md` stays as project-level conventions, per-task context is dynamic.
- Session management: per-project conversation threads in SQLite, calendar-driven automatic switching (save current session, resume the session for the new calendar event's project)
- Kanban task activation: clicking "Start" on a task injects its details into the current AI conversation
- Workflow phase prompts: structured system prompts for brainstorming, evaluation, planning, execution modes
- Prompt buttons: UI buttons that insert pre-built prompts into the terminal (e.g., "Plan this sprint", "Research competitors")
- Background agents: non-interactive Codex runs (`codex exec`) or equivalent selected-agent processes for delegated parallel work, results as notifications or kanban updates
- Markdown export/import: CLI exports project state as markdown to git repos for collaborators and agents without the CLI

**Depends on:** phase 1 (SQLite, Kanban, calendar for context), phase 2 (notes for project docs)

**Out of scope:** BYOK chat widget (phase 11), MCP (phase 11), content-specific blocking (phase 11)

**Complexity:** large

**Platform:** desktop only (terminal requires desktop OS)

---

## Phase 8: project management framework

Structured project lifecycle templates and tools. The AI panel from phase 7 enhances every phase with contextual assistance.

**Includes:**

- Project lifecycle phases: Genesis (brainstorming), Forging the idea (evaluation), The journey ahead (planning, MVP, execution, post-execution) with all subphases
- Phase templates: all planning subtemplates (deep brainstorming, market analysis, competitor research, specification, resources, review), MVP subtemplates (PoC, MVP, funding), execution subtemplates (alpha, beta, launch, polish), post-execution subtemplates
- Actionable methodology templates: reverse brainstorming, value proposition canvas, business model canvas, SWOT analysis, market research frameworks. Structured forms, not static documents
- Project Kanban boards: per-project boards linked to project phases
- Requirement version control: timestamped diffs on every task change (what, when, who, why, downstream impact), immutable history, searchable and filterable, exportable
- Calendar date cascade: inserting or extending session blocks shifts downstream blocks, dependency graph propagation, conflict highlighting
- Automatic report generation: markdown reports from Kanban state, calendar data, Pomodoro history, requirement changes, milestone progress. PDF generation via Typst
- PDF reading: pdfium-render for importing external documents (text extraction, page rendering)
- AI-enhanced workflows: the integrated terminal's workflow phase prompts guide users through each project phase. The AI researches competitors, helps fill templates, and validates ideas.

**Depends on:** phase 1 (Kanban, calendar), phase 2 (notes for project working documents), phase 4 (work environments for project contexts), phase 7 (CLI for exports, terminal for AI-assisted workflows)

**Out of scope:** NPC visual layer (deferred with gamification), conversational AI calendar management (phase 11)

**Complexity:** large

**Platform:** cross-platform (templates and forms), desktop only (report PDF generation via Typst, AI terminal)

---

## Phase 9: sync and collaboration

Multi-device sync and real-time collaboration via CRDTs and E2E encryption.

**Includes:**

- Yjs CRDT integration: every document type (notes, calendar, Kanban, diary, app state) as Yjs data structures, binary updates that merge in any order
- Tiptap collaboration: @tiptap/extension-collaboration for real-time note co-editing, @tiptap/extension-collaboration-cursor for live cursor positions and selections
- Hocuspocus server: apps/server package, persistent document state, presence and awareness, authentication and authorization hooks for workspace access control, self-hostable
- E2E encryption: libsodium / @noble/ciphers, client-side key derivation, personal vault (single key per vault), collaborative workspace (workspace key encrypted per-member), server stores only ciphertext
- Two sync tiers: local-only (scheduled encrypted export to user-specified path), self-hosted (user's own Hocuspocus server with guided setup, automatic cloud backup)
- Multi-device sync: desktop-to-desktop, desktop-to-mobile (mobile in phase 10)
- Collaborative workspaces: shared documents, live presence, access control
- Local backup: scheduled encrypted zip export of vault folder

**Depends on:** phase 2 (Tiptap editor for collaboration extensions), phase 1 (SQLite data model, vault structure)

**Out of scope:** mobile sync client (phase 10), AI features

**Complexity:** large

**Platform:** cross-platform (server is standalone Node.js)

---

## Phase 10: mobile

Tauri v2 mobile builds delivering a focused subset of the desktop experience.

**Includes:**

- Tauri v2 mobile builds: iOS and Android targets from the same Svelte + Rust codebase
- Mobile-adaptive layouts: responsive UI for all shared features, touch-optimized interactions
- Sleep alarm: iOS UNNotificationRequest with alarm-style scheduling, Android AlarmManager with SCHEDULE_EXACT_ALARM permission
- Alarm-to-diary flow: morning alarm dismissal triggers morning diary, morning playlist starts; setting evening alarm triggers evening diary
- Sleep duration tracking: alarm-set to dismissal time, feeds into sleep quality suggestions
- App-level procrastination blocking: iOS Screen Time API (Family Controls framework), Android UsageStatsManager, with graceful degradation when permissions unavailable
- Mobile Pomodoro: notification-based breaks (no fullscreen overlay), timer continues in background
- Mobile calendar and notes: full editing capability, synced via phase 9
- Mobile sync: connects to Hocuspocus server from phase 9
- Calendar notifications as calls to action (reminders to return to desktop for upcoming session blocks)

**Depends on:** phase 9 (sync for multi-device), phase 3 (diary system), phase 6 (music for alarm playlists)

**Out of scope:** work environment management, edge panel, fullscreen break overlay, browser extension, desktop activity monitoring. All of these are blocked by mobile OS sandboxing

**Complexity:** large

**Platform:** mobile only (iOS, Android)

---

## Phase 11: BYOK chat, advanced AI, and MCP

The general-user AI path, advanced AI capabilities, and external access layer. Builds on the integrated terminal from phase 7.

**Includes:**

- BYOK chat widget: in-app chat interface with same session management as the terminal (calendar-driven switching, per-project threads)
- LLM provider support: OpenAI API, OpenAI-compatible APIs (Groq, Together, Mistral, and any provider using a compatible chat format), Ollama for local models (Llama, Mistral, Gemma, no API key needed), and other explicitly supported provider APIs when users supply their own credentials
- BYOK configuration UI: API key management (stored locally), model selection, provider setup with guided instructions, consent controls
- Natural language calendar management: "move my 3pm session to tomorrow", AI modifies events via CLI
- Mood-aware motivation: using diary mood/energy baselines, AI adapts communication and suggests schedule adjustments
- Content-specific procrastination detection: LLM analyzes page content (not just URLs) for task relevance, smarter blocking on YouTube and similar platforms
- Local LLM diary analysis: small local models (via Ollama) analyze diary language for goal-setting, reflection quality, mood trends, no data leaves the device
- MCP server: exposes GanbaruAI data to external AI clients (ChatGPT, teammate agents, and other MCP-compatible clients) that don't run locally
- MCP client: consumes external MCP servers for integrations (email, external calendars)
- Firefox browser extension: port of Chrome extension to Firefox manifest
- Edge panel global mouse trigger: rdev / Win32 / X11 polling for cursor position (replaces keyboard shortcut from phase 4), Wayland detection and graceful fallback

**Depends on:** phase 7 (CLI and terminal as foundation), phase 3 (diary for mood baselines), phase 4 (browser extension for content blocking)

**Out of scope:** this is the final planned phase

**Complexity:** large

**Platform:** cross-platform (BYOK chat, AI features), desktop only (mouse trigger, Firefox extension, content-specific blocking)

---

## Systems coverage verification

Every system from the product spec is accounted for:


| System                                                           | Phase         |
| ---------------------------------------------------------------- | ------------- |
| Calendar (session blocks)                                        | 1             |
| Kanban (personal)                                                | 1             |
| Pomodoro timer                                                   | 1             |
| Note-taking (Tiptap, markdown, backlinks)                        | 2             |
| Daily diary (morning/evening)                                    | 3             |
| Consistency tracking                                             | 3             |
| Procrastination stopper (desktop/browser)                        | 4             |
| Work environment management                                      | 4             |
| Edge panel                                                       | 4             |
| Multi-window (break overlay, notification)                       | 4             |
| Browser extension (Chrome)                                       | 4             |
| Gamification (Will, skill tree, XP, contracts, badges, capsules) | 5 (deferred)  |
| Music player (local + YouTube)                                   | 6             |
| `ganbaruai` CLI                                                  | 7             |
| Integrated terminal (xterm.js + Codex)                           | 7             |
| AI session management (calendar-driven switching)                | 7             |
| Context injection and workflow phase prompts                     | 7             |
| Markdown export/import for project repos                         | 7             |
| Background agents                                                | 7             |
| Project management lifecycle templates                           | 8             |
| Kanban (project, requirement version control)                    | 8             |
| Methodology templates                                            | 8             |
| Calendar date cascade                                            | 8             |
| Report generation (markdown + PDF)                               | 8             |
| Sync (Yjs + Hocuspocus)                                          | 9             |
| E2E encryption                                                   | 9             |
| Collaborative workspaces                                         | 9             |
| Mobile (Tauri v2, iOS/Android)                                   | 10            |
| Sleep alarm (mobile)                                              | 10            |
| Procrastination stopper (mobile/app-level)                       | 10            |
| BYOK chat widget (OpenAI, compatible APIs, Ollama)               | 11            |
| AI: natural language calendar management                         | 11            |
| AI: mood-aware motivation                                        | 11            |
| AI: content-specific blocking                                    | 11            |
| AI: local LLM diary analysis                                     | 11            |
| MCP server/client (external AI access)                           | 11            |
| Browser extension (Firefox)                                      | 11            |
| NPC characters and visual novel (deferred with gamification)     | 5 (deferred)  |

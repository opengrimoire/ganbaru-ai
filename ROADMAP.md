# Roadmap

Phased development plan for GanbaruAI. Each phase produces a working, testable increment. Phases are sequential — each builds on prior phases.

---

## Phase 1 — Core loop

The minimum viable cycle: plan sessions, focus with a timer, earn XP, see progress.

**Includes:**

- Monorepo scaffold: Turborepo + pnpm workspaces + Tauri v2 + Svelte 5 + Vite
- SQLite setup via tauri-plugin-sql with initial schema (sessions, tasks, XP ledger, skill tree nodes, streaks)
- Calendar with session blocks: day/week/month views, drag-and-drop event creation and resizing, session blocks carrying task references, Pomodoro counts, and skill tree branch tags
- Basic Pomodoro timer: configurable focus/break durations, cycle counting per session block, timer state in Svelte runes, auto-start when session block activates
- Basic personal Kanban: four default columns (backlog, to do, in progress, done), task cards with priority tiers (easy/medium/hard/epic), estimated Pomodoro count, drag-and-drop reordering (svelte-dnd-action), task-to-session-block linking
- Simplified Pomodoro-to-XP pipeline: basic Activity XP on Pomodoro completion and task completion (by difficulty tier), simplified Will Focus tracking via timer adherence (completing vs. abandoning cycles, break extension tracking), session XP stored in SQLite
- Basic skill tree view: static SVG rendering of a sample DAG structure, nodes showing XP progress, read-only visualization (no interactive features yet)
- Basic RPG-themed UI shell: shadcn-svelte component setup, global CSS theme variables, main window layout with navigation between calendar/kanban/pomodoro/skill-tree views

**Depends on:** nothing

**Out of scope:** fullscreen break overlay, edge panel, multi-window, work environments, browser extension, notes, diary, music, contracts, sync, mobile, NPC layer, anti-grinding mechanics beyond basic daily caps

**Complexity:** large

**Platform:** cross-platform (desktop focus, no mobile-specific work)

---

## Phase 2 — Notes and vault

The local-first knowledge layer. Users can take notes linked to their tasks and projects.

**Includes:**

- Vault directory structure on disk (notes/, diary/, calendar/, projects/, config.json, app.db)
- Tiptap note editor: block-based editing, slash commands, rich formatting, drag-to-reorder blocks
- Markdown serialization via @tiptap/extension-markdown (notes saved as .md files to disk via Tauri file system plugin)
- Bidirectional backlinks tracked in SQLite (note-to-note, note-to-task, note-to-project)
- Note tags and search indexing in SQLite
- Daily notes (auto-created dated markdown files)

**Depends on:** phase 1 (SQLite, Tauri file system access, Kanban tasks for linking)

**Out of scope:** Yjs/collaboration, AI features, diary system (phase 3), cross-referencing XP (phase 5)

**Complexity:** medium

**Platform:** cross-platform

---

## Phase 3 — Diary, streaks, and consistency

Daily touchpoints and engagement mechanics that make the app habit-forming.

**Includes:**

- Daily diary: morning and evening entry forms stored as dated markdown files in vault/diary/
- Diary indexed fields in SQLite: mood (5 options), energy level (5 options), sleep quality (5 options), daily intention, evening reflection
- Streak tracking: consecutive productive days, multipliers (1.1x at 3 days through 1.5x at 30 days), one free freeze per 7-day streak
- Consistency tracking: session block completion rate, Pomodoro cycle completion rate
- Will Clarity XP: basic scoring from diary morning entries (goal-setting) and note cross-referencing (backlink creation)
- Will Execution XP: basic scoring from evening diary reflections

**Depends on:** phase 2 (notes/vault for diary storage and backlinks), phase 1 (Pomodoro/calendar for consistency data)

**Out of scope:** sleep alarm (mobile, phase 11), AI mood analysis (phase 12), full Will system (phase 5)

**Complexity:** small

**Platform:** cross-platform

---

## Phase 4 — Desktop experience

Multi-window desktop features that make GanbaruAI an always-present productivity companion.

**Includes:**

- Tauri multi-window: notification popup (frameless, always-on-top, bottom-right), fullscreen break overlay (frameless, always-on-top, covers taskbar, semi-transparent), edge panel window (narrow, always-on-top, right edge)
- Fullscreen break screen: countdown timer, RPG-style XP battle results display (Activity XP, Will scores, streak status), option to extend break (with Focus penalty), break playlist placeholder
- Edge panel: quick-access module icons, live Pomodoro timer indicator, active work environment name, quick-add Kanban task, task checkboxes for current session, streak counter. Initially triggered by keyboard shortcut (global mouse polling added later)
- Work environment management: saved configurations (apps to open/close, browser tabs, blocker rules, playlist assignment), automatic activation when session block starts, app open/close via sysinfo + std::process::Command
- Chrome browser extension (manifest v3): native messaging bridge to Tauri backend, URL blocklist enforcement, redirect to branded block page, tab management for environment switching
- Procrastination stopper: blocker trigger events logged as Will Focus data (successful block = positive XP, bypass attempt = negative XP)

**Depends on:** phase 1 (Pomodoro timer, calendar session blocks, Kanban tasks), phase 3 (streaks for break screen display)

**Out of scope:** content-specific blocking (phase 12), Firefox extension (phase 12), active window tracking for Will (phase 5), music playback (phase 8), global mouse edge-panel trigger via rdev (can be added incrementally)

**Complexity:** large

**Platform:** desktop only

---

## Phase 5 — Full Will system and XP formula

Complete the experience measurement engine with all four Will categories and anti-grinding mechanics.

**Includes:**

- Complete Will Focus: full scoring from blocker events, app-switch frequency, break adherence, screen activity classification
- Complete Will Clarity: preparation quality scoring (time to first action, pre-assigned tasks, pre-opened references, context-switch cost, diary/note signals)
- Complete Will Intensity: output density via file system watching (notify crate for file saves in project directories), git integration (commits, line diffs), task completion rate, personal baseline calibration (rolling 30-day averages per task type), relative output scoring capped at 2.0x
- Complete Will Execution: disruption recovery quality scoring, brief self-assessment during breaks (2-3 quick taps), calendar interruption recovery tracking, re-prioritization handling
- Will XP penalization rules (subtractive, never makes total session XP negative)
- Full compound Activity XP formula: base_XP x category_weight x focus_quality x streak_multiplier x diversity_bonus x output_ratio x contract_multiplier - distraction_penalty
- Anti-grinding mechanics: daily XP cap per branch (200 XP, then 25% rate), logarithmic time-to-XP conversion, novelty weighting (2x for new task types, diminishing to 1x), diversity bonus (up to 1.3x for 6+ distinct skills/day), competency gates at skill tree thresholds
- Desktop activity monitoring: active window tracking (Win32 GetForegroundWindow / X11 _NET_ACTIVE_WINDOW), idle detection, app-switch counting per session. Wayland graceful degradation (fallback to in-app signals only)

**Depends on:** phase 4 (browser extension for Focus data, desktop monitoring infrastructure, edge panel for self-assessment UI), phase 3 (diary for Clarity/Execution data, streaks for multipliers), phase 1 (Pomodoro/Kanban for base signals)

**Out of scope:** contract multipliers (phase 7), AI analysis

**Complexity:** medium

**Platform:** desktop only for OS-level monitoring; XP formula is cross-platform

---

## Phase 6 — Skill tree and rewards

Transform the static skill tree view into a fully interactive, visually rich reward system.

**Includes:**

- Interactive skill tree: D3.js force-directed and hierarchical layout for DAG, SVG rendering within Svelte components, semantic zoom (branch clusters when zoomed out, individual nodes when zoomed in), pan and zoom controls
- Progressive disclosure: show unlocked nodes + immediate neighbors, fade distant nodes, recommended next step highlighting, guided constrained paths for new users
- Skill decay visualization: displayed_level = actual_level x e^(-0.03 x days_since_practice), dimming effect on unpracticed branches, cheap restoration on re-engagement
- Three node types: basic (small, incremental), notable (medium, named landmarks), keystone (large, transformative, multi-branch prerequisites)
- Cross-branch connections: bridge nodes at branch boundaries, multi-parent DAG nodes, synergy bonuses (hidden nodes revealed when related cross-branch skills complete), tag-based filtering
- Tier upgrade system: overall progression gating access to deep content and features
- Badges: achievement markers for milestones, streaks, project completions. Displayed on profile
- Skill Capsules: gacha mechanic (common 60%, rare 25%, epic 10%, legendary 5%), pity system (guaranteed rare+ every 10, epic+ every 50), animated reveal sequence, cosmetic-only rewards (profile decorations, tree themes, avatar accessories, UI color schemes)
- Endowed progress effect: onboarding questions (profession, interests, experience) pre-populate foundational skills as "already begun"
- Profile sharing: opt-in display of skill tree, tier, badges, streaks

**Depends on:** phase 5 (full XP formula feeding the tree), phase 1 (basic skill tree data model and schema)

**Out of scope:** deep layers/branches (contract-gated, phase 7), contract corruption effects (phase 7), conversational AI onboarding (phase 12)

**Complexity:** large

**Platform:** cross-platform (mobile-specific layout deferred to phase 11)

---

## Phase 7 — Contract system

Self-imposed productivity conditions with real stakes, inspired by Nen restrictions and binding vows.

**Includes:**

- Contract creation UI: condition builder, duration (1 day to 3 months), auto-renewal option, benefit/penalty configuration
- Auto-tracked conditions: Pomodoro counts, task completions, streak requirements, session block adherence — verified against SQLite data
- Real-life conditions: proof attachment support (photos), frequency and duration configuration, mandatory proof for penalty completion
- Penalty/reward mechanics: passive XP boost on related branches, active XP boost on specific tasks, 2x accumulated XP subtraction on failure, 0.01x XP multiplier until penalty completed, level demotion on exclusive branches (1x contract boost XP), badge/personalization removal on failure, 2x duration lockout if penalty refused
- Corruption visual effects on failed skill tree branches (CSS-driven visual degradation)
- Deep layers and deep branches: additional depth tiers and new branches unlocked via contract completion or tier upgrades
- Tier/level gating: minimum threshold to access the contract system
- Max 5 active contracts simultaneously
- Exclusive badges and personalization options obtainable only through contracts

**Depends on:** phase 6 (skill tree for corruption effects and deep layers, tier system for access gating), phase 5 (XP system for multipliers and contract_multiplier in formula)

**Out of scope:** AI-assisted condition suggestions (phase 12)

**Complexity:** medium

**Platform:** cross-platform

---

## Phase 8 — Music player

Local-first media playback integrated into the productivity workflow, licensed separately as LGPL 2.1.

**Includes:**

- Tauri plugin structure: Rust crate (publishable to crates.io) + npm package (publishable to npm), separate from the AGPL app
- Local file playback: Symphonia for audio-only (lightweight, pure Rust), ffmpeg-next fallback for video and unsupported audio formats, format detection and codec support
- YouTube IFrame API integration: load videos by ID/URL, start/end timestamps, volume and speed control, seek, transparent div overlay blocking direct user interaction (input-locked, not hidden), playback position persistence in SQLite, ad-compatible (YouTube Premium removes ads if user is logged in)
- Playlist management: definitions stored in SQLite (track paths, ordering, environment associations), create/edit/delete playlists, assign playlists to work environment templates and session blocks
- Session block integration: automatic playlist start when block activates, focus/break playlist switching on Pomodoro phase change
- User preconfiguration per session block: source selection, timestamps, skip ranges, volume, playback speed, break source override
- Edge panel music controls: play/pause, skip, volume
- Morning playlist placeholder (actual alarm trigger in phase 11)

**Depends on:** phase 1 (calendar session blocks for playlist assignment, SQLite), phase 4 (edge panel for controls, work environments for playlist association)

**Out of scope:** Spotify (explicitly not supported — documented in project), collaborative playlists, AI music recommendations, video display in main app window (audio-focused initially)

**Complexity:** medium

**Platform:** cross-platform (desktop primary, mobile audio-only path)

---

## Phase 9 — Project management framework

The quest chain structure that makes GanbaruAI a ClickUp/Jira/Asana alternative wrapped in RPG narrative.

**Includes:**

- Quest chain structure: Genesis (brainstorming), Forging the idea (evaluation), The journey ahead (planning → MVP → execution → post-execution) with all subphases (3.1.1 through 3.4.4)
- Visual novel presentation: custom Svelte components, JSON-driven dialogue state machine, character sprites and background illustrations loaded from vault assets, CSS transitions between dialogue states, interactive form fields within dialogue
- NPC characters: Fairy (Sparkweaver) for brainstorming, Dwarf (Bearer of Great Promise) for idea evaluation, Drasil (The Eternal Wayfinder) for planning and execution — each with distinct personality and guidance style
- Phase templates: all planning subtemplates (deep brainstorming, market analysis, competitor research, specification, resources, review), MVP subtemplates (PoC, MVP, funding), execution subtemplates (alpha, beta, launch, polish), post-execution subtemplates
- Actionable methodology templates: reverse brainstorming, value proposition canvas, business model canvas, SWOT analysis, market research frameworks — structured forms, not static documents
- Project Kanban boards: per-project boards within the quest chain, linked to project phases
- Requirement version control: timestamped diffs on every task change (what, when, who, why, downstream impact), immutable history, searchable and filterable, exportable
- Calendar date cascade: inserting or extending session blocks shifts downstream blocks, dependency graph propagation, conflict highlighting
- Automatic report generation: markdown reports from Kanban state, calendar data, Pomodoro history, requirement changes, milestone progress. PDF generation via Typst (Rust-native typesetting invoked via Tauri commands)
- PDF reading: pdfium-render for importing external documents (text extraction, page rendering)
- NPC-guided onboarding: brief story-lore introduction (2-3 minutes), leads into first practical interaction

**Depends on:** phase 1 (Kanban, calendar), phase 2 (notes for project working documents), phase 4 (work environments for project contexts)

**Out of scope:** Dwarf AI chatbot (phase 12), Drasil conversational AI (phase 12), AI-powered template analysis (phase 12)

**Complexity:** large

**Platform:** cross-platform (visual novel and templates), desktop only (report PDF generation via Typst)

---

## Phase 10 — Sync and collaboration

Multi-device sync and real-time collaboration via CRDTs and E2E encryption.

**Includes:**

- Yjs CRDT integration: every document type (notes, calendar, Kanban, diary, gamification state) as Yjs data structures, binary updates that merge in any order
- Tiptap collaboration: @tiptap/extension-collaboration for real-time note co-editing, @tiptap/extension-collaboration-cursor for live cursor positions and selections
- Hocuspocus server: apps/server package, persistent document state, presence and awareness, authentication and authorization hooks for workspace access control, self-hostable
- E2E encryption: libsodium / @noble/ciphers, client-side key derivation, personal vault (single key per vault), collaborative workspace (workspace key encrypted per-member), server stores only ciphertext
- Three sync tiers: free local-only (scheduled encrypted export to user-specified path), paid hosted (your Hocuspocus instance, automatic cloud backup), self-hosted (user's own server)
- Multi-device sync: desktop-to-desktop, desktop-to-mobile (mobile in phase 11)
- Collaborative workspaces: shared documents, live presence, access control
- Local backup: scheduled encrypted zip export of vault folder

**Depends on:** phase 2 (Tiptap editor for collaboration extensions), phase 1 (SQLite data model, vault structure)

**Out of scope:** mobile sync client (phase 11), AI features

**Complexity:** large

**Platform:** cross-platform (server is standalone Node.js)

---

## Phase 11 — Mobile

Tauri v2 mobile builds delivering a focused subset of the desktop experience.

**Includes:**

- Tauri v2 mobile builds: iOS and Android targets from the same Svelte + Rust codebase
- Mobile-adaptive layouts: responsive UI for all shared features, touch-optimized interactions
- Sleep alarm: iOS UNNotificationRequest with alarm-style scheduling, Android AlarmManager with SCHEDULE_EXACT_ALARM permission
- Alarm-to-diary flow: morning alarm dismissal triggers morning diary, morning playlist starts; setting evening alarm triggers evening diary
- Sleep duration tracking: alarm-set to dismissal time, feeds into sleep quality suggestions
- App-level procrastination blocking: iOS Screen Time API (Family Controls framework), Android UsageStatsManager — graceful degradation when permissions unavailable
- Mobile Pomodoro: notification-based breaks (no fullscreen overlay), timer continues in background
- Mobile calendar and notes: full editing capability, synced via phase 10
- Mobile skill tree: pinch-to-zoom container, node details in bottom sheets
- Mobile sync: connects to Hocuspocus server from phase 10
- Calendar notifications as calls to action (reminders to return to desktop for upcoming session blocks)

**Depends on:** phase 10 (sync for multi-device), phase 3 (diary system), phase 8 (music for alarm playlists), phase 6 (skill tree for mobile view)

**Out of scope:** work environment management, edge panel, fullscreen break overlay, browser extension, desktop activity monitoring — all blocked by mobile OS sandboxing

**Complexity:** large

**Platform:** mobile only (iOS, Android)

---

## Phase 12 — AI and MCP (post-MVP)

Opt-in AI features and protocol integrations. All BYOK, no data leaves the device without consent.

**Includes:**

- Drasil conversational AI: natural language calendar management ("move my 3pm session to tomorrow"), mood-aware motivation from diary patterns, schedule suggestions based on energy/productivity trends, project guidance during quest chain phases
- Dwarf chatbot: AI-powered research discussions during idea evaluation, market research assistance, idea validation with web search and document analysis
- Content-specific procrastination detection: LLM analyzes page content (not just URLs) to determine task relevance, smarter blocking on platforms like YouTube
- Small local LLM models: diary language analysis (goal-setting detection, reflection quality, mood patterns) without API calls, fallback to LLM API (BYOK) if insufficient
- MCP server: expose calendar, tasks, notes, skill tree data to external AI tools
- MCP client: consume external MCP servers for integrations (email, external calendars)
- Firefox browser extension: port of Chrome extension to Firefox manifest
- BYOK configuration UI: API key management, model selection, consent controls
- Edge panel global mouse trigger: rdev / Win32 / X11 polling for cursor position (replaces keyboard shortcut from phase 4). Wayland detection and graceful fallback

**Depends on:** all prior phases

**Out of scope:** this is the final planned phase

**Complexity:** large

**Platform:** cross-platform (AI features), desktop only (mouse trigger, Firefox extension)

---

## Systems coverage verification

Every system from the product spec is accounted for:

| System | Phase |
|---|---|
| Calendar (session blocks) | 1 |
| Kanban (personal) | 1 |
| Kanban (project, requirement version control) | 9 |
| Pomodoro timer | 1 |
| Note-taking (Tiptap, markdown, backlinks) | 2 |
| Daily diary (morning/evening) | 3 |
| Sleep alarm (mobile) | 11 |
| Music player (local + YouTube) | 8 |
| Procrastination stopper (desktop/browser) | 4 |
| Procrastination stopper (mobile/app-level) | 11 |
| Work environment management | 4 |
| Edge panel | 4 |
| Will system — Focus | 1 (simplified), 5 (full) |
| Will system — Clarity | 3 (basic), 5 (full) |
| Will system — Intensity | 5 |
| Will system — Execution | 3 (basic), 5 (full) |
| Consistency tracking | 3 |
| Streaks and multipliers | 3 |
| XP formula (compound, anti-grinding) | 1 (basic), 5 (full) |
| Skill tree (DAG, progressive disclosure, decay) | 1 (basic view), 6 (full) |
| Tier upgrade system | 6 |
| Badges | 6 |
| Skill Capsules (gacha) | 6 |
| Profile sharing | 6 |
| Endowed progress effect | 6 |
| Contract system | 7 |
| Deep layers / deep branches | 7 |
| Project management quest chain | 9 |
| NPC characters (Fairy, Dwarf, Drasil) | 9 |
| Visual novel presentation | 9 |
| Methodology templates | 9 |
| Calendar date cascade | 9 |
| Report generation (markdown + PDF) | 9 |
| Sync (Yjs + Hocuspocus) | 10 |
| E2E encryption | 10 |
| Collaborative workspaces | 10 |
| Browser extension (Chrome) | 4 |
| Browser extension (Firefox) | 12 |
| Multi-window (break overlay, notification) | 4 |
| Desktop activity monitoring | 5 |
| Mobile (Tauri v2, iOS/Android) | 11 |
| AI — Drasil conversational AI | 12 (post-MVP) |
| AI — Dwarf chatbot | 12 (post-MVP) |
| AI — content-specific blocking | 12 (post-MVP) |
| AI — local LLM diary analysis | 12 (post-MVP) |
| MCP server/client | 12 (post-MVP) |

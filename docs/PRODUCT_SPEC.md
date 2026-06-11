# Ganbaru AI: complete product specification

This document describes every system in Ganbaru AI, how each system works internally, and how all systems interact with each other. It is the single source of truth for understanding the product's design intent before implementation. The tech stack is documented separately. This document covers what the app does and why, not how it is built.

---

## App identity

Ganbaru AI is a free, open-source (AGPL 3.0), privacy-first, local-first productivity app for desktop and mobile. It unifies a calendar, Kanban board, Pomodoro system, note-taking, sleep alarm, daily diary, Doomscrolling, music player, work environment management, and project management into one interconnected experience.

Desktop (Windows, Linux) is the primary target. Mobile (iOS, Android via Tauri v2) is a first-class secondary target that shares the same codebase but offers a focused subset of features.

A gamification layer (skill tree, XP system, Will system, contracts, NPC-guided workflows) is planned for later phases. When implemented, these features will measure real productivity signals, reflect genuine personal and professional development, and guide users through actionable frameworks.

Monetization: donations only via GitHub Sponsors. Sync is self-hosted by the user (with guided setup for cloud providers or local servers). BYOK for any AI features. No ads, no subscriptions, ever.

---

## Core productivity modules

### Calendar

The calendar is the central planning hub. When users plan their week, they are not just scheduling time; they are configuring their entire working environment for each block.

Each calendar event (called a "session block") contains: the task or project it belongs to, the number of Pomodoro cycles allocated, the work environment configuration (which apps to open, which browser tabs, which music playlist, which blocker rules), and the associated project.

The calendar supports day, week, and month views with drag-and-drop event creation and resizing. Overlapping events are displayed with proper layout.

When the current time reaches a session block's start, the app automatically activates the associated work environment: opening apps, arranging browser tabs, starting the playlist, and enabling the correct blocker configuration. This happens without user intervention. The user decides their environment once during planning; the app enforces it.

The calendar also handles automatic date cascade when scope changes. If a user inserts a new session block or extends one, downstream blocks shift accordingly. If dependencies exist between project tasks (from the Kanban), the cascade propagates through the dependency graph and highlights conflicts. This is critical for the project management use case: when requirements change (a new feature request, a shifted deadline), the system shows what moves, what conflicts, and what breaks.

Calendar data is stored in SQLite for fast querying and indexed alongside Kanban tasks, Pomodoro history, and diary entries.

### Kanban board

The Kanban board is the task management layer. It operates at two levels:

**Personal Kanban:** the user's own tasks organized by status (backlog, to do, in progress, done, or custom columns). Tasks have priority levels (easy, medium, hard, epic), estimated Pomodoro count, actual Pomodoro count, due dates, tags, and links to notes and calendar session blocks.

**Project Kanban:** within the project management system (see "Project management framework" section), each project has its own Kanban board. Tasks here also carry requirement version history: every change to a task's description, acceptance criteria, or scope creates a timestamped diff recording what changed, when, who requested it, and why. This is the version-controlled requirement system.

Tasks can be linked to calendar session blocks. When a task is marked as done, the associated session block's completion status updates. When a task's scope changes and its estimated Pomodoro count increases, the calendar can automatically suggest rescheduling downstream blocks.

### Pomodoro system

The Pomodoro timer is the heartbeat of the app. Every productivity signal flows through it.

**Session structure:** Pomodoro sessions are focus rhythms attached to calendar blocks. The default rhythm can be classic Pomodoro-style focus and break timing, but the long-term product model is more flexible: users can choose how many focus periods earn a long break, and advanced users can define short repeating break patterns or custom durations. Adaptative settings can choose focus and break timing from the user's own history without making the default setup feel complicated. The adaptive direction is a constrained personal optimization problem: maximize useful progress while protecting recovery, happiness, sustainability, and user trust.

**During a focus period:** Doomscrolling is active, the work environment is enforced, screen activity is monitored for productivity analytics (app switches, active tool use, idle time), and the music player continues the focus playlist.

**During a break:** the break screen appears fullscreen (desktop only, covering the taskbar and acting as a custom screen saver). The break screen shows: a countdown timer, session completion stats, an option to extend the break, and the break playlist. On mobile, the break is a notification-based timer without the fullscreen overlay.

**When a session block ends or transitions:** the system closes or hands off the active rhythm and transitions to the next session block's environment automatically when appropriate.

**Pomodoro data captured per session:** start/end timestamps, task ID, project ID, app-switch count, active creation time vs. passive time, distraction events (blocker triggers, extended breaks), focus quality score (composite of the above). All stored in SQLite.

### Note-taking

A Notion-like block-based editor powered by Tiptap. Supports slash commands, drag-to-reorder blocks, rich formatting, and markdown serialization. Notes are stored as `.md` files on disk, and the user owns their files.

Notes link bidirectionally to tasks, projects, calendar events, and diary entries via backlinks tracked in SQLite. Cross-referencing notes via backlinks supports the Zettelkasten principle of connecting ideas for better mental organization.

The note editor supports real-time collaboration via Yjs when the sync/collaboration layer is active (self-hosted). Collaborative cursors show live presence.

### Daily diary

The diary creates two daily touchpoints: morning and evening, tied to the sleep alarm system.

**Morning diary (alarm dismissal ritual):** triggered when the user dismisses the sleep alarm. Fields: mood (1 tap, 5 options), energy level (1 tap, 5 options), sleep quality (1 tap, 5 options, auto-suggested based on alarm-to-dismissal time and sleep duration), one intention for the day (typed or selected from planned tasks). Total time: ~10 seconds. The app then displays a summary of the day's planned session blocks and transitions into the morning routine (morning playlist starts, day plan visible).

**Evening diary (bedtime ritual):** triggered when the user sets their alarm for the next day. Fields: what went well (short text), what didn't go well (short text), optional longer free-form reflection, next-day priority (typed or selected from backlog).

Mood and energy data over time create personal baselines for the AI layer (understanding the user's patterns).

Diary entries are stored as dated markdown files in the Ganbaru AI folder and indexed in SQLite.

### Sleep alarm (mobile-only feature)

An intelligent alarm system specific to the mobile app. It serves three purposes: waking the user, triggering the morning diary, and triggering the evening diary.

**Morning:** the alarm rings, the user dismisses it, and the morning diary screen appears immediately. The morning media player playlist starts (configurable: calm music, a podcast, white noise, etc.). Doomscrolling activates according to the user's configured morning rules (e.g., social media blocked until the first session block starts).

**Evening:** when the user sets tomorrow's alarm, the evening diary screen appears. After completing it, the app can optionally show a summary of the day's productivity as a wind-down review.

The alarm system knows sleep duration (time from setting alarm to dismissal), which feeds into sleep quality suggestions in the morning diary and can influence the AI layer's understanding of the user's energy patterns.

### Music player

A local-first media player (Rodio and Symphonia for Rust-backed local audio, platform WebView media for local video) integrated into the productivity workflow. Two supported sources: local audio/video files (primary) and YouTube via the official IFrame Player API (secondary).

**Local files** are handled by the Rust media engine. **YouTube** is integrated via the IFrame API, which is officially supported, free with no developer key required, and works without user registration. The IFrame API provides full programmatic control: loading videos by ID or URL, start/end timestamps, volume, playback speed, and seeking. A transparent overlay covers the iframe to block direct user interaction, so all control is handled programmatically based on the user's preconfiguration. The player remains fully visible and ads play normally; it is simply input-locked. If the user has YouTube Premium, ads do not appear. Playback position is persisted to SQLite and restored on app restart via the `start` URL parameter.

**Spotify is explicitly not supported.** As of 2025-2026, Spotify's API policies make indie integration impossible: development mode caps at 5 users, extended quota requires 250,000 MAU and a registered business, and the gap between these thresholds is a deliberate policy excluding indie developers. This decision is stated publicly in the project documentation.

**User preconfiguration per session block:** which video, playlist, or local file to load; start and end timestamps; parts to skip (timestamp ranges); volume; playback speed; whether to switch source during breaks. Stored in SQLite alongside session block data.

**Playlists are tied to work environments.** When the user plans their calendar, they assign a playlist to each session block (or to the work environment template that the session block uses). When the session block activates, the playlist starts automatically. When a break starts, the playlist can switch to a break playlist. When the morning alarm dismisses, the morning playlist starts.

The music player is accessible from the edge panel for quick controls (play/pause, skip, volume) without leaving the current context.

### Doomscrolling

Two implementations depending on platform:

**Desktop (browser extension):** a Chrome/Firefox extension connected to the Tauri backend via native messaging. It receives blocklist configurations from the app and enforces them by redirecting blocked URLs to a branded block page. The blocking is content-specific where possible. For example, it can block unrelated YouTube videos while allowing videos related to the current task (this requires keyword/channel matching logic initially, with the LLM layer handling more sophisticated content analysis in the future).

**Mobile (app-level blocking):** blocks entire apps according to the user's configured rules. Active during scheduled focus times and morning routines.

**The block page is minimal:** it simply states the site/app is blocked. No gamification elements appear on the block page itself, as that would make it a distraction. Motivation quotes and current stats may be added in the long term but are not a priority.

Blocker trigger events are logged for productivity analytics.

### Work environment management (desktop only)

A work environment is a saved configuration of: which desktop apps to open, which browser tabs to open (and in which window/group), which music playlist to play, which blocker rules to enforce, and which Kanban board/project to display in the edge panel.

Users create environment templates (e.g., "Deep Work: Project X," "Admin," "Creative Writing") and assign them to calendar session blocks. When a session block activates, the app:

1. Closes apps not in the new environment's config (or minimizes them, configurable).
2. Opens apps specified in the new environment.
3. Opens the correct browser tabs via the browser extension.
4. Starts the assigned playlist.
5. Updates the blocker rules.
6. Updates the edge panel to show the relevant Kanban tasks.

This eliminates the daily friction of manually arranging your workspace. The user decides once during weekly planning; the app enforces it automatically throughout the week.

### Edge panel (desktop only)

A narrow, auto-hiding panel anchored to the right edge of the screen. Appears on hover (global mouse position tracked via Rust using `rdev` or platform-specific APIs). Similar to Ubuntu's dock but vertical and on the right side.

Contains: quick-access icons for main modules (Calendar, Kanban, Notes, Music, Settings), the current Pomodoro timer countdown as a small circular progress indicator, the active work environment name, quick-add for new Kanban tasks, task completion checkboxes for current session's tasks, and music controls (play/pause, skip, volume).

Design principle: minimize clicks. Every action reachable from the edge panel should require the fewest possible interactions. The panel is designed for glanceable information and single-click actions without switching away from the user's current work.

### Integrated AI panel

The AI panel is Ganbaru AI's conversational interface for working with AI assistants. It appears as a panel in the app, supporting two modes: an embedded terminal running Codex or another CLI coding agent (developer path) and a chat widget connecting to BYOK LLM providers (general user path). All AI features are opt-in. The app is fully functional without any AI.

**One conversation per project, calendar-driven switching.** Each project has its own persistent conversation thread stored in SQLite. When a calendar event starts, the AI panel automatically saves the current conversation and resumes (or starts) the conversation for the new event's project. A developer working on four different projects in a week has four conversation threads, each resuming exactly where they left off. Manual override is always available.

**Context injection from app state.** When a session starts or switches, Ganbaru AI assembles context from the active project, current kanban tasks, recent progress, calendar events, and related notes. For the terminal, context is passed through the launch prompt or standard input, depending on the selected agent. For the chat widget, context is sent as the system prompt in API calls. `AGENTS.md` stays as project-level conventions; per-task context comes from Ganbaru AI dynamically.

**Kanban task activation.** Clicking "Start" on a kanban task injects that task's details (title, description, priority, branch, related calendar events, related notes) into the current AI conversation. The agent immediately knows what the user is working on without any explanation needed.

**Developer path (Codex terminal):** an xterm.js terminal emulator running Codex or another CLI coding agent with full capabilities (file editing, bash, subagents). The user installs the agent themselves and signs in with their own account or API key. Ganbaru AI provides context injection, session management, and workflow prompt buttons. Background agents run through the selected agent's documented non-interactive mode, with `codex exec` as the default target for Codex.

**General user path (BYOK chat widget):** a chat interface connecting to the user's chosen LLM provider. Three provider categories cover most users: OpenAI API, OpenAI-compatible APIs (Groq, Together, Mistral, and any provider using a compatible chat format), and Ollama for local models (Llama, Mistral, Gemma, running entirely on the user's machine with no API key needed). Other provider APIs can be added when users supply their own credentials. The chat widget can read/write Ganbaru AI data but cannot edit arbitrary files or run bash commands.

**Workflow phase prompts.** Each project management phase has a structured system prompt that adapts the AI's behavior: brainstorming mode guides structured ideation, evaluation mode helps assess ideas against Want/Can/Need criteria, planning mode assists with specifications and resource estimation, execution mode helps with implementation and blockers. These prompts work with both the terminal and the chat widget. One general agent per project carries context across all phases.

**Prompt buttons.** The UI shows contextual action buttons alongside the AI panel: "Plan this sprint", "Research competitors", "Create calendar events for these tasks". Each button inserts a structured prompt into the terminal input or chat widget. The user can review, edit, or execute immediately.

---

## Gamification system (deferred)

The following features are planned for later development phases. Full specifications are preserved here for reference.

### Overview

The gamification layer measures real productivity through automated data collection with four pillars: Consistency, Streaks, Will (Focus, Clarity, Intensity, Execution), and Contracts. XP feeds into a skill tree that visualizes personal and professional growth.

When implemented, these features will include:

- **Skill tree:** an RPG-style directed acyclic graph with layered sub-graphs, center-snap navigation, neighborhood culling, and three node tiers (basic, notable, keystone). Skill decay based on spaced repetition science.
- **Will system:** four categories measuring Focus (distraction resistance), Clarity (preparation quality), Intensity (output density), and Execution (disruption recovery). All data-driven from automated tracking.
- **Contract system:** self-imposed productivity conditions with real stakes. Inspired by Hunter x Hunter's Nen restrictions. Duration 1 day to 3 months, max 5 active simultaneously.
- **Anti-grinding mechanics:** daily XP caps, logarithmic time conversion, novelty weighting, diversity bonus, competency gates.
- **Badges, Skill Capsules, and tier progression:** achievement markers, gacha-inspired cosmetic rewards (no real money), and overall progression gating.
- **NPC-guided workflows:** the Fairy (brainstorming), the Dwarf (idea evaluation), and Drasil (planning and execution) as visual novel characters guiding the project management quest chain.
- **Endowed progress effect:** onboarding pre-populates foundational skills based on user profile.

---

## Project management framework

### The quest chain structure

The project management system presents project lifecycle phases as a sequential quest chain, guided by NPCs. This is where Ganbaru AI becomes a ClickUp/Jira/Asana alternative, wrapped in a narrative structure that makes the inherently dry process of project planning feel guided and purposeful.

**First-time experience:** the NPC walks the user through each phase sequentially in visual novel style. The user fills in templates, answers guided questions, and builds their project specification step by step. This is not a cutscene; it is an interactive form-filling experience where the NPC explains each section contextually.

**Returning experience:** the full framework is visible with all phases accessible. The user can jump to any phase, skip phases, or reorder steps. The NPC explanations remain available on each section but do not block the user from proceeding directly.

When a user starts a new project, the app creates a dedicated work environment for that project's quest chain. The project management interface becomes the active context.

### Phase 1: Genesis (brainstorming)

**NPC guide: the Fairy (Sparkweaver)**
Visual novel presentation with the Fairy character. The user brainstorms freely, writing whatever ideas come to mind. The system provides structured prompts: write ideas, choose the best ones or combine them, iterate until a sufficiently attractive idea emerges. Discarded ideas are classified (e.g., "outside current capabilities," "too expensive," "already exists") for later reference.

### Phase 2: Forging the idea

**NPC guide: the Dwarf (Bearer of Great Promise)**
The Dwarf walks the user through the Venn diagram of ideas, evaluating each idea against three criteria:

1. **Want:** does the user desire to do it? Working on an idea you don't like is painful and likely to fail.
2. **Can:** is it realistically achievable given the user's resources and knowledge?
3. **Need:** does it address a real problem or desire? Revenue potential makes the idea self-sustaining.

The Dwarf NPC is present as a visual novel character during this phase. The Dwarf also has its own chatbot functionality (powered by the AI layer when available) for research discussions and idea validation.

### Phase 3: The journey ahead (planning and execution)

**NPC guide: Drasil (High Elf, The Eternal Wayfinder)**
The most substantial phase, covering the full project lifecycle. Each substep is an actionable template with guided form fields.

**3.1 Planning**

- **3.1.1 Deep brainstorming:** structured expansion of the chosen idea. Write complementary details, choose the best, discard those whose value does not justify the effort.
- **3.1.2 Market analysis:** a comprehensive guided template covering platform identification (where is the audience?), competitive landscape (supply volume, saturation vs. demand, revenue distribution), performance benchmarking (defining success tiers such as top 1%, top 25%, and median, using median as baseline), pricing and quality structure (price tier segmentation and positioning), projections and risk assessment (conservative/realistic/optimistic scenarios, ROI calculation), target audience profile (demographics and psychographics), and comparative analysis (direct competitors, indirect competitors, value extraction from successes and failures).
- **3.1.3 Competitor research:** deep dive into how competitors work. The user tries competing products and documents: the essence of their experience (what makes them special, why some succeeded and others failed, what can be improved) and technical details (specialized research needs). Subtemplates cover core subject deep-dive, genre and structural analysis, medium and presentation standards, gap analysis (finding the unique selling point), and contextual/technical accuracy.
- **3.1.4 Specification:** detailed description of the expected final product. Covers usage, platforms, functionality, hiring needs, revenue model. Subtemplates cover defining project boundaries and depth (phased structure, path variations), logic refinement and problem-solving (addressing core flaws, layering complexity), resource and entity definition (key entities, role evolution, scope management), presentation and interaction standards (perspective, visual dynamism, interface accessibility), and consolidation/formalization. For creative/narrative projects, parallel subtemplates cover structure and narrative flow, theme exploration, initial hook, character development arcs, scene relevance, and dialogue quality.
- **3.1.5 Resources:** team size, roles needed, hiring costs, timeline estimation, budget assessment, pricing and break-even calculation, pessimistic/expected/optimistic demand projections. Subtemplates cover labor and content production costs, technical and operational roles, marketing and distribution budget, scope-based estimation, resource allocation, quantitative asset estimation, financial modeling, and timeframe/labor management.
- **3.1.6 Review:** final viability check against all gathered information.

**3.2 Minimum viable product**

- **3.2.1 Party members:** recruit necessary collaborators.
- **3.2.2 Proof of concept:** validate technical feasibility of specific elements. Subtemplates cover PoC objective, core system development, early observations and pivoting, technical stability, and transition to next phase.
- **3.2.3 MVP:** first usable version for market validation. The user should be satisfied enough with the MVP to take the risk to continue. If not, iterate with minimal changes or discard. If the MVP is good, share with target audience for feedback. Organic attraction is the strongest indicator of product viability.
- **3.2.4 Update:** review and update all prior work based on MVP experience.
- **3.2.5 Funding:** if needed, present the MVP with: the problem statement, MVP with audience feedback, one-sentence technical feasibility, one-sentence financial feasibility, simplified cost breakdown, and funding terms.

**3.3 Execution**

- **3.3.1 Execution plan:** detailed step-by-step plan with resource allocation and error margins.
- **3.3.2 Alpha version:** full core features developed, internal use only, can be unstable.
- **3.3.3 Beta version:** near-complete product for external testing and bug catching.
- **3.3.4 Launch marketing:** content creation, platform preparation, engagement analysis.
- **3.3.5 Polish:** final quality assurance before launch.
- **3.3.6 Final launch announcement:** maximum-reach announcement including press, influencers, and channels beyond existing audience.

**3.4 Post-execution**

- **3.4.1 Contingency handling:** rapid response to unexpected problems.
- **3.4.2 Update investors:** follow-up reporting to stakeholders.
- **3.4.3 Expand your horizon:** consider new platforms, regions, languages.
- **3.4.4 Expand the product:** plan new features based on demand.

**Important note to users:** the framework's order and number of steps are not set in stone. Different projects may require different sequences. The point is to start working, not to follow the template rigidly.

### Actionable methodology templates

Beyond the main project lifecycle, the system includes guided templates for established methodologies: reverse brainstorming, value proposition canvas, business model canvas, SWOT analysis, market research frameworks, and more. Each is a structured, actionable form, not a static document. The user fills in fields, and the system can generate reports, highlight gaps, and (with the AI layer) suggest improvements.

### Requirement version control

Every change to a task's description, acceptance criteria, scope, or assignment within the Kanban board creates a timestamped diff. The diff records: what changed, when it changed, who requested the change, why (a mandatory brief explanation field), and what downstream tasks/dates are affected. This history is permanently attached to the task and cannot be deleted. It can be searched, filtered by date range or by requester, and exported as a report.

This solves the specific problem of shifting requirements in collaborative environments: when a CEO adds a new project, when a client changes specifications, or when scope creep happens incrementally. The system makes every change visible and traceable, enabling accountability and informed decision-making.

### Automatic report generation

The system can generate project status reports automatically from: Kanban board state (tasks by status, completion rates), calendar data (planned vs. actual time spent), Pomodoro history (focus hours, productivity trends), requirement change history (scope changes over time), and milestone completion status. Reports are exportable as markdown or PDF.

---

## NPC characters and narrative layer (deferred)

Three NPCs are planned as an aesthetic layer on top of the project management workflows: the Fairy (Sparkweaver) for brainstorming, the Dwarf (Bearer of Great Promise) for idea evaluation, and Drasil (The Eternal Wayfinder) for planning and execution. They appear in visual novel style during guided workflows. The NPC layer is purely visual; all project management functionality works without it. The AI assistance for these workflows is provided by the integrated AI panel (terminal or BYOK chat), not by the NPCs themselves.

---

## System interactions map

This section documents how every system connects to every other system. These interactions are the core differentiator of Ganbaru AI. No individual feature is unique, but the interconnection between all features in a single app is.

### Calendar → Work environment

When a session block's scheduled time arrives, the calendar triggers the work environment manager to activate the block's associated environment configuration. Apps open, tabs arrange, music starts, blocker rules engage.

### Calendar → Pomodoro

Each session block can contain a Pomodoro rhythm. When the session block activates, the Pomodoro timer starts automatically with the configured focus and break plan. The timer knows the next phase transition, how earned breaks carry across back-to-back blocks, and when the calendar window requires the rhythm to stop or hand off.

### Calendar → Kanban

Session blocks reference Kanban tasks. The edge panel updates to show the relevant tasks for the current session block. When tasks are completed, the session block's progress updates. When task scope changes affect time estimates, the calendar suggests rescheduling downstream blocks.

### Calendar → Music

Session blocks reference playlists. When the block activates, the assigned playlist starts. Break playlists start when the Pomodoro timer enters break phase.

### Pomodoro → Doomscrolling

During focus periods, Doomscrolling is active with the current session block's blocker rules. During breaks, Doomscrolling may relax rules (configurable per environment). Blocker trigger events during focus periods are logged for productivity analytics.

### Pomodoro → Music

The music player switches between focus and break playlists based on the Pomodoro phase.

### Kanban → Calendar

Task scheduling creates calendar session blocks. Task scope changes trigger calendar cascade recalculation. Task dependencies inform the cascade's dependency graph.

### Kanban → Project management

Project Kanban boards are the task layer of the project management framework. Requirement changes on tasks are version-controlled.

### Notes → Project management

Notes can be linked to project phases, tasks, and research. Project templates generate notes for each phase that serve as working documents.

### Daily diary → AI panel

Mood and energy data from diary entries create personal baselines. Over time, the AI can understand the user's patterns and provide context-aware motivation and schedule suggestions via the integrated AI panel.

### Sleep alarm → Daily diary

Morning alarm dismissal triggers the morning diary. Setting the evening alarm triggers the evening diary. The alarm system's sleep duration data informs sleep quality suggestions.

### Sleep alarm → Music

The morning alarm dismissal starts the morning playlist. This can be a gentle wake-up playlist, a podcast, or any configured audio.

### Sleep alarm → Doomscrolling

Morning blocker rules activate immediately upon alarm dismissal. If the user configured "no social media until first session block," Doomscrolling enforces it from the moment they wake up.

### Work environment → Doomscrolling

Each work environment template includes its own blocker ruleset. Switching environments (manually or via calendar) updates the active blocker rules.

### Work environment → Edge panel

The edge panel displays context relevant to the current work environment: the right Kanban tasks, the right quick-access shortcuts, the current environment name.

### Calendar → AI panel

When a calendar event starts, the AI panel saves the current conversation and resumes the conversation thread for the new event's project. The AI automatically has context about what the user is working on, what tasks are active, and where they left off.

### Kanban → AI panel

Clicking "Start" on a kanban task injects the task's context into the current AI conversation. The AI knows the task details, related calendar events, and project context without the user needing to explain.

### AI panel → Kanban

The AI can update kanban tasks via the CLI: moving tasks between columns, updating descriptions, marking tasks as done. Background agents can work on delegated tasks and update the kanban when finished.

### AI panel → Calendar

The AI can create and modify calendar events via the CLI: scheduling work sessions, adjusting event durations, and suggesting rescheduling when task scope changes.

### AI panel → Notes

The AI can read and write project notes. In the terminal path, Codex or another CLI coding agent edits markdown files directly. In the BYOK chat path, the AI can read notes for context and suggest content.

### AI panel → Project management

Workflow phase prompts adapt the AI's behavior to the current project phase. The AI assists with brainstorming, evaluation, planning, and execution using structured system prompts. Project templates and methodology forms are enhanced by AI suggestions.

### Project management → Calendar

Starting a project quest chain creates a dedicated work environment and suggests calendar blocks for the project's phases.

### Project management → Kanban

Each project phase generates Kanban tasks. The project's Kanban board is the living task layer of the quest chain.

### Project management → NPC layer (deferred)

When the NPC visual layer is implemented, NPCs appear contextually during guided project phases as an aesthetic wrapper over the workflow phase prompts.

### Project management → Software repositories

When a project is a software repository, Ganbaru AI bridges its internal data with the repo's own documentation:

- **Calendar events** for the project carry pomodoro presets, music, blocker rules, and workspace settings. Starting a calendar event for "Project X" auto-opens the right browser tabs, switches the terminal to the project directory, loads the project's notes, and activates the project's kanban board.
- **Kanban tasks** are the live task layer. The kanban tab auto-switches based on the active calendar event's project. Agents and collaborators see the same tasks.
- **The `ganbaru-ai` CLI** exports repo-facing markdown views such as `KANBAN.md` and generated reports into the git repository. This makes project context available to collaborators who don't use Ganbaru AI and to AI agents that read the repo natively. The export is a view of the database, not the source of truth. Changes made to exported markdown by agents or humans can be imported back when the export type supports imports.
- **AI agents** interact with Ganbaru AI via the CLI: querying tasks, creating calendar events, updating progress. This works with Codex, Cursor, and any agent that can run shell commands, with no MCP server or plugin required.

The data split: documents (notes, diary, project docs) are markdown files on disk. Structured data (events, tasks, workspace configs) is SQLite. The CLI bridges the two worlds. See TECH_STACK.md for the full technical rationale.

---

## Mobile experience

Mobile is a focused subset: note editor, calendar view and editing, Pomodoro timer, daily diary, sleep alarm, Doomscrolling (app-level blocking), BYOK AI chat, sync.

Mobile does not include: work environment management, edge panel, fullscreen break overlay, browser extension, always-on-top windows. These features require desktop OS-level access that mobile sandboxing prohibits.

The mobile app's primary roles are: anti-procrastination enforcement (app blocking during scheduled focus times and mornings), calendar/notes access and editing when away from the desktop, the sleep alarm and diary cycle, and Pomodoro timing with notification-based breaks. The mobile app also serves as the device that reminds you to return to your desktop. Calendar notifications for upcoming session blocks function as calls to action.

---

## Advanced AI features (post-MVP)

The integrated AI panel (terminal and BYOK chat) provides the foundation. These additional features build on it:

**Natural language calendar management:** "move my 3pm session to tomorrow", "schedule a 2-hour deep work block for project X on Wednesday". The AI modifies calendar events via the CLI.

**Mood-aware motivation:** using diary mood/energy baselines, the AI adapts its communication style and suggests schedule adjustments on low-energy days.

**Content-specific browsing relevance detection:** the LLM analyzes page content (not just URLs) to determine if browsing is task-relevant, enabling smarter blocking on platforms like YouTube.

**Local LLM diary analysis:** small local models (via Ollama) analyze diary language for goal-setting patterns, reflection quality, and mood trends without any API calls or data leaving the device.

**MCP for external access:** exposes Ganbaru AI's data (calendar, tasks, notes) to external AI clients (ChatGPT, teammate agents, and other MCP-compatible clients) that don't run locally. Also consumes external MCP servers for integrations (email, external calendars). MCP is not used for internal agent interaction; that's handled by the CLI and direct process spawning.

---

## Design principles summary

1. **Local-first:** the app works fully offline. Sync is additive, never required.
2. **Automated measurement:** productivity metrics come from real tracked behavior, not self-reporting.
3. **Interconnection over isolation:** every module feeds data to and receives data from other modules. The value of the app comes from the connections, not any single feature.
4. **Progressive disclosure:** new users see a guided, constrained experience. Complexity reveals itself as confidence grows.
5. **Gamification as structure (planned):** the gamification layer (Will, Contracts, skill tree, NPCs) is designed to be structurally integrated into how the app measures and motivates productivity, not as a skin on a task list.
6. **AI as infrastructure, not afterthought:** the integrated AI panel is a core module, not a post-MVP add-on. Calendar-driven session switching, context injection, and workflow phase prompts make AI assistance seamless. The terminal and BYOK chat are two interfaces to the same session management architecture.
7. **Minimal friction:** the edge panel, automatic environment switching, calendar-driven automation, and 10-second diary entries all serve the same goal: reducing the number of decisions and clicks required to stay productive.
8. **Ethical engagement (planned):** gacha-inspired mechanics (Skill Capsules) will use earned currency only, never real money. Loss aversion (skill decay, Contract penalties) will be visible but not punitive.
9. **Privacy-first:** E2E encryption for sync, local storage as default, BYOK for AI, no ads, no tracking beyond what the user explicitly configures for their own productivity measurement.

# GanbaruAI: complete product specification

This document describes every system in GanbaruAI, how each system works internally, and how all systems interact with each other. It is the single source of truth for understanding the product's design intent before implementation. The tech stack is documented separately. This document covers what the app does and why, not how it is built.

---

## App identity

GanbaruAI is a free, open-source (AGPL 3.0), privacy-first, local-first productivity app for desktop and mobile. It unifies a gamified calendar, Kanban board, Pomodoro system, note-taking, real-life skill tree, sleep alarm, daily diary, procrastination stopper, music player, work environment management, and project management into one interconnected experience wrapped in an adventure RPG aesthetic.

Desktop (Windows, Linux) is the primary target. Mobile (iOS, Android via Tauri v2) is a first-class secondary target that shares the same codebase but offers a focused subset of features.

The RPG layer is not cosmetic. It is structurally integrated: the experience system (Will, Contracts, Consistency, Streaks) measures real productivity signals, the skill tree reflects genuine personal and professional development, NPCs guide users through actionable frameworks, and the visual presentation follows a visual novel style at key interaction points.

Monetization: donations only via GitHub Sponsors. Sync is self-hosted by the user (with guided setup for cloud providers or local servers). BYOK for any AI features. No ads, no subscriptions, ever.

---

## Core productivity modules

### Calendar

The calendar is the central planning hub. When users plan their week, they are not just scheduling time; they are configuring their entire working environment for each block.

Each calendar event (called a "session block") contains: the task or project it belongs to, the number of Pomodoro cycles allocated, the work environment configuration (which apps to open, which browser tabs, which music playlist, which blocker rules), and which skill tree branches it contributes XP to.

The calendar supports day, week, and month views with drag-and-drop event creation and resizing. Overlapping events are displayed with proper layout.

When the current time reaches a session block's start, the app automatically activates the associated work environment: opening apps, arranging browser tabs, starting the playlist, and enabling the correct blocker configuration. This happens without user intervention. The user decides their environment once during planning; the app enforces it.

The calendar also handles automatic date cascade when scope changes. If a user inserts a new session block or extends one, downstream blocks shift accordingly. If dependencies exist between project tasks (from the Kanban), the cascade propagates through the dependency graph and highlights conflicts. This is critical for the project management use case: when requirements change (a new feature request, a shifted deadline), the system shows what moves, what conflicts, and what breaks.

Calendar data is stored in SQLite for fast querying and indexed alongside Kanban tasks, Pomodoro history, and diary entries.

### Kanban board

The Kanban board is the task management layer. It operates at two levels:

**Personal Kanban:** the user's own tasks organized by status (backlog, to do, in progress, done, or custom columns). Tasks have priority levels (easy, medium, hard, epic), estimated Pomodoro count, actual Pomodoro count, due dates, tags, and links to notes and calendar session blocks. When using custom columns, the user designates which column(s) count as "completion columns" for XP purposes. This is necessary because the XP system needs to know when a task is considered done, regardless of how many intermediate columns (QA, review, etc.) exist between "in progress" and the final state.

**Project Kanban:** within the project management system (see "Project management framework" section), each project has its own Kanban board. Tasks here also carry requirement version history: every change to a task's description, acceptance criteria, or scope creates a timestamped diff recording what changed, when, who requested it, and why. This is the version-controlled requirement system.

Tasks can be linked to calendar session blocks. When a task is marked as done, the associated session block's completion status updates. When a task's scope changes and its estimated Pomodoro count increases, the calendar can automatically suggest rescheduling downstream blocks.

Task completion feeds into the XP system. Each completed task generates XP proportional to its difficulty tier: easy = 10, medium = 25, hard = 50, epic = 100. Minimum time thresholds prevent gaming (a "hard" task completed in 2 minutes does not award full XP).

### Pomodoro system

The Pomodoro timer is the heartbeat of the app. Every productivity signal flows through it.

**Session structure:** a standard Pomodoro cycle is 25 minutes of focus followed by a 5-minute break. Every 4 cycles, a longer break (15-30 minutes) occurs. These defaults are configurable. Sessions are grouped into session blocks defined in the calendar.

**During a focus period:** the procrastination stopper is active, the work environment is enforced, screen activity is monitored for Will system metrics (app switches, active tool use, idle time), and the music player continues the focus playlist.

**During a break:** the break screen appears fullscreen (desktop only, covering the taskbar and acting as a custom screen saver). The break screen shows: a countdown timer, the XP earned during the completed focus period (displayed as an RPG-style "battle results" screen), Will metrics for the session, streak status, an option to extend the break (with Will Focus penalty), and the break playlist. On mobile, the break is a notification-based timer without the fullscreen overlay.

**When all Pomodoros in a session block complete:** a fullscreen XP summary screen appears showing total XP earned across all focus periods in that block, Will category breakdowns, any level-ups or skill tree progress, and Skill Capsule drops if earned. The user interacts briefly (reviewing progress, allocating points if applicable), then the system transitions to the next session block's environment automatically.

**Pomodoro data captured per session:** start/end timestamps, task ID, project ID, app-switch count, active creation time vs. passive time, distraction events (blocker triggers, extended breaks), focus quality score (composite of the above). All stored in SQLite.

### Note-taking

A Notion-like block-based editor powered by Tiptap. Supports slash commands, drag-to-reorder blocks, rich formatting, and markdown serialization. Notes are stored as `.md` files on disk, and the user owns their files.

Notes link bidirectionally to tasks, projects, calendar events, and diary entries via backlinks tracked in SQLite. Cross-referencing notes generates Will Clarity XP (the Zettelkasten principle: connecting ideas demonstrates mental organization).

The note editor supports real-time collaboration via Yjs when the sync/collaboration layer is active (self-hosted). Collaborative cursors show live presence.

### Daily diary

The diary creates two daily touchpoints: morning and evening, tied to the sleep alarm system.

**Morning diary (alarm dismissal ritual):** triggered when the user dismisses the sleep alarm. Fields: mood (1 tap, 5 options), energy level (1 tap, 5 options), sleep quality (1 tap, 5 options, auto-suggested based on alarm-to-dismissal time and sleep duration), one intention for the day (typed or selected from planned tasks). Total time: ~10 seconds. The app then displays a summary of the day's planned session blocks and transitions into the morning routine (morning playlist starts, day plan visible).

**Evening diary (bedtime ritual):** triggered when the user sets their alarm for the next day. Fields: what went well (short text), what didn't go well (short text), optional longer free-form reflection, next-day priority (typed or selected from backlog).

**Diary data feeds into the XP system:** morning goal-setting contributes to Will Clarity XP (evidence of preparation). Evening reflection contributes to Will Execution XP (evidence of adaptive learning). Mood and energy data over time create personal baselines for the AI layer (understanding the user's patterns).

Diary entries are stored as dated markdown files in the vault and indexed in SQLite.

### Sleep alarm (mobile-only feature)

An intelligent alarm system specific to the mobile app. It serves three purposes: waking the user, triggering the morning diary, and triggering the evening diary.

**Morning:** the alarm rings, the user dismisses it, and the morning diary screen appears immediately. The morning media player playlist starts (configurable: calm music, a podcast, white noise, etc.). The procrastination stopper activates according to the user's configured morning rules (e.g., social media blocked until the first session block starts).

**Evening:** when the user sets tomorrow's alarm, the evening diary screen appears. After completing it, the app can optionally show a summary of the day's XP and skill tree progress as a wind-down review.

The alarm system knows sleep duration (time from setting alarm to dismissal), which feeds into sleep quality suggestions in the morning diary and can influence the AI layer's understanding of the user's energy patterns.

### Music player

A local-first media player (LGPL 2.1, FFmpeg via `ffmpeg-next` for the Rust backend) integrated into the productivity workflow. Two supported sources: local audio/video files (primary) and YouTube via the official IFrame Player API (secondary).

**Local files** are handled by the Rust media engine. **YouTube** is integrated via the IFrame API, which is officially supported, free with no developer key required, and works without user registration. The IFrame API provides full programmatic control: loading videos by ID or URL, start/end timestamps, volume, playback speed, and seeking. A transparent overlay covers the iframe to block direct user interaction, so all control is handled programmatically based on the user's preconfiguration. The player remains fully visible and ads play normally; it is simply input-locked. If the user has YouTube Premium, ads do not appear. Playback position is persisted to SQLite and restored on app restart via the `start` URL parameter.

**Spotify is explicitly not supported.** As of 2025-2026, Spotify's API policies make indie integration impossible: development mode caps at 5 users, extended quota requires 250,000 MAU and a registered business, and the gap between these thresholds is a deliberate policy excluding indie developers. This decision is stated publicly in the project documentation.

**User preconfiguration per session block:** which video, playlist, or local file to load; start and end timestamps; parts to skip (timestamp ranges); volume; playback speed; whether to switch source during breaks. Stored in SQLite alongside session block data.

**Playlists are tied to work environments.** When the user plans their calendar, they assign a playlist to each session block (or to the work environment template that the session block uses). When the session block activates, the playlist starts automatically. When a break starts, the playlist can switch to a break playlist. When the morning alarm dismisses, the morning playlist starts.

The music player is accessible from the edge panel for quick controls (play/pause, skip, volume) without leaving the current context. There is no gamification in the music system currently.

### Procrastination stopper

Two implementations depending on platform:

**Desktop (browser extension):** a Chrome/Firefox extension connected to the Tauri backend via native messaging. It receives blocklist configurations from the app and enforces them by redirecting blocked URLs to a branded block page. The blocking is content-specific where possible. For example, it can block unrelated YouTube videos while allowing videos related to the current task (this requires keyword/channel matching logic initially, with the LLM layer handling more sophisticated content analysis in the future).

**Mobile (app-level blocking):** blocks entire apps according to the user's configured rules. Active during scheduled focus times and morning routines.

**The block page is minimal:** it simply states the site/app is blocked. No gamification elements appear on the block page itself, as that would make it a distraction. Motivation quotes and current stats may be added in the long term but are not a priority.

**Blocker data feeds into Will Focus XP:** every time the blocker fires and the user does not attempt to bypass it, positive Focus XP accrues. Attempted bypasses or disabling the blocker during a focus period generates negative Focus XP. The blocker is a primary data source for the Will system.

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

Contains: quick-access icons for main modules (Calendar, Kanban, Notes, Skill Tree, Music, Settings), the current Pomodoro timer countdown as a small circular progress indicator, the active work environment name, quick-add for new Kanban tasks, task completion checkboxes for current session's tasks, music controls (play/pause, skip, volume), and streak counter.

Design principle: minimize clicks. Every action reachable from the edge panel should require the fewest possible interactions. The panel is designed for glanceable information and single-click actions without switching away from the user's current work.

---

## The experience and gamification system

### Overview

The experience system measures real productivity through automated data collection, not self-reporting. It has four pillars: Consistency, Streaks, Will, and Contracts. XP earned across all pillars feeds into the skill tree and tier progression.

The XP display follows RPG conventions: after each Pomodoro focus period, the break screen shows a "battle results" style summary. After completing all Pomodoros in a session block, a fullscreen XP summary appears. This is the primary moment where the user interacts with the gamification layer.

### XP curve

XP requirements follow a quadratic curve: `XP_required = (level / x)²`. Calibrated so that level 1→2 takes approximately one productive day (~200 XP earned) and level 49→50 takes roughly two weeks of sustained focused work.

### Consistency

Measures whether the user follows through on their planned schedule. XP is awarded for completing planned session blocks as scheduled, completing Pomodoro cycles without early termination, and following through on calendar commitments. Penalization occurs for skipping planned sessions, abandoning Pomodoro cycles mid-focus, and repeatedly rescheduling without completing.

### Streaks

Tracks consecutive days of productive activity. Multipliers follow Duolingo's proven model: 1.1× at 3 days, 1.2× at 7 days, 1.3× at 14 days, 1.5× at 30 days. One free streak freeze per 7-day streak (the user can miss one day without breaking the streak). Streaks increase commitment measurably, and users with 7-day streaks are significantly more likely to remain engaged long-term.

### Will system

Inspired by Hunter × Hunter's Nen system and Eternally Regressing Knight's Will. The Will system measures the quality of work, not just the quantity. It has four categories:

#### Will Focus (inspired by Ten)

The user's proof of maintaining an unbroken protective barrier against distraction, covering both voluntary (extending breaks, ignoring the timer, choosing to browse) and involuntary triggers (accidental app-switching, mindless browsing).

**Data sources:**
- Procrastination stopper: did it trigger? How often? Did the user attempt to bypass it?
- App-switch frequency during Pomodoro sessions (tracked by the desktop activity monitor).
- Break timer adherence: did the user return on time or extend the break?
- Screen activity during focus blocks: active tool use vs. passive browsing.

**Core metric:** distraction events per focus session. Zero distraction events = perfect Focus score for that session. Each distraction event reduces the Focus score proportionally.

**XP award:** base Focus XP per completed Pomodoro, multiplied by the Focus score (0.0 to 1.0). A perfectly focused session earns full Focus XP. A session with 5 app switches earns reduced Focus XP. A session where the blocker was disabled earns zero Focus XP.

#### Will Clarity (inspired by Zetsu)

The user's proof of mental preparation: having studied their tasks, prepared their environment, and being ready to act without fumbling. Zetsu in Nen is about suppressing output to heighten perception. The productivity equivalent is reducing mental noise to maximize awareness of what needs to be done.

**Data sources:**
- Time between Pomodoro start and first meaningful action (was the task pre-selected before the session, or did the user spend 3 minutes figuring out what to do?).
- Whether the Kanban task was pre-assigned to the session block in the calendar.
- Whether notes or reference materials were opened before the timer started vs. scrambled for during.
- Morning diary completion (goal-setting language indicates preparation).
- Note cross-referencing (creating backlinks between notes demonstrates organized thinking).
- Context-switch cost: if someone starts a Pomodoro, opens three different apps looking for their place, then finally settles, that indicates low Clarity.

**Core metric:** preparation quality score, composite of the above signals. High Clarity = the user starts working immediately because they prepared their environment and knew what to do.

**XP award:** base Clarity XP per session, multiplied by the preparation quality score.

#### Will Intensity (inspired by Ren)

The user's proof of sustained high-output work within a session. Ren in Nen is about projecting maximum power outward. The productivity equivalent is output density: how much meaningful work was produced per unit of time.

**Data sources:**
- Task type-specific output metrics: for coding (file saves, commits, lines changed), for writing (word count delta), for design (export events), for general tasks (Kanban cards moved to done). These are tracked via OS-level observation. File system watchers (Rust `notify` crate) detect saves in the user's configured project directories, and git CLI commands count commits and line diffs. No IDE-specific integrations or plugins are required.
- Pomodoro completion rate within a session block (completing all planned Pomodoros = high intensity).
- Task difficulty tier vs. completion time (completing a "hard" task efficiently = high intensity).

**Core metric:** output density relative to the user's own rolling average. This is personal-baseline calibration; what counts as "intense" for a student writing an essay differs from a developer shipping features. The system compares today's output to the user's past 30-day average for the same task type.

**XP award:** base Intensity XP per session, multiplied by the relative output density (capped at 2.0× to prevent outlier sessions from dominating).

#### Will Execution (inspired by Hatsu)

The user's proof of adaptive problem-solving: handling interruptions, unexpected blockers, and shifting priorities without losing momentum. Hatsu in Nen is about personal expression and unique ability. The productivity equivalent is how the user responds to chaos.

**Data sources:**
- Recovery time after disruptions: if the procrastination stopper fires mid-session and the user recovers within 30 seconds vs. 5 minutes.
- Calendar event interruptions: if an unplanned event interrupts a focus block, how quickly does the user resume?
- Kanban re-prioritization: if the user re-orders tasks mid-day and still completes the adjusted plan.
- Evening diary reflection: content about what went wrong and how it was handled contributes to Execution XP.
- A brief self-assessment during the Pomodoro break screen (2-3 quick taps, not a form): "Did anything unexpected come up? How did you handle it?" This hybrid approach supplements automated signals for a category that is inherently harder to track automatically.

**Core metric:** disruption recovery quality. High Execution = the user absorbs disruptions and adapts without derailing their session.

**XP award:** base Execution XP per session, multiplied by the recovery quality score. Sessions with no disruptions earn a baseline Execution score (not zero, because absence of disruption is not the same as poor execution).

#### Will XP penalization

Will XP is penalized for: disabling the procrastination stopper during focus time (Focus penalty), starting a Pomodoro with no task selected and no preparation (Clarity penalty), abandoning sessions significantly below personal output averages without cause (Intensity penalty), and failing to recover from disruptions within a reasonable window (Execution penalty).

Penalties are subtractive from the session's Will XP, never punitive enough to make total session XP negative. The goal is to reduce the reward, not to punish.

### Contract system

Inspired by Hunter × Hunter's Nen curses and Jujutsu Kaisen's binding vows. Contracts are self-imposed productivity conditions with real stakes, both in-app and optional non-harmful real-life consequences.

**Rules:**

1. Only available for advanced players (minimum tier/level threshold to unlock).
2. Self-imposed conditions with in-app benefits/penalties and optional non-harmful real-life benefits/penalties.
3. Conditions can be automatically tracked by the app (e.g., "complete 4 Pomodoros daily for 30 days") or real-life conditions requiring proof attachment (e.g., "run 3 times per week" with photo proof).
4. There is always an in-app penalty for failure. If the user selects real-life penalties, they must establish frequency (one-time, daily, etc.) and duration (up to 3 months), each requiring proof.
5. Non-harmful real-life benefits and penalties scale with how much the user values discipline on the contract's objective. The user self-determines the severity.
6. Duration: 1 day to 3 months. Can be set to auto-renew (only if selected at creation).
7. The more restrictive and broad the conditions and penalties, the higher the benefit multiplier.
8. Maximum 5 active contracts simultaneously.

**Benefits of an active contract:**

1. Passive XP boost on related projects (all XP earned in the contract's domain is multiplied).
2. Active XP boost on specific tasks related to the contract's condition.
3. Exclusive reward system elements: unique badges, exclusive skill tree layers/branches, personalization options only obtainable through contracts.
4. The extra productivity generated by the condition itself (the real benefit).
5. Whatever non-harmful real-life benefits the user defined for themselves.

**Penalties for contract failure:**

1. 2× the accumulated XP given by the contract's boost is subtracted. A passive ×0.01 XP multiplier applies to the contract's domain until the user completes any self-imposed real-life penalty.
2. Level demotion on exclusive skill tree layers/branches equal to the XP they gained from the contract's boost (1×). A UI "corruption" visual effect is applied to the affected branches.
3. Removal of exclusive badges and personalization options earned through the contract.
4. The user must attach proof of completing their self-imposed real-life penalty (if any).
5. The user cannot create new contracts until completing the penalty, or for 2× the contract's duration if they refuse or fail to complete the penalty on time.

The Contract system creates a powerful psychological loop: the higher the stakes the user sets, the greater the reward, but also the greater the consequence of failure. This mirrors the Nen restriction/covenant system where power scales with sacrifice. The corruption visual effect on failed branches is particularly impactful because it makes failure visible in the skill tree, creating a stronger loss-aversion signal than numbers alone.

---

## The reward system

### Skill tree

Inspired by The Rising of the Shield Hero's skill tree system and informed by research into Path of Exile's passive tree, Final Fantasy X's Sphere Grid, and Maker Skill Trees. The reference aesthetic is Shield Hero's skill tree: dark background, glowing circular nodes with icons, a center-focused node, animated transitions between nodes, and a detail panel showing unlock information.

**Architecture:** a directed acyclic graph (DAG) with **layered sub-graphs**. The top layer shows broad life/work categories as navigable nodes. Entering a node reveals its own sub-graph with more specific skills. This creates a "generalist but deep" structure, broad at the surface and specialized within.

**Navigation model (the core UX contract):**

- **The world moves, the camera does not.** Selecting a node animates the entire graph so that node lands at the center of the viewport. The user never drags or pans; the graph repositions itself.
- **Navigation is discrete.** Arrow keys or click traverse edges one step at a time. No free pan, no free zoom during normal navigation.
- **No drag-and-drop.** Users navigate and unlock; they never reposition nodes.
- **Depth is bounded per view.** From any focal node, only adjacent neighbors (depth 1) and their neighbors (depth 2) are rendered. Depth 3+ nodes are hidden. This caps the visible set at ~15-40 nodes regardless of total tree size.

**Structure:**

- **Root graph (5-8 nodes):** broad life/work domains. Examples: Mind, Body, Craft, Social, Creative. Each is a navigable node containing its own sub-graph.
- **Sub-graphs within each domain:** subcategories. Craft might contain Programming, Writing, Design. Mind might contain Focus, Memory, Learning.
- **Further depth via nested sub-graphs:** Programming might contain Rust, TypeScript, Python. Arbitrary nesting depth, though 3-4 levels is practical.
- **Target: 200+ total nodes across all layers.** At any single focal point, the user sees only 3-5 adjacent choices.

**Node types (three-tier hierarchy from Path of Exile):**

1. **Basic nodes** (small, subtle glow): the connective tissue. Represent small improvements or subskills. Low cost to unlock.
2. **Notable nodes** (medium, named, brighter glow): landmarks. Represent meaningful competencies. Higher cost, may require multiple basic prerequisites.
3. **Keystone nodes** (large, intense glow): transformative. Represent mastery-level achievements. Very high cost, and may require prerequisites from 2+ sub-graphs.

**Node states:**

- **Locked:** all prerequisites not yet met. Visually dimmed, grayscale, non-interactive.
- **Available:** all prerequisites unlocked. Glowing border, interactive. User can spend skill points to unlock.
- **Unlocked:** purchased by the user. Full brightness, colored glow.

There is no reverse transition in normal play. If respec is supported, it is a separate operation.

**Skill points:** XP earned through productivity (Pomodoro sessions, task completions, streak maintenance) converts to spendable skill points. The user chooses which available nodes to unlock. This gives agency: the user decides their growth path, not the system.

**Cross-disciplinary connections (four mechanisms):**

1. **Bridge nodes:** sit at the boundary between two sub-graphs, with prerequisite paths from both. Example: "Technical Writing" bridges Craft/Programming and Craft/Writing.
2. **Multi-parent nodes:** require prerequisites from 2+ sub-graphs. Example: "Public Speaking" requires nodes from Social/Communication and Creative/Performance.
3. **Synergy bonuses:** hidden nodes that appear when related skills across sub-graphs are both completed.
4. **Tag system:** skills carry labels (Communication, Leadership, Analytical, Creative) that can be filtered to reveal cross-branch connections.

**Neighborhood culling (critical for performance and UX):**

The visible node set is computed by BFS from the focal node, not by viewport intersection. Depth 0 renders fully centered, depth 1 renders fully, depth 2 renders at reduced opacity, depth 3+ is hidden. This is a `$derived` rune that recomputes only when the focal node changes. Total tree size is irrelevant to render performance.

On mobile: the same neighborhood culling applies. Node details appear in bottom sheets instead of side panels.

**Center-snap animation:**

When the focused node changes, the entire graph translates via a spring animation so the new focal node lands at the viewport center. The spring uses `svelte/motion` for the elastic, game-like feel. Only one animated value (the `<g>` container's translate offset) drives all movement.

**How the skill tree connects to productivity data:**

- Calendar session blocks are tagged to skill tree sub-graphs. Completing a session block generates skill points.
- Kanban task completion generates skill points proportional to difficulty tier.
- Pomodoro sessions generate skill points in the sub-graphs associated with the current task.
- Note-taking and cross-referencing generates Clarity XP which converts to skill points.
- Contract bonuses apply multipliers to skill point earnings in specific sub-graphs.
- The skill tree is the primary visual representation of long-term growth. It reflects genuine accumulated effort verified by automated tracking.

**Skill decay (based on spaced repetition science):**

Skills visibly decline without practice: `displayed_level = actual_level * e^(-0.03 * days_since_practice)`. After 7 days: ~81% retention (barely noticeable). After 14 days: ~66% (visible decline). After 30 days: ~41% (significant). One Pomodoro in the relevant domain restores the displayed level. The actual earned level is preserved, so returning after a break is cheap, but prolonged absence is visible.

**Deep layers and deep branches:**

Deep layers are additional depth tiers gated behind tier upgrades and/or Contract achievements. Deep branches are entirely new sub-graphs that only appear after specific Contract completions. Both serve as exclusive content that rewards commitment, visible as "locked" indicators that incentivize progression.

**Authored graph data:**

The graph structure is curated static data (TypeScript constants or JSON), not user-generated. Node positions within each sub-graph are hand-authored. Only node unlock states and skill point balance are user-specific and persisted to SQLite. The graph definition is versioned with the app.

### Tier upgrade system

Tiers represent the user's overall progression level across the entire app, separate from individual skill tree branch levels. Tier upgrades unlock: access to tier-locked deep branches and deep layers in the skill tree, new customization options, the Contract system (for advanced tiers), and personal satisfaction as a measure of overall growth.

### Badges

Achievement markers earned through specific accomplishments: completing a Contract, reaching a milestone in a skill tree branch, maintaining a streak for a threshold duration, completing a project through the full lifecycle, and other notable events. Badges are displayed on the user's profile and serve as completionist incentives.

### Profile sharing

Users can share their skill tree, tier, badges, and streak information. This serves as social proof and enables comparison/inspiration within collaborative teams. Profile sharing is opt-in.

### Skill capsules

A gacha-inspired reward mechanic adapted ethically for productivity. Completing practice sessions earns capsules containing randomized cosmetic rewards:

- Common: 60% drop rate
- Rare: 25% drop rate
- Epic: 10% drop rate
- Legendary: 5% drop rate

Guaranteed rare+ every 10 capsules. Guaranteed epic+ every 50 capsules (pity system). Full animated reveal sequence with escalating visual effects for higher rarities. No real money is involved; capsules are earned purely through practice. Contents are cosmetic only: profile decorations, skill tree visual themes, avatar accessories, UI color schemes.

### Endowed progress effect

New users start with their skill tree partially illuminated. Based on onboarding questions (profession, interests, experience level), foundational skills are pre-populated as "already begun." This leverages the endowed progress effect: showing partial progress significantly increases completion rates compared to starting from zero.

---

## Anti-grinding mechanics

The experience system must resist gaming. Five mechanisms prevent XP accumulation without genuine productivity:

1. **Daily XP cap per skill area:** 200 XP per branch per day, after which the rate drops to 25%. This encourages breadth (working across multiple domains) rather than grinding one branch.

2. **Logarithmic time-to-XP conversion:** `XP = base_rate × ln(1 + minutes) / ln(1 + 25)`. The first hour of focused work earns full XP. The fourth+ consecutive hour in the same branch earns only ~40%. This prevents marathon grinding sessions from dominating.

3. **Novelty weighting:** first attempts at new task types earn 2× XP. The bonus diminishes to 1× after 5 similar repetitions. This rewards exploration and learning new skills.

4. **Diversity bonus:** `1.0 + 0.05 × distinct_skills_practiced_today` (max 1.3×). Practicing across 6 different skill areas in one day earns a 1.3× multiplier on all XP. This incentivizes a balanced approach.

5. **Competency gates:** at certain skill tree thresholds, the user must demonstrate output or pass a skill check to level up, not just log time. For automated task types, this could be verified output (e.g., a completed project phase). For others, it could be a self-assessment validated by the system's data (e.g., "you claim you've mastered this, but your Intensity scores in this branch have been declining").

**The cardinal rule:** every gamifiable metric must pass this test: "Could a user maximize this metric without being more productive?" If yes, do not gamify it. Never award XP for task creation, app opening, or raw time logged.

---

## XP formula

Total session XP has two components: activity XP (the compound formula below) and Will category XP (awarded separately per session for each of the four Will categories as described in their individual sections).

### Activity XP (compound formula)

```
Activity_XP = Σ(base_XP × category_weight × focus_quality × streak_multiplier) × diversity_bonus × min(1.0, actual_output / expected_output) × contract_multiplier - distraction_penalty
```

Where:
- `base_XP` = base XP for the completed activity (Pomodoro = 25, task completion = 10/25/50/100 by tier, journal = 15, etc.)
- `category_weight` = 1.5 for active creation, 1.0 for standard work, 0.8 for admin
- `focus_quality` = Will Focus score (0.0 to 1.0). This is the only Will category that directly scales activity XP.
- `streak_multiplier` = streak bonus (1.0 to 1.5)
- `diversity_bonus` = skill diversity multiplier (1.0 to 1.3)
- `actual_output / expected_output` = personal baseline ratio (capped at 1.0; output above baseline does not inflate activity XP, and it is rewarded separately through Will Intensity XP)
- `contract_multiplier` = active Contract boost (1.0 if no contract)
- `distraction_penalty` = XP subtracted for distraction events during the session

### Will category XP (per session)

Each Will category awards its own XP independently: Focus (base × focus score, 0.0-1.0), Clarity (base × preparation quality score), Intensity (base × relative output density, capped at 2.0×), Execution (base × disruption recovery quality). These are separate line items that do not multiply against the activity XP formula above.

### Total session XP

```
Session_XP = Activity_XP + Focus_XP + Clarity_XP + Intensity_XP + Execution_XP
```

All XP flows to the skill tree branches tagged on the current session block.

---

## Project management framework

### The quest chain structure

The project management system presents project lifecycle phases as a sequential quest chain, guided by NPCs. This is where GanbaruAI becomes a ClickUp/Jira/Asana alternative, wrapped in a narrative structure that makes the inherently dry process of project planning feel guided and purposeful.

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

## NPC characters and narrative layer

### Visual novel presentation

NPCs appear in visual novel style: a background illustration with the character, dialogue text, and interactive options. This presentation is used in guided workflows (project management, onboarding, key tutorial moments) but does not appear in utility interfaces (Calendar, Kanban, edge panel).

### Current NPCs

**The Fairy (Sparkweaver):** guides brainstorming and ideation phases. Appears during Genesis. Encouraging, creative, focused on possibility.

**The Dwarf (Bearer of Great Promise):** guides idea evaluation and project management. Appears during Forging the Idea and throughout the planning templates. Practical, thorough, focused on quality and realistic assessment. Has an integrated chatbot for research discussions (AI-powered when available).

**Drasil (High Elf, The Eternal Wayfinder):** guides long-term planning, execution, and the overarching journey. The primary NPC for the project lifecycle quest chain. Wise, patient, focused on the big picture. In the future, Drasil becomes the conversational AI assistant for the app, managing calendar changes via natural language, understanding the user's mood and patterns from diary data, and providing personalized motivation.

### Onboarding

A short story-lore onboarding introduces the user to the world and their relationship with the NPCs. The user learns why they are working with Drasil, why the Fairy helps with ideas, and how the Dwarf forges plans. This onboarding is brief (2-3 minutes maximum) and leads directly into the first practical interaction with the app (setting up the first calendar session, creating the first task).

---

## System interactions map

This section documents how every system connects to every other system. These interactions are the core differentiator of GanbaruAI. No individual feature is unique, but the interconnection between all features in a single app is.

### Calendar → Work environment

When a session block's scheduled time arrives, the calendar triggers the work environment manager to activate the block's associated environment configuration. Apps open, tabs arrange, music starts, blocker rules engage.

### Calendar → Pomodoro

Each session block contains a Pomodoro count. When the session block activates, the Pomodoro timer starts automatically with the configured cycle count. The timer knows how many cycles remain in the current block.

### Calendar → Kanban

Session blocks reference Kanban tasks. The edge panel updates to show the relevant tasks for the current session block. When tasks are completed, the session block's progress updates. When task scope changes affect time estimates, the calendar suggests rescheduling downstream blocks.

### Calendar → Skill tree

Session blocks are tagged to skill tree branches. All XP earned during a session block flows to the tagged branches.

### Calendar → Music

Session blocks reference playlists. When the block activates, the assigned playlist starts. Break playlists start when the Pomodoro timer enters break phase.

### Pomodoro → Will system

Every Pomodoro focus period generates data for all four Will categories: Focus (distraction events), Clarity (preparation quality), Intensity (output density), Execution (disruption recovery). The break screen displays Will metrics and XP earned.

### Pomodoro → Procrastination stopper

During focus periods, the stopper is active with the current session block's blocker rules. During breaks, the stopper may relax rules (configurable per environment). Blocker trigger events during focus periods are logged as Will Focus data.

### Pomodoro → Skill tree (XP screen)

After completing all Pomodoros in a session block, the fullscreen XP summary appears showing skill tree progress. This is the primary skill tree interaction moment: the user sees branches grow, levels advance, and any new nodes unlocked.

### Pomodoro → Music

The music player switches between focus and break playlists based on the Pomodoro phase.

### Kanban → Calendar

Task scheduling creates calendar session blocks. Task scope changes trigger calendar cascade recalculation. Task dependencies inform the cascade's dependency graph.

### Kanban → Skill tree

Task completion generates XP for the branches the task is tagged to. XP amount scales with task difficulty tier.

### Kanban → Project management

Project Kanban boards are the task layer of the project management framework. Requirement changes on tasks are version-controlled.

### Notes → Skill tree

Cross-referencing notes (creating backlinks between related notes) generates Will Clarity XP distributed across the branches the notes are tagged to.

### Notes → Project management

Notes can be linked to project phases, tasks, and research. Project templates generate notes for each phase that serve as working documents.

### Daily diary → Will system

Morning entries contribute to Will Clarity XP (preparation/goal-setting). Evening entries contribute to Will Execution XP (reflection/adaptive learning).

### Daily diary → AI layer (future)

Mood and energy data from diary entries create personal baselines for the conversational AI (Drasil). Over time, Drasil can understand the user's patterns and provide context-aware motivation and schedule suggestions.

### Sleep alarm → Daily diary

Morning alarm dismissal triggers the morning diary. Setting the evening alarm triggers the evening diary. The alarm system's sleep duration data informs sleep quality suggestions.

### Sleep alarm → Music

The morning alarm dismissal starts the morning playlist. This can be a gentle wake-up playlist, a podcast, or any configured audio.

### Sleep alarm → Procrastination stopper

Morning blocker rules activate immediately upon alarm dismissal. If the user configured "no social media until first session block," the stopper enforces it from the moment they wake up.

### Procrastination stopper → Will system

Blocker trigger events (and the user's response to them) are the primary data source for Will Focus. Successful blocking without bypass = positive Focus XP. Attempted bypass = negative Focus XP.

### Contracts → Skill tree

Active Contracts provide XP multipliers to specific branches. Failed Contracts cause level demotion and visual corruption on affected branches. Completed Contracts unlock exclusive deep layers and deep branches.

### Contracts → Badges

Contract completion awards exclusive badges. Contract failure removes them.

### Skill capsules → Pomodoro

Capsules are earned through completing practice sessions (Pomodoro focus periods). The capsule drop animation appears on the XP screen during breaks or end-of-session-block summaries.

### Work environment → Procrastination stopper

Each work environment template includes its own blocker ruleset. Switching environments (manually or via calendar) updates the active blocker rules.

### Work environment → Edge panel

The edge panel displays context relevant to the current work environment: the right Kanban tasks, the right quick-access shortcuts, the current environment name.

### Project management → Calendar

Starting a project quest chain creates a dedicated work environment and suggests calendar blocks for the project's phases.

### Project management → Kanban

Each project phase generates Kanban tasks. The project's Kanban board is the living task layer of the quest chain.

### Project management → NPC layer

NPCs appear contextually during guided project phases. The Fairy during brainstorming. The Dwarf during idea forging and specification. Drasil during planning and execution.

---

## Mobile experience

Mobile is a focused subset: note editor, calendar view and editing, Pomodoro timer, daily diary, sleep alarm, procrastination stopper (app-level blocking), skill tree viewing, sync.

Mobile does not include: work environment management, edge panel, fullscreen break overlay, browser extension, always-on-top windows. These features require desktop OS-level access that mobile sandboxing prohibits.

The mobile app's primary roles are: anti-procrastination enforcement (app blocking during scheduled focus times and mornings), calendar/notes access and editing when away from the desktop, the sleep alarm and diary cycle, Pomodoro timing with notification-based breaks, and viewing skill tree progress. The mobile app also serves as the device that reminds you to return to your desktop. Calendar notifications for upcoming session blocks function as calls to action.

---

## AI and MCP roadmap (post-MVP)

These features are not part of the initial build but are architecturally planned for:

**Drasil as conversational AI assistant:** natural language interaction for calendar management ("move my 3pm session to tomorrow"), mood-aware motivation based on diary patterns, schedule suggestions based on energy/productivity patterns, and project guidance during quest chain phases.

**AI-powered research:** within the project management framework, the Dwarf's chatbot assists with market research, competitor analysis, and idea validation using web search and document analysis.

**Content-specific procrastination detection:** the LLM layer analyzes page content (not just URLs) to determine if browsing is task-relevant, enabling smarter blocking on platforms like YouTube.

**Small local LLM models:** for diary language analysis (detecting goal-setting, reflection, mood indicators) without requiring API calls. Falls back to LLM API (BYOK) if local models are insufficient.

**MCP integration:** the app exposes its data (calendar, tasks, notes, skill tree) via MCP, allowing external AI tools to interact with GanbaruAI's systems. Conversely, GanbaruAI can consume external MCP servers for integrations (email, external calendars, etc.).

All AI features are opt-in and BYOK. The app is fully functional without any AI layer. Users who want AI features provide their own API key, so there are no bill surprises and no data leaving the device without explicit consent.

---

## Design principles summary

1. **Local-first:** the app works fully offline. Sync is additive, never required.
2. **Automated measurement:** XP comes from real tracked behavior, not self-reporting. If the app cannot verify it, it does not award XP.
3. **Interconnection over isolation:** every module feeds data to and receives data from other modules. The value of the app comes from the connections, not any single feature.
4. **Progressive disclosure:** new users see a guided, constrained experience. Complexity reveals itself as confidence grows.
5. **RPG as structure, not decoration:** the gamification layer (Will, Contracts, skill tree, NPCs) is structurally integrated into how the app measures and motivates productivity. It is not a skin on a to-do list.
6. **Minimal friction:** the edge panel, automatic environment switching, calendar-driven automation, and 10-second diary entries all serve the same goal: reducing the number of decisions and clicks required to stay productive.
7. **Ethical engagement:** gacha-inspired mechanics (Skill Capsules) use earned currency only, never real money. Loss aversion (skill decay, Contract penalties) is visible but not punitive. The test: does the user feel better about themselves after each session?
8. **Privacy-first:** E2E encryption for sync, local storage as default, BYOK for AI, no ads, no tracking beyond what the user explicitly configures for their own productivity measurement.

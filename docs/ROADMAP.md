# Roadmap

This roadmap records delivery horizons, not a history of implementation order. Ganbaru AI has developed across several domains in parallel, so numbered phases no longer describe the real dependency graph.

Detailed behavior belongs in feature specifications. This document states what is implemented, what is actively incomplete, and which outcomes should follow.

## Implemented foundation

The current repository has a substantial local desktop and Android foundation:

- A Svelte 5 and Tauri v2 application with separate desktop and mobile composition roots.
- An active-vault model with embedded SQLite migrations, managed assets, and portable folder identity.
- Calendar day, week, and month views; event editing; recurrence; iCalendar import and export; notifications; and project links.
- Pomodoro rhythms, persisted runs and segments, idle and suspend handling, adaptive decision foundations, progress surfaces, and desktop or Android scheduling.
- SQLite-backed Projects with groups, planning views, tasks, dependencies, tags, custom fields, templates, scheduling links, and history.
- SQLite-backed Notes pages, blocks, databases, templates, links, comments, suggestions, assets, history, import, export, and working-folder Markdown editing.
- Quick notes, typed English and Spanish localization, profiles, and customizable themes.
- Project channels over durable native coding-agent sessions, with provider-neutral history, local provider transports, workspace tools, terminals, checkpoints, review, teammate identity, and explicit access profiles.
- Local Music library and playlist workflows, desktop audio playback and media controls, Android Media3 playback, and YouTube IFrame integration with a known interaction-compliance redesign requirement.
- Chromium website blocking, desktop application blocking, Android selected-application usage awareness, and explicitly consented Android enforcement.
- An adaptive Android shell for Calendar, Projects, Notes, Chat, Quick notes, Pomodoro, Music, Settings, themes, portable backup and restore, notifications, and Doomscrolling controls.
- A source-complete private-LAN whole-vault handoff coordinated by one administration desktop for a bounded membership of desktop and Android clients, with QR or complete-code pairing, explicit single-writer ownership, read-only refresh, recovery, and combined Doomscrolling usage. Physical multi-device acceptance remains pending.

Implemented does not mean release-complete on every platform. The [feature index](features/README.md) and [Android platform document](platforms/android/README.md) identify partial areas and platform limits.

## Active completion work

These domains already have useful implementations but still need hardening or missing product slices.

### Calendar and Pomodoro correctness

- Move live Calendar transition and reconfiguration decisions into Rust. Scheduler and rail selection now share an active-first policy with stable tie-breakers.
- Align TypeScript and Rust recurrence behavior through shared fixtures, then resolve COUNT with exclusions and the relationship between RDATE and RRULE termination.
- Expose idle-source availability and apply bounded retry or backoff instead of silently treating adapter errors as zero idle duration.

See [Calendar](features/calendar/README.md), [Pomodoro](features/pomodoro/README.md), [recurrence expansion](algorithms/calendar/recurrence-expansion.md), and [time-conflict detection](algorithms/calendar/time-conflict-detection.md).

### Concurrent device synchronization

Build concurrent one-person synchronization beyond the implemented local single-writer whole-vault handoff. The future design uses typed domain operations, SQLite-persisted Yrs/Yjs text, end-to-end encrypted enrollment, and an optional user-hosted Rust relay for opaque encrypted records. Hocuspocus is no longer the relay candidate.

Concurrent synchronization remains unimplemented. The current handoff moves one validated complete vault and permits only one writer, so it does not provide CRDT editing, conflict resolution, asynchronous delivery, or cloud access. Scoped preferences, the transactional operation journal, domain convergence, cryptographic writer and key lifecycle, explicit focus-controller ownership, native runtime bridges, and relay delivery remain required. The [sync milestone table](data/sync.md#delivery-and-acceptance) tracks the implemented boundary and remaining work.

### Android release readiness

- Complete broader physical-device and emulator acceptance, including gesture navigation and predictive Back behavior.
- Provision durable signing credentials, validate signed APK and AAB output, and finish distribution preparation.
- Complete remaining content-URI attachment transfers and encrypted scheduled backup.
- Keep notification, background focus, Media3, and Accessibility Service behavior reliable across supported Android versions and manufacturer variants.

See [Android](platforms/android/README.md).

### Projects and Notes maturity

- Finish incomplete planning, database, editor, transfer, and history workflows without weakening the current source-of-truth model.
- Keep large collections bounded through pagination, visible-window queries, and measured bundle boundaries.
- Refine project-to-Calendar and project-to-Notes transitions around accepted commitments rather than duplicated state.

See [Projects](features/projects/README.md) and [Notes](features/notes/README.md).

### Chat and local agent execution

- Finish the user-facing teammate, mention, reply-thread, scheduling, and access-review flows built on the current authorization foundation.
- Harden provider recovery, workspace observation, scratch cleanup, checkpoints, and review across supported local providers.
- Keep organizational communication independent from replaceable provider sessions.

See [Chat](features/chat/README.md), [AI integration](features/ai/README.md), and [Chat access control](data/access-control.md).

### Music and Doomscrolling

- Complete local library repair, assignment, and Android queue behavior where the current UI still exposes partial workflows.
- Redesign YouTube interaction so no Ganbaru element overlays or disables required embedded-player interaction.
- Complete browser and desktop rule coverage, diagnostics, false-positive recovery, and cross-platform reliability.
- Treat any future Firefox or content-aware blocking as a separate reviewed capability.

See [Music](features/music/README.md) and [Doomscrolling](features/doomscrolling/README.md).

## Next product outcomes

The next outcomes complete missing parts of the core anti-procrastination and anti-burnout loop.

### Diary and sleep routines

Implement morning and evening diary flows, durable dated entries, mood and energy baselines, and an Android sleep-alarm experience with explicit exact-alarm policy and graceful fallback.

See [Diary](features/diary.md) and [Sleep alarm](features/sleep-alarm.md).

### Human work environments

Implement saved desktop environments that can prepare approved applications, browser resources, Music, Doomscrolling rules, and the relevant project context when a Calendar block begins. Activation must remain user-configurable and must not grant AI execution authority.

See [Work environments](features/work-environments.md) and [Edge panel](features/edge-panel.md).

### Structured project delegation

Build reviewable planning proposals, task-linked agent runs, context packages, assignment and review workflows, budgets, sustainable work-in-progress limits, requirement history, schedule proposals, and generated reports on top of the current Projects and Chat foundations.

No planning teammate is seeded or privileged by default. A person approves commitments before Projects or Calendar changes.

See [Project management](features/projects/management.md) and [Agent coordination](features/ai/coordination.md).

## Later outcomes

### Human collaboration

Extend the one-person synchronization foundation to multiple participants with resource-scoped authorization, invitations, history visibility, revocation, offline behavior, and permission-safe derived data. This remains later work and is separate from linking one person's devices.

See [Sync and collaboration](data/sync.md).

### General BYOK assistants and external access

Add hosted and local BYOK assistants through the same teammate, channel, task, permission, and provenance model. Add a separately authorized external MCP service and, if still useful, a local `ganbaru-ai` CLI for explicit queries and derivative exports.

This work must not reuse native coding-provider trust as general Ganbaru authority. External service credentials remain user-owned and locally protected.

See [AI integration](features/ai/README.md).

### Additional platforms and interoperability

- Add macOS and iOS composition, build, signing, and acceptance after Apple hardware and release infrastructure are available.
- Add Firefox only after shared browser-rule semantics and native-host packaging are stable.
- Expand iCalendar conformance through fixtures and evidence without claiming unsupported scheduling transports.

See [Platforms](platforms/README.md) and [iCalendar compatibility](interop/icalendar/README.md).

## Deferred

Gamification, the Will model, skill trees, contracts, and the narrative character layer remain deliberately deferred. They must reflect genuine progress, protect recovery, avoid paid chance mechanics, and never become prerequisites for the core productivity app.

See [Gamification](features/gamification.md).

## Dependency rules

- Diary and sleep can build on the existing vault, notification, Calendar, Pomodoro, and Android foundations.
- Work environments depend on stable Calendar activation, Music, and Doomscrolling adapters.
- Structured delegation depends on current Projects, Notes, Chat, access-control, and execution foundations.
- Human collaboration depends on domain-specific sync operations and permission-safe derived data.
- General BYOK and external MCP depend on the same identity, authorization, and provenance rules as local coordination.
- Apple platform releases depend on platform build and signing capability, not on unrelated feature completion.

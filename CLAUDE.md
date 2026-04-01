# GanbaruAI

GanbaruAI is a free, open-source (AGPL 3.0), privacy-first, local-first productivity app for desktop and mobile built with Tauri v2, Svelte 5, and Rust. It unifies a gamified calendar, Kanban board, Pomodoro system, note-taking, real-life skill tree, sleep alarm, daily diary, procrastination stopper, music player, work environment management, and project management into one interconnected experience wrapped in an adventure RPG aesthetic with a structurally integrated experience system (Will, Contracts, Consistency, Streaks).

## Essential reading

- **PRODUCT_SPEC.md**: full product specification (what the app does and why)
- **TECH_STACK.md**: complete technical stack and architecture (how it's built)
- **PROGRESS.md**: current state of the project
- **ROADMAP.md**: phased development plan
- **TESTING.md**: test setup, conventions, and what is covered

## Workspace structure

> This tree shows both existing and planned directories. Items marked with (planned) do not exist yet. Update this tree whenever directories are created, renamed, or removed.

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
│   │   │   │   │   ├── skill-tree/       ← SVG + Svelte center-snap tree, node components
│   │   │   │   │   ├── notes/            ← (planned) Tiptap editor wrapper, slash commands
│   │   │   │   │   ├── diary/            ← (planned) morning/evening entry forms
│   │   │   │   │   ├── music/            ← (planned) player controls, playlist management
│   │   │   │   │   ├── visual-novel/     ← (planned) NPC dialogue, conversation state machine
│   │   │   │   │   ├── edge-panel/       ← (planned) panel layout, quick-access widgets
│   │   │   │   │   ├── environment/      ← (planned) work environment config UI
│   │   │   │   │   ├── contracts/        ← (planned) contract creation, tracking, proof UI
│   │   │   │   │   ├── project/          ← (planned) project management quest chain phases
│   │   │   │   │   ├── capsules/         ← (planned) Skill Capsule reveal animations
│   │   │   │   │   └── ui/              ← shadcn-svelte generated components
│   │   │   │   ├── data/                ← static data (skill tree JSON, schema, adapter)
│   │   │   │   ├── hooks/               ← reusable Svelte hooks
│   │   │   │   ├── stores/              ← Svelte runes ($state), global app state
│   │   │   │   ├── api/                ← typed wrappers around Tauri invoke() calls
│   │   │   │   ├── utils/               ← shared helpers, XP formulas, formatters
│   │   │   │   └── types/               ← frontend-specific TypeScript types
│   │   │   ├── windows/                 ← (planned) entry points for each Tauri window
│   │   │   ├── app.html                 ← HTML shell
│   │   │   ├── app.css                  ← global styles, RPG theme variables
│   │   │   └── app.d.ts                 ← global type declarations
│   │   ├── static/                      ← static assets (fonts, icons, sounds)
│   │   ├── src-tauri/                   ← Rust backend
│   │   │   ├── src/
│   │   │   │   ├── main.rs              ← shared entry point
│   │   │   │   ├── lib.rs               ← shared commands and logic
│   │   │   │   └── mobile.rs            ← mobile-specific Rust logic
│   │   │   ├── gen/                     ← auto-generated mobile projects
│   │   │   ├── capabilities/            ← permission declarations (desktop/mobile)
│   │   │   ├── icons/                   ← app icons
│   │   │   ├── tauri.conf.json          ← Tauri config
│   │   │   └── Cargo.toml
│   │   ├── package.json
│   │   ├── svelte.config.js
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── server/                          ← (planned) Hocuspocus sync server (self-hostable)
│
├── plugins/                             ← (planned)
│   └── media-player/                    ← LGPL 2.1 Tauri plugin (Rust crate + npm)
│
├── packages/
│   └── shared-types/                    ← TypeScript types shared across workspaces
│       ├── src/
│       └── package.json
│
├── extensions/                          ← (planned)
│   ├── chrome/                          ← Chrome extension (manifest v3)
│   └── firefox/                         ← Firefox extension
│
├── Cargo.toml                           ← cargo workspace root
├── turbo.json                           ← Turborepo task config
├── pnpm-workspace.yaml                  ← workspace definition
└── package.json                         ← root scripts, shared dev dependencies
```

## Key conventions

- **Package manager:** pnpm
- **Monorepo orchestration:** Turborepo on top of pnpm workspaces
- **Frontend:** plain Svelte 5 with runes (not SvelteKit)
- **Desktop/mobile shell:** Tauri v2
- **License:** AGPL 3.0 for the app, LGPL 2.1 for the media player plugin
- **Data architecture:** two categories of data with different storage. Documents (notes, diary, project docs) are markdown files on disk; SQLite indexes them for fast queries but the file is the source of truth. Structured data (calendar events, kanban tasks, workspace configs, pomodoro sessions, XP, skill tree, gamification state) lives in SQLite as the source of truth. Never store structured data as markdown or document content in SQLite.
- **Agent integration:** a `ganbaruai` CLI (Rust, reads the same SQLite) is the primary bridge between AI agents and GanbaruAI's data. Agents call it via Bash. MCP is reserved for post-MVP real-time features only. The CLI can export project state as markdown to git repos for collaborators and agents without the CLI. These exports are views of the database, not the source of truth.
- **State management:** Svelte 5 runes ($state, $derived, $effect), no external state manager
- **Sync:** Yjs + Hocuspocus (CRDT-based, E2E encrypted, self-hosted by the user)
- **Build tool:** Vite (default with Tauri + Svelte scaffold)

## Rules

- Read PROGRESS.md at the start of every conversation to understand what has been done and what is in progress.
- After every session where files are created, modified, or deleted, update PROGRESS.md before finishing. PROGRESS.md is a current-state board, not a history log (git has the history). Maintenance rules:
  - When something is completed, move it from "Active work" to "What exists" as a brief line.
  - When a full phase is complete, collapse its "What exists" items into a single summary line and start the next phase.
  - When starting a new feature branch, add it to "Active work" with the branch name and scope.
  - "Blocked / needs decision" tracks anything that cannot proceed without input.
- When adding or modifying pure functions (utils, helpers, formulas), write or update unit tests. Tests live next to the source with `.test.ts` suffix. Run `pnpm test` from `apps/desktop/` to verify. Update TESTING.md if new test categories are added.
- Do not use em dashes or double dashes in markdown, code comments, or commit messages. Restructure sentences using periods, commas, colons, semicolons, or parentheses instead.
- This project is entirely donation-funded (GitHub Sponsors). Users never pay for a service and should never depend on infrastructure we host or maintain. Any feature involving external services (sync, backups, AI, integrations) must be designed so the user provisions and hosts it themselves. Prioritize ease of setup: provide step-by-step guides accessible to non-technical users, support multiple provider options (or the most common ones), and ask me for clarification on which providers to target if not already specified in the roadmap.
- Keep the workspace structure in this file up to date. When directories are created, renamed, or removed, update the tree and remove or add the (planned) marker as needed.
- When stuck on a framework-specific issue that you cannot resolve confidently from training knowledge, search the official documentation before attempting workarounds or guessing. Primary sources:
  - Tauri v2: v2.tauri.app
  - Svelte 5: svelte.dev/docs
  - shadcn-svelte: next.shadcn-svelte.com
  - Bits UI: bits-ui.com
  - Tailwind CSS v4: tailwindcss.com/docs
  - Tiptap: tiptap.dev/docs
  - If the official docs are not enough, fall back to general web searches (GitHub issues, Stack Overflow, etc.).

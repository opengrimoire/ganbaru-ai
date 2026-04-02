# GanbaruAI

GanbaruAI is an anti-procrastination project manager for life and work. Free, local, open-source (AGPL 3.0), privacy-first, lightweight with opt-in AI (Claude Code and BYOK for any LLM). It's built with Tauri v2 (Rust) and Svelte 5 with multi-platform in mind (Linux, Windows, macOS, and in the future Android and iOS).

Features a highly interconnected:
- Calendar
- Pomodoro
- Kanban (pending)
- Mindless browsing stopper (pending)
- Note-taking (pending)
- Sleep alarm (pending)
- Daily diary (pending)
- Music management (pending)
- Gamification (real-life skill tree, XP, contracts, NPC-guided workflows) (pending)

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
│   │   │   │   │   ├── pomodoro/         ← timer display, break screen, idle overlay
│   │   │   │   │   ├── notes/            ← (planned) Tiptap editor wrapper, slash commands
│   │   │   │   │   ├── diary/            ← (planned) morning/evening entry forms
│   │   │   │   │   ├── music/            ← (planned) player controls, playlist management
│   │   │   │   │   ├── ai-panel/         ← (planned) integrated terminal (xterm.js) and BYOK chat
│   │   │   │   │   ├── visual-novel/     ← (planned) NPC dialogue, conversation state machine
│   │   │   │   │   ├── edge-panel/       ← (planned) panel layout, quick-access widgets
│   │   │   │   │   ├── environment/      ← (planned) work environment config UI
│   │   │   │   │   ├── contracts/        ← (planned) contract creation, tracking, proof UI
│   │   │   │   │   ├── project/          ← (planned) project management quest chain phases
│   │   │   │   │   └── ui/              ← shadcn-svelte generated components
│   │   │   │   ├── hooks/               ← reusable Svelte hooks
│   │   │   │   ├── stores/              ← Svelte runes ($state), global app state
│   │   │   │   ├── api/                ← typed wrappers around Tauri invoke() calls
│   │   │   │   ├── utils/               ← shared helpers, formatters
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

## Vault structure

> Everything the app produces or manages lives in one folder called the vault. This makes backup and sync the same operation regardless of data type. Update this tree as the project evolves.

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
  reports/                ← generated project status reports (markdown, PDF)
  assets/                 ← user assets (images embedded in notes, attachments)
  templates/              ← project management phase templates, methodology templates (SWOT, BMC, etc.)
  config.json             ← user settings, work environment definitions, blocker rulesets
  .yjs/                   ← Yjs document state cache (binary, not human-readable)
  app.db                  ← SQLite index (metadata, search, tags, backlinks, pomodoro sessions,
                             playlist definitions, requirement version diffs, diary indexed fields)
```

Music files are not stored in the vault. Local audio files stay wherever the user keeps them; the vault only stores playlist definitions in SQLite. Backups are not stored in the vault; scheduled encrypted exports go to a user-specified path outside the vault.

## Key conventions

- **Package manager:** pnpm
- **Monorepo orchestration:** Turborepo on top of pnpm workspaces
- **Frontend:** plain Svelte 5 with runes (not SvelteKit)
- **Desktop/mobile shell:** Tauri v2
- **License:** AGPL 3.0 for the app, LGPL 2.1 for the media player plugin
- **Data architecture:** two categories of data with different storage. Documents (notes, diary, project docs) are markdown files on disk; SQLite indexes them for fast queries but the file is the source of truth. Structured data (calendar events, kanban tasks, workspace configs, pomodoro sessions) lives in SQLite as the source of truth. Never store structured data as markdown or document content in SQLite.
- **AI integration:** three paths. (1) Integrated terminal (xterm.js) running Claude Code with context injection via `--append-system-prompt` flags, calendar-driven session switching, and per-project conversation threads. (2) BYOK chat widget for non-developer users (Anthropic API, OpenAI-compatible API, Ollama for local models). (3) MCP for external AI clients only (ChatGPT, Claude web, etc.), not for internal agent interaction.
- **Agent data bridge:** a `ganbaruai` CLI (Rust, reads the same SQLite) is the primary bridge between AI agents and GanbaruAI's data. Agents call it via Bash. The CLI exports project state as markdown to git repos for collaborators and agents without the CLI. These exports are views of the database, not the source of truth.
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
- Keep the workspace structure and vault structure in this file up to date. When directories are created, renamed, or removed, update the relevant tree. Never hardcode vault paths; read them from user configuration.
- When stuck on a framework-specific issue that you cannot resolve confidently from training knowledge, search the official documentation before attempting workarounds or guessing. Primary sources:
  - Tauri v2: v2.tauri.app
  - Svelte 5: svelte.dev/docs
  - shadcn-svelte: next.shadcn-svelte.com
  - Bits UI: bits-ui.com
  - Tailwind CSS v4: tailwindcss.com/docs
  - Tiptap: tiptap.dev/docs
  - If the official docs are not enough, fall back to general web searches (GitHub issues, Stack Overflow, etc.).

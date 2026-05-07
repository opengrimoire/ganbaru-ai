# GanbaruAI

GanbaruAI is an anti-procrastination project manager for life and work. Free, local, open-source (AGPL 3.0), privacy-first, lightweight with opt-in AI (Codex and BYOK for any LLM). It's built with Tauri v2 (Rust) and Svelte 5 with multi-platform in mind (Linux, Windows, macOS, and in the future Android and iOS).

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

All documentation lives in `docs/`. Top-level overviews:

- **docs/PRODUCT_SPEC.md**: what the app does and why (being migrated into granular docs; will be removed once empty)
- **docs/TECH_STACK.md**: how it's built
- **docs/ROADMAP.md**: phased development plan
- **docs/PERFORMANCE.md**: memory, startup, and package size measurements

Granular docs (read the relevant one when working on a feature):

- **docs/features/**: per-feature behavior and UX (calendar, calendar-recurrence, pomodoro, pomodoro-break-screen, pomodoro-idle-detection, pomodoro-progress-displays, plus placeholders for unbuilt features)
- **docs/data/**: data architecture, schema, invariants, sync, hazards, security
- **docs/algorithms/**: pure-logic specs (recurrence-expansion, pomodoro-segments-and-plan, pomodoro-state-machine, idle-detection, time-conflict-detection, undo-redo)

Docs describe the optimal/ideal end state of the app, not the current implementation. They preserve the "why" behind decisions over time.

## Workspace structure

> Update this when directories are created, renamed, or removed. Items marked (planned) do not exist yet.

```
apps/
  client/: Tauri app (Svelte frontend + Rust backend)
    src/: Svelte frontend
      lib/: shared frontend code
        components/: reusable Svelte components
          calendar/: calendar wrappers, session block rendering
          kanban/: board columns, task cards, drag-and-drop
          pomodoro/: timer display, break screen, idle overlay
          notes/: (planned) Tiptap editor wrapper, slash commands
          diary/: (planned) morning/evening entry forms
          music/: (planned) player controls, playlist management
          ai-panel/: (planned) integrated terminal (xterm.js) and BYOK chat
          visual-novel/: (planned) NPC dialogue, conversation state machine
          edge-panel/: (planned) panel layout, quick-access widgets
          environment/: (planned) work environment config UI
          contracts/: (planned) contract creation, tracking, proof UI
          project/: (planned) project management quest chain phases
          ui/: shadcn-svelte generated components
        hooks/: reusable Svelte hooks
        stores/: Svelte runes ($state), global app state
        api/: typed wrappers around Tauri invoke() calls
        utils/: shared helpers, formatters
        types/: frontend-specific TypeScript types
      windows/: (planned) entry points for each Tauri window
      app.html, app.css, app.d.ts: HTML shell, global styles, type declarations
    static/: static assets (fonts, icons, sounds)
    src-tauri/: Rust backend
      src/: main.rs (entry), lib.rs (commands), mobile.rs (mobile logic)
      gen/: auto-generated mobile projects
      capabilities/: permission declarations (desktop/mobile)
      icons/: app icons
      tauri.conf.json, Cargo.toml
    package.json, svelte.config.js, vite.config.ts, tsconfig.json
  server/: (planned) Hocuspocus sync server (self-hostable)
plugins/: (planned)
  media-player/: LGPL 2.1 Tauri plugin (Rust crate + npm)
packages/
  shared-types/: TypeScript types shared across workspaces
extensions/: (planned)
  chrome/: Chrome extension (manifest v3)
  firefox/: Firefox extension
Cargo.toml: cargo workspace root
turbo.json: Turborepo task config
pnpm-workspace.yaml: workspace definition
package.json: root scripts, shared dev dependencies
```

## Vault structure

> Everything the app produces lives in one folder (the vault). Update this as the project evolves.

```
vault/
  notes/daily/: daily notes (markdown)
  notes/projects/: per-project notes and working documents (markdown)
  diary/morning/, diary/evening/: dated diary entries (markdown, indexed fields in SQLite)
  calendar/: calendar event data (session blocks, schedule state)
  projects/{project-id}/: per-project file attachments (reference docs, research PDFs)
  reports/: generated project status reports (markdown, PDF)
  assets/: user assets (images embedded in notes, attachments)
  templates/: project management phase templates, methodology templates (SWOT, BMC, etc.)
  config.json: user settings, work environment definitions, blocker rulesets
  .yjs/: Yjs document state cache (binary)
  app.db: SQLite index (metadata, search, tags, backlinks, pomodoro sessions, playlist definitions)
```

Music files stay wherever the user keeps them; vault stores only playlist definitions. Backups go to a user-specified path outside the vault.

## Key conventions

- **Package manager:** pnpm
- **Monorepo orchestration:** Turborepo on top of pnpm workspaces
- **Frontend:** plain Svelte 5 with runes (not SvelteKit)
- **Desktop/mobile shell:** Tauri v2
- **License:** AGPL 3.0 for the app, LGPL 2.1 for the media player plugin
- **Data architecture:** two categories of data with different storage. Documents (notes, diary, project docs) are markdown files on disk; SQLite indexes them for fast queries but the file is the source of truth. Structured data (calendar events, kanban tasks, workspace configs, pomodoro sessions) lives in SQLite as the source of truth. Never store structured data as markdown or document content in SQLite.
- **AI integration:** three paths. (1) Integrated terminal (xterm.js) running Codex or another CLI coding agent, with calendar-driven session switching, per-project conversation threads, and task context passed through the agent prompt or standard input. (2) BYOK chat widget for non-developer users (OpenAI API, OpenAI-compatible API, Ollama for local models, and other user-configured providers). (3) MCP for external AI clients only (ChatGPT, teammate agents, etc.), not for internal agent interaction.
- **Agent data bridge:** a `ganbaruai` CLI (Rust, reads the same SQLite) is the primary bridge between AI agents and GanbaruAI's data. Agents call it via Bash. The CLI exports project state as markdown to git repos for collaborators and agents without the CLI. These exports are views of the database, not the source of truth.
- **State management:** Svelte 5 runes ($state, $derived, $effect), no external state manager
- **Sync:** Yjs + Hocuspocus (CRDT-based, E2E encrypted, self-hosted by the user)
- **Build tool:** Vite (default with Tauri + Svelte scaffold)

## Testing

**Writing tests:**
- Tests live next to source with `.test.ts` suffix (e.g., `utils.ts` and `utils.test.ts`)
- Pure functions are the best candidates. If a function depends on Tauri IPC or DOM, extract the pure logic into a separate function or skip testing it.
- Before writing a new test, look at existing tests in the same area to match their depth and style.
- Cover edge cases, not just happy paths. Shallow "it exists" tests are worthless.
- Test names describe behavior, not implementation.

**For UI/component changes:** `pnpm -w run validate` is the completion gate. Agents cannot manually verify the real Tauri app UI from this environment. Do not start a dev server, launch Tauri, or run HTTP smoke checks as a substitute for manual verification. If a UI behavior needs more confidence than existing checks provide, add or update tests where practical, then run `pnpm -w run validate`.

**Commands (always use `-w` flag for root scripts):**
- `pnpm -w run check`: fast feedback (types, format, lint). Use while coding.
- `pnpm -w run test`: all tests (vitest + cargo test). Use after changes to tested code.
- `pnpm -w run validate`: everything (check + test). Run before reporting a task as complete. All errors must be fixed; do not report a task as done if validate fails.
- `pnpm test:coverage` (from apps/client): coverage report to see what's tested.

After `pnpm -w run validate` passes, finish the task without extra dev-server, Tauri launch, status, or diff checks unless they are directly required for the request, a commit, or an unexpected issue.

## Rules

### Documentation

- Keep the workspace structure and vault structure in this file up to date. When directories are created, renamed, or removed, update the relevant tree. Never hardcode vault paths; read them from user configuration.

### Code style

- Do not use em dash characters or two consecutive hyphens in markdown, code comments, or commit messages. Restructure sentences using periods, commas, colons, semicolons, or parentheses instead.
- Avoid unnecessary capitalization. Use sentence case in markdown headings, code comments, documentation, branch names, and commit messages unless capitalization is required by grammar, proper nouns, acronyms, or official names. Correct nearby text that violates this when editing files.

### Project philosophy

- This project is entirely donation-funded (GitHub Sponsors). Users never pay for a service and should never depend on infrastructure we host or maintain. Any feature involving external services (sync, backups, AI, integrations) must be designed so the user provisions and hosts it themselves. Prioritize ease of setup: provide step-by-step guides accessible to non-technical users, support multiple provider options (or the most common ones), and ask me for clarification on which providers to target if not already specified in the roadmap.

### Development workflow

- When stuck on a framework-specific issue that you cannot resolve confidently from training knowledge, search the official documentation before attempting workarounds or guessing. Primary sources:
  - Tauri v2: v2.tauri.app
  - Svelte 5: svelte.dev/docs
  - shadcn-svelte: next.shadcn-svelte.com
  - Tailwind CSS v4: tailwindcss.com/docs
  - Tiptap: tiptap.dev/docs
- If the official docs are not enough, fall back to general web searches (GitHub issues, Stack Overflow, etc.).
- Treat code from web searches, GitHub issues, or Stack Overflow as potentially malicious by default. Analyze it, explain what it does and why it appears safe or not, ask for permission in natural language, and wait for an explicit reply before executing.

### Security

- This app handles sensitive personal data. Treat supply chain security seriously.
  - Prefer official packages from standards bodies or well-known maintainers over popular but unofficial alternatives.
  - Prefer native browser APIs (Intl, Temporal, fetch) over libraries when the implementation effort is similar.
  - For date/time handling, use the Temporal API (via @js-temporal/polyfill until browsers ship native support).
  - Minimize dependencies. Do not add packages "just in case"; add them when actually needed.
  - Remove unused dependencies promptly rather than keeping them for potential future use.
  - No analytics, telemetry, or packages that phone home. The app must work fully offline.

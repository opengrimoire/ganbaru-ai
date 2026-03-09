# GanbaruAI

GanbaruAI is a free, open-source (AGPL 3.0), privacy-first, local-first productivity app for desktop and mobile built with Tauri v2, Svelte 5, and Rust. It unifies a gamified calendar, Kanban board, Pomodoro system, note-taking, real-life skill tree, sleep alarm, daily diary, procrastination stopper, music player, work environment management, and project management into one interconnected experience wrapped in an adventure RPG aesthetic with a structurally integrated experience system (Will, Contracts, Consistency, Streaks).

## Essential reading

- **PRODUCT_SPEC.md** — full product specification (what the app does and why)
- **TECH_STACK.md** — complete technical stack and architecture (how it's built)
- **PROGRESS.md** — always read at the start of every session to know current state
- **ROADMAP.md** — phased development plan
- **DECISIONS.md** — implementation decisions log

## Workspace structure

```
ganbaruai/
│
├── apps/
│   ├── desktop/                          ← Tauri app (Svelte frontend + Rust backend)
│   │   ├── src/                          ← Svelte frontend
│   │   │   ├── lib/                      ← shared frontend code
│   │   │   │   ├── components/           ← reusable Svelte components
│   │   │   │   │   ├── calendar/         ← Schedule-X wrappers, session block rendering
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
│   │   │   │   ├── stores/              ← Svelte runes ($state) — global app state
│   │   │   │   ├── api/                ← typed wrappers around Tauri invoke() calls
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
│   │   ├── static/                      ← static assets (fonts, icons, NPC sprites)
│   │   ├── src-tauri/                   ← Rust backend
│   │   │   ├── src/
│   │   │   │   ├── main.rs              ← shared entry point
│   │   │   │   ├── lib.rs               ← shared commands and logic
│   │   │   │   └── mobile.rs            ← mobile-specific Rust logic
│   │   │   ├── gen/                     ← auto-generated mobile projects
│   │   │   ├── capabilities/            ← permission declarations (desktop/mobile)
│   │   │   ├── tauri.conf.json          ← Tauri config
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
│   └── media-player/                    ← LGPL 2.1 Tauri plugin (Rust crate + npm)
│       ├── src/                         ← Rust source (ffmpeg-next, Symphonia)
│       ├── guest-js/                    ← TypeScript bindings for the frontend
│       ├── Cargo.toml
│       └── package.json
│
├── packages/
│   └── shared-types/                    ← TypeScript types shared across workspaces
│       ├── src/
│       └── package.json
│
├── extensions/
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
- **Frontend:** plain Svelte 5 with runes — not SvelteKit
- **Desktop/mobile shell:** Tauri v2
- **License:** AGPL 3.0 for the app, LGPL 2.1 for the media player plugin
- **Database:** SQLite via tauri-plugin-sql
- **Note format:** markdown files on disk (Tiptap editor)
- **State management:** Svelte 5 runes ($state, $derived, $effect) — no external state manager
- **Sync:** Yjs + Hocuspocus (CRDT-based, E2E encrypted)
- **Build tool:** Vite (default with Tauri + Svelte scaffold)

## Rules

- After every session where files are created, modified, or deleted, update PROGRESS.md before finishing.

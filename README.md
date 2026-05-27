<div align="center">
  <img src="apps/client/static/icon.png" alt="GanbaruAI icon" width="20%" />
  <h1>GanbaruAI</h1>

Anti-procrastination project manager for life and work. Free, local, open-source, privacy-first, lightweight with opt-in AI.

</div>

<p align="center">
  <a href="#features">Features</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#building-from-source">Building from source</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#contributing">Contributing</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#license">License</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#funding">Funding</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#acknowledgments">Acknowledgments</a>
</p>

> [!WARNING]
> The app is under heavy development and is unstable.

## Features

| Feature | Description | Status |
|---|---|---|
| **Calendar** | 100% custom-built with Svelte 5. Session blocks with drag-and-drop creation/resizing, day/week/month views, full RFC 5545 RRULE recurrence, auto-environment activation on block start | Available |
| **Pomodoro timer** | Focus/break phases, configurable cycle durations, timeline rail visualization, idle detection, suspend/wake handling, pre-break notifications | Available |
| **Kanban board** | Backlog/planned/in-progress/done columns, priority tiers (easy/medium/hard/epic), estimated pomodoro count, task-to-session linking | Available |
| **Note-taking** | Tiptap block editor with slash commands, markdown storage on disk, bidirectional backlinks indexed in SQLite | Planned |
| **Daily diary** | Morning and evening entry forms, mood/energy/sleep tracking, personal baselines for AI suggestions | Planned |
| **Doomscrolling** | Chromium-based development extension that blocks configured websites and category stacks during active Pomodoro focus sessions; Firefox, richer rules, and mobile app-level blocking are planned | Early desktop slice |
| **Work environments** | Saved configs per session block: apps to open/close, browser tabs, playlist, blocker rules. Auto-activated by the calendar | Planned |
| **Edge panel** | Always-on-top sidebar with live pomodoro timer, quick-add tasks, music controls, active environment name | Planned |
| **Music player** | Local file playback (Symphonia/FFmpeg), YouTube via IFrame API, playlists tied to session blocks and environments | Planned |
| **AI panel** | Embedded terminal (xterm.js) for Codex or another CLI coding agent, BYOK chat widget (OpenAI API, OpenAI-compatible providers, Ollama), calendar-driven session switching, context injection from app state | Planned |
| **Project management** | Lifecycle templates (brainstorming, evaluation, planning, execution), requirement version control, date cascade, report generation | Planned |
| **Sync** | Yjs CRDTs with self-hosted Hocuspocus server, E2E encryption, collaborative workspaces with live presence | Planned |
| **Mobile** | Tauri v2 Android and iOS builds, sleep alarm with diary integration, notification-based pomodoro | Planned |
| **Gamification** | Skill tree, XP system, Will metrics, self-imposed contracts, NPC-guided project workflows | Planned |

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full phased development plan.

## Building from source

### Prerequisites

- [Node.js](https://nodejs.org/) 24 LTS recommended. Node 22.12.0 or newer is also supported while Node 22 remains maintained.
- [Corepack](https://nodejs.org/api/corepack.html) enabled for the pinned [pnpm](https://pnpm.io/) 11 version in `package.json`
- [Rust](https://rustup.rs/) (stable)
- Tauri v2 system dependencies for your platform: [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
git clone https://github.com/opengrimoire/GanbaruAI.git
cd GanbaruAI
corepack enable
pnpm install
```

### Development

```bash
cd apps/client
pnpm tauri dev              # desktop app with hot reload
pnpm tauri android dev      # Android (planned)
pnpm tauri ios dev          # iOS (planned)
```

### Browser extension local testing

The Doomscrolling extension is tested as an unpacked Chromium extension during development. The same flow applies to Chrome, Chromium, Brave, and Edge. The browser-specific parts are the extensions page URL and the last argument passed to the native host registration script.

From the repo root, build the native messaging host:

```bash
pnpm -w run build:native-host
```

Open the browser's extensions page, enable developer mode, load the `extensions/chrome` folder as an unpacked extension, copy the extension id, then register the native host:

```bash
node apps/client/scripts/install-chrome-native-host.mjs <extension-id> <chrome|chromium|brave|edge>
```

For Brave, this helper builds the native host and opens the extensions page:

```bash
pnpm -w run setup:brave-extension
```

After first setup, keep `pnpm tauri dev` running, configure Settings > Doomscrolling in the app, keep Blacklist mode selected, start a Pomodoro focus session, and open a blocked website such as `reddit.com`.

For repeat testing:

- App UI changes usually hot reload through `pnpm tauri dev`.
- Rust command changes need `pnpm tauri dev` restarted.
- Native host changes need `pnpm -w run build:native-host`.
- Extension HTML, CSS, JS, manifest, or icon changes need the reload button on the extension card in the browser's extensions page.
- Doomscrolling mode, category, or website list changes are picked up by already open browser tabs on the next extension state poll.
- Removing and adding the unpacked extension gives it a new id, so the native host registration command must be run again.

### Build

```bash
cd apps/client
pnpm tauri build            # produces platform-specific installer
```

### Tests

```bash
pnpm -w run check      # types, Svelte diagnostics, Rust formatting, and clippy
pnpm -w run test       # Vitest and cargo tests
pnpm -w run validate   # full local validation gate
pnpm --dir apps/client test:watch
```

## Contributing

Contributions are welcome, but keep in mind:

- The app is in heavy early development. Architecture, APIs, and data models are still changing.
- Active testing is limited to **Ubuntu Linux** and **Windows 10**. macOS and iOS builds are untested since no Apple hardware is available for development, so contributions for those platforms are especially valuable.
- If you are considering a large change, open an issue first to discuss the approach.

## License

GanbaruAI is licensed under [AGPL-3.0](LICENSE).

## Funding

GanbaruAI is donation-funded. Sponsorship will be set up after a minimum stable version is ready for Linux, Windows, and Android.

## Acknowledgments

### Sound effects

Sound effects sourced from [Freesound](https://freesound.org/) under Attribution and CC0 licenses.

<!-- Add attributions as sounds are added: "sound name" by author (license) - URL -->

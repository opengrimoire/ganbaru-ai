# GanbaruAI

Anti-procrastination project manager for life and work. Free, local, open-source, privacy-first, lightweight with opt-in AI.

> **Status:** early development. The app is under heavy development and is unstable.

## What it does

GanbaruAI unifies productivity tools into one interconnected desktop app:

- **Calendar** with session blocks, drag-and-drop, recurring events (full RFC 5545 RRULE support)
- **Pomodoro timer** with focus/break phases, timeline visualization, idle detection, suspend/wake handling
- **Kanban board** with priority tiers and task-to-session linking

### Planned

- Note-taking (Tiptap editor, markdown storage, bidirectional backlinks)
- Daily diary (morning/evening entries, mood and energy tracking)
- Work environment management (app/tab switching, procrastination blocking)
- Music player (local files, YouTube integration)
- CLI and integrated terminal for AI-assisted workflows
- Project management lifecycle templates
- Multi-device sync (Yjs, E2E encrypted, self-hosted)
- Mobile (Android, iOS)
- Gamification (real-life skill tree, XP, contracts)

See [ROADMAP.md](ROADMAP.md) for the full phased development plan.

## Building from source

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 10
- [Rust](https://rustup.rs/) (stable)
- Tauri v2 system dependencies for your platform: [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
git clone https://github.com/VictorBenitoGR/GanbaruAI.git
cd GanbaruAI
pnpm install
```

### Development

```bash
cd apps/client
pnpm tauri dev              # desktop app with hot reload
pnpm tauri android dev      # Android (planned)
pnpm tauri ios dev          # iOS (planned)
```

### Build

```bash
cd apps/client
pnpm tauri build            # produces platform-specific installer
```

### Tests

```bash
cd apps/client
pnpm test         # run all unit tests
pnpm test:watch   # watch mode
```

## Contributing

Contributions are welcome, but keep in mind:

- The app is in heavy early development. Architecture, APIs, and data models are still changing.
- Active testing is limited to **Ubuntu Linux** and **Windows 10**. macOS and iOS builds are untested since no Apple hardware is available for development, so contributions for those platforms are especially valuable.
- If you are considering a large change, open an issue first to discuss the approach.

## License

[AGPL-3.0](LICENSE) for the app. The media player plugin (planned) will be licensed under [LGPL-2.1](https://www.gnu.org/licenses/lgpl-2.1.html).

## Funding

GanbaruAI is donation-funded. Sponsorship will be set up after a minimum stable version is ready for Linux, Windows, and Android.

## Acknowledgments

### Sound effects

Sound effects sourced from [Freesound](https://freesound.org/) under Attribution and CC0 licenses.

<!-- Add attributions as sounds are added: "sound name" by author (license) - URL -->

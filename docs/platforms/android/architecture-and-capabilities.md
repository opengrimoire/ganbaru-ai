# Android architecture and capabilities

## Composition

Android uses the Tauri mobile library entry and a mobile-specific Rust composition root. Vite selects a mobile frontend graph before Svelte mounts. A typed platform profile and immutable capability registry prevent desktop-only behavior from entering the Android runtime path.

The shared `main.ts` module selects the platform entry. Mobile configuration, vault activation, theme hydration, command registration, lifecycle, and adapter wiring belong to the mobile bootstrap and native composition.

## One Activity and WebView

The product uses one visible Activity and WebView. Feature navigation occurs inside the shared Svelte shell. Additional native services and providers do background or transfer work but do not create competing application shells.

Cross-window synchronization becomes a build-time no-op because Android owns one WebView. Detached desktop windows, preview webviews, tray, desktop media controls, and benchmark surfaces are absent.

## Build-time exclusion

The Android artifact does not compile or initialize:

- Desktop coding-agent provider processes.
- PTYs, terminals, Git workspaces, checkpoints, or filesystem observers.
- Desktop working-folder Markdown and generic native path pickers.
- Rodio and desktop media-control integration.
- Desktop loopback local-media hosting.
- Desktop process closing and browser native messaging.
- Desktop notifications, overlays, tray, updater, and benchmark harness.

This exclusion reduces artifact size and prevents dormant desktop authority from becoming reachable through a frontend mistake.

## Shared capability matrix

| Domain | Shared contract | Android adapter or restriction |
| --- | --- | --- |
| Vault | Marker, configuration, SQLite, managed assets, single-writer ownership | Application-private default, document-tree import, portable backup and restore, secure LAN handoff and read-only refresh |
| Calendar | Events, recurrence, reminders, projects, active runs | Native notification and alarm projection |
| Projects | Full local planning and task views | Responsive UI, no local coding working-folder execution |
| Notes | Pages, blocks, databases, history, links, assets | Responsive UI, document picker for bounded files, no working-folder Markdown |
| Chat | Channels, messages, replies, search, drafts, scheduling | Provider-free communication only; no local execution or workspace tools |
| Pomodoro | Canonical accepted runs, history and recovery in `ganbaru-focus` | Commitment reminders, accepted-phase deadline alarms and ongoing notification |
| Music | Canonical library, playlists, assignments, player state | Selected document tree and Media3 local audio; no desktop soundscape engine |
| Doomscrolling | Shared rule and usage-limit intent | Selected packages, Usage Access, Accessibility Home action, native journal, linked-device combined usage |
| Settings | Shared portable preferences | Platform equivalents and direct special-access recovery |
| Updates | Version and release information | Distribution source owns installation and updates; desktop updater absent |

## Mobile Chat

Android implements provider-free channels, messages, reply threads, search, drafts, scheduling, and durable review activity already present in a conversation. It does not launch Codex, Claude, Cursor, Grok, OpenCode, shells, terminals, or Git.

Future encrypted sync can make mobile a cross-device communication and review client. Remote execution must identify the authorized desktop or runner and never pretend work is executing on the phone.

## Feature ownership

Platform documentation defines only Android differences. Canonical feature behavior stays in:

- [Calendar](../../features/calendar/README.md)
- [Projects](../../features/projects/README.md)
- [Notes](../../features/notes/README.md)
- [Chat](../../features/chat/README.md)
- [Pomodoro](../../features/pomodoro/README.md)
- [Music](../../features/music/README.md)
- [Doomscrolling](../../features/doomscrolling/README.md)

## Future iOS alignment

iOS should reuse portable contracts while supplying its own native storage, background execution, notification, media, and permission adapters. Android-specific services, Accessibility behavior, or filesystem assumptions do not define the iOS product.

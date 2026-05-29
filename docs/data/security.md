# Security

Ganbaru AI handles deeply personal data: calendar, notes, mood, work patterns, and conversations with AI. Security here is not a feature checklist; it is a constraint on every other design decision. This doc covers the threat model, supply chain rules, sandboxing, the no-phone-home guarantee, and how to handle code copied from web sources.

## Threat model

The app must protect against:

1. **Local malware on the user's machine.** Exfiltration of vault contents or SQLite data via processes the user did not authorize.
2. **Compromised dependencies.** A malicious or compromised npm, pip, or cargo package executing during install or runtime.
3. **Supply chain attacks via external code.** Snippets the user (or AI agents) copy from web searches, GitHub issues, or Stack Overflow.
4. **Network observation of sync traffic.** Anyone between the user's devices and the sync server (ISP, government, a cafe Wi-Fi attacker) seeing or modifying the user's data in transit.
5. **Server-side observation of synced data.** The sync server operator (often the user themselves on a VPS) seeing data they should not have access to.

The app does **not** attempt to defend against:

- The user themselves modifying their own database files. The user owns their data.
- A determined attacker with physical access and unencrypted disk. Disk encryption is the OS's job.
- AI providers logging or training on the data the user sends them. This is the provider's policy; Ganbaru AI documents the choice and lets the user pick.

## Supply chain rules

These rules are enforced globally on the developer environment and reiterated in `AGENTS.md` so every contributor (and every AI agent) follows them.

**pnpm: ignore-scripts.** Lifecycle scripts (`postinstall`, etc.) are disabled by default. A package that needs a postinstall script (e.g. native bindings) must be explicitly allow-listed. This blocks the most common npm supply chain attack vector.

**pnpm: release-age gate.** npm packages published less than 3 days ago are rejected through `minimumReleaseAge: 4320` in `pnpm-workspace.yaml`. This gives compromised or suspicious releases time to be detected before they can enter the lockfile.

**pip: only-binary.** Source-distributed packages cannot run their `setup.py` at install time; only pre-built wheels are accepted. This blocks the analogous Python attack vector.

**cargo-audit.** Run on every dependency change. Known vulnerable crate versions are flagged.

**No analytics, no telemetry.** No SDK that phones home is acceptable. Even "anonymous usage statistics" libraries are rejected; the app must work fully offline and emit no network traffic the user did not initiate.

**Prefer official packages.** Standards bodies, well-known maintainers, and packages with a clear governance model are preferred over popular but unofficial alternatives.

**Prefer native APIs.** Browser/standard library APIs (Intl, Temporal, fetch) are preferred over libraries when implementation effort is similar. Fewer dependencies, smaller attack surface.

**Minimize dependencies.** Do not add packages "just in case." Add them when needed. Remove them when no longer needed.

**Flag new and unmaintained packages.** When suggesting new dependencies, the contributor (human or AI) must check download counts, last-publish dates, and maintenance status. Low-download or unmaintained packages are flagged before being recommended.

## Sandbox boundaries

Tauri capabilities define which APIs the frontend (Svelte) can call into the backend (Rust). The default capability set is narrow: no generic filesystem plugin permission, no shell access, no arbitrary process spawn, no opener permission, and only the window, event-listen, webview zoom, and global shortcut permissions needed by current UI code.

File import and export flows are backend-owned commands. Rust opens the native dialog, applies extension filters, validates the selected local path and size limit, then reads or writes the file. The frontend receives parsed text or a success flag, not an arbitrary path it can reuse later.

When a feature needs broader access (e.g. work environment management needs to launch other apps), the capability is added narrowly to the specific window or command, not granted globally.

The Tauri webview itself is hardened: production CSP allows bundled local assets and Tauri IPC only, blocks object and frame sources, disallows inline scripts, and currently allows inline styles for Svelte layout, theme, and calendar geometry bindings. The dev CSP remains more permissive for Vite and HMR, including local dev origins and `unsafe-eval`. IPC channels are validated by command name and parameter shape.

Calendar descriptions are the current app-owned rich HTML surface. The frontend and Rust backend both cap and sanitize descriptions before rendering or persistence, and closed event panels render only plain text previews in the main DOM.

## Current audit posture

The dependency refresh on 2026-05-14 updated the Tauri family to the latest compatible 2.x releases available to this workspace (`tauri` 2.11.1, `tauri-build` 2.6.1, `tauri-runtime` 2.11.1, `tauri-runtime-wry` 2.11.1, `tauri-utils` 2.9.1, `tauri-plugin-dialog` 2.7.1, `tauri-plugin-fs` 2.5.1, and related windowing crates). `cargo audit` reports no vulnerability findings, but it still reports allowed upstream warnings that are not removed by safe updates inside the current Tauri, Wry, GTK3, and parser dependency families:

- `RUSTSEC-2024-0411`, `RUSTSEC-2024-0412`, `RUSTSEC-2024-0413`, `RUSTSEC-2024-0414`, `RUSTSEC-2024-0415`, `RUSTSEC-2024-0416`, `RUSTSEC-2024-0417`, `RUSTSEC-2024-0418`, `RUSTSEC-2024-0419`, and `RUSTSEC-2024-0420`: gtk-rs GTK3 bindings are unmaintained. These remain through the Linux Tauri/Wry WebKit stack and the app's direct GTK overlay code (`gtk` and `gdk`). They should be removed when the upstream Tauri/Wry Linux stack and the local overlay implementation can move to maintained GTK4 bindings without replacing the runtime with a lower-trust alternative.
- `RUSTSEC-2024-0429`: `glib` 0.18.5 has an unsound iterator implementation. This remains through GTK3/WebKit dependencies. The app does not directly use the affected `VariantStrIter` APIs. Remove this warning when the GTK/WebKit stack reaches a `glib` release with the fix.
- `RUSTSEC-2024-0370`: `proc-macro-error` is unmaintained. This remains through `gtk3-macros` and `glib-macros`. Remove it when the GTK stack no longer pulls that macro crate.
- `RUSTSEC-2025-0057`: `fxhash` is unmaintained. This remains through `tauri-utils` → `kuchikiki` → `selectors`. Remove it when Tauri's utility parser stack replaces that dependency.
- `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098`, and `RUSTSEC-2025-0100`: `unic-*` crates are unmaintained. These remain through `tauri-utils` → `urlpattern`. Remove them when Tauri updates that URL pattern dependency path.
- `RUSTSEC-2026-0097`: `rand` 0.7.3 is unsound when a custom logger reenters thread-local RNG calls during reseeding. The remaining path is `tauri-utils` → `kuchikiki` → `selectors` → `phf_codegen` → `rand` 0.7.3. Ganbaru AI does not install a custom logger that uses `rand::thread_rng`; remove this warning when the upstream parser chain no longer depends on `rand` 0.7.
- `uds_windows` 1.2.0 is yanked through `notify-rust` → `zbus`. It is a transitive Windows crate in the notification stack. Remove it when `notify-rust` or `zbus` releases a compatible path without the yanked package.

The npm audit on 2026-05-14 reported no known vulnerabilities at the moderate level.

## No phone home

The app does not initiate any network traffic without an explicit user-configured destination:

- Sync goes to the user's chosen Hocuspocus server.
- AI calls go to the user's chosen provider (OpenAI API, OpenAI-compatible provider, another explicitly configured provider, or local Ollama).
- Doomscrolling extension only talks to the local Tauri backend.
- No update check, no crash report, no usage analytics, no font loading from CDNs, no analytics scripts in the webview.

A network filter (e.g. Little Snitch on macOS, an outbound firewall on Linux) should see no traffic from Ganbaru AI when the user has not configured sync or AI. This is testable, and it is part of the project's brand.

## Handling code copied from web sources

A specific class of supply chain attack exploits the human (or AI agent) habit of copying code from Stack Overflow, GitHub issues, or blog posts without auditing it.

The rule, documented in `AGENTS.md` and repeated to every contributing AI agent: code from web searches is treated as potentially malicious by default. Before executing or committing any web-sourced snippet, the agent must:

1. Read the snippet line by line and explain what it does.
2. Identify any operation that touches the file system, network, environment variables, or executes subprocesses.
3. Explain why the snippet appears safe or flag the specific concern.
4. Ask for explicit user permission in natural language before executing.
5. Wait for an explicit reply before proceeding.

This is friction by design. The cost of blindly running a malicious snippet on a system that holds the user's calendar, notes, diary, and AI conversation history is much higher than the cost of pausing to audit.

## Encryption

Sync uses end-to-end encryption via libsodium (see `data/sync.md`). Local data on disk is not application-encrypted; the app trusts the OS to handle disk encryption (LUKS, BitLocker, FileVault). This is the right tradeoff because:

- Application-level local encryption complicates backups and external tool access (the `ganbaru-ai` CLI would need the key to do anything useful).
- The OS already offers strong full-disk encryption that the user is more likely to have configured for everything else, not just Ganbaru AI.

Sensitive in-memory state (API keys, session tokens) is held in OS-level credential stores where available (libsecret on Linux, Keychain on macOS, Credential Manager on Windows), not in plain config files.

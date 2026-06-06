# Security

Ganbaru AI handles deeply personal data: calendar, notes, mood, work patterns, and conversations with AI. Security here is not a feature checklist; it is a constraint on every other design decision. This doc covers the threat model, supply chain rules, sandboxing, the no-phone-home guarantee, and how to handle code copied from web sources.

## Threat model

The app must protect against:

1. **Local malware on the user's machine.** Exfiltration of Ganbaru AI folder contents or SQLite data via processes the user did not authorize.
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

**cargo-audit.** Run through `pnpm -w run audit:rust` on every dependency or lockfile change and as part of `pnpm -w run validate:full`. Known vulnerable crate versions are flagged. Reviewed exceptions live in `.cargo/audit.toml`; each exception must stay narrow, have a written rationale in this document, and be removed when it is no longer needed.

**No analytics, no telemetry.** No SDK that phones home is acceptable. Even "anonymous usage statistics" libraries are rejected; the app must work fully offline and emit no network traffic the user did not initiate.

**Prefer official packages.** Standards bodies, well-known maintainers, and packages with a clear governance model are preferred over popular but unofficial alternatives.

**Prefer native APIs.** Browser/standard library APIs (Intl, Temporal, fetch) are preferred over libraries when implementation effort is similar. Fewer dependencies, smaller attack surface.

**Minimize dependencies.** Do not add packages "just in case." Add them when needed. Remove them when no longer needed.

**Flag new and unmaintained packages.** When suggesting new dependencies, the contributor (human or AI) must check download counts, last-publish dates, and maintenance status. Low-download or unmaintained packages are flagged before being recommended.

**Release workflow hardening.** Release jobs must avoid dependency caches, avoid mutable action tags, and keep write tokens separate from signing keys. The GitHub release workflow builds unsigned artifacts with read-only repository access, signs updater assets in the protected `release` environment, then publishes the draft release in a separate job with `contents: write`. After the GitHub Release is published, a separate protected job signs package repository metadata and pushes the Pages package repository. The Tauri updater private key is not present in the build, publish, or package repository jobs. The package repository GPG private key is not present in the build, updater signing, or draft publish jobs. Release jobs use fixed runner labels, full commit SHA action pins, `persist-credentials: false` on checkout, and explicit artifact handoff between jobs.

**Branch and tag protection.** Normal work must enter through pull requests to `dev`; direct pushes to `dev` and `main` are not part of the normal workflow. `main`, same-repository `release/*` branches, `app-v*` tags, the protected release environment, and published GitHub Releases are controlled by organization admins because they govern signed installers and the updater feed. The exact intended GitHub rulesets live in `docs/rulesets.md`. `pull_request_target` workflows must never checkout pull request code, install dependencies, restore or save caches, run build scripts, or read untrusted files. Do not add a `pull_request_target` workflow for branch routing unless a separate security review explicitly accepts the added privileged automation surface.

**Cache poisoning class.** The May 2026 TanStack npm compromise showed that a CI trust-boundary issue can become a release compromise: TanStack's postmortem describes a chain involving `pull_request_target`, GitHub Actions cache poisoning, token access from the runner process, and malicious package publication. This project treats caches, workflow files, release tags, environment approvals, and signing credentials as privileged supply-chain surfaces. Source: <https://tanstack.com/blog/npm-supply-chain-compromise-postmortem>.

## Sandbox boundaries

Tauri capabilities define which APIs the frontend (Svelte) can call into the backend (Rust). The default capability set is narrow: no generic filesystem plugin permission, no shell access, no arbitrary process spawn, no opener permission, and only the window, event-listen, webview zoom, and global shortcut permissions needed by current UI code.

File import and export flows are backend-owned commands. Rust opens the native dialog, applies extension filters, validates the selected local path and size limit, then reads or writes the file. The frontend receives parsed text or a success flag, not an arbitrary path it can reuse later.

When a feature needs broader access (e.g. work environment management needs to launch other apps), the capability is added narrowly to the specific window or command, not granted globally.

The Tauri webview itself is hardened: production CSP allows bundled local assets and Tauri IPC only, blocks object and frame sources, disallows inline scripts, and currently allows inline styles for Svelte layout, theme, and calendar geometry bindings. The dev CSP remains more permissive for Vite and HMR, including local dev origins and `unsafe-eval`. IPC channels are validated by command name and parameter shape.

Developer tools can be toggled with F12 or Ctrl + Shift + I in development builds. The backend command is guarded by Rust debug assertions, so production builds reject it.

Calendar descriptions are the current app-owned rich HTML surface. The frontend and Rust backend both cap and sanitize descriptions before rendering or persistence, and closed event panels render only plain text previews in the main DOM.

## Native overlay enforcement

The Pomodoro break and idle overlays use native desktop APIs only while a blocked screen is active. This is kiosk-lite enforcement, not OS policy control. The Svelte overlay remains the visual surface, and Rust owns temporary platform state through a guard that restores everything when the overlay closes or when the app restarts after stale Linux shortcut state.

On Windows, the app reinforces overlay webviews with `HWND_TOPMOST`, installs a scoped `WH_KEYBOARD_LL` hook to block normal shell switching chords, and uses `SetThreadExecutionState` to request that the display and system stay awake. The hook passes all non-blocked keys through immediately and does not use `BlockInput`, so keyboard and mouse input are not globally disabled. Secure attention and OS-level escape routes such as Ctrl+Alt+Del remain outside the app's control.

On macOS, the app sets overlay windows to the screen saver level, applies temporary AppKit presentation options that hide the Dock and menu bar and disable normal process switching and quit surfaces, and creates IOKit assertions for display and system idle sleep. The implementation does not use event taps, Accessibility permission, Input Monitoring permission, root access, or persistent profile or policy changes.

The direct macOS Objective-C bridge crates are target-only dependencies used for AppKit and Core Foundation calls in this enforcement layer. They are not loaded on Linux or Windows. The IOKit power calls use minimal FFI because the locked crates do not provide a cleaner high-level wrapper for these assertion APIs.

## Current audit posture

As of June 3, 2026, `pnpm -w run validate` is the normal code gate: type checks, linting, tests, and editor diagnostics. Dependency audits are separated into `pnpm -w run audit` and included in `pnpm -w run validate:full`, which is the gate for dependency or lockfile changes, PRs, releases, and explicit security checks. `pnpm -w run audit:deps` reports no known npm vulnerabilities at the low advisory level. `pnpm -w run audit:rust` uses `.cargo/audit.toml` and reports no unreviewed Rust vulnerability findings. The audit output omits dependency trees so routine validation stays readable; use `cargo tree` when reviewing a new advisory path. The current Rust audit still reports one reviewed vulnerability ignore and allowed upstream warnings that are not removed by safe updates inside the current SQLx, Tauri, Wry, GTK3, and parser dependency families:

- `RUSTSEC-2023-0071`: `rsa` 0.9.10 has a timing side-channel vulnerability. It appears through `sqlx-mysql`, which SQLx keeps in Cargo.lock for optional MySQL macro support. Ganbaru AI uses SQLite only, and `cargo tree` for the app target shows no active `sqlx-mysql` or `rsa` path. This advisory is ignored in `.cargo/audit.toml` because there is no fixed `rsa` upgrade in that SQLx path and the affected backend is not used by the app. Remove the ignore before enabling MySQL, when SQLx stops locking the optional backend path, or when a compatible fixed dependency path exists.

- `RUSTSEC-2024-0411`, `RUSTSEC-2024-0412`, `RUSTSEC-2024-0413`, `RUSTSEC-2024-0414`, `RUSTSEC-2024-0415`, `RUSTSEC-2024-0416`, `RUSTSEC-2024-0417`, `RUSTSEC-2024-0418`, `RUSTSEC-2024-0419`, and `RUSTSEC-2024-0420`: gtk-rs GTK3 bindings are unmaintained. These remain through the Linux Tauri/Wry WebKit stack and direct Linux integrations that still use `gtk` for media controls, tray image handling, and native black Pomodoro blocker windows on secondary monitors. The interactive Pomodoro overlay UI is Svelte-only, and the app no longer declares a direct `gdk` dependency. These warnings should be removed when the upstream Tauri/Wry Linux stack and the remaining local Linux integrations can move to maintained GTK4 bindings without replacing the runtime with a lower-trust alternative.
- `RUSTSEC-2024-0429`: `glib` 0.18.5 has an unsound iterator implementation. This remains through GTK3/WebKit dependencies. The app does not directly use the affected `VariantStrIter` APIs. Remove this warning when the GTK/WebKit stack reaches a `glib` release with the fix.
- `RUSTSEC-2024-0370`: `proc-macro-error` is unmaintained. This remains through `gtk3-macros` and `glib-macros`. Remove it when the GTK stack no longer pulls that macro crate.
- `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098`, and `RUSTSEC-2025-0100`: `unic-*` crates are unmaintained. These remain through `tauri-utils` and `urlpattern`. Remove them when Tauri updates that URL pattern dependency path.

The June 3, 2026 Rust compatible dependency update removed prior warnings for `fxhash`, `rand` 0.7.3, and yanked `uds_windows` 1.2.0 from the active lockfile. If any of those reappear, re-run `cargo tree` for the affected package before deciding whether to update, document, or ignore the advisory.

## Network defaults

The app does not send analytics, telemetry, crash reports, or usage data. Network traffic is limited to user-facing features with visible configuration:

- Sync goes to the user's chosen Hocuspocus server.
- AI calls go to the user's chosen provider (OpenAI API, OpenAI-compatible provider, another explicitly configured provider, or local Ollama).
- Doomscrolling extension only talks to the local Tauri backend.
- Release builds check the configured GitHub Releases feed at most once per day by default to notify the user when an update is available. Users can turn this off in Settings, Updates. The app never downloads or installs updates until the user chooses that action. Linux package-manager installs (`.deb`, `.rpm`, and AUR packages) do not expose in-app installation because the Linux updater artifact is the AppImage. They show a copyable package-manager command instead, and the app never executes `sudo` or package-manager commands.
- The update prompt can open the matching GitHub Release page in the default browser. The Tauri opener permission is scoped to Ganbaru AI release pages, not broad HTTP or HTTPS URL opening.
- No crash report, no usage analytics, no font loading from CDNs, no analytics scripts in the webview.

A network filter (e.g. Little Snitch on macOS, an outbound firewall on Linux) should see only the configured update check in a release build when the user has not configured sync or AI. Opening release notes can also open the matching GitHub Release page in the user's default browser. Turning off update notifications returns the app to no external traffic unless the user starts a manual update check, opens release notes from an already visible update prompt, or configures another network feature.

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

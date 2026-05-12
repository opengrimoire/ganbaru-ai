# Security

GanbaruAI handles deeply personal data: calendar, notes, mood, work patterns, and conversations with AI. Security here is not a feature checklist; it is a constraint on every other design decision. This doc covers the threat model, supply chain rules, sandboxing, the no-phone-home guarantee, and how to handle code copied from web sources.

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
- AI providers logging or training on the data the user sends them. This is the provider's policy; GanbaruAI documents the choice and lets the user pick.

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

Tauri capabilities define which APIs the frontend (Svelte) can call into the backend (Rust). The default capability set is minimal: file system access scoped to the vault directory, no shell access, no arbitrary process spawn.

When a feature needs broader access (e.g. work environment management needs to launch other apps), the capability is added narrowly to the specific window or command, not granted globally.

The Tauri webview itself is hardened: CSP set to disallow inline scripts and untrusted origins, devtools disabled in release builds, IPC channels validated by command name and parameter shape.

## No phone home

The app does not initiate any network traffic without an explicit user-configured destination:

- Sync goes to the user's chosen Hocuspocus server.
- AI calls go to the user's chosen provider (OpenAI API, OpenAI-compatible provider, another explicitly configured provider, or local Ollama).
- The procrastination stopper extension only talks to the local Tauri backend.
- No update check, no crash report, no usage analytics, no font loading from CDNs, no analytics scripts in the webview.

A network filter (e.g. Little Snitch on macOS, an outbound firewall on Linux) should see no traffic from GanbaruAI when the user has not configured sync or AI. This is testable, and it is part of the project's brand.

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

- Application-level local encryption complicates backups and external tool access (the `ganbaruai` CLI would need the key to do anything useful).
- The OS already offers strong full-disk encryption that the user is more likely to have configured for everything else, not just GanbaruAI.

Sensitive in-memory state (API keys, session tokens) is held in OS-level credential stores where available (libsecret on Linux, Keychain on macOS, Credential Manager on Windows), not in plain config files.

# Dependency audit posture

This file records reviewed Rust advisory exceptions and the most recent known audit snapshot. Lockfiles and current command output are authoritative. Re-run the audits before relying on this snapshot.

Snapshot checked on 2026-09-12:

- pnpm -w run audit:deps reports no known npm vulnerabilities at the low advisory level after updating Vitest and its coverage integration to 4.1.11 for GHSA-82fw-gwwq-j7x9.
- pnpm -w run audit:rust exits successfully with three configured vulnerability ignores and 10 allowed warnings.

GitHub Dependabot also reported GHSA-7gcf-g7xr-8hxj for serde_with 3.20.0. Cargo audit did not include that advisory in its RustSec database at the time of review. The lockfile now resolves serde_with and serde_with_macros 3.21.0, which contains the upstream fix.

The `ganbaru-focus` extraction uses existing workspace dependencies and adds no third-party package. The findings below remain unresolved; this extraction does not change their disposition or the audit protections.

The Rust command's successful exit does not mean warning-free. The current cargo-audit output policy allows warnings, so maintainers must review new unsound, unmaintained, and yanked findings separately.

## Commands and gates

- pnpm -w run audit:deps checks workspace npm dependencies.
- pnpm -w run audit:rust checks Cargo.lock using .cargo/audit.toml.
- pnpm -w run audit runs both audits.
- pnpm -w run validate:full runs dependency audits followed by the normal code gate.

Run validate:full for dependency, lockfile, release, audit, and other security-sensitive work. Do not add or broaden an ignore merely to make the command green.

## Configured vulnerability ignores

The following advisories are ignored in .cargo/audit.toml after path review. Each ignore is conditional and must be removed when its assumptions no longer hold.

### RUSTSEC-2023-0071, rsa timing side channel

Cargo.lock contains rsa 0.9.10 through SQLx's optional MySQL macro support. Ganbaru AI uses SQLite. Current application dependency trees do not activate sqlx-mysql or rsa in the shipped database path.

The ignore is valid only while MySQL remains disabled and no reachable application path uses rsa. Remove it before enabling MySQL, when SQLx no longer locks the affected optional path, or when a compatible fixed path is available.

### RUSTSEC-2026-0194 and RUSTSEC-2026-0195, quick-xml denial of service

Affected quick-xml versions are locked through constrained dependency paths:

- wayland-scanner uses quick-xml while parsing dependency-owned Wayland protocol XML during compilation;
- tauri-winrt-notification uses its XML escaping helper to construct Windows notifications and does not invoke the affected reader, duplicate-attribute, or namespace parsing paths.

The ignored parsing behavior is not reachable from user-controlled runtime XML in those paths. Remove the ignores when the relevant Wayland and notification dependencies accept fixed quick-xml releases or if a new runtime parser reaches an affected version.

## Allowed upstream warnings

### GTK3 and GLib

The audit reports the GTK3 family as unmaintained:

- RUSTSEC-2024-0411 through RUSTSEC-2024-0420 for the affected atk, gdk, gtk, and related sys or macro crates;
- RUSTSEC-2024-0429 for unsound iteration in glib 0.18.5;
- RUSTSEC-2024-0370 for unmaintained proc-macro-error.

These remain through the Linux Tauri and Wry WebKit stack and current native Linux integrations. Ganbaru AI does not directly use the affected glib VariantStrIter API. Remove the warnings when the upstream stack and local integrations can move to maintained compatible bindings without replacing them with a broader or less trustworthy runtime.

### UNIC crates

The audit reports RUSTSEC-2025-0075, RUSTSEC-2025-0080, RUSTSEC-2025-0081, RUSTSEC-2025-0098, and RUSTSEC-2025-0100 for unmaintained unic crates. They remain through Tauri's URL pattern dependency path. Remove them when the upstream dependency graph no longer requires those crates.

### RUSTSEC-2026-0221, event-listener unsoundness

event-listener 5.4.1 is present through several active paths, including zbus, async-process, SQLx core, opener and single-instance integrations, native notifications, credential storage, and the agent client protocol. The advisory concerns a Send-boundary unsoundness in StackSlot.

This is a current unresolved warning, not a reviewed ignore. Before a release or dependency update, check the advisory's fixed versions and the reachable APIs in each active path, update compatible parents where possible, and record any temporary residual risk. Do not describe the Rust audit as having only unmaintained warnings while this finding remains.

### Yanked chacha20 0.10.1

The yanked version is present through rand 0.10.2 and rmcp 3.0.0 in the internal MCP dependency path. A yanked release is not automatically a known vulnerability, but it requires review of the yank reason and compatible parent updates. Prefer an upstream rmcp or rand resolution rather than forcing an incompatible transitive version.

### Yanked spin 0.9.8

The yanked version is present through flume 0.11.1 and SQLx SQLite. Review compatible SQLx or flume updates and the yank reason. Do not add a direct dependency override without verifying feature and platform behavior.

## Review procedure

For a new finding:

1. Record the advisory, affected version, and finding class.
2. Use cargo tree with the exact package version to identify all reverse paths.
3. Determine whether the vulnerable API is compiled, shipped, and reachable from untrusted input.
4. Prefer a compatible upstream update and run the full dependency gate.
5. If no safe update exists, document the exact unreachable or mitigated path and the condition that ends the exception.
6. Add a configured ignore only for a vulnerability advisory with a reviewed rationale. Do not ignore broad warning categories.
7. Revisit every exception during dependency work and before releases.

An old date or prior clean result is not evidence for the current lockfile. Keep this page focused on active exceptions and material warnings, removing resolved entries when the audit no longer reports them.

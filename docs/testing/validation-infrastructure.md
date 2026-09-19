# Validation infrastructure

This document explains the resource, ordering, caching, and production-build constraints behind the commands in [Testing](README.md).

## Rust baseline

The workspace uses Rust edition 2024 and Cargo resolver 3. `Cargo.toml` declares Rust 1.98 as the supported minimum; `rust-toolchain.toml` pins compiler 1.98.0 with Clippy and rustfmt for local, pull request, and release validation. Shared package metadata is inherited from the workspace, while package versions remain independent. `rustfmt.toml` explicitly selects the 2024 formatting style for consistent CLI and editor output. Format the entire Rust workspace with `cargo fmt --all`.

Run commands through rustup without a conflicting toolchain override. CI installs the repository-selected toolchain with `rustup show`, then adds the targets required by each job. A Linux gate does not replace the independent Windows composition check or Android APK build. macOS and iOS are future platforms and are not validated by these jobs.

Toolchain or edition changes require `validate:full` and the platform checks. Compatibility diagnostics must be reviewed for temporary lifetimes, lock and resource cleanup, and native unsafe boundaries rather than fixed mechanically to suppress warnings.

The shared Clippy policy allows `collapsible_if`: nested guards and edition-2024 let-chains are both valid styles. Choose the form that makes control flow and resource scope clearest. This avoids a mandatory rewrite of existing guards merely because the edition now permits let-chains. Other compiler and Clippy warnings remain errors in the normal gate; dependency audit policy is unchanged.

## Root execution order

The complete normal gate runs in this order:

1. Rust formatting and Clippy with one Cargo build job.
2. Rust workspace tests with one Cargo build job and one runtime test thread.
3. Svelte Check with a 1,792 MiB Node old-space limit, then TypeScript checking.
4. Four sequential one-worker Vitest shards, excluding benchmark-harness tests.
5. Tailwind diagnostics through Turbo.
6. Desktop and Android production builds and bundle contracts through Turbo.

Rust runs first because compiler and linker peaks are less predictable. Rust and frontend tools do not overlap. Sequential Vitest shards release transformed module graphs between groups.

The hosted Linux pull request and merge-queue job runs this same complete gate. It does not substitute static checks for regression tests or bundle contracts.

Benchmark fixture and harness contracts are deliberately outside `validate`. Run `pnpm -w run test:benchmark-contracts` when changing the harness. Performance measurement remains manual release-build work.

## Resource policy

The 1,792 MiB Svelte Check heap is the lowest measured stable limit for the current full graph. Treat exhaustion as a controlled failure. Investigate graph growth and checker topology before raising it.

Cargo development and test profiles retain line-level debugging with reduced debug detail. One-job development builds prevent competing compiler or linker peaks. Restore full native debug information only for a concrete debugging session:

```sh
CARGO_PROFILE_DEV_DEBUG=full CARGO_BUILD_JOBS=1 pnpm --dir apps/client tauri dev
```

The repository-owned Tauri wrapper sets one Cargo build job for development commands when the caller has not supplied one. On Wayland it removes an inherited exact `GDK_BACKEND=x11` override unless `GANBARU_AI_DEV_PRESERVE_GDK_BACKEND=1` is set. Android commands select JDK 21, with `GANBARU_AI_ANDROID_JAVA_HOME` as the explicit override.

Persistent swap is a system safety margin, not a replacement for bounded jobs. Do not clear Cargo or Turbo caches as a routine memory fix.

## Cache behavior

Cargo reuses compatible compilation artifacts, but tests still execute. Turbo hashes declared inputs, configuration, environment inputs, and command arguments. Each Vitest shard has a distinct cache key. Bundle contracts cache their declared build output.

A warm run may restore frontend tasks while a cold or changed run performs substantially more work. A fast cached result is not evidence that a cold build has the same resource profile.

When changing validation topology, measure at least one affected cache-miss run and one warm repeat. Confirm both coverage and invalidation.

## Production bundle contracts

Unit tests cannot prove the final production import graph. The bundle contract performs real Vite builds and inspects emitted module metadata.

Desktop and Android builds use different platform entries. The Android wrapper sets the platform before Vite configuration loads and writes to the isolated `.bundle-contracts/android/` directory. Contracts verify required roots and platform adapters, follow static imports transitively, enforce source-module ceilings, and reject desktop-only authority from the mobile artifact.

The Android artifact intentionally includes mobile Doomscrolling, notification, document, and media adapters. It rejects desktop Doomscrolling process control, the desktop App shell, PTYs, Git and provider execution, Rodio, desktop media controls, tray and title bar code, benchmark surfaces, desktop working-folder tools, and heavy editor graphs that are not part of the mobile route.

The machine-readable ceilings and required or forbidden module sets are authoritative in:

- `apps/client/scripts/first-use-bundle-baseline.json`
- `apps/client/scripts/android-bundle-baseline.json`

The current Projects, Notes, and Chat desktop route ceiling is 361 source modules. The shared route graph includes the vault ownership store and read-only ownership banner so every primary surface immediately reflects a handoff. It also includes the component-scoped teammate editor controller, extracted to test draft preservation, access confirmation, and revision-conflict recovery independently of rendering. That controller and its existing settings component remain in the same emitted chunk, and its dependencies were already imported by the component. Excluding the extracted file restores the prior 360-module count for all three routes. The ceiling has no extra headroom, and required and forbidden loading boundaries remain unchanged. Changes to a ceiling require a concrete user-visible rationale and should remove obsolete narrative rather than accumulating a chronology in documentation.

Android ceilings include the three theme modules and three Notes block modules behind their existing public APIs. These splits preserve theme editing, import/export, and the supported Notes block operations while separating their maintenance boundaries. The production graph contains 1,008 source modules; excluding the six extracted files brings every destination back within its previous ceiling. Route limits match the measured graph without extra headroom. Required mobile modules and forbidden platform imports remain enforced unchanged.

## Android project and pull request build

The generated-project contract verifies pinned Gradle, Android Gradle Plugin, Kotlin, SDK, NDK, Java, application identifiers, manifests, backup exclusions, provider paths, and Rust task behavior.

The independent pull request job builds one ARM64 debug APK on the pinned Ubuntu and Android toolchain with Rust warnings denied. It intentionally targets the reference-device ABI to bound pull request cost. The protected release workflow builds every supported ABI into signed universal APK and AAB artifacts.

Run the direct Android package contract with:

```sh
pnpm --dir apps/client run check:android-bundle
```

The root bundle contract builds desktop first, then Android through Turbo.

## Provider protocol snapshots

Routine checks validate committed provider compatibility artifacts without requiring globally installed tools. A recorded CLI version is provenance for a snapshot, not a developer installation requirement.

Provider maintenance can compare an installed Codex app-server schema with the committed snapshot:

```sh
pnpm --dir apps/client run check:codex-protocol-installed
```

Use `generate:codex-protocol` only after reviewed protocol change.

## Changing validation topology

Before changing concurrency, sharding, ordering, heap limits, cache inputs, profiles, or target selection:

1. Record the current command topology and task counts.
2. Run the proposed command with representative changed inputs.
3. Confirm that no test files, Cargo targets, bundle roots, or platform checks disappear.
4. Compare wall time, peak memory, and swap use.
5. Repeat with warm caches.
6. Preserve portable standard-toolchain behavior.
7. Update root scripts, task configuration, `AGENTS.md`, and documentation together.

Prefer orchestration and bounded execution changes before removing coverage.

## Troubleshooting

Reproduce the first failed broad stage with the narrowest relevant command. Do not start another broad command while the original gate is active.

If a focused Vitest command collects the full suite, stop and correct its path or argument placement. If a Turbo result appears stale, inspect declared inputs and the task hash before disabling caching. If Cargo work becomes unexpectedly large, confirm the intended package and library or binary target and keep frontend tools stopped during diagnosis.

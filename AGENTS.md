# Ganbaru AI

Ganbaru AI is an anti-procrastination + anti-burnout productivity app. Free, local, open-source (AGPL 3.0), privacy-first, lightweight with opt-in AI. It is built with Tauri v2 (Rust) and Svelte 5 for Linux, Windows, and an active pre-release Android implementation. macOS and iOS remain future platform work.

Features are highly interconnected. Current status:

- Calendar (work in progress; the main views and workflows exist, while recurrence and Pomodoro transition persistence need correctness hardening)
- Pomodoro (work in progress; the timer lifecycle and platform surfaces exist, while transition persistence and idle-source failure handling need hardening)
- Quick notes and themes
- Doomscrolling (work in progress; browser, desktop, and selected Android application enforcement exist)
- Music player (work in progress; desktop and Android local playback, playlists, source parsing, controls, and platform integrations exist)
- Localization (work in progress; English and Spanish catalogs with language preferences exist)
- Projects (work in progress; SQLite-backed planning, task views, scheduling, settings, history, templates, and custom fields exist)
- Note-taking (work in progress; SQLite-backed pages, blocks, databases, templates, history, links, comments, assets, and transfer workflows exist)
- Chat and local coding-agent execution (work in progress; durable project channels, provider sessions, access profiles, workspace tools, terminals, checkpoints, and review exist)
- Android (work in progress; an adaptive app shell and native integrations exist, but release readiness remains incomplete)
- Sleep alarm (pending)
- Daily diary (pending)
- Work environments and sync (pending)
- Gamification (deferred)

## Essential reading

All documentation lives in `docs/`. Start with `docs/README.md`, which routes readers by decision type and defines the documentation status vocabulary.

- **docs/product/**: product direction, principles, scope, and system ownership
- **docs/features/**: current and planned user-facing feature behavior
- **docs/ROADMAP.md**: delivery horizons, active gaps, and deferred areas
- **docs/architecture/**: current code, platform, and integration boundaries
- **docs/data/**: sources of truth, schema domains, invariants, authorization, hazards, security, and sync
- **docs/algorithms/**: pure-logic specifications and worked examples
- **docs/interop/**: standards scope, preservation rules, conformance, fixtures, and client observations
- **docs/platforms/**: platform-specific capability, UX, delivery, and acceptance contracts
- **docs/performance/**: benchmark methodology and recorded measurements
- **docs/testing/**: validation gates, infrastructure, test design, caching, and resource constraints
- **docs/operations/** and **CONTRIBUTING.md**: branch, PR, ruleset, and release workflow

Docs can describe both the current implementation and the intended end state, but they must label that distinction explicitly. They preserve durable behavior and the reasons behind decisions instead of mirroring private implementation details. When implementation work discovers a better product direction than an older spec, update the relevant spec. When meaningful behavior has no suitable spec, create the smallest appropriate document instead of leaving design intent only in code or chat. `AGENTS.md` carries durable repository context; detailed product, data, algorithm, platform, and operational behavior belongs in the corresponding documentation area.

## Workspace structure

> Update this architectural map when directories are created, renamed, or removed. It lists existing source paths unless an entry is explicitly marked as planned.

```
.github/
  CODE_OF_CONDUCT.md: GitHub community behavior policy
  ISSUE_TEMPLATE/: GitHub issue forms and template chooser config
  SECURITY.md: GitHub security policy and private vulnerability reporting instructions
  workflows/: GitHub Actions CI and release workflows
  release.yml: generated GitHub Release notes config
  release-notes-template.md: maintainer template used to draft release descriptions
  pull_request_template.md: default GitHub pull request template
docs/
  README.md: documentation index, status vocabulary, and ownership rules
  product/: product direction and cross-system ownership
  features/: user-facing behavior, grouped by large feature domain
  architecture/: current code boundaries and durable technical decisions
  data/: storage, schema domains, authorization, invariants, hazards, security, and sync
  algorithms/: deterministic Calendar and Pomodoro logic
  interop/: external standards, conformance, fixtures, and client observations
  platforms/: Android and desktop-specific product contracts
  performance/: benchmark methodology and immutable results
  testing/: validation gates, infrastructure, authoring guidance, and manual matrices
  operations/: repository policy, release, signing, and distribution procedures
  development/: small contributor-facing implementation references
  assets/: documentation images
  ROADMAP.md: delivery horizons and deferred product areas
apps/
  client/: Tauri app (Svelte frontend + Rust backend)
    src/: Svelte frontend
      lib/: shared frontend code
        components/: reusable Svelte components
          benchmark/: benchmark overlay and diagnostics components
          calendar/: calendar views, event editing, recurrence, import, and session block rendering
          chat/: local coding-agent shell, timeline, composer, interactive requests, inspector, file browser, terminal, navigation, and archive
          icon-picker/: shared icon, emoji, custom emoji, and image picker
          music/: player controls, source parsing, playlist management surfaces
          mobile/: adaptive phone and tablet shell, navigation, status, and overlays
          notes/: Notes navigation, editor, databases, history, transfer, and project surfaces
          perf/: memory and performance diagnostics surfaces
          pomodoro/: timer display, controls, break screen, and idle overlay
          profile/: shared local profile avatar surfaces
          projects/: project navigation, planning views, task details, and settings
          quick-notes/: Quick notes panel, masonry cards, editor, and color controls
          settings/: shared desktop and mobile settings controller, platform renderers, theme editor, preferences, and optional tools
          title-bar/: application title bar and window controls
          ui/: shared generated shadcn-svelte primitives
          updates/: app update UI
          vault/: data folder setup and active-folder UI
        api/: typed wrappers around Tauri commands and asset URL handling
          chat.ts, chat-coordination.ts, chat-session.ts, chat-settings.ts, chat-workspace.ts, chat-workspace-observer.ts: split Chat command clients by backend domain
          notes.ts, notes/: stable Notes API facade and split workspace, knowledge, collaboration, template/history, transfer, database, content, and working-Markdown command clients
        benchmark/: benchmark runner, samplers, output, scenarios
        calendar/: shared calendar logic and iCalendar parser/serializer
        chat/: local coding-agent contracts, runtime validation, workspace controller, inspector and terminal models, and API boundaries
          contracts/: provider-neutral commands, events, models, and read DTOs
          validation/: bounded parsers for untrusted Chat responses and events
          composer-controller.ts, composer-model.ts, inspector-model.ts, review-model.ts, terminal-model.ts, timeline-model.ts: split interaction and presentation models and controllers
          file-editor-session.svelte.ts, review-session.svelte.ts, workspace-panel-tabs.svelte.ts: stateful editor, review, and workspace controllers
          teammate-editor-controller.svelte.ts: component-scoped teammate drafts, revision checks, and save/conflict recovery
        data/: shared static/domain data helpers
        doomscrolling/: shared browser and desktop blocking rules
        hooks/: reusable Svelte hooks
        i18n/: typed localization catalogs, locale resolution, formatters
          messages/: split locale catalog entry points, domain modules, and shape tests
        music/: frontend music source and playback helpers
        notes/: Notes contracts, validation, editor operations, databases, and tree helpers
          block-factory.ts, block-payloads.ts, block-queries.ts, block-updates.ts: stable block API and separate payload creation, inspection, and edit operations
          contracts/: typed Notes DTO families and view models
          validation/: split validation helpers
        pomodoro/: adaptive rhythm and Pomodoro domain logic
        profile/: local profile identity helpers
        projects/: project planning, view, settings, icon, and task domain logic
        quick-notes/: Quick notes contracts, rich-text operations, masonry, persistence, and window sync
        scheduling/: lifecycle and notification schedulers
        stores/: Svelte rune stores and domain controllers for active runtime state
          themes.ts, themes/: stable theme API, definitions, color derivation, and JSON transfer
          chat.svelte.ts, chat-communication-controller.svelte.ts, chat-organizational-controller.svelte.ts, chat-timeline-controller.svelte.ts: root Chat state and split communication, organization, and timeline controllers
        types/: frontend-specific TypeScript types
        utils/: shared helpers, formatters
        vault/: frontend data folder config and state
        windows/: detached window helpers
      App.svelte, MobileApp.svelte: desktop and mobile Svelte shell roots
      main-desktop.ts, main-mobile.ts, main.ts: platform bootstraps and virtual entry selector
      app.css, app.d.ts, virtual-modules.d.ts: global styles and type declarations
    static/: static assets (fonts, icons, sounds)
    scripts/: repo-owned maintenance and diagnostics scripts
    src-tauri/: Tauri package, build script, configuration, and platform entries
      src/
        main.rs: thin desktop entry that invokes ganbaru-tauri-app
        lib.rs: mobile-only Tauri entry that preserves Android and iOS library outputs
      app/: ganbaru-tauri-app ordinary Rust library
        src/: Tauri commands, managed state, setup and exit hooks, and platform integrations
          desktop_runtime.rs, mobile_runtime.rs: platform-specific Tauri composition roots
          db.rs, db_path.rs, vault.rs, vault/: active-folder authorization, SQLite adapter boundary, and portable Android backup and restore
            config.rs, documents.rs: bounded vault config mutations and native Calendar/theme document transfer behind the vault command facade
            handoff/: local single-writer linking, ownership transfer, refresh, and recovery
              state/, state.rs: one pairing-state owner with split transfer operations, persistence validation, and restart tests
              coordinator/, coordinator.rs: serialized coordinator dispatch with separate outgoing and incoming transfer workflows
              transport/, transport.rs: pinned client and shared streaming transport, desktop server adapter, and transport tests
          calendar_events/, calendar_import/, calendar_reads/: split calendar persistence, import, and query services
          calendar_description.rs, calendar_import.rs, calendar_reads.rs, calendars.rs, recurrence.rs: calendar command roots and shared logic
          chat.rs, chat/: desktop Tauri Chat adapters, application command flows, and platform integrations
            coordination_commands/, send/, interaction/: messages, scheduling, turn orchestration, attachments, drafts, and follow-ups
            coordination_commands/access/: access-profile lifecycle, assignment targets, channel access resolution, and retained-reference disclosure checks
            internal_mcp_tools/: live authorization, invocation audits, bounded channel reads, and workspace operations behind the internal host-tool dispatcher
            scratch_commands/: scratch inspection, explicit artifact promotion, and confirmed cleanup behind the public command facade
            checkpoints/, restore_commands/: authorization cleanup and restoration workflows over the core Chat service
            preview/, workspace_observer/: browser previews, webviews, and workspace change observation
            settings/: provider discovery, native credentials, preferences, model mapping, and pickers
            tests/: Tauri integration tests
          chat_mobile.rs: mobile-compatible Chat configuration and vault contract surface
          notes.rs, notes/: Notes Tauri command adapters, working-Markdown composition, dialogs, and asset authorization
          pomodoro.rs: authorized Tauri focus command adapters over ganbaru-focus
          projects.rs, projects/: project commands, DTOs, persistence, validation, history, custom fields, and templates
          quick_notes/: Quick notes commands, normalized text runs, lifecycle, search, and tests
          notification.rs, notification/: notification commands, scheduling, and platform delivery
          pomodoro_enforcement.rs, tray.rs: timer overlays and tray integration
          doomscrolling.rs, doomscrolling/: browser and desktop blocking commands, runtime helpers, and tests
          media_player.rs, media_controls.rs, media_controls/, music.rs, music/: local playback, platform media-control adapters, metadata, and music commands
          project_icons.rs: managed project icon assets
          themes.rs, updates.rs: theme validation and application updates
          benchmark_seed.rs, first_use_contracts.rs: benchmark data and first-use query contracts
      migrations/: embedded SQLx SQLite migrations
      package-repo/: generated package repository public key staging (ignored)
      package-scripts/: Linux package lifecycle scripts for repo registration
      capabilities/: permission declarations (desktop/mobile)
      gen/
        android/: generated Android project and native platform integration
        schemas/: generated Tauri schema files
      examples/: Rust example targets
      icons/: app icons
      build.rs, tauri.conf.json, tauri.dev.conf.json, tauri.android.conf.json, Cargo.toml
    index.html, package.json, svelte.config.js, vite.config.ts, tsconfig.json
crates/
  ganbaru-mobile-doomscrolling/: Android launchable-app discovery, explicit access settings, foreground app enforcement, and durable usage journal plugin
  ganbaru-mobile-documents/: Android MediaStore export and bounded document-picker transfer plugin
  ganbaru-mobile-media/: Android Media3 playback and selected music document-tree plugin
  ganbaru-mobile-notifications/: Android Calendar notification scheduling, channel, tap, exact-alarm, and settings adapter
  ganbaru-working-folders/: Tauri-free working-folder IDs, repository kinds, timestamps, bindings, and device-state operations
  ganbaru-db/: Tauri-free SQLite pool registry, connection configuration, migrations, row macro, and schema tests
  ganbaru-focus/: Tauri-free focus persistence, history, validation, recovery, and local activity admission
  ganbaru-chat-contracts/: stable provider-neutral Chat IDs, commands, events, DTOs, errors, and Serde contracts
  ganbaru-chat-providers/: provider processes, transports, drivers, event sinks, cancellation, and registry
  ganbaru-chat/: Chat persistence, runtime, Git workspaces, checkpoints, review, source control, and application services
  ganbaru-notes/: Notes domain, persistence, transfers, history, assets, validation, and bounded filesystem operations
  ganbaru-native-messaging/: independent ganbaru-ai-native-messaging binary and tests
    src/config.rs, rules.rs, snapshot.rs, events.rs: configuration validation, typed browser decisions, device snapshot freshness, and event persistence
packages/
  shared-types/: TypeScript types shared across workspaces
extensions/
  chrome/: Chrome extension (manifest v3)
  chrome-dev/: generated dev extension copy (ignored)
Cargo.toml: cargo workspace root
turbo.json: Turborepo task config
pnpm-workspace.yaml: workspace definition
package.json: root scripts, shared dev dependencies
```

Planned top-level work that does not have source directories yet includes the self-hosted sync server and Firefox extension. Planned product surfaces such as the diary, BYOK assistant, edge panel, sleep alarm, work environments, and gamification also do not have component directories yet.

## Ganbaru AI folder structure

> Everything the app produces belongs to one active Ganbaru AI vault. On desktop, production defaults to `Documents/Ganbaru AI` and development defaults to `Documents/Ganbaru AI Dev`, unless the user selects another location. Android keeps the active vault in application-private storage. The logical skeleton below applies to each vault. Asset subdirectories are created on demand. Planned paths are explicitly labeled.

```
Ganbaru AI/
  vault.json: internal Ganbaru AI folder marker, id, display name, and schema version
  config.json: folder-local user preferences, UI state, and Doomscrolling settings
  ganbaru-ai.sqlite: SQLite source of truth for structured data, Notes, and indexes
  notes/: document directories reserved by the current vault skeleton
    daily/: reserved for daily note documents
    projects/: reserved for project note documents
    exports/: derivative markdown exports for Notes (planned, not created yet, not authoritative)
  diary/: document directories created by the vault skeleton
    morning/: dated morning diary entries (planned feature)
    evening/: dated evening diary entries (planned feature)
  projects/: project document and attachment root reserved by the vault skeleton
    {project-id}/: managed working folder created for every project
  reports/: generated project status reports (planned feature)
  assets/: user asset root
    profile/: managed local profile image (created on demand)
    chat/attachments/: managed Chat image and text context files (created on demand)
    chat/browser-artifacts/: managed Chat screenshots and recordings (created on demand)
    notes/page-icons/: managed Notes page icon images (created on demand)
    notes/page-covers/: managed Notes page cover images (created on demand)
    notes/files/: managed Notes block, property, comment, and import files (created on demand)
    project-icons/: managed project and group icon images, including custom emoji (created on demand)
  templates/: reserved file-based project and methodology templates
  .yjs/: reserved Yjs document state cache
```

Music files stay wherever the user keeps them. The vault stores library metadata, source identities, playlist memberships, assignments, and playback state, but not the media bytes. Desktop backups go to a user-selected path outside the vault. Android portable backups are exported to shared Downloads and restored through the system document picker.

Tauri's platform app config directory stores device-local bootstrap and runtime state only, including `app-state.json`, benchmark state, benchmark SQLite, and doomscrolling runtime snapshots. Production and dev builds keep separate app config directories and therefore separate active-folder pointers.

## Key conventions

- **Package manager:** pnpm
- **Monorepo orchestration:** Turborepo on top of pnpm workspaces
- **Frontend:** plain Svelte 5 with runes (not SvelteKit)
- **Desktop/mobile shell:** Tauri v2
- **License:** AGPL 3.0
- **Data architecture:** two categories of data with different storage. Documents (diary entries, project docs, reports, and attachments) are files on disk; SQLite can index them for fast queries but the file is the source of truth where the document format is canonical. Structured data and document graphs (Notes pages and blocks, calendar events, project tasks, workspace configs, pomodoro configs, runs, segments, pauses, and run events) live in SQLite as the source of truth. Markdown for Notes is derivative import, export, or bridge output only.
- **AI integration:** the architecture has three opt-in paths. (1) The local coding-agent Chat uses project channels above Rust-owned native harness sessions, durable SQLite history, project-owned working folders, device-local folder bindings, operating-system credential references, and a Svelte shell. Project `#general`, channel navigation and archive, hidden session handoffs, Codex app-server, Claude native streaming, Cursor and Grok ACP, OpenCode HTTP and event streams, the combined timeline, composer, interactive requests, inspector, bounded file browsing, thread terminals, and Git checkpoints are implemented. Coding-agent runs receive an ephemeral loopback MCP endpoint for narrowly scoped application-owned host tools. This internal MCP endpoint is infrastructure, not a participant or teammate identity. (2) A BYOK chat widget supporting hosted and local user-configured providers is planned. (3) A separately authorized MCP service for external AI clients is planned.
- **Chat storage boundary:** project working folders, channels, ordered channel-session links, provider threads, canonical events, projections, drafts, attachment metadata, command receipts, checkpoints, access profiles, authorization revisions, logical scratch scopes, and cleanup records live in the active vault SQLite database. Every organizational run has one execution target, either an authorized project working folder or a private scratch generation. Personal channel sections and last-selected-channel state are device-local presentation preferences. Managed attachment bytes live under the active vault at `assets/chat/attachments/`. External absolute folder paths, scratch paths, executable paths, provider homes, probe caches, diagnostics, provider-native trust, and process state are device-local. Provider-native trust never widens organizational authority. Provider secrets live only behind operating-system credential references.
- **Agent data bridge:** native Chat sessions use Rust-owned application services and the scoped internal MCP endpoint for authorized channel and folder operations. A future Rust `ganbaru-ai` CLI may expose separately authorized external queries and derivative project exports for agents and collaborators, but it is not the internal Chat authorization path. The CLI is not implemented yet. The current Notes UI provides a deterministic agent-bridge markdown export for selected Notes and related project context.
- **State management:** Svelte 5 runes ($state, $derived, $effect), no external state manager
- **Localization:** user-facing UI text must use the typed i18n catalog. Language selectors show explicit languages as autonyms, such as `English` and `Español`, while non-language options like system preference are localized. User-facing date, time, number, plural, relative-minute, and list formatting should use the current locale helpers.
- **Branching and releases:** normal work uses topic branches from `dev` and PRs back to `dev`. Direct pushes to `dev` or `main` are not normal workflow. `main`, `app-v*` tags, release environment approval, published GitHub Releases, package repositories, and AUR publication are controlled by organization admins for supply-chain safety. Releases are promoted through a PR from `dev` to `main`, merged through `main` merge queue, then published from explicit `app-v*` tags that build draft GitHub Releases. Publishing the GitHub Release updates the apt, RPM, and AUR package paths. See `CONTRIBUTING.md`, `docs/operations/release/README.md`, and `docs/operations/repository-policy.md`.
- **Pull request workflow:** for review work, create a neutral topic branch from current `dev` before committing. Branch names describe the work, such as `docs/github-templates` or `fix/calendar-import`; never use tool names, assistant names, or vanity prefixes in branches, commits, or PR titles. Open PRs into `dev` unless the user explicitly asks for a release PR. Creating a PR does not imply merging it. Merge only when the user explicitly asks to merge, or explicitly asks to complete the whole PR flow after checks pass. Before merging, confirm the PR is mergeable, required checks passed, and the branch is up to date with its base. For release PRs from `dev` to `main`, do not update `dev` with `main`; add the PR to `main` merge queue after pull request checks pass. If `gh pr merge` attempts auto-merge instead of queueing a `main` PR, use GitHub's queue action or the GraphQL `enqueuePullRequest` mutation; do not enable auto-merge. If a non-release PR branch is out of date, update it once, then merge if merging was already authorized after checks pass. After opening a PR, do not wait or poll repeatedly for GitHub Actions. Check status once immediately when useful, or when the user reports checks are complete. When a PR into `dev` is merged, fetch `origin/dev`, switch back to `dev`, sync local `dev` to `origin/dev`, and delete merged topic branches locally and remotely. When a PR into `main` is merged, fetch `origin/main`, switch back to `main`, and sync local `main` to `origin/main`. Do not keep backup branches unless the user explicitly asks.
- **Commit signing:** commits should be signed with the configured SSH signing key. If signing fails, stop and report it instead of creating an unsigned commit.
- **Sync:** planned typed domain operations with SQLite-persisted Yrs/Yjs text, local device enrollment, end-to-end encryption, and an optional user-hosted Rust relay for opaque encrypted records. Sync and device linking are not implemented yet. See `docs/data/sync.md`.
- **Focus evidence:** Android Calendar alarms are reminders and cannot start runs or record later phases. Recovery uses only committed SQLite execution. Desktop automatic admission requires fresh local activity; explicit starts remain available. Device controller ownership and live companion status are planned separately from window coordination.
- **Build tool:** Vite (default with Tauri + Svelte scaffold)

## Testing

Read `docs/testing/README.md` when changing tests, validation scripts, task ordering, concurrency, sharding, cache inputs, test profiles, or test target selection.

**Writing tests:**
- Tests live next to source with `.test.ts` suffix (e.g., `utils.ts` and `utils.test.ts`)
- Pure functions are the best candidates. If a function depends on Tauri IPC or DOM, extract the pure logic into a separate function or skip testing it.
- Before writing a new test, look at existing tests in the same area to match their depth and style.
- Cover edge cases, not just happy paths. Shallow "it exists" tests are worthless.
- Test names describe behavior, not implementation.

**For UI/component changes:** Agents cannot manually verify the real Tauri app UI from this environment. Do not start a dev server, launch Tauri, or run HTTP smoke checks as a substitute for manual verification. During iterative UI work, do not run full `pnpm -w run validate` after every small visual adjustment. Use the narrowest relevant checks while coding, rely on user manual app inspection for visual confirmation, and run the risk-appropriate completion gate when the batch is ready or when requested. Committing a small UI-only change does not by itself require full validation. If a UI behavior needs more confidence than existing checks provide, add or update focused tests where practical.

**Validation policy for agent work:**
- The root `check`, `test`, and `validate` scripts intentionally cap tool concurrency. Use those scripts for broad local verification instead of direct full-suite `turbo`, `vitest`, or `cargo` commands.
- The broad root scripts intentionally run Rust work before frontend work, use one Cargo build job and Rust test thread, and split Vitest into sequential one-worker shards. Do not increase their concurrency, combine Rust and frontend stages, or remove the sharding without measuring peak memory and confirming that coverage is preserved.
- Run frontend and Rust validation sequentially. Do not run Cargo compilation or tests concurrently with Vitest, Svelte checks, Turbo, or another Node-based validation command.
- Do not run additional validation commands while a root `check`, `test`, `validate`, or `validate:full` command is active.
- For direct focused checks, use one Vitest worker and one Cargo build job and test thread unless the user explicitly requests higher concurrency. Add `--lib` when the filtered Rust test is in the library so Cargo does not build unrelated binary test targets. Use an explicit `--bin <name>` only when testing that binary.
- The workspace test profile uses limited debug information to keep Rust test binaries and relinks smaller while retaining useful line-based stack traces. Do not restore full test debug information unless a concrete debugger session needs local-variable inspection.
- Keep standard Cargo commands portable across Linux, Windows, and macOS. Do not make an external linker a required project dependency. Any optional linker optimization must fall back to the standard toolchain on unsupported systems and must be benchmarked before repository-wide adoption.
- Confirm that focused Vitest runs report only the requested files. Stop and correct the command if the full suite starts unexpectedly.
- Start with the narrowest useful command. Use affected Vitest files for focused TypeScript tests and filtered Cargo tests for focused Rust tests where practical.
- For trivial, mechanically obvious edits with no plausible impact on compilation, types, styling, behavior, generated output, persisted data, or public interfaces, do not run checks unless a relevant workflow requires them. Examples include changing existing copy text, renaming a visible label without changing keys, adjusting punctuation, or replacing one imported icon with another from the same library in an already type-compatible slot.
- For small UI-only or docs-only edits, do not run `pnpm -w run validate` merely because files changed, the task is complete, or the user asks for a commit. Run `pnpm -w run check` or `pnpm -w run editor-check` when the edit affects Svelte compilation, TypeScript, Tailwind classes, or shared UI structure. Run focused tests only when behavior changes.
- For backend, persistence, SQLite, import/export, migrations, project membership, note saving, or other data-loss-sensitive changes, run focused Rust or Vitest tests immediately, then a broader gate before committing.
- Run `pnpm -w run validate` before opening a PR, before a release, when the risk-specific rules above require a broader gate, or when the user explicitly requests full validation. Ordinary completion of an uncommitted task is not a release-ready handoff, and creating a commit does not automatically require full validation. If a batch already passed `validate`, do not rerun it unless later changes materially affect the behavior covered by that gate; use narrow checks for later isolated changes.
- Run `pnpm -w run validate:full` for dependency, lockfile, security, release, and audit-sensitive work, or when explicitly requested.
- Do not repeat full validation after unrelated clean status checks unless the code or generated output changed again.

**Commands (always use `-w` flag for root scripts):**
- `pnpm -w run check`: broad static feedback, including Svelte and TypeScript checks through Turbo, Rust formatting, and Rust clippy.
- `pnpm --dir apps/client run check`: client-only Svelte and TypeScript checks.
- `pnpm -w run editor-check`: editor-style diagnostics, including Tailwind canonical class checks.
- `pnpm -w run test`: all tests, with serialized Rust execution followed by sequential one-worker Vitest shards. Use after changes to tested code.
- `pnpm --dir apps/client exec vitest run path/to/file.test.ts --maxWorkers=1`: focused frontend test file.
- `cargo test -p ganbaru-chat --lib -j 1 test_name -- --test-threads=1`: focused Chat service test by name. Substitute `ganbaru-notes`, `ganbaru-db`, `ganbaru-chat-contracts`, `ganbaru-chat-providers`, `ganbaru-focus`, or `ganbaru-working-folders` for the relevant core crate.
- `cargo test -p ganbaru-tauri-app --lib -j 1 test_name -- --test-threads=1`: focused Tauri composition or command-adapter test.
- `cargo test -p ganbaru-native-messaging --bin ganbaru-ai-native-messaging -j 1 test_name -- --test-threads=1`: focused native messaging host test.
- `cargo check -p ganbaru-ai --bin ganbaru-ai -j 1`: focused desktop composition check.
- `cargo fmt --check`: Rust formatting only.
- `cargo clippy --workspace -j 1 -- -D warnings`: Rust linting only.
- `pnpm -w run audit:deps`: npm advisory audit for workspace dependencies. Run for dependency or lockfile changes, before PRs, before releases, and when investigating security alerts.
- `pnpm -w run audit:rust`: RustSec audit for cargo dependencies. Run for dependency or lockfile changes, before PRs, before releases, and when investigating security alerts. Reviewed ignores live in `.cargo/audit.toml` and must be documented in `docs/data/security/dependency-audits.md`.
- `pnpm -w run audit`: both dependency audits (`audit:deps` + `audit:rust`).
- `pnpm -w run validate`: full normal gate (check + test + editor-check + bundle contracts). Run before PRs, releases, risk-sensitive completion gates, and explicit full-validation requests. Do not treat ordinary task completion or a commit alone as requiring this gate. All errors must be fixed before treating that gate as passed.
- `pnpm -w run validate:full`: security and code gate (audit + validate). Run for dependency or lockfile changes, before PRs, before releases, and when explicitly requested.
- `pnpm --dir apps/client run test:coverage`: frontend coverage report to see what is tested.

After the relevant gate passes, finish the task without extra dev-server, Tauri launch, status, or diff checks unless they are directly required for the request, a commit, or an unexpected issue.

**Benchmark versioning:**
- `HARNESS_VERSION`, `DENSE_DATASET_VERSION`, and dense detail profile names are tied to recorded benchmark rows, not local iteration.
- Do not bump them while tuning an unrecorded benchmark shape. Edit the current version in place until a run is recorded in `docs/performance/results.md`.
- Once a version has recorded rows, bump only when a later methodology, workload, sampling, or dataset change makes new numbers incomparable with those rows.
- Benchmark markdown copied from the app uses `YYYY-MM-DD-ID` as an unresolved run-id placeholder. When placing rows in `docs/performance/results.md`, replace it with the next zero-padded sequence for that date, such as `YYYY-MM-DD-01`; never leave `-ID` in recorded rows.

## Rules

### Documentation

- Keep the workspace structure and Ganbaru AI folder structure in this file up to date. When directories are created, renamed, or removed, update the relevant tree. Never hardcode Ganbaru AI folder paths; read them from user configuration.

### Data handling and migrations

- Treat stored user data as durable. Any change to SQLite schema, persisted JSON, config keys, theme tokens, import/export formats, or generated Ganbaru AI folder data must consider existing installs, older exports, stale rows, removed fields, renamed keys, seed/reset data, and rollback or fallback behavior.
- Do not leave dead persistent data behind. If a field, row key, config key, or JSON property becomes obsolete, add an explicit migration, cleanup path, or validator drop rule, then document it in the relevant data or feature spec.
- SQLite migrations live in `apps/client/src-tauri/migrations/` and are embedded by `ganbaru-db` through `sqlx::migrate!`. Use SQLx file names with a UTC timestamp prefix, `YYYYMMDDHHMMSS_description.sql`, such as `20260601103000_add_project_tables.sql`. Do not manually register migration files; the SQLx macro discovers them at compile time.
- `20260830173211_baseline_schema.sql` is the fresh-start schema for the final pre-user reset. Earlier development databases are intentionally unsupported and must be recreated. Once a user-capable release can apply this baseline, never edit it. Add a new timestamped migration file instead.
- Keep `crates/ganbaru-db/src/lib.rs` focused on pool and migration services. Put schema and migration invariant tests in `crates/ganbaru-db/src/tests/`. Keep active-folder path authorization in `apps/client/src-tauri/app/src/db.rs`.
- Keep migrations idempotent and narrowly scoped when practical, but remember that SQLx validates applied migration checksums. Never rewrite an applied migration to fix a live install. Preserve user-authored values whenever those values still have meaning, and only delete data that is truly obsolete or derivable from current canonical data.
- The maintainer approved the final pre-user baseline squash on 2026-08-30.
- Future baseline squashes require explicit maintainer approval. Once users can have applied the current baseline, preserve it permanently and use additive migrations.

### Theme and color tokens

- New UI should use existing semantic theme tokens first. Add a new editable theme token only when it represents a stable, user-facing customization choice that users can reasonably understand and value.
- Do not add editable theme tokens for one-off internal paint details such as borders, shadows, dividers, placeholder text, selected-state outlines, editor tints, drag-preview borders, or temporary affordances when they can be derived from an existing surface, foreground, event color, or semantic signal.
- Keep theme editing broad but curated. The editor should expose meaningful color decisions, not every CSS variable. Prefer local derivation for implementation details and document the relationship when it affects future theme work.
- When adding, renaming, or removing theme tokens, update `docs/features/themes/README.md`, import/export validation, SQLite migrations or cleanup paths, seed/reset behavior, and tests in the same change.

### Code style

- Do not use em dash characters or two consecutive hyphens in markdown, code comments, or commit messages. Restructure sentences using periods, commas, colons, semicolons, or parentheses instead. Literal syntax is allowed when required, including command flags, CLI examples, code, URLs, file contents, diffs, and copied tool output.
- Avoid unnecessary capitalization. Use sentence case in markdown headings, code comments, documentation, branch names, and commit messages unless capitalization is required by grammar, proper nouns, acronyms, or official names. Correct nearby text that violates this when editing files.
- Prefer Tailwind canonical utilities over arbitrary-value equivalents. Use arbitrary values only when the value is genuinely custom or not represented by Tailwind theme tokens or project tokens.

### Responsive UI

- Design UI against the app minimum window size of 280 by 180, but treat it as a recoverability floor, not a promise that every feature is comfortable there.
- Prefer fit-based responsive behavior over viewport-class-only behavior. Use actual container width, available viewport space, anchor position, and measured content when those determine whether a layout fits.
- Keep desktop and floating affordances until they no longer fit. Use full-width, bottom sheet, or fullscreen layouts only when the viewport physically leaves no practical room for the normal layout.
- Prefer container queries for local component layout. Use the shared viewport store for route-level decisions. Use JavaScript layout only for measured controls, pointer anchors, viewport clamping, or collision avoidance.
- Preserve user state across responsive render variants. Changing from a wide layout to a compact layout must not reset selected tabs, draft fields, scroll intent, or active edits.
- Keep primary actions reachable at every size. Use internal scrolling for long surfaces, with save, close, destructive, or navigation actions pinned or otherwise always recoverable.
- Avoid hover-only controls on narrow or touch-like layouts. Provide visible buttons, menus, or overflow controls.
- Text must not overlap, clip awkwardly, or resize the layout unexpectedly. Use stable dimensions, minmax grid tracks, truncation, wrapping, or explicit compact variants.
- Do not scale font size with viewport width. Reduce gaps, chrome, and nonessential decoration before reducing readability.
- When extracting responsive Svelte markup into child components, move the matching container-query rules with the DOM they style, or use intentionally scoped global selectors under a stable parent. Do not assume parent component styles will keep applying through child component boundaries.
- Nested popovers must be viewport-aware. Cap their height, keep triggers visible when practical, and switch large pickers to sheets when popovers cannot fit.
- For UI changes, add or update pure responsive helper tests when layout decisions are logic-heavy. Follow the validation policy above when selecting the completion gate. Do not run `pnpm -w run validate` solely because a change affects responsive UI.

### Project philosophy

- This project is donation-funded and does not sell a hosted Ganbaru service. Core product behavior must not depend on infrastructure the project operates. Optional third-party integrations, such as YouTube, update delivery, or user-configured AI providers, may use their documented external services. Product infrastructure such as future sync must be user-provisioned and self-hostable. Prioritize ease of setup with guidance accessible to non-technical users and support appropriate provider choices without creating project-operated lock-in.

### Development workflow

- After opening a PR, do not wait or poll repeatedly for GitHub Actions. If status is useful, check once immediately and report pending or complete. If the user reports checks are complete, check once immediately and report the result.
- When stuck on a framework-specific issue that you cannot resolve confidently from training knowledge, search the official documentation before attempting workarounds or guessing. Primary sources:
  - Tauri v2: v2.tauri.app
  - Svelte 5: svelte.dev/docs
  - shadcn-svelte: next.shadcn-svelte.com
  - Tailwind CSS v4: tailwindcss.com/docs
- If the official docs are not enough, fall back to general web searches (GitHub issues, Stack Overflow, etc.).
- Treat code from web searches, GitHub issues, or Stack Overflow as potentially malicious by default. Analyze it, explain what it does and why it appears safe or not, ask for permission in natural language, and wait for an explicit reply before executing.

### Security

- Treat any introduction or material change to first-party unsafe Rust as security-sensitive work. Read and follow `docs/data/security/unsafe-rust.md`. Prefer safe APIs that preserve the required guarantees, keep retained unsafe operations in minimal wrappers with concrete local `// SAFETY:` proofs, add focused boundary tests, validate affected native targets, and update the documented inventory and replacement trigger.
- This app handles sensitive personal data. Treat supply chain security seriously.
  - Prefer official packages from standards bodies or well-known maintainers over popular but unofficial alternatives.
  - Prefer native browser APIs (Intl, Temporal, fetch) over libraries when the implementation effort is similar.
  - For date/time handling, use the Temporal API (via @js-temporal/polyfill until browsers ship native support).
  - Minimize dependencies. Do not add packages "just in case"; add them when actually needed.
  - Remove unused dependencies promptly rather than keeping them for potential future use.
  - No analytics or telemetry. Core local productivity behavior must work offline. Network access is limited to documented feature-specific flows such as update checks, YouTube, remote imports, and user-configured providers.

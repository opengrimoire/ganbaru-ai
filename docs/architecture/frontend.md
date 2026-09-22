# Frontend architecture

The frontend is a plain Svelte 5 application built with Vite. It is not SvelteKit and has no server-rendering layer. Desktop and mobile builds share one workspace but enter through different composition roots.

## Entry points

`apps/client/src/main.ts` selects a virtual platform entry. Desktop uses `main-desktop.ts` and `App.svelte`; mobile uses `main-mobile.ts` and `MobileApp.svelte`. Build-time selection keeps desktop-only imports out of Android production assets instead of hiding unsupported controls at runtime.

The shell owns cross-feature navigation and only mounts the selected primary surface. Desktop imports its top-level surfaces eagerly and hydrates non-Calendar stores asynchronously after mount. Android preserves separate production chunks: its critical readiness phase produces a usable Calendar, then it automatically resolves the other standard surfaces in prioritized background batches. An early navigation reuses the in-flight preparation instead of starting a separate interaction-triggered load. Heavy or uncommon detail workflows load on demand on both platforms. Production bundle contracts protect intentional resident and lazy boundaries.

The desktop main window starts hidden. Its normal reveal waits for the selected root to mount, Svelte updates to flush, layout to resolve required fonts, and those fonts to become ready. Initial theme and localization hydration precede the configured-vault root mount. Reveal must not depend on animation frames from a hidden WebView. An ownership transition cover remains until replacement content is ready, and the native reveal timeout remains failure recovery. Detached windows and Pomodoro overlays do not reveal the main window.

Without an active vault, desktop boot loads setup and prewarms handoff onboarding without importing the App feature roots. Shared production chunks must preserve that boundary and the existing deferred terminal, editor, and review runtimes. Activating a vault retains eager common surfaces and existing workspace preparation.

## Source organization

The frontend uses four broad layers under `apps/client/src/lib/`:

- `components/` contains Svelte presentation and interaction surfaces.
- Domain folders such as `calendar/`, `chat/`, `notes/`, `music/`, `pomodoro/`, and `projects/` contain pure helpers, contracts, validation, and view models.
- `api/` contains typed wrappers around Tauri commands and asset URL handling.
- `stores/` contains stateful Svelte rune controllers for runtime domains that need shared lifecycle.

Components should not duplicate command contracts or parse unknown backend values ad hoc. Untrusted or versioned responses pass through bounded validation before entering typed state.

The Notes block API separates payload creation, read-only inspection, and edit operations behind `notes/block-factory.ts`. Payload construction does not depend on editing or store lifecycle. Typed block switches preserve each block variant's payload and metadata explicitly.

## State model

Svelte runes provide in-memory presentation state. Durable user data is loaded from native services and persisted through typed commands. A store can cache, coordinate, or optimistically present data, but it does not become a second source of truth.

State is scoped to the smallest useful owner:

- Component-local state for transient interaction.
- Domain controllers for a mounted feature or shared runtime.
- App-level stores for active vault, theme, locale, Pomodoro, Music, and other genuinely global lifecycles.
- Device-local preferences for presentation details that should not synchronize with the vault.

Changing responsive variants must preserve active drafts, selections, scroll intent, and open workflows.

The Chat teammate settings editor uses a component-scoped controller for draft baselines, revision checks, asynchronous access loading, and save/conflict recovery. Its Svelte component owns rendering, menus, focus restoration, and layout. The controller reuses the pure access and draft helpers; backend authorization remains authoritative. A save captures its submitted draft so edits made during the request remain unsaved, and access confirmation is valid only for the exact previewed snapshot.

## UI foundations

Generated shadcn-svelte primitives live under `components/ui/`. Product-specific components compose them rather than modifying generated primitives without a clear shared reason. Tailwind CSS provides layout utilities, while semantic CSS variables provide theme colors.

Themes are data-driven and validated before application. Feature code should consume semantic tokens, not embed user-facing palette values. The full contract is in [Themes](../features/themes/README.md).

The stable `stores/themes.ts` API delegates to definitions, runtime color derivation, and JSON transfer modules under `stores/themes/`. Definitions are independent of derivation and transfer. This keeps changes to import validation separate from the color engine and preserves existing consumer imports.

## Localization

User-facing text goes through the typed catalogs under `lib/i18n/messages/`. English is the resident fallback. Other locale graphs load when selected. Catalog shape tests keep locale modules aligned.

Dates, times, numbers, lists, plural forms, and relative values use locale-aware helpers. Explicit language names appear as autonyms. Stored identifiers and protocol values remain locale-neutral.

## Responsive and platform behavior

Shared components adapt through capability inputs and layout constraints. Platform-specific authority comes from the selected composition, not from viewport width. A narrow desktop window does not become Android, and a large Android tablet does not gain desktop process or filesystem authority.

Prefer container-aware layout, visible touch targets, bounded sheets and popovers, and recoverable behavior at the minimum window size. Hover, pointer precision, detached windows, and keyboard shortcuts require alternatives where the target platform does not guarantee them.

## Loading and performance

Primary navigation should render useful chrome before deferred data resolves. Expensive editors, diagnostics, transfer workflows, syntax grammars, and large catalogs remain lazy unless measurement proves that residency improves a common interaction at acceptable cost.

Visible-window queries, pagination, virtual lists, bounded caches, and latest-wins request handling prevent total stored history from defining render cost. See [Performance](../performance/README.md) for measurement rules.

## Testing boundary

Pure TypeScript logic is tested next to source. Component tests cover behavior that can be represented reliably in the test environment. Real Tauri window behavior, operating-system integration, and visual quality still require platform acceptance. See [Testing](../testing/README.md).

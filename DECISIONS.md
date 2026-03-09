# Decisions

Technical decisions made during development that are not already covered in TECH_STACK.md. This includes library version choices, patterns adopted, trade-offs made, and things tried and rejected.

## Format

Each entry records:
- **Date** — when the decision was made
- **Decision** — what was decided
- **Reasoning** — why this choice was made
- **Alternatives considered** — what else was evaluated and why it was rejected

---

### 2026-03-09 — Plain Svelte 5 instead of SvelteKit scaffold

**Decision:** converted the Tauri scaffold from SvelteKit (with adapter-static in SPA mode) to plain Svelte 5 + Vite.

**Reasoning:** the TECH_STACK.md explicitly specifies plain Svelte 5. SvelteKit adds file-based routing, SSR infrastructure, and adapter abstractions that are unnecessary for a Tauri desktop app. Plain Svelte with Vite is simpler, has faster builds, and avoids the `.svelte-kit` generated directory. Navigation is handled by a Svelte rune store ($state) since the app is a single-window SPA.

**Alternatives considered:** keeping SvelteKit in SPA mode was considered since it works fine with adapter-static, but it adds complexity (route files, layout files, +page.svelte convention) without benefit for this use case.

---

### 2026-03-09 — Tailwind CSS v4 (required by shadcn-svelte v1.1.1)

**Decision:** using Tailwind CSS v4 via @tailwindcss/vite plugin.

**Reasoning:** shadcn-svelte v1.1.1 requires Tailwind v4. The v4 approach uses CSS-native `@theme` and `@custom-variant` instead of a tailwind.config.js file. The dark theme variables are defined directly in app.css using oklch color values.

**Alternatives considered:** Tailwind v3 would have worked with older shadcn-svelte versions, but staying on the latest gives better ecosystem support and is what the CLI generates.

---

### 2026-03-09 — Svelte rune stores pattern for global state

**Decision:** using module-level `$state` with getter functions (e.g., `getPomodoro()`, `getKanban()`, `getNavigation()`) instead of Svelte stores or context API.

**Reasoning:** Svelte 5 runes are the recommended approach and provide fine-grained reactivity without the boilerplate of writable/readable stores. The getter pattern keeps the API surface clean and allows encapsulating mutations. No external state management library needed.

**Alternatives considered:** Svelte stores (`writable`), Svelte context API, or external libraries like Zustand. All add unnecessary abstraction when runes handle the use case natively.

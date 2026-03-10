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

---

### 2026-03-09 — SVG + Svelte skill tree instead of D3.js force-directed graph

**Decision:** replaced the D3.js force-directed graph skill tree with a custom SVG + Svelte component-based implementation using center-snap discrete navigation, neighborhood culling, and authored graph data.

**Reasoning:** the D3.js force simulation is designed for data visualization, not game-like navigation. It produces unpredictable node positions (different every render), jittery physics, and defaults to free pan/zoom — all of which fight the intended Shield Hero-style UX where the user navigates one step at a time and the world moves to center the focused node. The force layout also has no concept of layered sub-graphs, which is needed for the "generalist but deep" tree structure (broad categories at the top, specialized skills nested within).

The new approach renders nodes as pure Svelte components within SVG `<g>` elements (avoiding `<foreignObject>` due to WebKitGTK rendering quirks). Node positions are hand-authored within each sub-graph (TypeScript constants), not computed. Navigation is discrete — arrow keys or click, one step at a time, with spring-animated center-snap. Neighborhood culling by graph distance (BFS depth 0–2 from focal node) caps the rendered set at ~15–40 nodes regardless of total tree size.

**Alternatives considered:**
- **D3.js force layout** (previous implementation): rejected for reasons above.
- **Svelte Flow (`@xyflow/svelte`)**: designed for user-editable node graphs with free pan/zoom. Would require fighting its defaults at every step.
- **Canvas (HTML5)**: loses the Svelte component model, requires manual hit detection. Only worth it for a "galaxy overview" mode, which can be added later if needed.
- **Keeping D3.js for layout only, custom rendering**: still produces unpredictable positions. The core issue is computed vs authored positions, not the rendering layer.

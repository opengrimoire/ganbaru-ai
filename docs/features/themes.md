# Themes

GanbaruAI ships curated themes and lets users author their own in-app. A theme recolors the built-in light and dark palette across every event slot and across the app and calendar shell. Users can run the built-in themes, pick a user-authored one, or edit slot hexes in a theme editor. Adding a new theme is a data-only change: one Theme object in the registry.

Theming is intentionally color-deep, not structure-deep. Themes set colors across the event palette and the app and calendar shell; they do not change layout, add custom components, or control typography. Font family, font size, and UI density live as separate user settings (see "Typography and density" below), orthogonal to the active theme. Heavier UI edits belong upstream (as contributions to the app) or in a fork. Keeping the theme format a validated data contract means no code execution, no remote asset loading, no DOM rewriting, and a stable contract across app updates.

This doc covers the theme model, the event color palette, the ideal custom-theme workflow, persistence, and the rules that keep stored events safe as palettes evolve.

## The Theme model

A Theme is a self-contained visual package. The minimum fields:

- **id:** stable string used in storage and lookups. Built-in IDs are `light` and `dark`. Custom themes use slugs or UUIDs.
- **displayName:** user-visible name in the theme picker.
- **base:** `light` or `dark`. Carried only by `BuiltinTheme` (the code-pinned light and dark) and by preset definitions, where it picks the BASE token table the preset's sources are layered on top of. User themes do not carry it: the v1 snapshot already holds every resolved token, so any required fallback is computed from the snapshot's canvas luminance via `defaultIconLabelFromCanvas`.
- **iconLabel:** `light` or `dark`. Purely decorative sun/moon tag answering "was this theme meant for day or night use?". Surfaced as the indicator next to the theme name in the theme list and editor header. Built-ins peg the iconLabel to their `base`. User themes can flip the indicator independently with one click; the flip is persisted but never affects the runtime `.dark` class or the calendar palette pick (those still derive from canvas luminance via `isThemeDark` / `isThemeCalendarDark`).
- **eventPalette:** ordered array of 24 hex values (one per slot index). Every position must be filled, even if the theme reuses the same color across multiple slots. See "Event color palette" below.
- **blendCanvas:** hex color the dimmed event variants blend toward. Usually the theme's canvas background.

User themes additionally carry a full resolved-token snapshot and source palette:

- **sources:** six-color palette (`canvas`, `ink`, `primary`, `destructive`, `confirm`, `warning`) that drives the rest of the shell through the derivation engine. Calendar canvas is not a source: it auto-derives from the app canvas via a direction-aware OKLab ΔL offset (see "Derivation formulas" below) and is pinnable through the per-token isolated flag on `--cal-bg` when the user wants to isolate it.
- **appTokens / calendarTokens:** full resolved hex map for every key in `APP_TOKEN_KEYS` (50 entries) and `CALENDAR_TOKEN_KEYS` (10 entries). The snapshot is what the runtime actually paints; sources are kept as editor seeds so source edits can re-derive the snapshot in lockstep.
- **appIsolated / calendarIsolated:** sets of token keys flagged as user-pinned. An isolated token does not participate in source-edit cascades or rebakes: it stays at whatever hex the user wrote.
- **derivationEngineVersion:** integer stamp identifying which version of the derivation engine produced the snapshot. The editor shows a rebake banner when a stored theme's stamp trails the current code constant (see "Engine version and rebaking" below).
- **blendCanvas:** scalar hex the dimmed event variants blend toward. Auto-tracks `--cal-bg` whenever that token is non-isolated; pinning `--cal-bg` lets the user pin `blendCanvas` indirectly.

The Theme type is a discriminated union: `BuiltinTheme` (just `id`, `displayName`, `base`, `iconLabel`, `eventPalette`, `blendCanvas`) for the code-pinned light and dark, and `UserTheme` (no `base`) for everything authored or duplicated. A user-theme value is frozen after construction and stored normalized in SQLite (see "Persistence" below). The registry of built-ins is frozen. This prevents runtime mutation of a shipped theme by accident.

### Why a registry, not a boolean

The original store was a binary `isDark` toggle. It could not express "a user made their own theme", "there are three themes to cycle through", or "this theme ships a different calendar canvas color". A registry keyed by ID, where each entry carries its own palette and optional shell overrides, makes the entire theme addition a single object: write a Theme, register it, done. No other code needs to change.

## The two-layer color model

Event colors use two layers so users can redesign themes freely without breaking stored events.

1. **Slot index (stable, invisible).** An integer in the range `0..PALETTE_SIZE-1` (currently `0..23`). Stored as `INTEGER` on the event row. Never shown to the user. Acts purely as a position into each theme's `eventPalette` array.
2. **Hex value (per theme).** The actual RGB the slot resolves to in the active theme. Two themes can assign wildly different hex to the same index. When the user switches themes, all events across the app pick up the new hex immediately because they reference the position, not the color.

There is no third "display name" layer. The index is internal only; UI surfaces (the editor grid, the event color picker tooltip) show the hex value next to the swatch. A user who recolors slot `6` blue never sees a name attached to that slot, only the swatch and `#3366CC`. No per-slot name field, no auto-naming heuristics, no name-vs-color drift.

## Event color palette

Each theme's `eventPalette` is a frozen array of 24 hex strings; the slot at index `n` is whatever color the active theme assigns to that position. `FALLBACK_COLOR_INDEX = 22` is the render-layer fallback when a stored color is unknown or missing. Every theme must keep all 24 slots filled and must keep slot 22 readable as a neutral fallback.

The two layers mean themes can swap any color at any position freely; existing events keep rendering, just in the new color the active theme assigns to their stored index.

### Validation on read

Raw color values come in from the database, iCalendar imports, and user edits. `normalizeEventColor(raw)` in `components/calendar/utils.ts` validates every value on its way into the in-memory event model:

- Integer in `0..PALETTE_SIZE-1`: pass through.
- Numeric string parseable to such an integer: coerce and pass through.
- Out of range, non-integer, `NaN`, or `Infinity`: warn once to the console, return undefined; render falls back to the `FALLBACK_COLOR_INDEX` slot.
- Null, empty string, or other non-numeric type: return undefined silently.
- Non-numeric strings: not coerced; treated as unknown and dropped. The DB schema migration to `INTEGER` removed the only path that ever produced them.

The warning is deduped across a session (Set-backed) so a bad value on a thousand rows logs one line, not one thousand.

### Evolving the palette

The palette size is fixed at 24 (`PALETTE_SIZE`). Themes redefine what color sits at each index; they do not add or remove slots. Stored events keep their integer reference forever, so changing a theme's hex for any slot is always safe. If the palette ever needs to grow, increase `PALETTE_SIZE` and add the new positions at the end so existing indices stay valid.

## Contrast math across the shell

Every foreground, border, and muted caption the derivation engine produces is resolved through WCAG contrast math in `components/ui/colorMath.ts`:

- `relativeLuminance(hex)` implements the WCAG 2.1 gamma-decoded formula.
- `contrastRatio(a, b)` returns the `(Lmax + 0.05) / (Lmin + 0.05)` ratio (1..21).
- `pickReadableForeground(bg, { ink, canvas, target })` returns `ink` or `canvas` if either meets the target against `bg`. When both fail, it prefers the saturating endpoint (`#000000` or `#ffffff`, whichever has higher contrast) so the foreground snaps decisively away from the surface instead of producing a chroma-preserving gray that technically meets target but sits too close to `bg` in luminance. Only when the endpoint also fails (target unreachable at this bg) does the picker walk the higher-contrast anchor's lightness in OKLab to preserve hue intent. Guaranteed to reach target whenever the bg's luminance allows it.
- `pickBrightForeground(bg, ink, target)` prefers pure `#FFFFFF` when it meets `target` against `bg`, falling back to `ink`, then `#000000`, then `pickReadableForeground`. Used for status / destructive / sidebar foregrounds where the design convention is "white unless bg is too bright", so the result snaps decisively to white on mid-dark surfaces without drifting toward ink's off-white.
- `pickReadableBorder(bg, ink, { target })` walks from `bg` toward `ink` until the ratio hits the target (default 3:1). Falls back to pure black or white if the ink is too close to the bg.
- `walkFraction(fg, bg, fraction)` blends `fg` toward `bg` in OKLab lightness by a fixed fraction, keeping `fg`'s chroma. Used to park recessed tokens (muted foreground, ring, event-panel divider and text variants, calendar time-label and timeline-break) at the exact OKLab-L position BASE.dark places them. A contrast-target walk cannot reproduce those hexes because BASE.dark's own contrast sits between 3:1 and 4.5:1 in ways that don't collapse to a single target; recording the fraction instead lets the derivation hit BASE.dark exactly and cascade consistently on any canvas. The walk anchor is not raw `ink`: it is `pickReadableForeground(bg, { ink, canvas, target: 4.5 })` per-surface, so the walk always starts from a foreground that is actually visible against that surface. On BASE.dark every app surface is dark and `pickReadableForeground` returns `ink`, preserving identity; when the user flips canvas to light while keeping ink light, the per-surface anchor flips to black and every recessed token walks in the right direction. `--form-indicator` uses the same anchor against canvas (instead of raw ink) so radio/checkbox dots flip with canvas for free.
- `shiftPerceptualL(hex, deltaL)` adds a signed delta to `hex`'s OKLab lightness (preserving hue and chroma) and clamps to the `[0, 1]` gamut boundary. Drives every shift-derived surface (see "Derivation formulas" below).

OKLab is implemented from D65 matrix math in the same file (no external dependency). A 10,000-iteration fuzz test asserts `pickReadableForeground` always meets its target; round-trip tolerance tests lock OKLab accuracy inside 1 channel out of 255.

Event-tile text still uses the legacy threshold-based `pickContrastText` (Rec. 709 luminance on raw sRGB) because the event palette was calibrated against those specific thresholds. Dimmed event variants (past, cancelled, transparent, outside-month) are computed by blending the event's base hex toward the theme's `blendCanvas` with a fixed weight; text contrast is recomputed from the dimmed bg and cached per (theme ID, slot, weight).

## Luminance-driven canvas resolution

Whether a theme "is dark" is a runtime property of its canvas, not a stored label. Two helpers in `stores/themes.ts` do the bucketing:

- `isThemeDark(theme)` reads `--background` from the theme's snapshot (or the base CSS for built-ins) and returns true when its relative luminance sits below `DARK_SURFACE_THRESHOLD` (0.4). Used to toggle the `.dark` class on the HTML root.
- `isThemeCalendarDark(theme)` does the same for `--cal-bg`, which either matches the auto-derived calendar canvas (the default) or a user-pinned hex when `--cal-bg` is in `calendarIsolated`. Event tiles need to pick their palette against the surface they actually sit on, which is not always the same as the app canvas.

User themes carry no `base` field at all, so there is no stored label to fall out of sync with. A separate helper, `defaultIconLabelFromCanvas(canvasHex)`, classifies an arbitrary canvas as `light` or `dark` for the few places that still need a BASE table to fall back to (legacy import, partial-row recovery during DB hydrate). Users can invert a theme's canvas mid-edit without fighting any stale label: the `.dark` class flips immediately, and event tiles pick the right palette on the very next frame. The 0.4 threshold is intentionally below the sRGB midpoint so a mid-gray canvas (~#888) still resolves as light.

## Persistence

User-authored themes persist in SQLite as a normalized snapshot. The active theme ID, font family, and font scale stay in `vault/config.json` under dotted keys (`theme.activeId`, `preferences.fontFamilyId`, `preferences.fontScale`); user themes have moved out of the config blob and into six tables documented in `data/schema.md` (`themes`, `theme_tokens`, `theme_event_palette`, plus seed mirrors and `theme_upgrade_dismissals`). Built-in light and dark stay code-pinned and never appear in the database. The schema's `CHECK (id NOT IN ('light', 'dark'))` defends against any malformed import shadowing them.

The vault folder still defaults to `app_config_dir / "vault"` and is created on first launch. Writes to `config.json` are atomic: the Rust backend serializes to `config.json.tmp`, fsyncs, and renames into place, so a crash mid-write leaves either the previous good file or an ignored temp.

The frontend bridge (`lib/vault/config.ts`) loads the config once at boot, exposes synchronous reads against an in-memory cache, and debounces writes (250 ms) so rapid edits coalesce into one disk write. Stores hydrate from the cache on first read, keeping first paint synchronous for the small prefs that still live there. User themes load asynchronously: `apps/client/src/main.ts` awaits `ensureConfigLoaded()` and then `hydrateUserThemes()` before mounting the app, so first paint always matches what the user has on disk.

The first vault load runs a one-time migration that copies the legacy `ganbaruai-theme`, `ganbaruai-font-family`, and `ganbaruai-font-scale` keys out of `localStorage` and removes them. The migration is idempotent. See "Migration from vault to SQLite" below for the second one-time migration that copies the legacy `themes.user` blob into the new tables.

Built-in themes still pass through `validateThemeJson` on load (defense in depth against tampered config files). Unknown or invalid theme IDs fall back to the default (`dark`).

## Custom theme workflow

Themes are managed from the single Appearance section in Settings. The section lists every theme (built-ins first, user themes below) above the font and zoom controls. Opening one hands off to a floating theme editor: the Settings modal closes and a draggable panel appears in the top-right of the viewport. The panel has no backdrop, so the app underneath stays interactive and every edit can be verified live (switch tabs, hover rows, open dialogs) without dismissing the editor. The panel header itself is draggable, constrained so at least the header stays on screen, and a chevron toggle on the right collapses the panel to just its header and footer so the rest of the app can be inspected without dismissing the editor. The drag header does not repeat the theme name and has no visible grip icon. The drag header, editor chrome, and footer use the theme's solid sidebar surface. Dividers separate the drag header from the editor chrome and the editor chrome from the editable body. Header and footer controls share the same horizontal inset as the editor body cards, so the collapse toggle, Back to themes button, and Save and apply button align with the content margins.

The editor follows a buffer model: every edit (color picker drag, isolate flip, palette slot, rebake, rename, preset apply) updates the in-memory theme registry and re-paints the DOM, but nothing is written to SQLite during the session. This keeps streaming color-picker drags at 60fps without per-frame DB writes and matches the user expectation that "nothing is applied unless I press Save". The sticky footer exposes two actions: Back to themes rolls the session back in memory (restores the theme's pre-edit JSON snapshot, or drops the theme entirely when it was minted for this session through New or Duplicate and edit, then reinstates the theme that was active before the session opened) and reopens Settings on the list. Save and apply flushes the in-memory theme to SQLite in one shot through `persistThemeToDb` (insert for fresh themes, content replace for existing ones, preserving any dismissal rows), leaves the edited theme active, and returns to the list. Editing a built-in swaps the primary label to Apply and return since there is nothing to save. A forced close of the app while the editor is open triggers a best-effort cancel through the close-confirm dialog; because the buffer was never written to disk, dropping the in-memory edits is enough.

Users can:

1. **Create a theme** by clicking "New theme". A user theme is added (seeded from the current active theme) and the editor opens on it.
2. **Duplicate and edit** any theme (built-in or user) into a new editable user theme. The duplicate is immediately applied as the active theme and the editor opens on it, so the user sees their edits live from the first change. Built-ins remain frozen.
3. **View a built-in**. The detail view renders the name, base label, and a read-only palette preview alongside any shell overrides the theme ships. A JSON panel shows the serialized theme with Copy and Save buttons.
4. **Edit a user theme**: rename it, tweak any of the 24 event-palette hexes through an in-house HSL color picker, edit the six sources (canvas, ink, primary, destructive, confirm, warning) to shift the shell in lockstep, and click Isolated edit on any driven row to flag it user-pinned and unlock direct hex input (Link back unflips it and re-derives). The sun/moon icon in the header is a clickable decorative tag (day/night use) that the user can flip independently of canvas luminance; the flip is persisted on the theme but does not affect the runtime `.dark` class. The same JSON panel is editable; pressing Apply changes validates the draft through `replaceTheme` and commits it in place (id locked).
5. **Reset a single color** back to its clone-time value. Every row in the editor, both source colors in the group headers and the driven tokens below, gets a small reset icon next to the color field whenever the current value or isolated flag differs from the seed snapshot captured at clone time (see "Seed snapshots" below). Clicking it restores both the value and the isolated flag for that one row: a source channel goes back to its seed hex; a driven token's value and isolated flag both fall back to the seed snapshot. Other rows are untouched.
6. **Reset every color** in one click via the "Reset all" button in the footer. Restores every source, every app and calendar token (value and isolated flag), the event palette, and `blendCanvas` from their seed mirrors in one in-memory pass. Like every editor mutator, the result lives in `$state` until Save and apply commits it. The button is disabled when the theme is already at its seed state.
7. **Apply** any registered theme by clicking its row. The active theme is highlighted; switching is non-destructive (only the active ID changes).
8. **Share** a theme by exporting it from the detail view. Copy JSON writes to the clipboard; Save to file uses the native save dialog. Import accepts pasted JSON or a file picked through the open dialog. Imported themes get a fresh slug ID if their incoming ID would collide with an existing user theme.
9. **Delete** a user theme. If the deleted theme was active, the store falls back to the default theme. The DB cascade (FK on every theme-scoped row) removes the snapshot, palette, seeds, and any dismissal rows in one statement.

Every new user theme starts with a `sources` palette and a full token snapshot synthesized from those sources at clone time. Source edits drive the snapshot through the derivation engine; the per-token `isolated` flag controls whether a token is part of the cascade or treated as user-pinned. A clone of a built-in starts with no isolated flags set, so the first canvas edit cascades through every surface; a clone of a user theme inherits that user theme's isolated flags so surgical edits survive Duplicate and edit.

Clicking "New theme" opens a preset picker before the editor mounts (see "Preset picker" below). Picking a curated preset seeds the new theme with a pre-validated palette; "Start blank" keeps the original path that seeds from the active theme.

Editing a built-in is blocked at the store level: mutators return false, `replaceTheme` rejects built-in ids, and the editor hides every input when the target is built-in. The schema's `CHECK (id NOT IN ('light', 'dark'))` provides defense in depth: even a malformed import cannot insert a row that shadows a built-in. Duplicate is the only path to a modifiable copy.

### Seed snapshots

Every user-theme row in `themes` carries a complete seed mirror in `theme_seed_tokens` and `theme_seed_event_palette`, plus a `seed_blend_canvas` scalar on the same row. The mirrors are written once, when the theme is created or duplicated, and capture every column that "Reset" needs: source hexes, every app and calendar token value, every isolated flag, the 24 palette slots, and `blendCanvas`. Built-in themes never appear in `themes` at all, so they never carry seeds.

Per-row reset compares the live snapshot in memory against the matching seed entry on the same `UserTheme` and surfaces a reset icon whenever the value or the `isolated` flag differs. Clicking it restores both columns from the seed: a token that was pinned at clone time goes back to its seed hex with `isolated=1`; a token that was free at clone time goes back to its seed hex with `isolated=0` so derivation takes over again on the next source edit. "Reset all" runs the equivalent restore across every seed bucket (sources, app tokens, calendar tokens, palette, blend canvas) in one in-memory pass. Both flow back to SQLite only when the editor commits.

Seeds are not exported in the JSON payload: `serializeTheme` emits the live snapshot only so the exported file describes the theme as portable data, not as a forked snapshot with history. Reset is an install-local affordance; sharing a theme ships just the current colors.

## Shell token derivation

The app and calendar shell are styled through CSS tokens defined in `app.css` under `:root` (light) and `.dark` (dark). User themes paint those tokens from a stored snapshot; the derivation engine runs only at write time.

### Snapshot model

Every user-theme token is stored as a resolved hex snapshot in `theme_tokens`, one row per (theme, kind, key) triple covering every key in `APP_TOKEN_KEYS` (50 entries) and `CALENDAR_TOKEN_KEYS` (10 entries). Sources are kept as editor seeds in the same table under `kind='source'`; they drive multi-token derivation when the user edits one of them, but they are not consulted at paint time. The per-token `isolated` flag controls whether each token participates in the next source-edit cascade or is treated as user-pinned.

`computeThemeTokenOps` reads the snapshot directly: for built-ins it serves `BASE_APP_TOKENS[base]` and `BASE_CALENDAR_TOKENS[base]`; for user themes it serves `theme.appTokens` and `theme.calendarTokens` verbatim. The result is pushed to the root via `root.style.setProperty`. Switching themes clears tokens set by the previous theme that the next one does not cover.

### Source-edit cascade

Editing a source value triggers `updateSourceValue(themeId, sourceKey, hex)`. The store rebuilds the snapshot from `deriveAppTokens(newSources)` and `deriveCalendarTokens(newSources)`, then updates the in-memory theme:

- Replace the `sources[sourceKey]` entry.
- For each app token where the isolated flag is unset, write the new derived value into `appTokens`.
- For each calendar token where the isolated flag is unset, write the new derived value into `calendarTokens`.
- If `--cal-bg` is non-isolated, set `blendCanvas` to the new derived `--cal-bg` so the dimmed event-tile blend stays in sync.
- Re-paint the DOM if the edited theme is active.

The mutator never touches SQLite. Save and apply later flushes the resulting snapshot through `persistThemeToDb`, which calls `replaceThemeContent` for an existing theme (UPDATE parent, DELETE+INSERT children, preserve dismissals) or `insertTheme` for a fresh theme. Isolated tokens never receive the new derived hex; they keep whatever the user wrote. Pinning a token whose value happens to equal the current derivation is a deliberate choice to freeze that color through future source edits, so no special "ghost equality" handling is needed.

### Isolated flag semantics

Three mutators expose the flag:

- `isolateToken(themeId, kind, key)` flips the isolated flag to 1 without touching the value. The editor only enables direct hex input on isolated rows; the snapshot already holds the auto value at the moment the user clicks Isolated edit.
- `setTokenValue(themeId, kind, key, value)` writes a new hex without touching the flag. Combined with the editor's gating, this implicitly only happens on a pinned token.
- `relinkToken(themeId, kind, key)` re-runs the derivation for the current sources, replaces the value in the snapshot, and flips the isolated flag to 0. This is the only path where derivation overwrites an isolated-then-unpinned token.

All three mutators are pure in-memory; the buffer flushes to SQLite when the editor commits.

Imported themes route unknown keys to be dropped: only keys present in `APP_TOKEN_KEYS` / `CALENDAR_TOKEN_KEYS` (and only valid hex values) survive validation.

### Sources

A theme can ship a `sources` object with six hex colors. The first four form the **app foundation**, the last two are **semantic signals**:

- `canvas`: app background. Every derived surface (card, popover, secondary, muted, accent, sidebar, event panel, calendar canvas) is computed by shifting this color's OKLab lightness by a signed per-token offset, so editing canvas cascades through the full surface stack including the calendar.
- `ink`: text base. The starting anchor for the contrast-aware pickers that drive `--foreground` (against canvas) and `--card-foreground` (against the card surface), the form indicator dot, the pomodoro idle caption, and the event panel's placeholder and muted captions. Because `--foreground` and `--card-foreground` both flow through `pickReadableForeground`, darkening canvas or tinting a card surface automatically flips the body text to the high-contrast side instead of stranding the user with black text on black.
- `primary`: brand/action accent, used directly for `--primary`.
- `destructive`: danger signal. Identity-drives `--destructive`, `--action-danger-armed`, and `--status-declined` so the delete button, armed-delete state, and declined attendance tile stay consistent.
- `confirm`: positive signal. Identity-drives `--action-confirm` (save button, active scope pill) and `--status-accepted` (accepted attendance tile).
- `warning`: caution signal. Identity-drives `--status-tentative` today; reserved for future notification warnings and deadline accents.

Editing one source color propagates through the derivation tables and shifts every non-isolated token in lockstep. Isolated tokens are untouched, so the user can let the engine drive the coherent parts of the shell while surgically fixing specific tokens (pinning `--card` to pure white, for example). Calendar canvas sits between the two: it auto-derives from `canvas` by default, but flagging `--cal-bg` isolated lets the user paint the grid a different color than the app canvas.

### Derivation formulas

The derivation engine is calibrated end-to-end against the dark built-in. Feeding its six sources (canvas `#27282A`, ink `#ECECF2`, primary `#ECECF2`, destructive `#E54545`, confirm `#065F46`, warning `#F59E0B`) back through `deriveAppTokens` / `deriveCalendarTokens` reproduces `BASE_APP_TOKENS.dark` and `BASE_CALENDAR_TOKENS.dark` exactly on source-pinned and hardcoded tokens, and within a 2 rgb-unit tolerance (roughly 0.005 OKLab-L) on every shift-derived or walk-fraction token. That identity is what makes editing `canvas` cascade correctly: every surface moves in lockstep because every formula is a delta off canvas (or a fraction between ink and the paired surface), not a pinned value. Light-theme clones naturally drift from BASE.light (whose values are curated, not derivation output), but every derived pair still passes its contrast target.

The engine combines three kinds of computations:

- **Shift-derived surfaces** (card, popover, secondary, muted, accent, sidebar, sidebar-accent, event-panel-bg, event-panel-contrast, cal-bg, cal-timeline-rail) are produced by `shiftPerceptualL(canvas, deltaL)`. The per-token deltas in `APP_DERIVATION` are the measured BASE.dark OKLab-L diffs between canvas and each surface hex. Card (+0.028), popover (+0.056), accent (+0.077) lift above canvas; sidebar (-0.039) recedes below canvas so the title bar frames the app (the "contrarian" step that makes the dark built-in read as layered). Event-panel-bg (+0.013) sits just above canvas and event-panel-contrast (-0.021) just below, keeping the recessed band behind the floating panel visible on any canvas. Near-white or near-black canvases clamp the upper or lower tiers at the gamut boundary (accent, popover, and card can all collapse to `#ffffff` on a pure-white canvas, for example), which is expected clamp behavior rather than a layout failure. Calendar canvas is a direction-aware shift: dark canvases (relative luminance below 0.5) receive `calCanvasDarkDeltaL` (-0.089) so `--cal-bg` recedes into the grid, while light canvases receive `calCanvasLightDeltaL` (+0.032) so the grid lifts gently above the app background. The calendar timeline rail is derived the same way but on top of `--cal-bg`, not canvas: dark cal-bg receives `timelineRailDarkDeltaL` (+0.183), light cal-bg receives `timelineRailLightDeltaL` (-0.072).
- **Walk-fraction tokens** (muted-foreground, ring, event-panel-divider, event-panel-text, event-panel-input-text, event-panel-placeholder, event-panel-muted-text, pomodoro-idle-text, cal-time-label, cal-timeline-break) are produced by `walkFraction(ink, paired-bg, fraction)`. The fractions in `APP_FRACTIONS` and `CAL_FRACTIONS` are measured from BASE.dark: each token's OKLab-L position as a fraction of the way from ink to its paired surface. BASE.dark's muted-foreground `#9494A0` sits at fraction 0.443 from ink (`L=0.893`) toward its muted bg, ring `#606070` sits at 0.673 from ink toward canvas, and so on. A contrast-target walk cannot reproduce those hexes because BASE.dark's own contrast sits between 3:1 and 4.5:1 in ways that don't collapse to a single target, so the fraction-based walk is the only way to hit BASE.dark identity while still cascading consistently on any canvas.
- **Contrast-picked and hardcoded foregrounds.** `pickReadableForeground` resolves `--foreground`, `--card-foreground`, `--popover-foreground`, `--primary-foreground`, `--secondary-foreground`, and `--accent-foreground` against their paired surface so body text always meets AA 4.5:1. `pickBrightForeground` resolves `--destructive-foreground`, `--action-danger-armed-foreground`, `--status-accepted-foreground`, `--status-declined-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground`, and `--pomodoro-idle-timer` so status signals and sidebar text snap to `#FFFFFF` (or ink, or `#000000`) at 3:1 or higher. `--action-confirm-foreground` is the special case: it starts with `shiftPerceptualL(confirm, +0.519)` so BASE.dark produces its pale green `#D1FAE5` on `#065F46` and BASE.light clamps to white on `#059669`; the result is checked against a 3:1 floor and falls back to `pickReadableForeground` only when the source confirm is bright enough that the shift collapses to low contrast (e.g., a pure `#00FF7F`). `--status-tentative-foreground` is hardcoded to `#FFFFFF` to match BASE.dark/light's intentional low-contrast signal on bright warnings. `--form-indicator` is hardcoded to ink so the radio/checkbox dot tracks the user's text color directly. `--cal-drag-preview-border` branches on canvas luminance: dark canvases get `#FFFFFF80`, light canvases get `#0000004D`. `--cal-gridline` uses `pickReadableBorder` with a lowered 1.4:1 target so cloned themes inherit the built-in's subtle gridline style instead of painting prominent lines.

Confirm, warning, and destructive propagate through identity derivation: one source color feeds both the button state and the corresponding status tile, so users pick three semantic accents (green, amber, red) and every surface that carries that meaning stays consistent.

The test suite asserts: every derivable body-text pair meets AA 4.5:1; status/destructive/confirm pairs meet AA-large 3:1 (tentative is excluded because BASE itself paints white on `#F59E0B` at 1.46:1 as an intentional low-contrast design); muted captions park in `[3.0, 5.0]` (the upper bound accommodates gamut clamping on near-white canvases); event-panel divider sits at or above 1.4:1 against the panel; calendar gridline sits at or above 1.4:1 against cal-bg; calendar time label and timeline-break sit at or above 3:1 against cal-bg; `sidebar <= canvas <= card <= popover <= accent` OKLab-L ordering holds on every canvas with headroom; feeding BASE.dark's sources reproduces BASE.dark exactly on source-driven and hardcoded tokens, and within 2 rgb-units on every shift-derived or walk-fraction token.

The derivable calendar tokens are `--cal-bg`, `--cal-header-bg`, `--cal-gridline`, `--cal-time-label`, `--cal-timeline-rail`, and `--cal-timeline-break`. `--cal-today-circle` and `--cal-today-circle-text` are no longer derived from sources: the today-marker's hand-tuned blue on dark and dark-gray on light carries a semantic meaning that does not reduce cleanly to the source palette, so the snapshot stores the BASE CSS hex on clone and users can isolate either token to repaint it. `--cal-current-time` (red "now" line) and `--cal-timeline-focus` (green pomodoro marker) follow the same convention.

### Editor UI

Every user theme carries a `sources` palette and a full token snapshot at clone time (see "Custom theme workflow"). The body renders every group inline with no mode selector: every source color and every driven token is reachable, and source-driven multi-row groups start collapsed so the list opens scannable (one row per group header). Expanding a group reveals every pinnable sub-row that can be isolated individually.

Groups are ordered top-to-bottom as a three-tier walkthrough: app and calendar foundation, semantic signals, then other feature surfaces. Calendar surface, calendar details, and event panel sit immediately after App canvas so the calendar colors that visually depend on the canvas are reachable before the user reaches the later semantic warning rows. Inside each tier, shell tokens live under the source color that drives them when a source exists, making the relationship visible without scrolling past a flat list.

**Tier 1 (app and calendar foundation)** starts with the dominant canvas, keeps the calendar grid and event panel controls beside it, then continues through the remaining core shell sources:

- **App canvas**: the dominant background color. Drives background, card, popover (paired with its text), secondary surface, muted surface, hover highlight, focus ring, title bar, and title bar hover. Editing it shifts the entire non-accent palette at once.
- **Calendar surface**: a sourceless card covering the auto-derived calendar background and its driven tokens. The card header carries no source color (the grid background tracks the app canvas by default). Sub-rows expose `--cal-bg` (isolate to pin a specific grid color), `--cal-header-bg`, `--cal-gridline`, `--cal-time-label`, and `--cal-timeline-rail`. Isolating `--cal-bg` breaks the auto-derivation so the user can paint the grid a different color than the app canvas.
- **Calendar details**: a sourceless card that collects every non-derived calendar color. Merges the former "Calendar markers" and "Calendar extras" into one group: today marker (pair), now line, break marker, focus marker, color-picker outline, description editor tint, and the all-day drag-preview border.
- **Event panel**: nine sub-rows painting the event creation/edit panel surface, section-header strip, outer edge, drop shadow, title divider, input text, placeholder, body text, and muted captions. Sourceless today; grouping the nine tokens together keeps them visible as a block near the calendar controls that use them.
- **Ink**: base text color. Anchors the contrast-aware pickers that derive every foreground, border, and muted caption. Sub-rows cover `--foreground`, `--form-indicator`, and `--pomodoro-idle-text`.
- **Primary action**: main accent for highlighted buttons and links. The source drives the button background directly (identity derivation) and the button text through contrast pick; a single sub-row exposes `--primary-foreground` for isolation.
- **Destructive**: danger signal. Sub-rows cover `--destructive`, `--action-danger-armed`, and `--status-declined` so the user can either let the one red drive all three or isolate any tile.

**Tier 2 (semantic signals)** adds the positive and cautionary accents:

- **Confirm**: drives the save button (paired bg + text), the active scope pill, and the accepted attendance tile. The pair row exposes `--action-confirm` alongside `--action-confirm-foreground`; a follow-up single row exposes `--status-accepted`.
- **Warning**: drives the tentative attendance tile today. Ships with one sub-row (`--status-tentative`) and is reserved for future notification warnings and deadline accents.

**Tier 3 (other feature surfaces)** keeps the remaining feature-scoped colors adjacent so nothing is scattered:

- **Task priority**: four sub-rows for the kanban priority badges (`--priority-easy`, `--priority-medium`, `--priority-hard`, `--priority-epic`). Each token feeds both the badge background (at 20% opacity) and the label text at full opacity.

The editor chrome lives directly below the floating panel's drag header and outside the editor scroll viewport. The scrollbar belongs only to the editable body, so it starts at App canvas rather than beside the name row and section index. The chrome uses the same solid sidebar surface as the drag header, with no overlay opacity, and draws a bottom divider before the editable body. The theme identity row is a single compound field with one border, one background, and a fixed height matching the section index. It uses the same background treatment, font size, and muted text color as the section index. Its left slot holds a compact decorative day/night icon sized to the smaller typography, and a subtle divider separates it from the name text. Focusing the icon or name input does not add a wrapper highlight; the field stays visually stable while editing. Built-in themes show the decorative day/night icon and read-only name. User themes keep the icon slot clickable for flipping the decorative tag and keep the name text editable, so renaming remains available even after the user scrolls deep into palette or JSON rows. The header keeps its compact original height and has its own divider above the editor chrome.

For user themes, the editor chrome also contains a compact horizontal section index below the name row. It jumps to the start of each major editor region: **General** to App canvas, **Calendar** to Calendar surface, **Signals** to Ink and the Ink through Warning source block, **To-do** to Task priority, and **JSON** to the raw JSON editor.

When user-theme contrast checks fail, a compact floating notice appears at the bottom of the editor's scroll area, above the panel footer. It is not part of the footer and it does not appear when checks pass. The notice keeps a neutral card background and border; only the warning icon uses the warning color. It includes Jump to next and Fix all actions and the scroll content gets extra bottom padding while the notice is present so the notice does not cover the final editor controls.

The header has three parts, all on one row: the title and description on the left (non-interactive), the source `ColorField` in the center of the right cluster (hidden on sourceless cards), and an **Expand** / **Collapse** button on the right. The collapse button is gated on **source presence and at least two rows**: it exists to amortize a long list when one color at the top drives everything below, so sourceless cards (Calendar surface, Calendar details, Event panel, Task priority) drop the button and show all sub-rows inline, and source-driven single-row cards (Primary action, Warning) drop it too and render their one sub-row as a peer of the source. Collapsible groups start collapsed so the editor opens scannable. Whenever the current value of a source color drifts from the clone-time seed, a small reset icon appears next to its `ColorField`; clicking it restores that channel only (see "Seed snapshots" above for the details).

Driven rows render below the header with two distinct layouts.

**Peer-style rows** (used when a source-driven group has exactly one sub-row): the row uses the same bold header typography (`text-[13px] font-semibold`) so the driven token reads as a peer of its source rather than a subordinate option. The right side shows an always-editable `ColorField` followed by an optional reset icon and an invisible placeholder sized to match the header's action slot. There is no Isolated edit or Link back button: editing the field directly calls `setTokenValue` (which implicitly flags the row isolated through the editor's gating), and clicking the reset icon restores both value and isolated flag from the seed snapshot.

**Sub-option rows** (used in multi-row groups, whether or not they have a source): rows render as a list where each row reflects the value of its `isolated` flag:

- **Linked** (`isolated=0`): the `ColorField` renders its swatch and hex input in a disabled state (reduced opacity, not-allowed cursor) showing the current snapshot value, with an **Isolated edit** action button. Clicking it calls `isolateToken`, which flips the flag to 1 without changing the value (the snapshot already holds the auto value), and swaps the row to the Isolated state.
- **Isolated** (`isolated=1`): the same `ColorField` becomes fully editable (swatch opens the picker, hex input accepts input), with a **Link back** action that calls `relinkToken`, which re-runs derivation for the current sources, writes the result, and flips the flag back to 0.

Sourceless multi-row cards skip the Linked state entirely: every sub-row is always editable because there is no source to link back to. The HEX value is always visible, which keeps the actual color number readable even for linked rows. When a row's current value or isolated flag differs from the seed snapshot, a small reset icon appears between the `ColorField` and the action button; clicking it restores both columns for that row.

Every pair row (source + foreground) shows a live contrast indicator (see "Contrast warnings" below) so the user can spot a failing combination and auto-fix it without leaving the editor.

### Contrast warnings

On every pair row (a source and its paired foreground), the editor resolves the effective foreground/background contrast at render time and compares it to a per-pair target. Most pairs target AA body text (4.5:1); pairs whose foreground is intentionally recessed (today only the muted surface, `--muted` paired with `--muted-foreground`) declare a lower target (3:1, AA-large) on their row definition so the warning panel respects the design intent. The muted pair covers captions and the past-day numbers in MonthView, both of which are supposed to fade. If the ratio falls below the row's own target, the editor shows a small amber warning pill next to the row with the current ratio and a wand button that calls `pickReadableForeground` with that row's target and writes the result as an override. The warning disappears automatically once the pair meets the target. Warnings are non-blocking: the user can still save a theme that fails contrast.

A floating **contrast notice** appears at the bottom of the editor body when at least one contrast check fails. It aggregates every pair row across every group (including rows collapsed inside an accordion) using each row's own target and reports the number of failing pairs. The notice keeps neutral card styling; only its warning icon uses the warning color. It exposes two actions: **Jump to next** cycles through the failing rows, expanding the target row's group when needed before scrolling it into view, and **Fix all** runs the per-row auto-fix on every failing pair at once. Together they mean a warning produced by a distant edit can no longer hide behind an unopened accordion, while recessed captions no longer produce false-positive warnings for behaving exactly as intended.

### Preset picker

`ThemePresetPicker` opens as a modal when the user clicks "New theme". It renders a 2x3 grid of curated presets (Sunrise, Graphite, Sepia, Nordic, High-contrast Dark, Lavender Pastel), each validated at build time by `themePresets.test.ts` to meet AA contrast across every derived foreground, border, and gridline. Every card shows a miniature preview painted from its own sources (inline CSS variables on the card root). A "Start blank" affordance under the grid keeps the original path that clones from the current active theme. Picking a preset seeds the new theme with that preset's `sources`, `base`, and `displayName` before opening the editor.

### Editor chrome tracks the live theme

The editor panel paints from the live user theme: `bg-card`, `text-foreground`, `border-border`, and every other Tailwind class inside the editor resolves to the user's current resolved tokens. Editing canvas therefore gives immediate visual feedback on the panel itself, not just on the app underneath. Legibility is handled by the contrast-aware derivation rather than by shadowing: `--foreground` and `--card-foreground` are `pickReadableForeground` against their paired surfaces with the endpoint-preference fallback, so even when the user drags canvas close to ink the foregrounds snap decisively to black or white instead of settling on a muddy mid-gray.

The only exceptions are three fixed base-only tokens used by `ColorField`: `--editor-chrome-thumb-border` (SV / hue / alpha slider thumb outlines) and `--editor-chrome-checker-a` / `-b` (the conic-gradient checker pattern behind the alpha slider). These stay independent of the live theme so the thumbs and the transparency pattern remain visible against any gradient the picker renders.

### Semantic tokens

The editor exposes the following semantic tokens beyond the core shell surfaces. Most of them sit under a source color whose change propagates to the whole group (form indicator and pomodoro idle caption under Ink, armed delete and declined status under Destructive, confirm + accepted under Confirm, tentative under Warning). The remainder live under sourceless feature cards so their relationship to a feature stays obvious, but no single source drives them.

Distribution across the editor:

- **Ink tints** (3): `--form-indicator` (radio/checkbox dot inside calendar sub-sections), `--pomodoro-idle-text` (caption on the idle overlay), and `--pomodoro-idle-timer` (the big countdown on the idle overlay). Form indicator is `pickReadableForeground(canvas, { ink, canvas, target: 4.5 })` so it flips direction when canvas flips without requiring an ink edit, idle caption uses `walkFraction(anchor, "#000000", 0.245)` against the overlay's black surface at BASE.dark's fraction (anchor contrast-picked against black, which resolves to ink on any reasonable theme), and the idle timer uses `pickBrightForeground` so it stays pure white against the overlay.
- **Destructive family** (4): `--action-danger-armed` + `--action-danger-armed-foreground` (delete button once armed) and `--status-declined` + `--status-declined-foreground` (declined attendance tile). Backgrounds identity-derive from `destructive`; foregrounds are contrast-picked.
- **Confirm family** (4): `--action-confirm` + `--action-confirm-foreground` (save button, active scope pill) and `--status-accepted` + `--status-accepted-foreground` (accepted attendance tile). Backgrounds identity-derive from `confirm`; foregrounds are contrast-picked.
- **Warning family** (2): `--status-tentative` + `--status-tentative-foreground` (tentative attendance tile). Background identity-derives from `warning`; foreground is contrast-picked.
- **Primary foreground** (1): `--primary-foreground`. Contrast-picked from the primary source so tinted pastel primaries flip to dark text automatically.
- **Destructive foreground core** (1): `--destructive-foreground`, same treatment for the destructive source.
- **Calendar details** (7, sourceless): Today marker (pair of circle + inner text), now line, break marker, focus marker, event-color-picker outline, description editor tint, and the all-day drag-preview border. The today marker, now line, and focus marker carry hard-coded semantic meaning that does not reduce to the source palette, so the snapshot stores the BASE CSS value on clone; users can still isolate any of them to repaint them.
- **Event panel** (9, sourceless): `--event-panel-bg`, `--event-panel-contrast`, `--event-panel-edge`, `--event-panel-shadow`, `--event-panel-divider`, `--event-panel-input-text`, `--event-panel-placeholder`, `--event-panel-text`, `--event-panel-muted-text`. Backgrounds shift off canvas by calibrated deltas; divider, body, input, placeholder, and muted text each use `walkFraction(ink, event-panel-bg, fraction)` with BASE.dark-measured fractions so the panel reads with the dark built-in's typographic hierarchy on any canvas.
- **Task priority** (4, sourceless): `--priority-easy`, `--priority-medium`, `--priority-hard`, `--priority-epic`. Each token feeds both the background (tinted toward canvas) and the label text; the Kanban column reads these directly and picks legible text through `pickReadableForeground`.

Four tokens carry alpha: `--event-panel-edge`, `--event-panel-shadow`, `--cal-description-editor-bg`, `--cal-drag-preview-border`. `ColorField` accepts and emits 8-digit `#rrggbbaa` for them, with a fourth slider (A) in the picker popover and a checkerboard swatch on the trigger so transparency is visible. Alpha-bearing tokens skip the Tailwind `@theme inline` alias and are consumed via plain CSS variables in scoped styles or inline `style` attributes.

Sourceless semantic tokens are stored in the snapshot like every other token: their seed value matches the BASE CSS hex on clone, so a user who never opens those rows sees the byte-for-byte default values; a user who isolates one gets a surgical override that survives theme export/import.

## Engine version and rebaking

The derivation engine evolves over time. New shift constants, new fractions, new contrast picks, or a new token in `APP_TOKEN_KEYS` can all change what `deriveAppTokens` and `deriveCalendarTokens` produce for the same sources. To make those shifts opt-in, every user theme stores a `derivationEngineVersion` integer, and the code carries a matching `DERIVATION_ENGINE_VERSION` constant in `themes.ts`.

The constant bumps whenever derivation output would change for unchanged sources. Themes stamped at the current constant render exactly the engine's current output; themes stamped at a lower number render the snapshot they were saved with, untouched by the new derivation tables.

The editor surfaces an inline rebake banner when:

- The loaded theme's `derivationEngineVersion` is below the code constant, AND
- `theme_upgrade_dismissals` does not contain a row for `(theme_id, currentVersion)`.

The banner offers two actions:

- **Rebake** calls `rebakeTheme(themeId)`. The store re-runs `deriveAppTokens` / `deriveCalendarTokens` against the theme's current sources, overwrites every non-isolated token in the in-memory snapshot with the new derived hex, stamps `derivationEngineVersion` at the current constant, and (if `--cal-bg` is non-isolated) updates `blendCanvas` to the new derived `--cal-bg`. Isolated tokens are preserved verbatim. Like every other editor mutator the change stays in `$state` until "Save and apply" flushes through `persistThemeToDb`.
- **Maybe later** records the dismissal in `dismissals` and, for an existing theme, immediately writes a row into `theme_upgrade_dismissals`. For a fresh theme that has not been persisted yet, the dismissal is queued in `pendingDismissals` and gets written right after the parent theme insert during commit. The banner stops appearing for this theme until the constant bumps again.

Clones inherit their source's stamp verbatim (a clone of a built-in stamps at the current constant). v1 JSON imports take the file's `derivationEngineVersion`; legacy imports stamp at the current constant because the legacy import re-derives at import time. The vault-to-SQLite migration also stamps at the current constant since it runs the current derivation when synthesizing the snapshot.

## Migration from vault to SQLite

The shift from a `themes.user` blob in `vault/config.json` to normalized SQLite rows runs once per install. `apps/client/src/main.ts` awaits `ensureConfigLoaded()` and then `hydrateUserThemes()` before mounting the app; `hydrateUserThemes` calls `migrateVaultThemesIfPresent()` first, then loads every theme from the DB into the in-memory store and applies the active theme.

The migration:

1. Reads `themes.user` from the config cache. If it is missing or empty, exits early (idempotent on every subsequent boot).
2. Walks each entry through `validateThemeJson`. Legacy entries lacking `sources` or seed mirrors get them synthesized from the resolved palette and the current derivation engine, stamping `derivationEngineVersion` at the current code constant.
3. Inserts each theme through `insertTheme(theme)`, which writes the row in `themes`, every snapshot row in `theme_tokens` and `theme_event_palette`, and every seed mirror row in `theme_seed_tokens` and `theme_seed_event_palette`, all in one transaction.
4. After every theme inserts successfully, calls `setConfigKey("themes.user", undefined)` and `flushConfig()` to commit the deletion. A second boot sees no `themes.user` and exits at step 1.

The migration is idempotent because it gates on the presence of `themes.user`. If a single theme fails validation it is skipped (logged once); the rest still land. Built-in themes never touch this path: they live as code constants in `BUILTIN_THEME_REGISTRY` and are filtered out of any imported JSON before insertion.

## Typography and density

Font family, font size, and UI density are user preferences, not part of the Theme model. They live in the app's settings and apply globally regardless of the active theme.

- **Font family:** picked from a curated list of system fallbacks (plus "system default"). No font file loading and no remote fetches, so the typography layer stays privacy-safe and offline.
- **Font scale:** a multiplier clamped to a safe range (roughly 0.85 to 1.3) so layout cannot break. Applied as a CSS custom property on the root.
- **Density:** compact, comfortable, or spacious. Controls padding and row heights through a small token set.

Themes may ship a recommended font or density as a suggestion the user can accept when switching, but the active values stay under user control. Typography and density are kept orthogonal to themes on purpose: users commonly want any theme paired with any density or font scale, and font or spacing changes are far more likely to break layout than color changes. The Theme contract stays narrow today and can widen later if a strong reason appears; widening is safe, narrowing would break existing themes.

## What this doc does not cover

- How events store the chosen color (see `data/schema.md`, `calendar_events.color`).
- The calendar event model and rendering (see `features/calendar.md`).
- Dimmed-variant weights for specific rail or band states (see `features/pomodoro-progress-displays.md`).

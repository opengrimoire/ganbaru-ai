# Themes

GanbaruAI ships curated themes and lets users author their own in-app. A theme recolors the built-in light and dark palette across every event slot and across the app and calendar shell. Users can run the built-in themes, pick a user-authored one, or edit slot hexes in a theme editor. Adding a new theme is a data-only change: one Theme object in the registry.

Theming is intentionally color-deep, not structure-deep. Themes set colors across the event palette and the app and calendar shell; they do not change layout, add custom components, or control typography. Font family, font size, and UI density live as separate user settings (see "Typography and density" below), orthogonal to the active theme. Heavier UI edits belong upstream (as contributions to the app) or in a fork. Keeping the theme format a validated data contract means no code execution, no remote asset loading, no DOM rewriting, and a stable contract across app updates.

This doc covers the theme model, the event color palette, the ideal custom-theme workflow, persistence, and the rules that keep stored events safe as palettes evolve.

## The Theme model

A Theme is a self-contained visual package. The minimum fields:

- **id:** stable string used in storage and lookups. Built-in IDs are `light` and `dark`. Custom themes use slugs or UUIDs.
- **displayName:** user-visible name in the theme picker.
- **base:** `light` or `dark`. A cosmetic label only, surfaced as the sun/moon indicator in the theme list and editor header. It has no effect on derived colors or on the `.dark` class, both of which are driven by the actual canvas luminance (see "Luminance-driven base detection" below). Kept as a data field for built-in themes (which carry no `sources`) and for preset defaults.
- **eventPalette:** ordered array of 24 hex values (one per slot index). Every position must be filled, even if the theme reuses the same color across multiple slots. See "Event color palette" below.
- **blendCanvas:** hex color the dimmed event variants blend toward. Usually the theme's canvas background.

Optional fields reserved for shell theming:

- **sources:** six-color palette (`canvas`, `ink`, `primary`, `destructive`, `confirm`, `warning`) that drives the rest of the shell through the derivation engine. Calendar canvas is not a source: it auto-derives from the app canvas via a direction-aware OKLab ΔL offset (see "Derivation formulas" below) and is pinnable through `calendarTokenOverrides["--cal-bg"]` when the user wants to isolate it. Omitted on both built-ins, so they resolve straight to the base CSS. See "Sources and derivation" below.
- **appTokenOverrides:** map of app-level CSS tokens (`--primary`, `--background`, etc.) to hex values. Applied on theme switch via `root.style.setProperty`. Pinned values here win over derivation and base CSS.
- **calendarTokenOverrides:** same idea, scoped to calendar shell tokens (`--cal-bg`, `--cal-gridline`, etc.).

A Theme is frozen after construction. The registry itself is frozen. This prevents runtime mutation of a shipped theme by accident.

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
- `pickReadableBorder(bg, ink, { target })` walks from `bg` toward `ink` until the ratio hits the target (default 3:1). Falls back to pure black or white if the ink is too close to the bg.
- `pickReadableMuted(bg, ink, { target })` walks from `ink` toward `bg` until the ratio drops to exactly the target, so muted captions sit at the deepest recession that still reads (AA-large, ~3:1).

OKLab is implemented from D65 matrix math in the same file (no external dependency). A 10,000-iteration fuzz test asserts `pickReadableForeground` always meets its target; round-trip tolerance tests lock OKLab accuracy inside 1 channel out of 255.

Event-tile text still uses the legacy threshold-based `pickContrastText` (Rec. 709 luminance on raw sRGB) because the event palette was calibrated against those specific thresholds. Dimmed event variants (past, cancelled, transparent, outside-month) are computed by blending the event's base hex toward the theme's `blendCanvas` with a fixed weight; text contrast is recomputed from the dimmed bg and cached per (theme ID, slot, weight).

## Luminance-driven base detection

Whether a theme "is dark" is a runtime property of its canvas, not a stored label. Two helpers in `stores/themes.ts` do the bucketing:

- `isThemeDark(theme)` resolves `--background` through the standard override/sources/base fallback chain and returns true when its relative luminance sits below `DARK_SURFACE_THRESHOLD` (0.4). Used to toggle the `.dark` class on the HTML root.
- `isThemeCalendarDark(theme)` does the same for `--cal-bg`, which either matches the auto-derived calendar canvas (the default) or a user-pinned override from `calendarTokenOverrides["--cal-bg"]`. Event tiles need to pick their palette against the surface they actually sit on, which is not always the same as the app canvas.

Both helpers decouple every "is it dark?" check from `theme.base`. Users can invert a theme's canvas mid-edit without fighting a stale label: the `.dark` class flips immediately, and event tiles pick the right palette on the very next frame. The 0.4 threshold is intentionally below the sRGB midpoint so a mid-gray canvas (~#888) still resolves as light.

## Persistence

The active theme ID, user-authored themes, font family, and font scale all live in `vault/config.json` under dotted keys (`theme.activeId`, `themes.user`, `preferences.fontFamilyId`, `preferences.fontScale`). The vault folder defaults to `app_config_dir / "vault"` and is created on first launch. Writes are atomic: the Rust backend serializes to `config.json.tmp`, fsyncs, and renames into place, so a crash mid-write leaves either the previous good file or an ignored temp.

The frontend bridge (`lib/vault/config.ts`) loads the config once at boot, exposes synchronous reads against an in-memory cache, and debounces writes (250 ms) so rapid edits coalesce into one disk write. Stores hydrate from the cache on first read, keeping first paint synchronous.

The first vault load runs a one-time migration that copies the legacy `ganbaruai-theme`, `ganbaruai-font-family`, and `ganbaruai-font-scale` keys out of `localStorage` and removes them. The migration is idempotent.

Built-in themes are validated through `validateThemeJson` on load (defense in depth against tampered config files). Unknown or invalid theme IDs fall back to the default (`dark`).

## Custom theme workflow

Themes are managed from the single Appearance section in Settings. The section lists every theme (built-ins first, user themes below) above the font and zoom controls. Opening one hands off to a floating theme editor: the Settings modal closes and a draggable panel appears in the top-right of the viewport. The panel has no backdrop, so the app underneath stays interactive and every edit can be verified live (switch tabs, hover rows, open dialogs) without dismissing the editor. A grip in the panel's header lets the user drag it anywhere (constrained so at least the drag handle stays on screen), and a chevron toggle next to the grip collapses the panel to just its header and footer so the rest of the app can be inspected without dismissing the editor. The sticky footer exposes two actions: Back to themes rolls the session back (restores the theme's pre-edit JSON, or deletes the theme outright when it was minted for this session through New or Duplicate and edit, then reinstates the theme that was active before the session opened) and reopens Settings on the list. Save and apply keeps the edits, leaves the edited theme active (it was activated on open for live preview), and returns to the same list. Editing a built-in swaps the primary label to Apply and return since there is nothing to save. A forced close of the app while the editor is open triggers a best-effort cancel through the close-confirm dialog; because vault writes are debounced the rollback is not guaranteed to flush.

Users can:

1. **Create a theme** by clicking "New theme". A user theme is added (seeded from the current active theme) and the editor opens on it.
2. **Duplicate and edit** any theme (built-in or user) into a new editable user theme. The duplicate is immediately applied as the active theme and the editor opens on it, so the user sees their edits live from the first change. Built-ins remain frozen.
3. **View a built-in**. The detail view renders the name, base label, and a read-only palette preview alongside any shell overrides the theme ships. A JSON panel shows the serialized theme with Copy and Save buttons.
4. **Edit a user theme**: rename it, tweak any of the 24 event-palette hexes through an in-house HSL color picker, edit the six Quick sources (canvas, ink, primary, destructive, confirm, warning) to shift the shell in lockstep, and click Isolated edit on any driven row to break it off the source for a surgical edit (Link back re-links it). The sun/moon icon in the header reflects the canvas luminance and is not toggleable: crafting a dark theme is just a matter of darkening the canvas source. The same JSON panel is editable; pressing Apply changes validates the draft through `replaceTheme` and commits it in place (id locked).
5. **Reset a single color** back to its clone-time value. Every row in the editor, both source colors in the group headers and the driven tokens below, gets a small reset icon next to the color field whenever the current value differs from the snapshot captured at clone time (see "Seed snapshots" below). Clicking it restores just that one control: a source channel goes back to its seed hex; a driven token goes back to its seed override, or, if the seed had no override for it, the token is relinked so derivation takes over again. Other rows are untouched.
6. **Reset every color** in one click via the "Reset all" button in the footer. Restores every source to its seed hex, wipes every app and calendar override, and restores the event palette and blend canvas to their seed values in a single update. The button is disabled when the theme is already at its seed state. Legacy themes cloned before the seed feature shipped have their seeds synthesized on first load (see "Seed snapshots" below) so the reset machinery works uniformly across the registry.
7. **Apply** any registered theme by clicking its row. The active theme is highlighted; switching is non-destructive (only the active ID changes).
8. **Share** a theme by exporting it from the detail view. Copy JSON writes to the clipboard; Save to file uses the native save dialog. Import accepts pasted JSON or a file picked through the open dialog. Imported themes get a fresh slug ID if their incoming ID would collide with an existing user theme.
9. **Delete** a user theme. If the deleted theme was active, the store falls back to the default theme.

Every new user theme (created or duplicated) starts with a `sources` palette sampled from its resolved colors, so the editor opens in Quick-colors mode and source edits immediately propagate through derived tokens. Explicit overrides on the source theme are preserved as pinned tokens so surgical edits survive the duplicate.

"Duplicate and edit" from a built-in additionally captures an **identity override** for every derived token whose value under the synthesized sources would differ from what the built-in actually rendered, so the clone starts byte-identical to the source. Those captured tokens render as Isolated rows in the editor, and the user can Link back any of them to bring the token back into the source-driven cascade. Clones of source-driven user themes skip this capture because their cascade already reproduces the source's look exactly.

Clicking "New theme" opens a preset picker before the editor mounts (see "Preset picker" below). Picking a curated preset seeds the new theme with a pre-validated palette; "Start blank" keeps the original path that seeds from the active theme.

Editing a built-in is blocked at the store level: mutators return false, `replaceTheme` rejects built-in ids, and the editor hides every input (name field, color pickers, add-override buttons) when the target is built-in. Duplicate is the only path to a modifiable copy.

### Seed snapshots

`cloneTheme` captures two snapshots on every clone, both stored on the Theme as optional fields and both persisted in the vault so per-row reset and "Reset all" survive a relaunch:

- **Input seeds** (`seedSources`, `seedAppTokenOverrides`, `seedCalendarTokenOverrides`, `seedBlendCanvas`, `seedEventPalette`): the editable inputs the theme had immediately after cloning. Per-row reset compares the current value of each control against the matching field on these seeds, shows a reset icon when they differ, and on click restores just that control: a source channel goes back to `seedSources[key]`, a token override either reverts to `seedAppTokenOverrides[key]` / `seedCalendarTokenOverrides[key]` or, if the seed had no override for that token, is cleared so derivation takes over again. "Reset all" restores every source, override, palette slot, and blend canvas from these seeds in a single update.
- **Resolved seeds** (`seedAppTokens`, `seedCalendarTokens`): the fully resolved token palette at clone time. Retained for future resolved-value comparisons; nothing reads them yet.

Built-in themes never carry seeds. User themes created before the input seeds were added are synthesized on first load by `synthesizeSeedsIfMissing`: if the stored theme has no `seedSources`, the current live values are captured as the seeds (sources come from the theme's `sources` field if present, otherwise from key channels of the resolved palette). The synthesizer is idempotent, so repeated loads produce the same seeded theme. After this one-time migration runs, "Reset all" is enabled and per-row reset icons appear exactly as they do on fresh clones.

Input seeds are not exported in the JSON payload: `serializeTheme` omits every seed field so the exported file describes the theme as portable data, not as a forked snapshot with history. Reset is an install-local affordance; sharing a theme ships just the current colors.

## Shell token derivation and overrides

The app and calendar shell are styled through CSS tokens defined in `app.css` under `:root` (light) and `.dark` (dark). User themes can tint or pin those tokens through a three-layer pipeline: override, derived, base.

### Resolution order

For each token in `APP_TOKEN_KEYS` (50 entries) or `CALENDAR_TOKEN_KEYS` (10 entries):

1. **Override (pinned).** `theme.appTokenOverrides[key]` / `theme.calendarTokenOverrides[key]` if set.
2. **Derived (auto).** If the theme carries `sources` and the token is covered by the derivation engine, the engine's value for that token.
3. **Default.** The base CSS rule (`:root` for light, `.dark` for dark) read from `BASE_APP_TOKENS` / `BASE_CALENDAR_TOKENS`.

Built-in themes ship without `sources` and without overrides, so every token resolves at layer 3, byte-identical to the pre-derivation behavior. When a theme with sources or overrides is applied, `computeThemeTokenOps` merges derived values first and then pinned overrides, pushing the result to the root via `root.style.setProperty`. Switching themes clears tokens set by the previous theme that the next one does not cover.

Unknown keys in overrides are stripped on import; only valid hex values are accepted.

### Sources

A theme can ship a `sources` object with six hex colors. The first four form the **app foundation**, the last two are **semantic signals**:

- `canvas`: app background. Every derived surface (card, popover, secondary, muted, accent, sidebar, event panel, calendar canvas) is computed by shifting this color's OKLab lightness by a signed per-token offset, so editing canvas cascades through the full surface stack including the calendar.
- `ink`: text base. The starting anchor for the contrast-aware pickers that drive `--foreground` (against canvas) and `--card-foreground` (against the card surface), the form indicator dot, the pomodoro idle caption, and the event panel's placeholder and muted captions. Because `--foreground` and `--card-foreground` both flow through `pickReadableForeground`, darkening canvas or tinting a card surface automatically flips the body text to the high-contrast side instead of stranding the user with black text on black.
- `primary`: brand/action accent, used directly for `--primary`.
- `destructive`: danger signal. Identity-drives `--destructive`, `--action-danger-armed`, and `--status-declined` so the delete button, armed-delete state, and declined attendance tile stay consistent.
- `confirm`: positive signal. Identity-drives `--action-confirm` (save button, active scope pill) and `--status-accepted` (accepted attendance tile).
- `warning`: caution signal. Identity-drives `--status-tentative` today; reserved for future notification warnings and deadline accents.

Editing one source color propagates through the derivation tables and shifts every non-pinned token in lockstep. Pinned overrides are untouched, so the user can let the engine drive the coherent parts of the shell while surgically fixing specific tokens (pinning `--card` to pure white, for example). Calendar canvas sits between the two: it auto-derives from `canvas` by default, but pinning `--cal-bg` through `calendarTokenOverrides` isolates it from the cascade.

### Derivation formulas

The engine combines two kinds of computations:

- Surface backgrounds (card, popover, secondary, muted, accent, sidebar, event panel, calendar canvas, timeline rail) are produced by `shiftPerceptualL(canvas, deltaL)`, which converts canvas to OKLab, adds a signed `deltaL` to the lightness channel (preserving hue and chroma), and converts back. The per-token deltas in `APP_DERIVATION` are calibrated from the dark built-in's actual OKLab-L diffs between its canvas (`#27282A`) and each of its surface hexes. Card (+0.028), popover (+0.056), and accent (+0.077) lift above canvas; sidebar (-0.039) recedes below canvas so the title bar frames the app (the "contrarian" step that made the dark built-in read as layered in the first place). Event panel bg (+0.013) sits just above canvas and event-panel-contrast (-0.021) just below, keeping the recessed band behind the floating panel visible on any canvas. Applying the same signed deltas to any canvas produces that same hierarchy regardless of whether the canvas is bright or dim, so cloning any theme gets the dark built-in's surface pop. Near-white or near-black canvases clamp the upper or lower tiers at the gamut boundary (accent, popover, and card can all collapse to `#ffffff` on a pure-white canvas, for example), which is expected clamp behavior rather than a layout failure. The calendar canvas uses a direction-aware pair of offsets in `CAL_DERIVATION`: dark canvases (relative luminance below 0.5) receive `calCanvasDarkDeltaL` (-0.173) so `--cal-bg` recedes into the grid, while light canvases receive `calCanvasLightDeltaL` (+0.044) so the grid lifts gently above the app background. Both values were calibrated from the two built-ins' actual canvas-to-cal-bg gaps, so any cloned theme inherits the same subtle grid framing regardless of canvas brightness. The calendar timeline rail (the empty track behind pomodoro events) is derived the same way but on top of `--cal-bg`, not canvas, via a direction-aware pair of offsets: dark cal-bg receives `timelineRailDarkDeltaL` (+0.183) so the rail lifts above the recessed grid, and light cal-bg receives `timelineRailLightDeltaL` (-0.072) so the rail recedes below the bright grid. Deriving the rail from `--cal-bg` keeps it visually anchored to the calendar surface (inheriting any tint) instead of drifting toward the app canvas. The test suite asserts: every derivable foreground/background pair meets WCAG AA (4.5:1), every border meets 3:1 against its surface, every muted caption parks in the [3.0, 4.5] band, `sidebar <= canvas <= card <= popover <= accent` across every base, `--cal-bg` derivation direction flips at the luminance midpoint, and strict ordering holds on any canvas with headroom. The cosmetic `base` label has zero effect on derived tokens.
- Every foreground, border, and muted caption is recomputed from the contrast-aware pickers (see "Contrast math across the shell" above). `pickReadableForeground` resolves `--primary-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, `--destructive-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground`, all three `--status-*-foreground` tokens, `--action-confirm-foreground`, `--action-danger-armed-foreground`, `--pomodoro-idle-timer`, `--event-panel-text`, `--event-panel-input-text`, and `--cal-today-circle-text`. `pickReadableBorder` resolves `--ring`, `--event-panel-divider`, `--cal-drag-preview-border`, and `--cal-timeline-break`. `--cal-gridline` uses the same picker with a lowered 1.4:1 target (not the 3:1 default) so cloned themes inherit the built-in's subtle gridline style instead of painting prominent lines. `pickReadableMuted` resolves `--muted-foreground`, `--form-indicator`, `--pomodoro-idle-text`, `--event-panel-placeholder`, `--event-panel-muted-text`, and `--cal-time-label`.

Confirm, warning, and destructive propagate through identity derivation: one color feeds both the button state and the corresponding status tile, and the contrast-picked foreground pairs with each so users pick three semantic accents (green, amber, red) and every surface that carries that meaning stays consistent and legible.

The derivable calendar tokens are `--cal-bg`, `--cal-header-bg`, `--cal-gridline`, `--cal-time-label`, `--cal-timeline-rail`, `--cal-today-circle`, `--cal-today-circle-text`, and `--cal-timeline-break`. The fully-semantic tokens (`--cal-current-time`, `--cal-timeline-focus`) carry meaning that does not reduce to a source palette (red for "now", green for focus) and always fall through to base CSS unless the user explicitly pins them.

### Editor UI

Every user theme gets a `sources` palette at clone time (see "Custom theme workflow"), so the editor is always in Quick-colors mode. The body renders every group inline with no mode selector: every source color and every driven token is reachable, and source-driven multi-row groups start collapsed so the list opens scannable (one row per group header). Expanding a group reveals every pinnable sub-row that can be isolated individually.

Groups are ordered top-to-bottom as a three-tier walkthrough: app foundation, semantic signals, then per-feature surfaces. Inside each tier, shell tokens live under the source color that drives them, making the relationship visible without scrolling past a flat list.

**Tier 1 (App foundation)** carries the four sources every shell surface reads from:

- **App canvas**: the dominant background color. Drives background, card, popover (paired with its text), secondary surface, muted surface, hover highlight, focus ring, title bar, and title bar hover. Editing it shifts the entire non-accent palette at once.
- **Ink**: base text color. Anchors the contrast-aware pickers that derive every foreground, border, and muted caption. Sub-rows cover `--foreground`, `--form-indicator`, and `--pomodoro-idle-text`.
- **Primary action**: main accent for highlighted buttons and links. The source drives the button background directly (identity derivation) and the button text through contrast pick; a single sub-row exposes `--primary-foreground` for isolation.
- **Destructive**: danger signal. Sub-rows cover `--destructive`, `--action-danger-armed`, and `--status-declined` so the user can either let the one red drive all three or isolate any tile.

**Tier 2 (Semantic signals)** adds the positive and cautionary accents:

- **Confirm**: drives the save button (paired bg + text), the active scope pill, and the accepted attendance tile. The pair row exposes `--action-confirm` alongside `--action-confirm-foreground`; a follow-up single row exposes `--status-accepted`.
- **Warning**: drives the tentative attendance tile today. Ships with one sub-row (`--status-tentative`) and is reserved for future notification warnings and deadline accents.

**Tier 3 (Per-feature)** keeps feature-scoped colors adjacent so nothing is scattered:

- **Calendar surface**: a sourceless card covering the auto-derived calendar background and its driven tokens. The card header carries no source color (the grid background tracks the app canvas by default). Sub-rows expose `--cal-bg` (isolate to pin a specific grid color), `--cal-header-bg`, `--cal-gridline`, `--cal-time-label`, and `--cal-timeline-rail`. Isolating `--cal-bg` breaks the auto-derivation so the user can paint the grid a different color than the app canvas.
- **Calendar details**: a sourceless card that collects every non-derived calendar color. Merges the former "Calendar markers" and "Calendar extras" into one group: today marker (pair), now line, break marker, focus marker, color-picker outline, description editor tint, and the all-day drag-preview border.
- **Event panel**: nine sub-rows painting the event creation/edit panel surface, section-header strip, outer edge, drop shadow, title divider, input text, placeholder, body text, and muted captions. Sourceless today; grouping the nine tokens together keeps them visible as a block.
- **Task priority**: four sub-rows for the kanban priority badges (`--priority-easy`, `--priority-medium`, `--priority-hard`, `--priority-epic`). Each token feeds both the badge background (at 20% opacity) and the label text at full opacity.

The header has three parts, all on one row: the title and description on the left (non-interactive), the source `ColorField` in the center of the right cluster (hidden on sourceless cards), and an **EXPAND** / **COLLAPSE** button on the right. The collapse button is gated on **source presence and at least two rows**: it exists to amortize a long list when one color at the top drives everything below, so sourceless cards (Calendar details, Event panel, Task priority) drop the button and show all sub-rows inline, and source-driven single-row cards (Primary action, Warning) drop it too and render their one sub-row as a peer of the source. Collapsible groups start collapsed so the editor opens scannable. Whenever the current value of a source color drifts from the clone-time seed, a small reset icon appears next to its `ColorField`; clicking it restores that channel only (see "Seed snapshots" above for the details).

Driven rows render below the header with two distinct layouts.

**Peer-style rows** (used when a source-driven group has exactly one sub-row): the row uses the same bold header typography (`text-[13px] font-semibold`) so the driven token reads as a peer of its source rather than a subordinate option. The right side shows an always-editable `ColorField` followed by an optional reset icon and an invisible placeholder sized to match the header's action slot. There is no Isolated edit or Link back button: editing the field directly writes an override, and clicking the reset icon falls back through the seed (restoring the seed's override, or dropping it when the seed had none so the token re-follows its source).

**Sub-option rows** (used in multi-row groups, whether or not they have a source): rows render as a list where each row shares two states expressed through the HEX input and the trailing action button:

- **Linked**: the `ColorField` renders its swatch and hex input in a disabled state (reduced opacity, not-allowed cursor) showing the current derived or default value, with an **Isolated edit** action button. Clicking it captures the current auto value as an explicit override and swaps the row to the Isolated state.
- **Isolated**: the same `ColorField` becomes fully editable (swatch opens the picker, hex input accepts input), with a **Link back** action that drops the override so the token re-follows its source.

Sourceless multi-row cards skip the Linked state entirely: every sub-row is always editable because there is no source to link back to. The HEX value is always visible, which keeps the actual color number readable even for linked rows. When a row's current value differs from the clone-time seed, a small reset icon appears between the `ColorField` and the action button; clicking it reverts that single row back to the seed value (restoring the override, or dropping it when the seed had none).

Every pair row (source + foreground) shows a live contrast indicator (see "Contrast warnings" below) so the user can spot a failing combination and auto-fix it without leaving the editor.

Legacy user themes imported without a `sources` field show a "Set up Quick colors" card that samples the seven values from the current resolved palette. After clicking, the editor switches to the grouped layout. Themes written before `confirm` and `warning` were introduced load normally: missing source channels backfill from the base defaults so existing vault files keep working without a migration.

### Contrast warnings

On every pair row (a source and its paired foreground), the editor resolves the effective foreground/background contrast at render time and compares it to a per-pair target. Most pairs target AA body text (4.5:1); pairs whose foreground is intentionally recessed (today only the muted surface, `--muted` paired with `--muted-foreground`) declare a lower target (3:1, AA-large) on their row definition so the warning panel respects the design intent. The muted pair covers captions and the past-day numbers in MonthView, both of which are supposed to fade. If the ratio falls below the row's own target, the editor shows a small amber warning pill next to the row with the current ratio and a wand button that calls `pickReadableForeground` with that row's target and writes the result as an override. The warning disappears automatically once the pair meets the target. Warnings are non-blocking: the user can still save a theme that fails contrast.

A persistent **contrast summary bar** sits above the groups. It aggregates every pair row across every group (including rows collapsed inside an accordion) using each row's own target, and reports the number of failing pairs. When the count is zero it shows a quiet "All contrast checks pass" line; when at least one pair fails it turns amber and exposes two actions: **Jump to next** cycles through the failing rows, expanding the target row's group when needed before scrolling it into view, and **Fix all** runs the per-row auto-fix on every failing pair at once. Together they mean a warning produced by a distant edit can no longer hide behind an unopened accordion, while recessed captions no longer produce false-positive warnings for behaving exactly as intended.

### Preset picker

`ThemePresetPicker` opens as a modal when the user clicks "New theme". It renders a 2x3 grid of curated presets (Sunrise, Graphite, Sepia, Nordic, High-contrast Dark, Lavender Pastel), each validated at build time by `themePresets.test.ts` to meet AA contrast across every derived foreground, border, and gridline. Every card shows a miniature preview painted from its own sources (inline CSS variables on the card root). A "Start blank" affordance under the grid keeps the original path that clones from the current active theme. Picking a preset seeds the new theme with that preset's `sources`, `base`, and `displayName` before opening the editor.

### Editor chrome tracks the live theme

The editor panel paints from the live user theme: `bg-card`, `text-foreground`, `border-border`, and every other Tailwind class inside the editor resolves to the user's current resolved tokens. Editing canvas therefore gives immediate visual feedback on the panel itself, not just on the app underneath. Legibility is handled by the contrast-aware derivation rather than by shadowing: `--foreground` and `--card-foreground` are `pickReadableForeground` against their paired surfaces with the endpoint-preference fallback, so even when the user drags canvas close to ink the foregrounds snap decisively to black or white instead of settling on a muddy mid-gray.

The only exceptions are three fixed base-only tokens used by `ColorField`: `--editor-chrome-thumb-border` (SV / hue / alpha slider thumb outlines) and `--editor-chrome-checker-a` / `-b` (the conic-gradient checker pattern behind the alpha slider). These stay independent of the live theme so the thumbs and the transparency pattern remain visible against any gradient the picker renders.

### Semantic tokens

The editor exposes the following semantic tokens beyond the core shell surfaces. Most of them sit under a source color whose change propagates to the whole group (form indicator and pomodoro idle caption under Ink, armed delete and declined status under Destructive, confirm + accepted under Confirm, tentative under Warning). The remainder live under sourceless feature cards so their relationship to a feature stays obvious, but no single source drives them.

Distribution across the editor:

- **Ink tints** (3): `--form-indicator` (radio/checkbox dot inside calendar sub-sections), `--pomodoro-idle-text` (caption on the idle overlay), and `--pomodoro-idle-timer` (the big countdown on the idle overlay). Form indicator and idle caption use `pickReadableMuted`; the idle timer uses `pickReadableForeground` against the overlay's black canvas.
- **Destructive family** (4): `--action-danger-armed` + `--action-danger-armed-foreground` (delete button once armed) and `--status-declined` + `--status-declined-foreground` (declined attendance tile). Backgrounds identity-derive from `destructive`; foregrounds are contrast-picked.
- **Confirm family** (4): `--action-confirm` + `--action-confirm-foreground` (save button, active scope pill) and `--status-accepted` + `--status-accepted-foreground` (accepted attendance tile). Backgrounds identity-derive from `confirm`; foregrounds are contrast-picked.
- **Warning family** (2): `--status-tentative` + `--status-tentative-foreground` (tentative attendance tile). Background identity-derives from `warning`; foreground is contrast-picked.
- **Primary foreground** (1): `--primary-foreground`. Contrast-picked from the primary source so tinted pastel primaries flip to dark text automatically.
- **Destructive foreground core** (1): `--destructive-foreground`, same treatment for the destructive source.
- **Calendar details** (7, sourceless): Today marker (pair of circle + inner text), now line, break marker, focus marker, event-color-picker outline, description editor tint, and the all-day drag-preview border.
- **Event panel** (9, sourceless): `--event-panel-bg`, `--event-panel-contrast`, `--event-panel-edge`, `--event-panel-shadow`, `--event-panel-divider`, `--event-panel-input-text`, `--event-panel-placeholder`, `--event-panel-text`, `--event-panel-muted-text`. Body + input text use `pickReadableForeground` against the panel bg; placeholder + muted text use `pickReadableMuted` so the dim captions stay at AA-large (~3:1).
- **Task priority** (4, sourceless): `--priority-easy`, `--priority-medium`, `--priority-hard`, `--priority-epic`. Each token feeds both the background (tinted toward canvas) and the label text; the Kanban column reads these directly and picks legible text through `pickReadableForeground`.

Four tokens carry alpha: `--event-panel-edge`, `--event-panel-shadow`, `--cal-description-editor-bg`, `--cal-drag-preview-border`. `ColorField` accepts and emits 8-digit `#rrggbbaa` for them, with a fourth slider (A) in the picker popover and a checkerboard swatch on the trigger so transparency is visible. Alpha-bearing tokens skip the Tailwind `@theme inline` alias and are consumed via plain CSS variables in scoped styles or inline `style` attributes.

Sourceless semantic tokens still resolve through the same override/base fall-through used by the rest of the shell, so a user who never opens those rows sees the byte-for-byte default values; a user who pins one gets a surgical override that survives theme export/import.

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

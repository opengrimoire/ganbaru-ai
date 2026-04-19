# Themes

GanbaruAI ships curated themes and lets users author their own in-app. A theme recolors the built-in light and dark palette across every event slot and across the app and calendar shell. Users can run the built-in themes, pick a user-authored one, or edit slot hexes in a theme editor. Adding a new theme is a data-only change: one Theme object in the registry.

Theming is intentionally color-deep, not structure-deep. Themes set colors across the event palette and the app and calendar shell; they do not change layout, add custom components, or control typography. Font family, font size, and UI density live as separate user settings (see "Typography and density" below), orthogonal to the active theme. Heavier UI edits belong upstream (as contributions to the app) or in a fork. Keeping the theme format a validated data contract means no code execution, no remote asset loading, no DOM rewriting, and a stable contract across app updates.

This doc covers the theme model, the event color palette, the ideal custom-theme workflow, persistence, and the rules that keep stored events safe as palettes evolve.

## The Theme model

A Theme is a self-contained visual package. The minimum fields:

- **id:** stable string used in storage and lookups. Built-in IDs are `light` and `dark`. Custom themes use slugs or UUIDs.
- **displayName:** user-visible name in the theme picker.
- **base:** `light` or `dark`. Drives inherited shell styling (via the `.dark` class on the HTML root) and contrast-text selection for events.
- **eventPalette:** ordered array of 24 hex values (one per slot index). Every position must be filled, even if the theme reuses the same color across multiple slots. See "Event color palette" below.
- **blendCanvas:** hex color the dimmed event variants blend toward. Usually the theme's canvas background.

Optional fields reserved for shell theming:

- **appTokenOverrides:** map of app-level CSS tokens (`--primary`, `--background`, etc.) to hex values. Applied on theme switch via `root.style.setProperty`. Empty on the built-in themes today, which rely on the `.dark` class and the existing light/dark rules in `app.css`.
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

## Contrast text and dimmed variants

Event text color is picked per event background using Rec. 709 luminance on the raw sRGB hex. Light-mode backgrounds flip to near-black text above a configured luminance threshold; dark-mode backgrounds flip to near-white text below a configured threshold. The thresholds are tuned against the built-in palette. Custom themes with unusual palettes may need to expose their own thresholds in a later iteration; for now the flip logic is shared across themes of a given base.

Dimmed event variants (past events, cancelled events, transparent/free events, outside-month events in the grid) are computed by blending the event's base hex toward the theme's `blendCanvas` with a fixed weight. Text contrast is recomputed from the dimmed bg, so a heavily faded background flips to the alt text token automatically. Results are cached per (theme ID, slot, weight) tuple.

## Persistence

The active theme ID, user-authored themes, font family, and font scale all live in `vault/config.json` under dotted keys (`theme.activeId`, `themes.user`, `preferences.fontFamilyId`, `preferences.fontScale`). The vault folder defaults to `app_config_dir / "vault"` and is created on first launch. Writes are atomic: the Rust backend serializes to `config.json.tmp`, fsyncs, and renames into place, so a crash mid-write leaves either the previous good file or an ignored temp.

The frontend bridge (`lib/vault/config.ts`) loads the config once at boot, exposes synchronous reads against an in-memory cache, and debounces writes (250 ms) so rapid edits coalesce into one disk write. Stores hydrate from the cache on first read, keeping first paint synchronous.

The first vault load runs a one-time migration that copies the legacy `ganbaruai-theme`, `ganbaruai-font-family`, and `ganbaruai-font-scale` keys out of `localStorage` and removes them. The migration is idempotent.

Built-in themes are validated through `validateThemeJson` on load (defense in depth against tampered config files). Unknown or invalid theme IDs fall back to the default (`dark`).

## Custom theme workflow

Themes are managed from the single Appearance section in Settings. The section lists every theme (built-ins first, user themes below) above the font and zoom controls; opening one swaps the section into a detail view for that theme and the "Back to themes" action returns to the list.

Users can:

1. **Create a theme** by clicking "New theme". A user theme is added (seeded from the current active theme) and the editor opens on it.
2. **Duplicate** any theme (built-in or user) into a new editable user theme. Built-ins remain frozen.
3. **View a built-in**. The detail view renders the name, base label, and a read-only palette preview alongside any shell overrides the theme ships. A JSON panel shows the serialized theme with Copy and Save buttons.
4. **Edit a user theme**: rename it, flip the base (light/dark), tweak any of the 24 event-palette hexes through an in-house HSL color picker, override individual app or calendar shell tokens, and clear overrides back to the base CSS. The same JSON panel is editable; pressing Apply changes validates the draft through `replaceTheme` and commits it in place (id locked).
5. **Apply** any registered theme by clicking its row. The active theme is highlighted; switching is non-destructive (only the active ID changes).
6. **Share** a theme by exporting it from the detail view. Copy JSON writes to the clipboard; Save to file uses the native save dialog. Import accepts pasted JSON or a file picked through the open dialog. Imported themes get a fresh slug ID if their incoming ID would collide with an existing user theme.
7. **Delete** a user theme. If the deleted theme was active, the store falls back to the default theme.

Editing a built-in is blocked at the store level: mutators return false, `replaceTheme` rejects built-in ids, and the editor hides every input (name field, base toggle, color pickers, add-override buttons) when the target is built-in. Duplicate is the only path to a modifiable copy.

## Shell token overrides

The app and calendar shell are styled through CSS tokens defined in `app.css` under `:root` (light) and `.dark` (dark). User themes can override any token in the `APP_TOKEN_KEYS` (23 tokens) and `CALENDAR_TOKEN_KEYS` (10 tokens) catalogs. Unknown keys are stripped on import; only valid hex values are accepted. When a theme with overrides is applied, the store iterates the maps and calls `root.style.setProperty(key, value)` for each entry; switching themes clears overrides not present in the next theme.

The editor exposes both catalogs as edit rows. Each row shows the token name, the resolved current value, and an "Add override" button that seeds the picker from the computed style if no override exists yet. Clearing an override removes the key entirely so the base CSS rule applies.

The current roadmap: gradually migrate remaining hardcoded color sites (pomodoro idle overlay, kanban priority badges, confirm dialog, event panel placeholders, and similar) into CSS tokens so a custom theme can recolor them without touching component code.

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

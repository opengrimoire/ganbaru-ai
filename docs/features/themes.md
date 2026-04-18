# Themes

GanbaruAI ships curated themes and lets users author their own in-app. A theme recolors the built-in light and dark palette across every event slot and across the app and calendar shell. Users can run the built-in themes, pick a user-authored one, or edit slot colors and labels in a theme editor. Adding a new theme is a data-only change: one Theme object in the registry.

Theming is intentionally color-deep, not structure-deep. Themes set colors across the event palette and the app and calendar shell; they do not change layout, add custom components, or control typography. Font family, font size, and UI density live as separate user settings (see "Typography and density" below), orthogonal to the active theme. Heavier UI edits belong upstream (as contributions to the app) or in a fork. Keeping the theme format a validated data contract means no code execution, no remote asset loading, no DOM rewriting, and a stable contract across app updates.

This doc covers the theme model, the event color palette, the ideal custom-theme workflow, persistence, and the rules that keep stored events safe as palettes evolve.

## The Theme model

A Theme is a self-contained visual package. The minimum fields:

- **id:** stable string used in storage and lookups. Built-in IDs are `light` and `dark`. Custom themes use slugs or UUIDs.
- **displayName:** user-visible name in the theme picker.
- **base:** `light` or `dark`. Drives inherited shell styling (via the `.dark` class on the HTML root) and contrast-text selection for events.
- **eventPalette:** full map of event color slots to hex values (see "Event color palette" below). Every registered slot must have a hex entry, even if the theme reuses the same color across multiple slots.
- **blendCanvas:** hex color the dimmed event variants blend toward. Usually the theme's canvas background.

Optional fields reserved for shell theming:

- **appTokenOverrides:** map of app-level CSS tokens (`--primary`, `--background`, etc.) to hex values. Applied on theme switch via `root.style.setProperty`. Empty on the built-in themes today, which rely on the `.dark` class and the existing light/dark rules in `app.css`.
- **calendarTokenOverrides:** same idea, scoped to calendar shell tokens (`--cal-bg`, `--cal-gridline`, etc.).

A Theme is frozen after construction. The registry itself is frozen. This prevents runtime mutation of a shipped theme by accident.

### Why a registry, not a boolean

The original store was a binary `isDark` toggle. It could not express "a user made their own theme", "there are three themes to cycle through", or "this theme ships a different calendar canvas color". A registry keyed by ID, where each entry carries its own palette and optional shell overrides, makes the entire theme addition a single object: write a Theme, register it, done. No other code needs to change.

## The three-layer color model

Event colors use three layers so users can redesign themes freely without breaking stored events.

1. **Slot ID (stable, invisible).** A stable string like `tomato` or `peacock`. Stored in the database on the event row. Never shown to the user. Never renamed in place.
2. **Display name (per theme).** The label shown in the color picker for a given theme. In the built-in palettes this happens to match the slot ID (`"Tomato"`), but a custom theme can call the same slot `"Brick"` or `"Signal Red"`. Events do not know or care about the display name.
3. **Hex value (per theme).** The actual RGB the slot resolves to in the active theme. Two themes can assign wildly different hex to the same slot. When the user switches themes, all events across the app pick up the new hex immediately because they reference the slot, not the color.

This is what makes the "mango scenario" work: if a theme author does not want a yellow mango slot, they change the hex assigned to the `mango` slot in their theme (and optionally rename the display label). Existing events tagged `mango` keep displaying correctly in any theme that has a hex for that slot, no migration needed.

## Event color palette

The built-in themes ship a 24-slot palette inspired by Google Calendar:

```
radicchio, cherryBlossom, tomato, flamingo, tangerine, pumpkin,
mango, banana, citron, avocado, pistachio, sage,
basil, eucalyptus, peacock, cobalt, blueberry, lavender,
wisteria, amethyst, grape, cocoa, graphite, birch
```

`graphite` is the render-layer fallback when a color is unknown or missing. It must exist in every theme's palette.

### Validation on read

Raw color values come in from the database, iCalendar imports, and user edits. `normalizeEventColor(raw)` in `components/calendar/utils.ts` validates every value on its way into the in-memory event model:

- Known slot ID: pass through.
- Known legacy alias (see next section): rewrite to the current slot.
- Unknown non-empty string: warn once to the console, return undefined, render falls back to graphite.
- Null, empty, or non-string: return undefined silently.
- Prototype-chain keys (`toString`, `__proto__`, `constructor`): rejected.

The warning is deduped across a session (Set-backed) so a legacy name on a thousand rows logs one line, not one thousand.

### Evolving the palette (aliases)

When a slot is renamed or removed, add an entry to the `COLOR_ALIASES` map in `utils.ts`. Example: if `flamingo` were renamed to `coral`, the alias `{ flamingo: "coral" }` keeps every stored `flamingo` event rendering as coral instead of silently degrading to graphite. Aliases are permanent: removing an alias breaks events that still reference the old name in backups or exports.

Never rename a slot in place without an alias. Never silently drop a slot: at minimum, add it to `COLOR_ALIASES` pointing to the closest remaining slot.

## Contrast text and dimmed variants

Event text color is picked per event background using Rec. 709 luminance on the raw sRGB hex. Light-mode backgrounds flip to near-black text above a configured luminance threshold; dark-mode backgrounds flip to near-white text below a configured threshold. The thresholds are tuned against the built-in palette. Custom themes with unusual palettes may need to expose their own thresholds in a later iteration; for now the flip logic is shared across themes of a given base.

Dimmed event variants (past events, cancelled events, transparent/free events, outside-month events in the grid) are computed by blending the event's base hex toward the theme's `blendCanvas` with a fixed weight. Text contrast is recomputed from the dimmed bg, so a heavily faded background flips to the alt text token automatically. Results are cached per (theme ID, slot, weight) tuple.

## Persistence

Today, the active theme ID lives in `localStorage` under `ganbaruai-theme`. The initial theme is applied synchronously on module load so first paint matches the stored preference, no flash of unstyled content on light-mode boot. Unknown or removed theme IDs fall back to the default (currently `dark`).

Later, the active theme ID and user-authored themes will move into `vault/config.json` so they sync alongside the rest of the user's data. Third-party themes shipped as files in the vault (for example, `vault/themes/my-theme.json`) are the natural next step. The registry already accepts arbitrary IDs; the only missing piece is loading and persisting user-authored Theme objects.

## Custom theme workflow (end state)

Users should be able to:

1. **Create a theme** by duplicating an existing one (or starting from scratch) and editing slot hex values, display names, and optional token overrides in a theme editor UI.
2. **Switch between any registered themes.** Built-in and user themes coexist in the picker, grouped by origin. Switching is non-destructive: it only changes the active theme ID; nothing is rewritten, merged, or overridden.
3. **Share a theme** by exporting the Theme object as JSON and importing it into another install.
4. **Copy a slot value from a built-in** while editing a user theme, as a starting-point shortcut. This pulls the built-in's hex into the user theme being edited; it never modifies the built-in itself.
5. **Delete a user theme** they no longer want. Built-in themes cannot be deleted and are always present in the picker.

Built-in themes are not editable. Editing a built-in clones it into a new user-theme with a unique ID.

## Shell token overrides

The app and calendar shell today are styled through CSS tokens defined in `app.css` under `:root` (light) and `.dark` (dark). The registry already reserves `appTokenOverrides` and `calendarTokenOverrides` fields on Theme so a future theme can repaint the shell without touching the built-in rules. When a theme with overrides is applied, the store iterates the maps and calls `root.style.setProperty(key, value)` for each entry. Clearing overrides on theme switch is handled by the next theme's setProperty calls replacing them, or by an explicit reset when switching to a theme that has no overrides.

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

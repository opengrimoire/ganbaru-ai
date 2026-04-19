import type { EventColor } from "$lib/components/calendar/types";

/**
 * Stable ID identifying a theme. Built-in IDs are "light" and "dark".
 * Custom themes added later should use slugs or UUIDs to avoid collisions.
 */
export type ThemeId = string;

/**
 * Full palette for event color slots within a theme. Every built-in
 * EventColor must have a hex entry. Themes may differ arbitrarily: two
 * themes can assign the same slot ID completely different colors, and
 * events preserve their slot reference across theme switches so they
 * render correctly in whichever theme the user is on.
 */
export type EventPaletteHexes = Record<EventColor, string>;

/**
 * A theme is a self-contained visual package. The minimum a theme must
 * carry is an id, a user-visible display name, a base (light or dark, used
 * for shell inheritance and contrast-text math), a complete event palette,
 * and the reference canvas used when blending dimmed event variants.
 *
 * The optional token-override fields are reserved for when themes also
 * recolor the app and calendar shell beyond the built-in light/dark CSS.
 * They are empty on the built-in themes today; adding a new theme that
 * overrides shell tokens later is a data-only change.
 */
export interface Theme {
  id: ThemeId;
  displayName: string;
  base: "light" | "dark";
  eventPalette: EventPaletteHexes;
  /** Reference bg dimmed event variants blend toward. Usually canvas bg. */
  blendCanvas: string;
  /** Optional overrides for app-shell CSS tokens (--primary, etc). */
  appTokenOverrides?: Readonly<Record<string, string>>;
  /** Optional overrides for calendar-shell CSS tokens (--cal-bg, etc). */
  calendarTokenOverrides?: Readonly<Record<string, string>>;
}

// Built-in event palettes. These are the Google-calendar-inspired 24-color
// sets shipped previously, split from the former combined {light, dark}
// palette so each theme now owns one standalone palette. Additional themes
// can freely deviate without being locked to these colors.

const LIGHT_EVENT_PALETTE: EventPaletteHexes = {
  radicchio:     "#AD1457",
  cherryBlossom: "#D81B60",
  tomato:        "#D50000",
  flamingo:      "#E67C73",
  tangerine:     "#F4511E",
  pumpkin:       "#EF6C00",
  mango:         "#F09300",
  banana:        "#F6BF26",
  citron:        "#E4C441",
  avocado:       "#C0CA33",
  pistachio:     "#7CB342",
  sage:          "#33B679",
  basil:         "#0B8043",
  eucalyptus:    "#009688",
  peacock:       "#039BE5",
  cobalt:        "#4285F4",
  blueberry:     "#3F51B5",
  lavender:      "#7986CB",
  wisteria:      "#B39DDB",
  amethyst:      "#9E69AF",
  grape:         "#8E24AA",
  cocoa:         "#795548",
  graphite:      "#616161",
  birch:         "#A79B8E",
};

const DARK_EVENT_PALETTE: EventPaletteHexes = {
  radicchio:     "#C05476",
  cherryBlossom: "#D85675",
  tomato:        "#DA5234",
  flamingo:      "#D6837A",
  tangerine:     "#E3683E",
  pumpkin:       "#DD7835",
  mango:         "#E0963C",
  banana:        "#E6B951",
  citron:        "#D8BE5E",
  avocado:       "#BCC256",
  pistachio:     "#85AD59",
  sage:          "#55B080",
  basil:         "#489160",
  eucalyptus:    "#429A8E",
  peacock:       "#4B99D2",
  cobalt:        "#668BE1",
  blueberry:     "#6E72C3",
  lavender:      "#828BC2",
  wisteria:      "#AE9CCE",
  amethyst:      "#A479B1",
  grape:         "#A75ABA",
  cocoa:         "#957367",
  graphite:      "#7C7C7C",
  birch:         "#A5998C",
};

export const lightTheme: Theme = Object.freeze({
  id: "light",
  displayName: "Light",
  base: "light",
  eventPalette: LIGHT_EVENT_PALETTE,
  blendCanvas: "#ffffff",
});

export const darkTheme: Theme = Object.freeze({
  id: "dark",
  displayName: "Dark",
  base: "dark",
  eventPalette: DARK_EVENT_PALETTE,
  blendCanvas: "#202124",
});

/**
 * Registry of the themes that ship with the app. Frozen so it cannot be
 * mutated at runtime; user-authored themes live in the store layer and are
 * merged with this registry when the active theme is resolved.
 */
export const BUILTIN_THEME_REGISTRY: Readonly<Record<ThemeId, Theme>> = Object.freeze({
  [lightTheme.id]: lightTheme,
  [darkTheme.id]: darkTheme,
});

/**
 * Theme ID used on first launch and when the stored ID is unknown. Kept as
 * "dark" to preserve the previous default.
 */
export const DEFAULT_THEME_ID: ThemeId = darkTheme.id;

/**
 * Returns true when the given ID matches a theme that ships with the app.
 * Used to guard mutators (built-in themes are immutable; "edit" duplicates
 * a built-in into a user theme first).
 */
export function isBuiltinThemeId(id: ThemeId | undefined | null): boolean {
  if (!id || typeof id !== "string") return false;
  return Object.hasOwn(BUILTIN_THEME_REGISTRY, id);
}

/**
 * Look up a theme by ID. By default searches only the built-in registry;
 * pass the combined registry from the store to resolve user themes too.
 * Guards against prototype-chain keys via Object.hasOwn.
 */
export function getThemeById(
  id: ThemeId | undefined | null,
  registry: Readonly<Record<ThemeId, Theme>> = BUILTIN_THEME_REGISTRY,
): Theme | undefined {
  if (!id || typeof id !== "string") return undefined;
  if (!Object.hasOwn(registry, id)) return undefined;
  return registry[id];
}

/**
 * List of registered theme IDs in insertion order. Defaults to built-ins;
 * pass a combined registry to include user themes.
 */
export function themeIds(
  registry: Readonly<Record<ThemeId, Theme>> = BUILTIN_THEME_REGISTRY,
): ThemeId[] {
  return Object.keys(registry);
}

/**
 * Compute the CSS custom property changes needed to apply a theme when
 * `previouslyApplied` tokens were set by the last theme.
 *
 * Without this, switching from a theme that painted `--primary` to a theme
 * without overrides would leave the previous value stuck on the root. The
 * result tells the caller which tokens to set and which leftover keys to
 * remove, plus the new set of applied keys to remember for the next switch.
 */
export function computeThemeTokenOps(
  theme: Theme,
  previouslyApplied: ReadonlySet<string>,
): {
  toSet: ReadonlyMap<string, string>;
  toClear: ReadonlySet<string>;
  applied: Set<string>;
} {
  const toSet = new Map<string, string>();
  const applied = new Set<string>();
  const merge = (overrides?: Readonly<Record<string, string>>) => {
    if (!overrides) return;
    for (const [key, value] of Object.entries(overrides)) {
      toSet.set(key, value);
      applied.add(key);
    }
  };
  merge(theme.appTokenOverrides);
  merge(theme.calendarTokenOverrides);
  const toClear = new Set<string>();
  for (const key of previouslyApplied) {
    if (!applied.has(key)) toClear.add(key);
  }
  return { toSet, toClear, applied };
}

/**
 * Canonical ordering of event color slots. The editor and validator iterate
 * this list so a slot added or removed from EventColor flows through one
 * source of truth.
 */
export const EVENT_SLOTS: readonly EventColor[] = Object.freeze([
  "radicchio",
  "cherryBlossom",
  "tomato",
  "flamingo",
  "tangerine",
  "pumpkin",
  "mango",
  "banana",
  "citron",
  "avocado",
  "pistachio",
  "sage",
  "basil",
  "eucalyptus",
  "peacock",
  "cobalt",
  "blueberry",
  "lavender",
  "wisteria",
  "amethyst",
  "grape",
  "cocoa",
  "graphite",
  "birch",
] satisfies readonly EventColor[]);

/**
 * App-shell CSS custom properties a user theme is allowed to override.
 * Limited to hex-color tokens for now: the in-house color picker emits hex
 * only, and tokens that ship as rgba (border alpha) or oklch (charts) are
 * intentionally excluded until the picker grows wider format support.
 */
export const APP_TOKEN_KEYS: readonly string[] = Object.freeze([
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-ring",
] as const);

/**
 * Calendar-shell CSS custom properties a user theme is allowed to override.
 * Same hex-only restriction as APP_TOKEN_KEYS; cal-hover (rgba) and
 * cal-header-row-h (px) are excluded.
 */
export const CALENDAR_TOKEN_KEYS: readonly string[] = Object.freeze([
  "--cal-bg",
  "--cal-header-bg",
  "--cal-gridline",
  "--cal-today-circle",
  "--cal-today-circle-text",
  "--cal-time-label",
  "--cal-current-time",
  "--cal-timeline-rail",
  "--cal-timeline-break",
  "--cal-timeline-focus",
] as const);

const APP_TOKEN_KEY_SET = new Set(APP_TOKEN_KEYS);
const CALENDAR_TOKEN_KEY_SET = new Set(CALENDAR_TOKEN_KEYS);

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_DISPLAY_NAME_LENGTH = 60;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Generate a unique slug-style theme ID. Prefix is short and human-friendly,
 * suffix is a 6-char base36 random tail. Pass the existing combined registry
 * to guarantee no collisions with current themes.
 */
export function generateThemeId(
  existing: Readonly<Record<ThemeId, Theme>>,
  prefix = "theme",
): ThemeId {
  const safePrefix = SLUG_RE.test(prefix) ? prefix : "theme";
  for (let attempt = 0; attempt < 64; attempt++) {
    const tail = Math.random().toString(36).slice(2, 8);
    const candidate = `${safePrefix}-${tail}`;
    if (!Object.hasOwn(existing, candidate)) return candidate;
  }
  return `${safePrefix}-${Date.now().toString(36)}`;
}

/**
 * Serialize a theme to a stable, pretty-printed JSON string suitable for
 * clipboard or file export. Keys are emitted in a deterministic order so
 * exported files diff cleanly across saves.
 */
export function serializeTheme(theme: Theme): string {
  const ordered: Record<string, unknown> = {
    id: theme.id,
    displayName: theme.displayName,
    base: theme.base,
    blendCanvas: theme.blendCanvas,
    eventPalette: orderedPalette(theme.eventPalette),
  };
  if (theme.appTokenOverrides && Object.keys(theme.appTokenOverrides).length > 0) {
    ordered.appTokenOverrides = orderedTokens(theme.appTokenOverrides, APP_TOKEN_KEYS);
  }
  if (
    theme.calendarTokenOverrides &&
    Object.keys(theme.calendarTokenOverrides).length > 0
  ) {
    ordered.calendarTokenOverrides = orderedTokens(
      theme.calendarTokenOverrides,
      CALENDAR_TOKEN_KEYS,
    );
  }
  return JSON.stringify(ordered, null, 2);
}

function orderedPalette(palette: EventPaletteHexes): EventPaletteHexes {
  const out = {} as EventPaletteHexes;
  for (const slot of EVENT_SLOTS) out[slot] = palette[slot];
  return out;
}

function orderedTokens(
  source: Readonly<Record<string, string>>,
  order: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of order) {
    if (Object.hasOwn(source, key)) out[key] = source[key];
  }
  return out;
}

export type ThemeValidationResult =
  | { ok: true; theme: Theme }
  | { ok: false; errors: string[] };

/**
 * Validate an unknown JSON-parsed value as a Theme suitable for import.
 * Returns the cleaned theme on success; on failure returns a list of all
 * problems found so the UI can surface them at once instead of one round-trip
 * per error. Unknown override keys are stripped silently because dropping a
 * stale token name should not block an otherwise valid theme.
 */
export function validateThemeJson(input: unknown): ThemeValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["theme must be a JSON object"] };
  }
  const { id, displayName, base, blendCanvas, eventPalette } = input;

  let cleanId = "";
  if (typeof id !== "string" || id.length === 0) {
    errors.push("id must be a non-empty string");
  } else if (!SLUG_RE.test(id)) {
    errors.push(
      "id must be a slug (lowercase letters, digits, and hyphens; must start with a letter or digit)",
    );
  } else {
    cleanId = id;
  }

  let cleanDisplayName = "";
  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    errors.push("displayName must be a non-empty string");
  } else if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push(`displayName must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`);
  } else {
    cleanDisplayName = displayName;
  }

  let cleanBase: "light" | "dark" = "dark";
  if (base !== "light" && base !== "dark") {
    errors.push('base must be "light" or "dark"');
  } else {
    cleanBase = base;
  }

  let cleanBlend = "";
  if (!isHexColor(blendCanvas)) {
    errors.push("blendCanvas must be a hex color (#RRGGBB or #RRGGBBAA)");
  } else {
    cleanBlend = blendCanvas;
  }

  const cleanPalette = {} as EventPaletteHexes;
  if (!isPlainObject(eventPalette)) {
    errors.push("eventPalette must be an object");
  } else {
    for (const slot of EVENT_SLOTS) {
      if (!Object.hasOwn(eventPalette, slot)) {
        errors.push(`eventPalette.${slot} is missing`);
        continue;
      }
      const value = (eventPalette as Record<string, unknown>)[slot];
      if (!isHexColor(value)) {
        errors.push(`eventPalette.${slot} must be a hex color`);
      } else {
        cleanPalette[slot] = value;
      }
    }
  }

  const cleanAppOverrides = sanitizeOverrides(
    input.appTokenOverrides,
    APP_TOKEN_KEY_SET,
    "appTokenOverrides",
    errors,
  );
  const cleanCalOverrides = sanitizeOverrides(
    input.calendarTokenOverrides,
    CALENDAR_TOKEN_KEY_SET,
    "calendarTokenOverrides",
    errors,
  );

  if (errors.length > 0) return { ok: false, errors };

  const theme: Theme = {
    id: cleanId,
    displayName: cleanDisplayName,
    base: cleanBase,
    blendCanvas: cleanBlend,
    eventPalette: cleanPalette,
  };
  if (cleanAppOverrides && Object.keys(cleanAppOverrides).length > 0) {
    theme.appTokenOverrides = cleanAppOverrides;
  }
  if (cleanCalOverrides && Object.keys(cleanCalOverrides).length > 0) {
    theme.calendarTokenOverrides = cleanCalOverrides;
  }
  return { ok: true, theme };
}

function sanitizeOverrides(
  source: unknown,
  allowed: ReadonlySet<string>,
  fieldName: string,
  errors: string[],
): Record<string, string> | undefined {
  if (source === undefined) return undefined;
  if (!isPlainObject(source)) {
    errors.push(`${fieldName} must be an object`);
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(source, key)) continue;
    if (!allowed.has(key)) continue;
    const value = (source as Record<string, unknown>)[key];
    if (!isHexColor(value)) {
      errors.push(`${fieldName}.${key} must be a hex color`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

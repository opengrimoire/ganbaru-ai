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
 * for chrome inheritance and contrast-text math), a complete event palette,
 * and the reference canvas used when blending dimmed event variants.
 *
 * The optional token-override fields are reserved for when themes also
 * recolor app chrome beyond the built-in light/dark CSS. They are empty on
 * the built-in themes today; adding a new theme that overrides chrome
 * tokens later is a data-only change.
 */
export interface Theme {
  id: ThemeId;
  displayName: string;
  base: "light" | "dark";
  eventPalette: EventPaletteHexes;
  /** Reference bg dimmed event variants blend toward. Usually canvas bg. */
  blendCanvas: string;
  /** Optional overrides for app-chrome CSS tokens (--primary, etc). */
  appTokenOverrides?: Readonly<Record<string, string>>;
  /** Optional overrides for calendar-chrome CSS tokens (--cal-bg, etc). */
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
 * Registry of all available themes. To add a theme: write one Theme object
 * above and include it here. No other code changes are required for the
 * theme to become available in the store.
 */
export const THEME_REGISTRY: Readonly<Record<ThemeId, Theme>> = Object.freeze({
  [lightTheme.id]: lightTheme,
  [darkTheme.id]: darkTheme,
});

/**
 * Theme ID used on first launch and when the stored ID is unknown. Kept as
 * "dark" to preserve the previous default.
 */
export const DEFAULT_THEME_ID: ThemeId = darkTheme.id;

/**
 * Look up a theme by ID, returning undefined if the ID isn't registered.
 * Guards against prototype-chain keys via Object.hasOwn.
 */
export function getThemeById(id: ThemeId | undefined | null): Theme | undefined {
  if (!id || typeof id !== "string") return undefined;
  if (!Object.hasOwn(THEME_REGISTRY, id)) return undefined;
  return THEME_REGISTRY[id];
}

/**
 * List of registered theme IDs in insertion order. Useful for building a
 * theme picker.
 */
export function themeIds(): ThemeId[] {
  return Object.keys(THEME_REGISTRY);
}

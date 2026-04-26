import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  contrastRatio,
  pickBrightForeground,
  pickReadableBorder,
  pickReadableForeground,
  relativeLuminance,
  shiftPerceptualL,
  walkFraction,
} from "$lib/components/ui/colorMath";

/**
 * Stable ID identifying a theme. Built-in IDs are "light" and "dark".
 * Custom themes added later should use slugs or UUIDs to avoid collisions.
 */
export type ThemeId = string;

/**
 * Six source colors that drive most of the shell palette through the
 * derivation formulas in {@link deriveAppTokens} / {@link deriveCalendarTokens}.
 *
 * - **canvas:** app background. The color visible in framing gaps and the
 *   Settings modal; also the reference the other app surfaces lift toward
 *   ink from. Also drives calendar canvas by a direction-aware OKLab ΔL
 *   (darker for dark canvases, slightly brighter for light) so the
 *   calendar reads as a distinct surface without requiring a separate
 *   source color. Users can still isolate `--cal-bg` through
 *   `calendarTokenOverrides` when they want a fully independent value.
 * - **ink:** text base. Default text color and the color every "lifted"
 *   surface mixes a small fraction of to tint it. Also drives secondary
 *   text tokens (form indicator, pomodoro idle caption, event panel text).
 * - **primary:** brand/action accent used on highlighted buttons and links.
 * - **destructive:** danger signal. Identity-drives the destructive tile,
 *   armed-delete state, and declined attendance status.
 * - **confirm:** positive/success signal. Identity-drives the confirm
 *   button (save, active scope pill) and accepted attendance status.
 * - **warning:** caution signal. Identity-drives the tentative attendance
 *   status today; reserved for future notification warnings and deadlines.
 *
 * Themes without `sources` fall back to the base CSS tokens unchanged;
 * sources exist purely to let a small number of color choices drive a
 * consistent palette across the shell.
 */
export interface ThemeSources {
  canvas: string;
  ink: string;
  primary: string;
  destructive: string;
  confirm: string;
  warning: string;
}

/**
 * Full palette for event color slots within a theme. Always exactly
 * PALETTE_SIZE entries (currently 24); each entry is a hex color the slot
 * resolves to. Events store the slot index, not the hex, so two themes can
 * assign the same slot index completely different colors and stored events
 * pick up the active theme's hex automatically when the user switches.
 *
 * Stored as an array (not an object) so order is intrinsic to the data
 * shape: a slot's position is its identity. JSON serialization preserves
 * the order without depending on object-key insertion semantics, and the
 * on-disk integer color (0..23) is tighter than any string key.
 */
export type EventPaletteHexes = readonly string[];

/**
 * Engine version stamp written onto every user theme at create, clone, or
 * import time. Bump whenever the derivation engine (APP_DERIVATION,
 * APP_FRACTIONS, CAL_DERIVATION, CAL_FRACTIONS, or any token-key list)
 * changes such that derived output shifts. The editor uses the gap between
 * a stored theme's stamp and this constant to render an opt-in "rebake"
 * banner so non-pinned colors do not silently drift across app updates.
 */
export const DERIVATION_ENGINE_VERSION = 1;

/**
 * A built-in theme ships with the app, never persists to SQLite, and paints
 * nothing onto the DOM beyond the base CSS rules. Built-ins carry the
 * minimum a theme needs: an id, display name, base (light or dark, used for
 * the base CSS lookup), a complete event palette, and the blend canvas the
 * dimmed event variants reference.
 */
export interface BuiltinTheme {
  kind: "builtin";
  id: ThemeId;
  displayName: string;
  base: "light" | "dark";
  /**
   * Decorative day/night annotation surfaced as the sun/moon icon. Built-in
   * themes pin this to their base; user themes carry it as a separate
   * editable field so the user can label a theme independently of canvas
   * luminance. The runtime `.dark` class and event-palette pick still come
   * from the actual canvas through `isThemeDark` / `isThemeCalendarDark`.
   */
  scheme: "light" | "dark";
  eventPalette: EventPaletteHexes;
  /** Reference bg dimmed event variants blend toward. Usually canvas bg. */
  blendCanvas: string;
}

/**
 * A user-authored theme persists in SQLite as a normalized snapshot. Every
 * shell token is stored as a resolved hex; the per-token `isolated` flag
 * controls whether each token participates in the next source-edit cascade
 * or is treated as user-pinned. Sources drive multi-token derivation only
 * at write time (source edits, rebake, clone, preset apply); at runtime the
 * snapshot is the source of truth, which makes saved themes stable across
 * derivation-engine changes.
 *
 * Seeds capture the live state at clone time so per-row and "Reset all"
 * restore correctly. Seed isolated flags mirror the live flags so a clone
 * of a user theme keeps its pins through resets.
 */
export interface UserTheme {
  kind: "user";
  id: ThemeId;
  displayName: string;
  base: "light" | "dark";
  /**
   * Decorative day/night annotation; flips the sun/moon icon in the editor
   * header and the theme list. Has no effect on the runtime `.dark` class or
   * the calendar event palette (both still derive from canvas luminance).
   */
  scheme: "light" | "dark";
  eventPalette: EventPaletteHexes;
  /** Reference bg dimmed event variants blend toward. Usually canvas bg. */
  blendCanvas: string;
  /** Engine version stamp; drives the rebake banner. */
  derivationEngineVersion: number;
  /** Six-color palette that powers source-edit derivation. */
  sources: ThemeSources;
  /** Full snapshot of every app-shell CSS token. */
  appTokens: Readonly<Record<string, string>>;
  /** Full snapshot of every calendar-shell CSS token. */
  calendarTokens: Readonly<Record<string, string>>;
  /** Keys of `appTokens` the user has pinned against future derivations. */
  appIsolated: ReadonlySet<string>;
  /** Keys of `calendarTokens` the user has pinned against future derivations. */
  calendarIsolated: ReadonlySet<string>;
  /** Clone-time snapshots used for per-row reset and "Reset all". */
  seedSources: ThemeSources;
  seedAppTokens: Readonly<Record<string, string>>;
  seedCalendarTokens: Readonly<Record<string, string>>;
  seedAppIsolated: ReadonlySet<string>;
  seedCalendarIsolated: ReadonlySet<string>;
  seedEventPalette: EventPaletteHexes;
  seedBlendCanvas: string;
  /** Clone-time scheme; "Reset all" restores `scheme` to this. */
  seedScheme: "light" | "dark";
}

/**
 * A theme is either a code-pinned built-in or a user-authored entry. The
 * `kind` discriminator picks which shape applies; built-ins are
 * synchronously available, user themes hydrate from SQLite at boot.
 */
export type Theme = BuiltinTheme | UserTheme;

// Built-in event palettes. Stored as positional arrays so the slot index
// (the value events save on disk) maps directly into the array. Additional
// themes can freely deviate from these hexes. Slot FALLBACK_COLOR_INDEX is
// the render-layer fallback; every theme must keep all PALETTE_SIZE
// positions filled.

const LIGHT_EVENT_PALETTE: EventPaletteHexes = Object.freeze([
  "#AD1457",
  "#D81B60",
  "#D50000",
  "#E67C73",
  "#F4511E",
  "#EF6C00",
  "#F09300",
  "#F6BF26",
  "#E4C441",
  "#C0CA33",
  "#7CB342",
  "#33B679",
  "#0B8043",
  "#009688",
  "#039BE5",
  "#4285F4",
  "#3F51B5",
  "#7986CB",
  "#B39DDB",
  "#9E69AF",
  "#8E24AA",
  "#795548",
  "#616161",
  "#A79B8E",
]);

const DARK_EVENT_PALETTE: EventPaletteHexes = Object.freeze([
  "#C05476",
  "#D85675",
  "#DA5234",
  "#D6837A",
  "#E3683E",
  "#DD7835",
  "#E0963C",
  "#E6B951",
  "#D8BE5E",
  "#BCC256",
  "#85AD59",
  "#55B080",
  "#489160",
  "#429A8E",
  "#4B99D2",
  "#668BE1",
  "#6E72C3",
  "#828BC2",
  "#AE9CCE",
  "#A479B1",
  "#A75ABA",
  "#957367",
  "#7C7C7C",
  "#A5998C",
]);

export const lightTheme: BuiltinTheme = Object.freeze({
  kind: "builtin",
  id: "light",
  displayName: "Light",
  base: "light",
  scheme: "light",
  eventPalette: LIGHT_EVENT_PALETTE,
  blendCanvas: "#ffffff",
});

export const darkTheme: BuiltinTheme = Object.freeze({
  kind: "builtin",
  id: "dark",
  displayName: "Dark",
  base: "dark",
  scheme: "dark",
  eventPalette: DARK_EVENT_PALETTE,
  blendCanvas: "#131314",
});

/**
 * Registry of the themes that ship with the app. Frozen so it cannot be
 * mutated at runtime; user-authored themes live in the store layer and are
 * merged with this registry when the active theme is resolved.
 */
export const BUILTIN_THEME_REGISTRY: Readonly<Record<ThemeId, BuiltinTheme>> =
  Object.freeze({
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
 * User themes paint their full token snapshot; built-ins paint nothing and
 * let the base CSS rules show through. The result tells the caller which
 * tokens to set, which leftover keys to clear, and the new set of applied
 * keys to remember for the next switch (without this bookkeeping, switching
 * from a user theme to a built-in would leave the previous theme's values
 * stuck on the root).
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
  if (theme.kind === "user") {
    for (const [key, value] of Object.entries(theme.appTokens)) {
      toSet.set(key, value);
      applied.add(key);
    }
    for (const [key, value] of Object.entries(theme.calendarTokens)) {
      toSet.set(key, value);
      applied.add(key);
    }
  }
  const toClear = new Set<string>();
  for (const key of previouslyApplied) {
    if (!applied.has(key)) toClear.add(key);
  }
  return { toSet, toClear, applied };
}

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
  "--destructive-foreground",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--event-panel-bg",
  "--event-panel-contrast",
  "--event-panel-edge",
  "--event-panel-shadow",
  "--event-panel-divider",
  "--event-panel-input-text",
  "--event-panel-placeholder",
  "--event-panel-text",
  "--event-panel-muted-text",
  "--form-indicator",
  "--action-confirm",
  "--action-confirm-foreground",
  "--action-danger-armed",
  "--action-danger-armed-foreground",
  "--status-accepted",
  "--status-accepted-foreground",
  "--status-tentative",
  "--status-tentative-foreground",
  "--status-declined",
  "--status-declined-foreground",
  "--priority-easy",
  "--priority-medium",
  "--priority-hard",
  "--priority-epic",
  "--pomodoro-idle-text",
  "--pomodoro-idle-timer",
  "--cal-color-picker-outline",
  "--cal-description-editor-bg",
  "--cal-drag-preview-border",
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

/**
 * Hex defaults for the app-shell tokens, mirrored from `app.css` so the
 * editor can show what a token resolves to without consulting the live DOM
 * (which reflects the currently active theme, not the one being edited).
 */
export const BASE_APP_TOKENS: Readonly<
  Record<"light" | "dark", Readonly<Record<string, string>>>
> = Object.freeze({
  light: Object.freeze({
    "--background": "#F4F4F7",
    "--foreground": "#141420",
    "--card": "#FFFFFF",
    "--card-foreground": "#141420",
    "--popover": "#FFFFFF",
    "--popover-foreground": "#141420",
    "--primary": "#404048",
    "--primary-foreground": "#F4F4F7",
    "--secondary": "#E2E2E7",
    "--secondary-foreground": "#141420",
    "--muted": "#E2E2E7",
    "--muted-foreground": "#646470",
    "--accent": "#E8E8ED",
    "--accent-foreground": "#141420",
    "--destructive": "#D93B3B",
    "--destructive-foreground": "#FFFFFF",
    "--ring": "#8C8C98",
    "--sidebar": "#DCDCE2",
    "--sidebar-foreground": "#141420",
    "--sidebar-accent": "#CFCFD6",
    "--sidebar-accent-foreground": "#141420",
    "--event-panel-bg": "#F0F4F9",
    "--event-panel-contrast": "#E8EDF5",
    "--event-panel-edge": "#0000004D",
    "--event-panel-shadow": "#0000001F",
    "--event-panel-divider": "#C4C7C5",
    "--event-panel-input-text": "#1F1F1F",
    "--event-panel-placeholder": "#444746",
    "--event-panel-text": "#141420",
    "--event-panel-muted-text": "#646470",
    "--form-indicator": "#6B6F6E",
    "--action-confirm": "#059669",
    "--action-confirm-foreground": "#FFFFFF",
    "--action-danger-armed": "#D93B3B",
    "--action-danger-armed-foreground": "#FFFFFF",
    "--status-accepted": "#059669",
    "--status-accepted-foreground": "#FFFFFF",
    "--status-tentative": "#F59E0B",
    "--status-tentative-foreground": "#FFFFFF",
    "--status-declined": "#D93B3B",
    "--status-declined-foreground": "#FFFFFF",
    "--priority-easy": "#22C55E",
    "--priority-medium": "#EAB308",
    "--priority-hard": "#F97316",
    "--priority-epic": "#A855F7",
    "--pomodoro-idle-text": "#9CA3AF",
    "--pomodoro-idle-timer": "#FFFFFF",
    "--cal-color-picker-outline": "#141420",
    "--cal-description-editor-bg": "#0000000D",
    "--cal-drag-preview-border": "#0000004D",
  }),
  dark: Object.freeze({
    "--background": "#27282A",
    "--foreground": "#ECECF2",
    "--card": "#2E2F31",
    "--card-foreground": "#ECECF2",
    "--popover": "#353638",
    "--popover-foreground": "#ECECF2",
    "--primary": "#ECECF2",
    "--primary-foreground": "#27282A",
    "--secondary": "#333436",
    "--secondary-foreground": "#ECECF2",
    "--muted": "#333436",
    "--muted-foreground": "#9494A0",
    "--accent": "#3B3B3F",
    "--accent-foreground": "#ECECF2",
    "--destructive": "#E54545",
    "--destructive-foreground": "#FFFFFF",
    "--ring": "#606070",
    "--sidebar": "#1E1E23",
    "--sidebar-foreground": "#FFFFFF",
    "--sidebar-accent": "#3B3B3F",
    "--sidebar-accent-foreground": "#FFFFFF",
    "--event-panel-bg": "#2A2B2E",
    "--event-panel-contrast": "#222325",
    "--event-panel-edge": "#0000008C",
    "--event-panel-shadow": "#00000066",
    "--event-panel-divider": "#444746",
    "--event-panel-input-text": "#E3E3E3",
    "--event-panel-placeholder": "#C4C7C5",
    "--event-panel-text": "#C4C7C5",
    "--event-panel-muted-text": "#9EA1A0",
    "--form-indicator": "#ECECF2",
    "--action-confirm": "#065F46",
    "--action-confirm-foreground": "#D1FAE5",
    "--action-danger-armed": "#E54545",
    "--action-danger-armed-foreground": "#FFFFFF",
    "--status-accepted": "#065F46",
    "--status-accepted-foreground": "#FFFFFF",
    "--status-tentative": "#F59E0B",
    "--status-tentative-foreground": "#FFFFFF",
    "--status-declined": "#E54545",
    "--status-declined-foreground": "#FFFFFF",
    "--priority-easy": "#4ADE80",
    "--priority-medium": "#FACC15",
    "--priority-hard": "#FB923C",
    "--priority-epic": "#C084FC",
    "--pomodoro-idle-text": "#9CA3AF",
    "--pomodoro-idle-timer": "#FFFFFF",
    "--cal-color-picker-outline": "#141420",
    "--cal-description-editor-bg": "#00000026",
    "--cal-drag-preview-border": "#FFFFFF80",
  }),
});

/**
 * Hex defaults for the calendar-shell tokens, mirrored from `app.css`.
 */
export const BASE_CALENDAR_TOKENS: Readonly<
  Record<"light" | "dark", Readonly<Record<string, string>>>
> = Object.freeze({
  light: Object.freeze({
    "--cal-bg": "#FFFFFF",
    "--cal-header-bg": "#F4F4F7",
    "--cal-gridline": "#DDDDE3",
    "--cal-today-circle": "#38383F",
    "--cal-today-circle-text": "#FFFFFF",
    "--cal-time-label": "#646470",
    "--cal-current-time": "#B83A3A",
    "--cal-timeline-rail": "#E5E7EB",
    "--cal-timeline-break": "#A1A1AA",
    "--cal-timeline-focus": "#4ADE80",
  }),
  dark: Object.freeze({
    "--cal-bg": "#131314",
    "--cal-header-bg": "#27282A",
    "--cal-gridline": "#333537",
    "--cal-today-circle": "#A4C4F7",
    "--cal-today-circle-text": "#0A1929",
    "--cal-time-label": "#9494A0",
    "--cal-current-time": "#B83A3A",
    "--cal-timeline-rail": "#3F3F46",
    "--cal-timeline-break": "#71717A",
    "--cal-timeline-focus": "#4ADE80",
  }),
});

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Signed OKLab lightness offsets that drive every derived surface.
 *
 * Each delta is measured from the dark built-in's actual OKLab lightness
 * diff between `canvas` (#27282A, L=0.2766) and the corresponding surface
 * hex (card, popover, ...). Applying these deltas to any canvas via
 * `shiftPerceptualL` reproduces the dark built-in's surface hierarchy
 * regardless of canvas brightness:
 *
 * - card / popover / accent / secondary / muted lift upward
 * - sidebar recedes below canvas so the title bar frames the app (the
 *   "contrarian" step that made the dark built-in read as layered)
 * - event panel sits just above canvas, and event-panel-contrast sits
 *   just below, keeping the panel's recessed band visible on any canvas
 *
 * The identity `deriveAppTokens(darkSources) === BASE_APP_TOKENS.dark`
 * holds on every shift-derived surface because the deltas are the
 * measured BASE_APP_TOKENS.dark OKLab-L differences from canvas. Any
 * custom canvas inherits the same relative surface stack by running
 * these same deltas.
 *
 * Near-white or near-black canvases clamp at the gamut boundary inside
 * `shiftPerceptualL`, so the hierarchy degrades gracefully instead of
 * wrapping. Foregrounds, borders, and muted captions are recomputed
 * from contrast math so legibility survives the clamp.
 */
const APP_DERIVATION = {
  cardDeltaL: +0.028345,
  popoverDeltaL: +0.056046,
  secondaryDeltaL: +0.048193,
  mutedDeltaL: +0.048193,
  accentDeltaL: +0.077214,
  sidebarDeltaL: -0.039433,
  sidebarAccentDeltaL: +0.077214,
  eventPanelBgDeltaL: +0.012636,
  eventPanelContrastDeltaL: -0.020696,
} as const;

/**
 * Per-token fractional walks calibrated from the dark built-in. Each
 * value is the fraction of the way from the chosen foreground anchor
 * toward the paired surface's OKLab lightness where BASE_APP_TOKENS.dark
 * sits. A contrast-target walk ("park at 3:1") cannot reproduce these
 * hexes because their contrast sits between 3:1 and AA (e.g.,
 * --muted-foreground at 4.9:1 is too deep for the 3:1 picker's landing
 * and too shallow for 4.5:1), so `walkFraction(fg, bg, f)` is used to
 * park each token at its BASE fraction.
 *
 * The chroma of the result comes from the foreground anchor (walk
 * preserves fg's `a`, `b`), which yields identity on dark for any token
 * whose BASE chroma is close to ink's. BASE hexes that were
 * hand-tuned with off-ink chroma (e.g., the slightly warmer
 * --event-panel-text) land within a few rgb units of the BASE hex.
 */
const APP_FRACTIONS = {
  mutedForeground: 0.442563,
  ring: 0.673365,
  eventPanelText: 0.180110,
  eventPanelInputText: 0.044202,
  eventPanelPlaceholder: 0.180110,
  eventPanelMutedText: 0.363909,
  eventPanelDivider: 0.839033,
  pomodoroIdleText: 0.244651,
} as const;

/**
 * Lightness shift that maps `confirm` (source green) to the confirm
 * foreground. Dark BASE confirm #065F46 (L=0.4318) pairs with
 * --action-confirm-foreground #D1FAE5 (L=0.9505), a ΔL of +0.5187.
 * Light BASE confirm #059669 (L=0.5960) shifts to L=1.1147 which
 * clamps to #FFFFFF, matching BASE.light's white confirm-foreground.
 * User-picked confirm colors get a pale tint of their own hue when
 * dark enough, or clamp to white when bright.
 */
const CONFIRM_FG_DELTA_L = 0.518657;

/**
 * Calendar-surface derivation offsets, measured from the built-ins.
 * - `calCanvasDarkDeltaL`: BASE.dark --cal-bg #131314 sits at ΔL -0.0894
 *   below canvas #27282A.
 * - `calCanvasLightDeltaL`: BASE.light --cal-bg #FFFFFF clamps to L=1,
 *   ΔL +0.0320 above canvas #F4F4F7 (L=0.968). Asymmetric by design:
 *   dark pulls cal-bg into a recessed framing; light pushes it to paper
 *   white so the app canvas reads as a tinted border around it.
 * - `timelineRailDarkDeltaL`: BASE.dark rail #3F3F46 sits at +0.1832
 *   above the derived cal-bg, elevating the empty track behind events.
 * - `timelineRailLightDeltaL`: BASE.light rail #E5E7EB sits at -0.0724
 *   below cal-bg, recessing the track on a paper-white surface.
 */
const CAL_DERIVATION = {
  calCanvasDarkDeltaL: -0.089432,
  calCanvasLightDeltaL: +0.031968,
  timelineRailDarkDeltaL: +0.183151,
  timelineRailLightDeltaL: -0.072415,
} as const;

/**
 * Fractional walks for calendar tokens that land at specific OKLab-L
 * recessions against `cal-bg`. Calibrated from BASE_CALENDAR_TOKENS.dark.
 * --cal-time-label matches --muted-foreground's fraction (both land at
 * the same BASE hex #9494A0). --cal-timeline-break sits deeper toward
 * the cal-bg.
 */
const CAL_FRACTIONS = {
  calTimeLabel: 0.362173,
  calTimelineBreak: 0.518908,
} as const;

/**
 * Derive every app-shell token from a source palette. Every surface
 * (card, popover, secondary, muted, accent, sidebar, event panel)
 * moves canvas by a per-token OKLab ΔL offset calibrated from the dark
 * built-in, so the same "card above canvas, sidebar below" hierarchy
 * shows on every canvas regardless of brightness. Foregrounds, borders,
 * and muted captions are recomputed from contrast math so the pairing
 * stays legible regardless of which sources the user picks:
 * `pickReadableForeground` guarantees AA 4.5:1 on body text,
 * `pickBrightForeground` snaps to pure white (or ink, or black) on status
 * surfaces so signal colors read consistently, and `walkFraction` parks
 * recessed captions at the exact OKLab-L position BASE.dark uses.
 *
 * The `base` parameter is kept for call-site compatibility with the
 * current resolver path but is intentionally unused: toggling the label
 * on a sourced theme must not shift any derived token.
 *
 * Built-in themes carry no `sources` field and never reach this function
 * at resolve time; it is called only for user themes that have opted into
 * the source-driven workflow.
 */
export function deriveAppTokens(
  sources: ThemeSources,
  _base: "light" | "dark",
): Record<string, string> {
  const { canvas, ink, primary, destructive, confirm, warning } = sources;
  const d = APP_DERIVATION;
  const f = APP_FRACTIONS;
  const shift = (deltaL: number) => shiftPerceptualL(canvas, deltaL);
  const fg = (bg: string, target = 4.5) =>
    pickReadableForeground(bg, { ink, canvas, target });
  // Direction-aware walk anchor. Recessed tokens (muted captions, rings,
  // event-panel hint text, form indicator) must sit between their paired
  // surface and a *visible* foreground, not between the surface and raw
  // ink. When the user keeps a light ink but drags canvas to white, raw
  // ink collapses against every near-white surface and walkFraction
  // produces invisible light-gray text. Anchoring on a contrast-picked
  // foreground for each bg flips direction with canvas so the walk always
  // starts from a visible point. On BASE.dark (dark canvas + light ink),
  // `pickReadableForeground` returns ink on every app surface, so
  // dark-BASE identity is preserved.
  const anchorFor = (bg: string) =>
    pickReadableForeground(bg, { ink, canvas, target: 4.5 });
  const walk = (bg: string, fraction: number) =>
    walkFraction(anchorFor(bg), bg, fraction);
  const bright = (bg: string, target = 4.5) =>
    pickBrightForeground(bg, ink, target);
  // Pomodoro idle overlay paints a full-screen black surface; tokens over
  // it pair against pure black rather than against canvas.
  const idleBg = "#000000";
  const canvasIsDark = relativeLuminance(canvas) < 0.5;
  const card = shift(d.cardDeltaL);
  const popover = shift(d.popoverDeltaL);
  const secondary = shift(d.secondaryDeltaL);
  const mutedBg = shift(d.mutedDeltaL);
  const accent = shift(d.accentDeltaL);
  const sidebar = shift(d.sidebarDeltaL);
  const sidebarAccent = shift(d.sidebarAccentDeltaL);
  const eventPanelBg = shift(d.eventPanelBgDeltaL);
  const eventPanelContrast = shift(d.eventPanelContrastDeltaL);
  // Confirm foreground: shift by the calibrated ΔL to reproduce BASE.dark's
  // pale-green #D1FAE5 on #065F46 and BASE.light's white on #059669. When
  // the source confirm is too bright for the shift to produce >=3:1 (e.g.,
  // a pure bright-green source), fall back to a contrast-aware pick so
  // button labels stay readable.
  const confirmShift = shiftPerceptualL(confirm, CONFIRM_FG_DELTA_L);
  const confirmFg =
    contrastRatio(confirmShift, confirm) >= 3
      ? confirmShift
      : pickReadableForeground(confirm, { ink, canvas, target: 3 });
  return {
    "--background": canvas,
    "--foreground": fg(canvas),
    "--card": card,
    "--card-foreground": fg(card),
    "--popover": popover,
    "--popover-foreground": fg(popover),
    "--primary": primary,
    "--primary-foreground": fg(primary),
    "--secondary": secondary,
    "--secondary-foreground": fg(secondary),
    "--muted": mutedBg,
    "--muted-foreground": walk(mutedBg, f.mutedForeground),
    "--accent": accent,
    "--accent-foreground": fg(accent),
    "--destructive": destructive,
    "--destructive-foreground": bright(destructive, 3),
    "--ring": walk(canvas, f.ring),
    "--sidebar": sidebar,
    "--sidebar-foreground": bright(sidebar, 4.5),
    "--sidebar-accent": sidebarAccent,
    "--sidebar-accent-foreground": bright(sidebarAccent, 4.5),
    "--action-confirm": confirm,
    "--action-confirm-foreground": confirmFg,
    "--action-danger-armed": destructive,
    "--action-danger-armed-foreground": bright(destructive, 3),
    "--status-accepted": confirm,
    "--status-accepted-foreground": bright(confirm, 3),
    "--status-tentative": warning,
    "--status-tentative-foreground": "#FFFFFF",
    "--status-declined": destructive,
    "--status-declined-foreground": bright(destructive, 3),
    "--form-indicator": anchorFor(canvas),
    "--pomodoro-idle-text": walk(idleBg, f.pomodoroIdleText),
    "--pomodoro-idle-timer": bright(idleBg, 4.5),
    "--event-panel-bg": eventPanelBg,
    "--event-panel-contrast": eventPanelContrast,
    "--event-panel-divider": walk(eventPanelBg, f.eventPanelDivider),
    "--event-panel-text": walk(eventPanelBg, f.eventPanelText),
    "--event-panel-input-text": walk(eventPanelBg, f.eventPanelInputText),
    "--event-panel-placeholder": walk(eventPanelBg, f.eventPanelPlaceholder),
    "--event-panel-muted-text": walk(eventPanelBg, f.eventPanelMutedText),
    "--cal-drag-preview-border": canvasIsDark ? "#FFFFFF80" : "#0000004D",
  };
}

/**
 * Derive the calendar-shell tokens that can be computed from sources.
 *
 * `--cal-bg` is auto-tracked from `canvas` via a direction-aware OKLab ΔL
 * so editing the app canvas cascades through the calendar surface by
 * default. Users who want a calendar surface that does NOT track canvas
 * can isolate `--cal-bg` through `calendarTokenOverrides`: the resolver
 * walks override first, so a pinned value wins over the auto-derived one.
 *
 * Gridlines (and the timeline-break marker) are parked just above a
 * minimum-visibility contrast against `--cal-bg`. The target is
 * intentionally subtle (1.4:1) to match how the dark built-in renders its
 * grid: a 3:1 target produces gridlines noticeably more prominent than
 * the built-in's curated hex, which users read as "uglier" on clones.
 *
 * The semantic tokens (current time, timeline focus) are intentionally
 * omitted: those colors carry hard-coded meaning (red for "now", green
 * for focus) that does not reduce to the source palette, so the resolver
 * falls through to the base CSS defaults for them.
 */
export function deriveCalendarTokens(
  sources: ThemeSources,
  _base: "light" | "dark",
): Record<string, string> {
  const { canvas, ink } = sources;
  const canvasIsDark = relativeLuminance(canvas) < 0.5;
  const calCanvasDelta = canvasIsDark
    ? CAL_DERIVATION.calCanvasDarkDeltaL
    : CAL_DERIVATION.calCanvasLightDeltaL;
  const calCanvas = shiftPerceptualL(canvas, calCanvasDelta);
  const calCanvasIsDark = relativeLuminance(calCanvas) < 0.5;
  const timelineRailDelta = calCanvasIsDark
    ? CAL_DERIVATION.timelineRailDarkDeltaL
    : CAL_DERIVATION.timelineRailLightDeltaL;
  // Same direction-aware anchor as deriveAppTokens: walk-fraction tokens
  // must start from a foreground that is actually visible against the
  // calendar surface, not from raw ink. Dark-BASE parity still holds
  // because pickReadableForeground returns ink on BASE.dark's calCanvas.
  const anchorFor = (bg: string) =>
    pickReadableForeground(bg, { ink, canvas, target: 4.5 });
  return {
    "--cal-bg": calCanvas,
    "--cal-header-bg": canvas,
    "--cal-gridline": pickReadableBorder(calCanvas, ink, { target: 1.4 }),
    "--cal-time-label": walkFraction(
      anchorFor(calCanvas),
      calCanvas,
      CAL_FRACTIONS.calTimeLabel,
    ),
    "--cal-timeline-rail": shiftPerceptualL(calCanvas, timelineRailDelta),
    "--cal-timeline-break": walkFraction(
      anchorFor(calCanvas),
      calCanvas,
      CAL_FRACTIONS.calTimelineBreak,
    ),
  };
}

/**
 * Resolve every app-shell token for a theme. User themes paint from the
 * stored snapshot directly; built-ins fall through to the base CSS rules.
 * The three-layer fall-through (override, derived, base) is gone: the
 * snapshot is computed at write time and stays stable at runtime.
 */
export function resolveAppTokens(theme: Theme): Record<string, string> {
  if (theme.kind === "user") return { ...theme.appTokens };
  return { ...BASE_APP_TOKENS[theme.base] };
}

/**
 * Calendar-shell counterpart to {@link resolveAppTokens}. User themes paint
 * from the stored snapshot; built-ins fall through to the base CSS.
 */
export function resolveCalendarTokens(theme: Theme): Record<string, string> {
  if (theme.kind === "user") return { ...theme.calendarTokens };
  return { ...BASE_CALENDAR_TOKENS[theme.base] };
}

/**
 * Luminance cutoff below which a surface is treated as "dark" for binary
 * decisions like applying Tailwind's `.dark` class or picking the dark
 * event-tile palette. Sits at 0.4 so any sub-midpoint canvas is treated
 * as dark, but a mid-gray canvas (~#888 at 0.5) still resolves as light.
 * Only a bucket test, not a WCAG contrast check.
 */
const DARK_SURFACE_THRESHOLD = 0.4;

/**
 * Resolve the effective app background a theme will actually paint. Reads
 * the token snapshot for user themes and the base CSS rule for built-ins.
 * Used to drive luminance-aware decisions (dark-mode class, event-tile
 * palette) from the actual painted color rather than the cosmetic label.
 */
export function resolveCanvas(theme: Theme): string {
  if (theme.kind === "user") return theme.appTokens["--background"];
  return BASE_APP_TOKENS[theme.base]["--background"];
}

/**
 * Resolve the effective calendar background. Used to pick the event-tile
 * palette and calendar outline mixes based on the actual painted surface.
 */
export function resolveCalCanvas(theme: Theme): string {
  if (theme.kind === "user") return theme.calendarTokens["--cal-bg"];
  return BASE_CALENDAR_TOKENS[theme.base]["--cal-bg"];
}

/** True when the resolved app canvas crosses into dark-mode territory. */
export function isThemeDark(theme: Theme): boolean {
  return relativeLuminance(resolveCanvas(theme)) < DARK_SURFACE_THRESHOLD;
}

/**
 * Pick the default decorative scheme for a canvas hex. Used by the clone
 * path, the v1 validator's missing-scheme fallback, and the legacy DB row
 * backfill when a row created before migration v5 is loaded.
 */
export function defaultSchemeFromCanvas(canvasHex: string): "light" | "dark" {
  return relativeLuminance(canvasHex) < DARK_SURFACE_THRESHOLD ? "dark" : "light";
}

/** True when the resolved calendar canvas crosses into dark-mode territory. */
export function isThemeCalendarDark(theme: Theme): boolean {
  return relativeLuminance(resolveCalCanvas(theme)) < DARK_SURFACE_THRESHOLD;
}

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
 *
 * Built-ins emit a minimal read-only payload (id, name, base, palette,
 * blendCanvas) used by the editor's "View JSON" affordance; built-ins are
 * never round-tripped through import. User themes emit `schemaVersion: 1`
 * with the full token snapshot, sources, isolated-flag arrays, engine
 * version stamp, and palette. Seeds are install-local reset state and are
 * intentionally omitted from the export.
 */
export function serializeTheme(theme: Theme): string {
  if (theme.kind === "builtin") {
    const ordered: Record<string, unknown> = {
      id: theme.id,
      displayName: theme.displayName,
      base: theme.base,
      scheme: theme.scheme,
      blendCanvas: theme.blendCanvas,
      eventPalette: orderedPalette(theme.eventPalette),
    };
    return JSON.stringify(ordered, null, 2);
  }
  const ordered: Record<string, unknown> = {
    schemaVersion: 1,
    id: theme.id,
    displayName: theme.displayName,
    base: theme.base,
    scheme: theme.scheme,
    blendCanvas: theme.blendCanvas,
    derivationEngineVersion: theme.derivationEngineVersion,
    sources: orderedSources(theme.sources),
    appTokens: orderedTokens(theme.appTokens, APP_TOKEN_KEYS),
    calendarTokens: orderedTokens(theme.calendarTokens, CALENDAR_TOKEN_KEYS),
    appIsolated: orderedIsolated(theme.appIsolated, APP_TOKEN_KEYS),
    calendarIsolated: orderedIsolated(theme.calendarIsolated, CALENDAR_TOKEN_KEYS),
    eventPalette: orderedPalette(theme.eventPalette),
  };
  return JSON.stringify(ordered, null, 2);
}

function orderedIsolated(
  set: ReadonlySet<string>,
  order: readonly string[],
): string[] {
  const out: string[] = [];
  for (const key of order) {
    if (set.has(key)) out.push(key);
  }
  return out;
}

function orderedPalette(palette: EventPaletteHexes): string[] {
  return [...palette];
}

const SOURCE_KEY_ORDER: readonly (keyof ThemeSources)[] = [
  "canvas",
  "ink",
  "primary",
  "destructive",
  "confirm",
  "warning",
];

function orderedSources(sources: ThemeSources): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SOURCE_KEY_ORDER) out[key] = sources[key];
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
  | { ok: true; theme: UserTheme }
  | { ok: false; errors: string[] };

/**
 * Validate an unknown JSON-parsed value as a Theme suitable for import.
 * Returns a {@link UserTheme} on success (built-ins are never imported);
 * on failure returns a list of all problems found so the UI can surface
 * them at once instead of one round-trip per error. Unknown token keys
 * are stripped silently because dropping a stale token name should not
 * block an otherwise valid theme.
 *
 * Two import paths share validation of common identity fields:
 * * - **v1** (`schemaVersion: 1`): expects full token snapshots, source
 *   palette, isolated-flag arrays, and an engine version stamp. Used by
 *   exports written by this app version onward.
 * - **Legacy** (no schemaVersion): walks the old `sources?` /
 *   `appTokenOverrides?` / `calendarTokenOverrides?` shape. The current
 *   derivation engine runs at import time to compute the missing tokens,
 *   overrides layer on top to produce the snapshot, and the engine
 *   version stamp is set to the current code constant. Pinned tokens map
 *   to the new `appIsolated` / `calendarIsolated` flag sets.
 */
export function validateThemeJson(input: unknown): ThemeValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["theme must be a JSON object"] };
  }
  if (input.schemaVersion === 1) return validateV1(input);
  return validateLegacy(input);
}

function validateIdentity(
  input: Record<string, unknown>,
  errors: string[],
): {
  cleanId: string;
  cleanDisplayName: string;
  cleanBase: "light" | "dark";
  cleanBlend: string;
  cleanPalette: string[];
} {
  const { id, displayName, base, blendCanvas, eventPalette } = input;

  let cleanId = "";
  if (typeof id !== "string" || id.length === 0) {
    errors.push("id must be a non-empty string");
  } else if (!SLUG_RE.test(id)) {
    errors.push(
      "id must be a slug (lowercase letters, digits, and hyphens; must start with a letter or digit)",
    );
  } else if (id === "light" || id === "dark") {
    errors.push("id must not collide with a built-in theme");
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

  const cleanPalette: string[] = [];
  if (!Array.isArray(eventPalette)) {
    errors.push(`eventPalette must be an array of ${PALETTE_SIZE} hex strings`);
  } else if (eventPalette.length !== PALETTE_SIZE) {
    errors.push(
      `eventPalette must contain exactly ${PALETTE_SIZE} entries (got ${eventPalette.length})`,
    );
  } else {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const value = eventPalette[i];
      if (!isHexColor(value)) {
        errors.push(`eventPalette[${i}] must be a hex color`);
        cleanPalette.push("#000000");
      } else {
        cleanPalette.push(value);
      }
    }
  }
  return { cleanId, cleanDisplayName, cleanBase, cleanBlend, cleanPalette };
}

function validateV1(input: Record<string, unknown>): ThemeValidationResult {
  const errors: string[] = [];
  const { cleanId, cleanDisplayName, cleanBase, cleanBlend, cleanPalette } =
    validateIdentity(input, errors);

  const cleanSources = sanitizeSources(input.sources, errors, "sources", cleanBase);
  if (!cleanSources && !errors.some((e) => e.startsWith("sources"))) {
    errors.push("sources is required on v1 themes");
  }

  const cleanAppTokens = sanitizeFullTokenSnapshot(
    input.appTokens,
    APP_TOKEN_KEYS,
    APP_TOKEN_KEY_SET,
    BASE_APP_TOKENS[cleanBase],
    "appTokens",
    errors,
  );
  const cleanCalTokens = sanitizeFullTokenSnapshot(
    input.calendarTokens,
    CALENDAR_TOKEN_KEYS,
    CALENDAR_TOKEN_KEY_SET,
    BASE_CALENDAR_TOKENS[cleanBase],
    "calendarTokens",
    errors,
  );

  const cleanAppIsolated = sanitizeIsolatedList(
    input.appIsolated,
    APP_TOKEN_KEY_SET,
    "appIsolated",
    errors,
  );
  const cleanCalIsolated = sanitizeIsolatedList(
    input.calendarIsolated,
    CALENDAR_TOKEN_KEY_SET,
    "calendarIsolated",
    errors,
  );

  let cleanEngineVersion = DERIVATION_ENGINE_VERSION;
  if (typeof input.derivationEngineVersion === "number") {
    if (
      Number.isInteger(input.derivationEngineVersion) &&
      input.derivationEngineVersion >= 0
    ) {
      cleanEngineVersion = input.derivationEngineVersion;
    } else {
      errors.push("derivationEngineVersion must be a non-negative integer");
    }
  } else if (input.derivationEngineVersion !== undefined) {
    errors.push("derivationEngineVersion must be a number");
  }

  const cleanScheme = sanitizeScheme(
    input.scheme,
    cleanSources?.canvas ?? cleanBlend,
    "scheme",
    errors,
  );

  if (errors.length > 0) return { ok: false, errors };

  const theme: UserTheme = {
    kind: "user",
    id: cleanId,
    displayName: cleanDisplayName,
    base: cleanBase,
    scheme: cleanScheme,
    blendCanvas: cleanBlend,
    eventPalette: cleanPalette,
    derivationEngineVersion: cleanEngineVersion,
    sources: cleanSources as ThemeSources,
    appTokens: cleanAppTokens,
    calendarTokens: cleanCalTokens,
    appIsolated: cleanAppIsolated,
    calendarIsolated: cleanCalIsolated,
    seedSources: { ...(cleanSources as ThemeSources) },
    seedAppTokens: { ...cleanAppTokens },
    seedCalendarTokens: { ...cleanCalTokens },
    seedAppIsolated: new Set(cleanAppIsolated),
    seedCalendarIsolated: new Set(cleanCalIsolated),
    seedEventPalette: [...cleanPalette],
    seedBlendCanvas: cleanBlend,
    seedScheme: cleanScheme,
  };
  return { ok: true, theme };
}

function validateLegacy(input: Record<string, unknown>): ThemeValidationResult {
  const errors: string[] = [];
  const { cleanId, cleanDisplayName, cleanBase, cleanBlend, cleanPalette } =
    validateIdentity(input, errors);

  const cleanSourcesPartial = sanitizeSources(
    input.sources,
    errors,
    "sources",
    cleanBase,
  );
  // Legacy files without `sources` resolve to defaults derived from BASE.
  // The new model always carries sources, so synthesize a valid set here.
  const cleanSources: ThemeSources =
    cleanSourcesPartial ?? defaultSources(cleanBase);

  const cleanAppOverrides =
    sanitizeOverrides(
      input.appTokenOverrides,
      APP_TOKEN_KEY_SET,
      "appTokenOverrides",
      errors,
    ) ?? {};
  const cleanCalOverrides =
    sanitizeOverrides(
      input.calendarTokenOverrides,
      CALENDAR_TOKEN_KEY_SET,
      "calendarTokenOverrides",
      errors,
    ) ?? {};

  // Legacy themes that stored calCanvas as a 7th source meant "keep the
  // calendar surface independent of canvas", which maps to an isolated
  // override on --cal-bg. Only apply when no override already exists.
  const legacyCalCanvas = extractLegacyCalCanvas(input.sources);
  if (legacyCalCanvas && !cleanCalOverrides["--cal-bg"]) {
    cleanCalOverrides["--cal-bg"] = legacyCalCanvas;
  }

  if (errors.length > 0) return { ok: false, errors };

  // Run the current derivation engine to produce the missing tokens,
  // then layer the overrides on top to produce the full snapshot.
  const derivedApp = deriveAppTokens(cleanSources, cleanBase);
  const derivedCal = deriveCalendarTokens(cleanSources, cleanBase);
  const appTokens = buildSnapshot(
    APP_TOKEN_KEYS,
    BASE_APP_TOKENS[cleanBase],
    derivedApp,
    cleanAppOverrides,
  );
  const calTokens = buildSnapshot(
    CALENDAR_TOKEN_KEYS,
    BASE_CALENDAR_TOKENS[cleanBase],
    derivedCal,
    cleanCalOverrides,
  );
  const appIsolated = new Set(Object.keys(cleanAppOverrides));
  const calIsolated = new Set(Object.keys(cleanCalOverrides));

  // Legacy seed fields, if any, follow the same shape.
  const seedSourcesPartial = sanitizeSources(
    input.seedSources,
    errors,
    "seedSources",
    cleanBase,
  );
  const seedSources: ThemeSources = seedSourcesPartial ?? { ...cleanSources };
  const seedAppOverrides =
    sanitizeOverrides(
      input.seedAppTokenOverrides,
      APP_TOKEN_KEY_SET,
      "seedAppTokenOverrides",
      errors,
    ) ?? { ...cleanAppOverrides };
  const seedCalOverrides =
    sanitizeOverrides(
      input.seedCalendarTokenOverrides,
      CALENDAR_TOKEN_KEY_SET,
      "seedCalendarTokenOverrides",
      errors,
    ) ?? { ...cleanCalOverrides };
  const legacySeedCalCanvas = extractLegacyCalCanvas(input.seedSources);
  if (legacySeedCalCanvas && !seedCalOverrides["--cal-bg"]) {
    seedCalOverrides["--cal-bg"] = legacySeedCalCanvas;
  }
  const seedAppTokensProvided = sanitizeOverrides(
    input.seedAppTokens,
    APP_TOKEN_KEY_SET,
    "seedAppTokens",
    errors,
  );
  const seedCalTokensProvided = sanitizeOverrides(
    input.seedCalendarTokens,
    CALENDAR_TOKEN_KEY_SET,
    "seedCalendarTokens",
    errors,
  );
  const seedPalette =
    sanitizeSeedPalette(input.seedEventPalette, errors) ?? [...cleanPalette];
  let seedBlend = cleanBlend;
  if (input.seedBlendCanvas !== undefined) {
    if (!isHexColor(input.seedBlendCanvas)) {
      errors.push("seedBlendCanvas must be a hex color (#RRGGBB or #RRGGBBAA)");
    } else {
      seedBlend = input.seedBlendCanvas;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Build seed snapshots: prefer explicit seedAppTokens when provided, else
  // re-derive from seedSources and layer seed overrides.
  const seedDerivedApp = deriveAppTokens(seedSources, cleanBase);
  const seedDerivedCal = deriveCalendarTokens(seedSources, cleanBase);
  const seedAppTokens = seedAppTokensProvided
    ? buildSnapshot(
        APP_TOKEN_KEYS,
        BASE_APP_TOKENS[cleanBase],
        seedDerivedApp,
        { ...seedAppTokensProvided, ...seedAppOverrides },
      )
    : buildSnapshot(
        APP_TOKEN_KEYS,
        BASE_APP_TOKENS[cleanBase],
        seedDerivedApp,
        seedAppOverrides,
      );
  const seedCalTokens = seedCalTokensProvided
    ? buildSnapshot(
        CALENDAR_TOKEN_KEYS,
        BASE_CALENDAR_TOKENS[cleanBase],
        seedDerivedCal,
        { ...seedCalTokensProvided, ...seedCalOverrides },
      )
    : buildSnapshot(
        CALENDAR_TOKEN_KEYS,
        BASE_CALENDAR_TOKENS[cleanBase],
        seedDerivedCal,
        seedCalOverrides,
      );
  const seedAppIsolated = new Set(Object.keys(seedAppOverrides));
  const seedCalIsolated = new Set(Object.keys(seedCalOverrides));

  const cleanScheme = sanitizeScheme(
    input.scheme,
    cleanSources.canvas,
    "scheme",
    errors,
  );

  const theme: UserTheme = {
    kind: "user",
    id: cleanId,
    displayName: cleanDisplayName,
    base: cleanBase,
    scheme: cleanScheme,
    blendCanvas: cleanBlend,
    eventPalette: cleanPalette,
    derivationEngineVersion: DERIVATION_ENGINE_VERSION,
    sources: cleanSources,
    appTokens,
    calendarTokens: calTokens,
    appIsolated,
    calendarIsolated: calIsolated,
    seedSources,
    seedAppTokens,
    seedCalendarTokens: seedCalTokens,
    seedAppIsolated,
    seedCalendarIsolated: seedCalIsolated,
    seedEventPalette: seedPalette,
    seedBlendCanvas: seedBlend,
    seedScheme: cleanScheme,
  };
  return { ok: true, theme };
}

/**
 * Build a full token snapshot by layering derived values over base CSS,
 * then overrides over derived. Every key in `order` ends up in the result.
 */
function buildSnapshot(
  order: readonly string[],
  base: Readonly<Record<string, string>>,
  derived: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of order) {
    out[key] = overrides[key] ?? derived[key] ?? base[key];
  }
  return out;
}

/**
 * Validate an array-of-key-strings (the v1 `appIsolated` / `calendarIsolated`
 * shape). Unknown keys are dropped silently to match the legacy import
 * tolerance for stale token names.
 */
/**
 * Validate the optional `scheme` field. Defaults to canvas-derived when
 * missing so legacy and v1-without-scheme imports always end up with a
 * concrete value. Any value other than "light", "dark", or undefined is a
 * hard error.
 */
function sanitizeScheme(
  raw: unknown,
  fallbackCanvasHex: string,
  fieldName: string,
  errors: string[],
): "light" | "dark" {
  if (raw === undefined) return defaultSchemeFromCanvas(fallbackCanvasHex);
  if (raw === "light" || raw === "dark") return raw;
  errors.push(`${fieldName} must be "light" or "dark"`);
  return defaultSchemeFromCanvas(fallbackCanvasHex);
}

function sanitizeIsolatedList(
  source: unknown,
  allowed: ReadonlySet<string>,
  fieldName: string,
  errors: string[],
): Set<string> {
  if (source === undefined) return new Set();
  if (!Array.isArray(source)) {
    errors.push(`${fieldName} must be an array of token-key strings`);
    return new Set();
  }
  const out = new Set<string>();
  for (let i = 0; i < source.length; i++) {
    const value = source[i];
    if (typeof value !== "string") {
      errors.push(`${fieldName}[${i}] must be a string`);
      continue;
    }
    if (!allowed.has(value)) continue;
    out.add(value);
  }
  return out;
}

/**
 * Validate a v1 full token snapshot. Every key in `order` must be present
 * and a valid hex; missing keys backfill from `base` with a non-fatal note
 * (drift across app versions should not block import).
 */
function sanitizeFullTokenSnapshot(
  source: unknown,
  order: readonly string[],
  allowed: ReadonlySet<string>,
  base: Readonly<Record<string, string>>,
  fieldName: string,
  errors: string[],
): Record<string, string> {
  if (!isPlainObject(source)) {
    errors.push(`${fieldName} must be an object of token-hex pairs`);
    return { ...base };
  }
  const out: Record<string, string> = {};
  for (const key of order) {
    const value = (source as Record<string, unknown>)[key];
    if (value === undefined) {
      out[key] = base[key];
      continue;
    }
    if (!isHexColor(value)) {
      errors.push(`${fieldName}.${key} must be a hex color`);
      continue;
    }
    if (!allowed.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Synthesize a default sources palette from base CSS for legacy imports
 * that don't carry a `sources` block.
 */
function defaultSources(base: "light" | "dark"): ThemeSources {
  return {
    canvas: defaultSourceValue("canvas", base),
    ink: defaultSourceValue("ink", base),
    primary: defaultSourceValue("primary", base),
    destructive: defaultSourceValue("destructive", base),
    confirm: defaultSourceValue("confirm", base),
    warning: defaultSourceValue("warning", base),
  };
}

/**
 * Pull a legacy `calCanvas` field out of an unknown sources-shaped value.
 * Returns the hex when valid, otherwise undefined. Used to migrate themes
 * written before calCanvas moved from a source to an auto-derived token.
 */
function extractLegacyCalCanvas(source: unknown): string | undefined {
  if (!isPlainObject(source)) return undefined;
  const value = (source as Record<string, unknown>).calCanvas;
  return isHexColor(value) ? value : undefined;
}

function sanitizeSeedPalette(
  source: unknown,
  errors: string[],
): string[] | undefined {
  if (source === undefined) return undefined;
  if (!Array.isArray(source)) {
    errors.push(`seedEventPalette must be an array of ${PALETTE_SIZE} hex strings`);
    return undefined;
  }
  if (source.length !== PALETTE_SIZE) {
    errors.push(
      `seedEventPalette must contain exactly ${PALETTE_SIZE} entries (got ${source.length})`,
    );
    return undefined;
  }
  const out: string[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const value = source[i];
    if (!isHexColor(value)) {
      errors.push(`seedEventPalette[${i}] must be a hex color`);
      return undefined;
    }
    out.push(value);
  }
  return out;
}

/**
 * Default value for each source channel, sampled from the base CSS tokens
 * so legacy themes missing newer source fields (confirm, warning) pick up
 * sensible defaults without erroring. Each channel reads from the token it
 * identity-drives in {@link deriveAppTokens}.
 */
function defaultSourceValue(
  key: keyof ThemeSources,
  base: "light" | "dark",
): string {
  switch (key) {
    case "canvas":
      return BASE_APP_TOKENS[base]["--background"];
    case "ink":
      return BASE_APP_TOKENS[base]["--foreground"];
    case "primary":
      return BASE_APP_TOKENS[base]["--primary"];
    case "destructive":
      return BASE_APP_TOKENS[base]["--destructive"];
    case "confirm":
      return BASE_APP_TOKENS[base]["--action-confirm"];
    case "warning":
      return BASE_APP_TOKENS[base]["--status-tentative"];
  }
}

function sanitizeSources(
  source: unknown,
  errors: string[],
  fieldName: string = "sources",
  base: "light" | "dark" = "dark",
): ThemeSources | undefined {
  if (source === undefined) return undefined;
  if (!isPlainObject(source)) {
    errors.push(`${fieldName} must be an object`);
    return undefined;
  }
  const out: Partial<ThemeSources> = {};
  let ok = true;
  for (const key of SOURCE_KEY_ORDER) {
    const value = (source as Record<string, unknown>)[key];
    // Missing keys are backfilled from base defaults so legacy themes
    // (written before a source was introduced) keep loading; only an
    // actively-invalid hex is an error.
    if (value === undefined) {
      out[key] = defaultSourceValue(key, base);
      continue;
    }
    if (!isHexColor(value)) {
      errors.push(`${fieldName}.${key} must be a hex color`);
      ok = false;
      continue;
    }
    out[key] = value;
  }
  if (!ok) return undefined;
  return out as ThemeSources;
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

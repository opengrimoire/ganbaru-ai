import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  pickReadableBorder,
  pickReadableForeground,
  pickReadableMuted,
  relativeLuminance,
  shiftPerceptualL,
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
  /**
   * Optional five-color source palette that drives the rest of the shell
   * through the derivation formulas. When set, the token resolver uses
   * overrides first, then derivation, then base CSS defaults. Built-ins do
   * not ship sources: they resolve straight to base CSS tokens.
   */
  sources?: ThemeSources;
  /** Optional overrides for app-shell CSS tokens (--primary, etc). */
  appTokenOverrides?: Readonly<Record<string, string>>;
  /** Optional overrides for calendar-shell CSS tokens (--cal-bg, etc). */
  calendarTokenOverrides?: Readonly<Record<string, string>>;
  /**
   * Snapshot of the source theme's resolved tokens at clone time. Drives
   * per-token lookups (future per-row reset) by recording what each token
   * looked like when the clone was created, regardless of derivation.
   */
  seedAppTokens?: Readonly<Record<string, string>>;
  seedCalendarTokens?: Readonly<Record<string, string>>;
  seedEventPalette?: EventPaletteHexes;
  /**
   * Snapshot of the clone-time editable inputs (sources, overrides, blend
   * canvas). Drives the theme-level "Reset to original" affordance: restoring
   * these fields rewinds the theme to how it looked right after cloning.
   * Separate from the resolved-token seeds above because reset restores the
   * inputs the derivation reads, not the outputs. Only set on user themes;
   * built-ins never carry seeds.
   */
  seedSources?: ThemeSources;
  seedAppTokenOverrides?: Readonly<Record<string, string>>;
  seedCalendarTokenOverrides?: Readonly<Record<string, string>>;
  seedBlendCanvas?: string;
}

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
  blendCanvas: "#131314",
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
  // Derived values go first so explicit overrides layered on top win. Both
  // derived AND overridden tokens need to be pushed to the DOM; if derived
  // values were omitted, clearing the previous theme's override would drop
  // the token back to the base CSS rule instead of the new theme's derived
  // value.
  if (theme.sources) {
    merge(deriveAppTokens(theme.sources, theme.base));
    merge(deriveCalendarTokens(theme.sources, theme.base));
  }
  merge(theme.appTokenOverrides);
  merge(theme.calendarTokenOverrides);
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
 * diff between `canvas` (#27282A) and the corresponding surface hex
 * (card, popover, ...). Applying these deltas to any canvas via
 * `shiftPerceptualL` reproduces the dark built-in's surface hierarchy
 * regardless of canvas brightness:
 *
 * - card / popover / accent / secondary / muted lift upward
 * - sidebar recedes below canvas so the title bar frames the app (the
 *   "contrarian" step that made the dark built-in read as layered)
 * - event panel sits just above canvas, and event-panel-contrast sits
 *   just below, keeping the panel's recessed band visible on any canvas
 *
 * Before this table, the derivation blended surfaces toward ink with a
 * single positive weight (`liftTowardInk(canvas, ink, t)`), which cannot
 * represent "sidebar moves away from ink" and collapsed the light-base
 * clone into a flat stack. Switching to signed OKLab ΔL lets a single
 * table describe the intent ("this surface is X steps lighter/darker
 * than canvas") without depending on which direction ink sits.
 *
 * Near-white or near-black canvases clamp at the gamut boundary inside
 * `shiftPerceptualL`, so the hierarchy degrades gracefully instead of
 * wrapping. Foregrounds, borders, and muted captions are recomputed
 * from contrast math so legibility survives the clamp.
 */
const APP_DERIVATION = {
  cardDeltaL: +0.028,
  popoverDeltaL: +0.056,
  secondaryDeltaL: +0.048,
  mutedDeltaL: +0.048,
  accentDeltaL: +0.077,
  sidebarDeltaL: -0.039,
  sidebarAccentDeltaL: +0.077,
  eventPanelBgDeltaL: +0.013,
  eventPanelContrastDeltaL: -0.021,
} as const;

/**
 * Calendar-surface derivation offsets.
 *
 * `calCanvasDarkDeltaL` / `calCanvasLightDeltaL` push `--cal-bg` away from
 * canvas in a direction-aware way: dark canvases produce a darker calendar
 * surface (matches the dark built-in's recessed grid), light canvases
 * produce a slightly brighter one (matches the light built-in's paper-on-
 * paper look). Magnitudes are asymmetric because that's what the built-ins
 * themselves do: the dark step is nearly 4x larger than the light step.
 *
 * `timelineRailDarkDeltaL` / `timelineRailLightDeltaL` elevate or recede
 * the empty-track band behind pomodoro events relative to the calendar
 * surface (not the app canvas), so the rail inherits the same tint as
 * `--cal-bg` and reads as a tick-mark gray instead of drifting toward
 * the app canvas. Calibrated from the built-ins: dark cal-bg lifts the
 * rail above the surface, light cal-bg recesses it below.
 */
const CAL_DERIVATION = {
  calCanvasDarkDeltaL: -0.173,
  calCanvasLightDeltaL: +0.044,
  timelineRailDarkDeltaL: +0.183,
  timelineRailLightDeltaL: -0.072,
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
 * `pickReadableBorder` parks borders at 3:1, and `pickReadableMuted`
 * walks captions down to exactly 3:1 so they recede without vanishing.
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
  const shift = (deltaL: number) => shiftPerceptualL(canvas, deltaL);
  const fg = (bg: string, target?: number) =>
    pickReadableForeground(bg, { ink, canvas, target });
  const muted = (bg: string) => pickReadableMuted(bg, ink, { target: 3 });
  // Pomodoro idle overlay paints a full-screen black surface; tokens over
  // it pair against pure black rather than against canvas.
  const idleBg = "#000000";
  const card = shift(d.cardDeltaL);
  const popover = shift(d.popoverDeltaL);
  const secondary = shift(d.secondaryDeltaL);
  const mutedBg = shift(d.mutedDeltaL);
  const accent = shift(d.accentDeltaL);
  const sidebar = shift(d.sidebarDeltaL);
  const sidebarAccent = shift(d.sidebarAccentDeltaL);
  const eventPanelBg = shift(d.eventPanelBgDeltaL);
  const eventPanelContrast = shift(d.eventPanelContrastDeltaL);
  return {
    "--background": canvas,
    "--foreground": fg(canvas),
    "--card": card,
    "--card-foreground": fg(card),
    "--popover": popover,
    "--popover-foreground": fg(popover),
    "--primary": primary,
    "--primary-foreground": fg(primary, 4.5),
    "--secondary": secondary,
    "--secondary-foreground": fg(secondary),
    "--muted": mutedBg,
    "--muted-foreground": muted(mutedBg),
    "--accent": accent,
    "--accent-foreground": fg(accent),
    "--destructive": destructive,
    "--destructive-foreground": fg(destructive),
    "--ring": pickReadableBorder(canvas, ink, { target: 3 }),
    "--sidebar": sidebar,
    "--sidebar-foreground": fg(sidebar),
    "--sidebar-accent": sidebarAccent,
    "--sidebar-accent-foreground": fg(sidebarAccent),
    "--action-confirm": confirm,
    "--action-confirm-foreground": fg(confirm),
    "--action-danger-armed": destructive,
    "--action-danger-armed-foreground": fg(destructive),
    "--status-accepted": confirm,
    "--status-accepted-foreground": fg(confirm),
    "--status-tentative": warning,
    "--status-tentative-foreground": fg(warning),
    "--status-declined": destructive,
    "--status-declined-foreground": fg(destructive),
    "--form-indicator": muted(canvas),
    "--pomodoro-idle-text": muted(idleBg),
    "--pomodoro-idle-timer": fg(idleBg, 4.5),
    "--event-panel-bg": eventPanelBg,
    "--event-panel-contrast": eventPanelContrast,
    "--event-panel-divider": pickReadableBorder(eventPanelBg, ink, {
      target: 3,
    }),
    "--event-panel-text": fg(eventPanelBg),
    "--event-panel-input-text": fg(eventPanelBg),
    "--event-panel-placeholder": muted(eventPanelBg),
    "--event-panel-muted-text": muted(eventPanelBg),
    "--cal-drag-preview-border": pickReadableBorder(canvas, ink, { target: 3 }),
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
  const todayCircle = ink;
  return {
    "--cal-bg": calCanvas,
    "--cal-header-bg": canvas,
    "--cal-gridline": pickReadableBorder(calCanvas, ink, { target: 1.4 }),
    "--cal-time-label": pickReadableMuted(canvas, ink, { target: 3 }),
    "--cal-timeline-rail": shiftPerceptualL(calCanvas, timelineRailDelta),
    "--cal-today-circle": todayCircle,
    "--cal-today-circle-text": pickReadableForeground(todayCircle, {
      ink,
      canvas,
      target: 4.5,
    }),
    "--cal-timeline-break": pickReadableBorder(calCanvas, ink, { target: 3 }),
  };
}

/**
 * Resolve every app-shell token for a theme using the three-layer lookup:
 *
 * 1. Explicit override in `theme.appTokenOverrides` wins.
 * 2. Else, if the theme carries `sources`, the derivation engine's value
 *    for this token (when defined) is used.
 * 3. Else, the CSS base default for the theme's `base` is used.
 *
 * Used at clone time so the duplicate is self-contained, and by the
 * token-apply pipeline so `root.style.setProperty` pushes both pinned
 * overrides AND derived values to the DOM (otherwise derived values
 * would stay at their base CSS defaults instead of tracking sources).
 */
export function resolveAppTokens(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  const derived = theme.sources
    ? deriveAppTokens(theme.sources, theme.base)
    : undefined;
  for (const key of APP_TOKEN_KEYS) {
    out[key] =
      theme.appTokenOverrides?.[key] ??
      derived?.[key] ??
      BASE_APP_TOKENS[theme.base][key];
  }
  return out;
}

/**
 * Calendar-shell counterpart to {@link resolveAppTokens}. The derivation
 * engine only returns entries for derivable tokens (cal-bg, cal-header-bg,
 * cal-gridline, cal-time-label, cal-timeline-rail); semantic tokens
 * (today marker, current time, timeline break / focus) fall through to
 * the base CSS defaults automatically.
 */
export function resolveCalendarTokens(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  const derived = theme.sources
    ? deriveCalendarTokens(theme.sources, theme.base)
    : undefined;
  for (const key of CALENDAR_TOKEN_KEYS) {
    out[key] =
      theme.calendarTokenOverrides?.[key] ??
      derived?.[key] ??
      BASE_CALENDAR_TOKENS[theme.base][key];
  }
  return out;
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
 * Resolve the effective app background a theme will actually paint. Walks
 * the same three-layer lookup the token pipeline uses (explicit override →
 * source-derived → base default) so luminance-driven branches see the same
 * canvas the user sees.
 */
export function resolveCanvas(theme: Theme): string {
  return (
    theme.appTokenOverrides?.["--background"] ??
    theme.sources?.canvas ??
    BASE_APP_TOKENS[theme.base]["--background"]
  );
}

/**
 * Resolve the effective calendar background. Used to pick the event-tile
 * palette and calendar-specific outline mixes based on the actual surface
 * rather than the theme's cosmetic `base` label. Walks the same three
 * layers the token pipeline uses: explicit override first, then the
 * source-derived value (direction-aware shift of the app canvas), then
 * the base CSS default.
 */
export function resolveCalCanvas(theme: Theme): string {
  const override = theme.calendarTokenOverrides?.["--cal-bg"];
  if (override) return override;
  if (theme.sources) {
    return deriveCalendarTokens(theme.sources, theme.base)["--cal-bg"];
  }
  return BASE_CALENDAR_TOKENS[theme.base]["--cal-bg"];
}

/** True when the resolved app canvas crosses into dark-mode territory. */
export function isThemeDark(theme: Theme): boolean {
  return relativeLuminance(resolveCanvas(theme)) < DARK_SURFACE_THRESHOLD;
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
 */
export function serializeTheme(theme: Theme): string {
  const ordered: Record<string, unknown> = {
    id: theme.id,
    displayName: theme.displayName,
    base: theme.base,
    blendCanvas: theme.blendCanvas,
    eventPalette: orderedPalette(theme.eventPalette),
  };
  if (theme.sources) {
    ordered.sources = orderedSources(theme.sources);
  }
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

  const cleanSources = sanitizeSources(input.sources, errors, "sources", cleanBase);

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
  const cleanSeedApp = sanitizeOverrides(
    input.seedAppTokens,
    APP_TOKEN_KEY_SET,
    "seedAppTokens",
    errors,
  );
  const cleanSeedCal = sanitizeOverrides(
    input.seedCalendarTokens,
    CALENDAR_TOKEN_KEY_SET,
    "seedCalendarTokens",
    errors,
  );
  const cleanSeedPalette = sanitizeSeedPalette(
    input.seedEventPalette,
    errors,
  );
  const cleanSeedSources = sanitizeSources(
    input.seedSources,
    errors,
    "seedSources",
    cleanBase,
  );
  const cleanSeedAppOverrides = sanitizeOverrides(
    input.seedAppTokenOverrides,
    APP_TOKEN_KEY_SET,
    "seedAppTokenOverrides",
    errors,
  );
  const cleanSeedCalOverrides = sanitizeOverrides(
    input.seedCalendarTokenOverrides,
    CALENDAR_TOKEN_KEY_SET,
    "seedCalendarTokenOverrides",
    errors,
  );
  let cleanSeedBlend: string | undefined;
  if (input.seedBlendCanvas !== undefined) {
    if (!isHexColor(input.seedBlendCanvas)) {
      errors.push("seedBlendCanvas must be a hex color (#RRGGBB or #RRGGBBAA)");
    } else {
      cleanSeedBlend = input.seedBlendCanvas;
    }
  }

  // Migrate legacy themes that stored calCanvas as a 7th source. In the
  // current model calendar-bg auto-tracks canvas; a user who had explicitly
  // picked a calCanvas before this change meant "keep the calendar surface
  // independent of canvas", which maps cleanly to an override on --cal-bg.
  // Only migrate when no override already exists so we don't clobber a
  // pinned value the user set more recently. Applied to seedSources too so
  // per-row reset still restores the clone-time value.
  const legacyCalCanvas = extractLegacyCalCanvas(input.sources);
  let migratedCalOverrides = cleanCalOverrides;
  if (legacyCalCanvas && !migratedCalOverrides?.["--cal-bg"]) {
    migratedCalOverrides = { ...(migratedCalOverrides ?? {}), "--cal-bg": legacyCalCanvas };
  }
  const legacySeedCalCanvas = extractLegacyCalCanvas(input.seedSources);
  let migratedSeedCalOverrides = cleanSeedCalOverrides;
  if (legacySeedCalCanvas && !migratedSeedCalOverrides?.["--cal-bg"]) {
    migratedSeedCalOverrides = {
      ...(migratedSeedCalOverrides ?? {}),
      "--cal-bg": legacySeedCalCanvas,
    };
  }

  if (errors.length > 0) return { ok: false, errors };

  const theme: Theme = {
    id: cleanId,
    displayName: cleanDisplayName,
    base: cleanBase,
    blendCanvas: cleanBlend,
    eventPalette: cleanPalette,
  };
  if (cleanSources) theme.sources = cleanSources;
  if (cleanAppOverrides && Object.keys(cleanAppOverrides).length > 0) {
    theme.appTokenOverrides = cleanAppOverrides;
  }
  if (migratedCalOverrides && Object.keys(migratedCalOverrides).length > 0) {
    theme.calendarTokenOverrides = migratedCalOverrides;
  }
  if (cleanSeedApp && Object.keys(cleanSeedApp).length > 0) {
    theme.seedAppTokens = cleanSeedApp;
  }
  if (cleanSeedCal && Object.keys(cleanSeedCal).length > 0) {
    theme.seedCalendarTokens = cleanSeedCal;
  }
  if (cleanSeedPalette) {
    theme.seedEventPalette = cleanSeedPalette;
  }
  if (cleanSeedSources) theme.seedSources = cleanSeedSources;
  if (cleanSeedAppOverrides && Object.keys(cleanSeedAppOverrides).length > 0) {
    theme.seedAppTokenOverrides = cleanSeedAppOverrides;
  }
  if (migratedSeedCalOverrides && Object.keys(migratedSeedCalOverrides).length > 0) {
    theme.seedCalendarTokenOverrides = migratedSeedCalOverrides;
  }
  if (cleanSeedBlend) theme.seedBlendCanvas = cleanSeedBlend;
  return { ok: true, theme };
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

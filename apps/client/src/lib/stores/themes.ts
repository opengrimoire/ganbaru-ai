import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  blendHex,
  pickReadableBorder,
  pickReadableForeground,
  pickReadableMuted,
} from "$lib/components/ui/colorMath";

/**
 * Stable ID identifying a theme. Built-in IDs are "light" and "dark".
 * Custom themes added later should use slugs or UUIDs to avoid collisions.
 */
export type ThemeId = string;

/**
 * Seven source colors that drive most of the shell palette through the
 * derivation formulas in {@link deriveAppTokens} / {@link deriveCalendarTokens}.
 *
 * - **canvas:** app background. The color visible in framing gaps and the
 *   Settings modal; also the reference the other app surfaces lift toward
 *   ink from.
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
 * - **calCanvas:** calendar grid background; intentionally distinct from
 *   canvas so the calendar reads as a different surface from the rest of
 *   the app (both built-ins keep them apart).
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
  calCanvas: string;
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
 * Blend `c` toward `ink` by fraction `t`. A weight of 0 returns `c`
 * unchanged; 1 returns `ink`. Used to "lift" a base surface toward its
 * text color (slightly tinted grays), which is how the built-in secondary,
 * muted, accent, and ring surfaces relate to their canvas.
 */
function liftTowardInk(c: string, ink: string, t: number): string {
  return blendHex(c, ink, 1 - t);
}

/**
 * Blend `c` toward pure black by fraction `t`. Used for the title bar
 * surface in light mode, which is a shade darker than canvas without
 * picking up any ink hue.
 */
function recessTowardBlack(c: string, t: number): string {
  return blendHex(c, "#000000", 1 - t);
}

/**
 * App-shell derivation weights for surface backgrounds only. Foregrounds,
 * borders, and muted captions are now computed from contrast math (see
 * `deriveAppTokens`) rather than empirical lifts. These weights preserve
 * the tinted-gray aesthetic of the built-in palettes for card/popover/
 * secondary/muted/accent/sidebar while contrast-aware pickers handle
 * every token that needs to stay legible against its paired surface.
 */
const APP_DERIVATION_LIGHT = {
  secondaryLift: 0.08,
  mutedLift: 0.08,
  accentLift: 0.05,
  // Light sidebar is slightly inked toward foreground (a soft tinted gray),
  // not recessed toward black: fitting against built-in #DCDCE2 / #CFCFD6
  // showed lift(canvas, ink, 0.10 / 0.16) tracks within ~2 channels whereas
  // recess(canvas, 0.11 / 0.17) diverges on the blue channel.
  sidebarLift: 0.1,
  sidebarAccentLift: 0.16,
} as const;

const APP_DERIVATION_DARK = {
  cardLift: 0.035,
  popoverLift: 0.071,
  secondaryLift: 0.061,
  mutedLift: 0.061,
  accentLift: 0.101,
  sidebarRecess: 0.23,
  sidebarAccentLift: 0.101,
} as const;

const CAL_DERIVATION_LIGHT = {
  timelineRailLift: 0.09,
} as const;

const CAL_DERIVATION_DARK = {
  timelineRailLift: 0.15,
} as const;

/**
 * Derive every app-shell token from a source palette for the given base.
 *
 * Surface backgrounds (card, popover, secondary, muted, accent, sidebar)
 * still use empirical ink lifts so the tinted-gray aesthetic is preserved.
 * Every foreground, border, and muted caption is recomputed from contrast
 * math so the pairing stays legible regardless of which sources the user
 * picks: `pickReadableForeground` guarantees AA 4.5:1 on body text,
 * `pickReadableBorder` parks borders at 3:1, and `pickReadableMuted` walks
 * captions down to exactly 3:1 so they recede without vanishing.
 *
 * Built-in themes carry no `sources` field and never reach this function
 * at resolve time; it is called only for user themes that have opted into
 * the source-driven workflow.
 */
export function deriveAppTokens(
  sources: ThemeSources,
  base: "light" | "dark",
): Record<string, string> {
  const { canvas, ink, primary, destructive, confirm, warning } = sources;
  const lift = (t: number) => liftTowardInk(canvas, ink, t);
  const recess = (t: number) => recessTowardBlack(canvas, t);
  const fg = (bg: string, target?: number) =>
    pickReadableForeground(bg, { ink, canvas, target });
  const muted = (bg: string) => pickReadableMuted(bg, ink, { target: 3 });
  const eventPanelBg = BASE_APP_TOKENS[base]["--event-panel-bg"];
  // Pomodoro idle overlay paints a full-screen black surface; tokens over
  // it pair against pure black rather than against canvas.
  const idleBg = "#000000";
  if (base === "light") {
    const w = APP_DERIVATION_LIGHT;
    const card = "#FFFFFF";
    const popover = "#FFFFFF";
    const secondary = lift(w.secondaryLift);
    const mutedBg = lift(w.mutedLift);
    const accent = lift(w.accentLift);
    const sidebar = lift(w.sidebarLift);
    const sidebarAccent = lift(w.sidebarAccentLift);
    return {
      "--background": canvas,
      "--foreground": ink,
      "--card": card,
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
      // Semantic signals: background identity, foreground contrast-picked.
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
      // Ink-derived typography beyond --foreground.
      "--form-indicator": muted(canvas),
      "--pomodoro-idle-text": muted(idleBg),
      "--pomodoro-idle-timer": fg(idleBg, 4.5),
      "--event-panel-text": fg(eventPanelBg),
      "--event-panel-input-text": fg(eventPanelBg),
      "--event-panel-placeholder": muted(eventPanelBg),
      "--event-panel-muted-text": muted(eventPanelBg),
    };
  }
  const w = APP_DERIVATION_DARK;
  const card = lift(w.cardLift);
  const popover = lift(w.popoverLift);
  const secondary = lift(w.secondaryLift);
  const mutedBg = lift(w.mutedLift);
  const accent = lift(w.accentLift);
  const sidebar = recess(w.sidebarRecess);
  const sidebarAccent = lift(w.sidebarAccentLift);
  return {
    "--background": canvas,
    "--foreground": ink,
    "--card": card,
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
    "--event-panel-text": fg(eventPanelBg),
    "--event-panel-input-text": fg(eventPanelBg),
    "--event-panel-placeholder": muted(eventPanelBg),
    "--event-panel-muted-text": muted(eventPanelBg),
  };
}

/**
 * Derive the calendar-shell tokens that can be computed from sources.
 *
 * Only returns entries for the derivable tokens (bg, header bg, gridline,
 * time label, timeline rail). The semantic tokens (today circle, current
 * time, timeline break, timeline focus) are intentionally omitted: those
 * colors carry meaning (today marker, red for "now", green for focus)
 * that does not reduce to the source palette, so the resolver falls
 * through to the base CSS defaults for them.
 */
export function deriveCalendarTokens(
  sources: ThemeSources,
  base: "light" | "dark",
): Record<string, string> {
  const { canvas, ink, calCanvas } = sources;
  const w = base === "light" ? CAL_DERIVATION_LIGHT : CAL_DERIVATION_DARK;
  return {
    "--cal-bg": calCanvas,
    "--cal-header-bg": canvas,
    "--cal-gridline": pickReadableBorder(calCanvas, ink, { target: 3 }),
    "--cal-time-label": pickReadableMuted(canvas, ink, { target: 3 }),
    "--cal-timeline-rail": liftTowardInk(canvas, ink, w.timelineRailLift),
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
  "calCanvas",
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
  if (cleanCalOverrides && Object.keys(cleanCalOverrides).length > 0) {
    theme.calendarTokenOverrides = cleanCalOverrides;
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
  if (cleanSeedCalOverrides && Object.keys(cleanSeedCalOverrides).length > 0) {
    theme.seedCalendarTokenOverrides = cleanSeedCalOverrides;
  }
  if (cleanSeedBlend) theme.seedBlendCanvas = cleanSeedBlend;
  return { ok: true, theme };
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
    case "calCanvas":
      return BASE_CALENDAR_TOKENS[base]["--cal-bg"];
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

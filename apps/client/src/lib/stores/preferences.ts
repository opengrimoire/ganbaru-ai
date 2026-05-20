/**
 * Pure types and helpers for app-wide user preferences that live outside
 * the theme system (font family, font scale, density). Themes may ship a
 * recommended pair of these, but the active values stay user-controlled.
 *
 * See `docs/features/themes.md`, section "Typography and density".
 */

export type FontFamilyId = string;

export interface FontFamilyOption {
  /** Stable identifier stored in user preferences. */
  id: FontFamilyId;
  /** Label shown in the settings picker. */
  displayName: string;
  /** CSS font-family stack applied on the root. */
  cssStack: string;
}

/**
 * Curated list of font family options. No remote fetching and no font file
 * loading: every option resolves through CSS system/installed-font fallbacks.
 * To add an option, append a new entry here. Unknown or removed IDs fall
 * back to `DEFAULT_FONT_FAMILY_ID`.
 */
export const FONT_FAMILIES: readonly FontFamilyOption[] = Object.freeze([
  {
    id: "inter",
    displayName: "Inter",
    cssStack:
      '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  },
  {
    id: "system",
    displayName: "System default",
    cssStack: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  {
    id: "serif",
    displayName: "Serif",
    cssStack: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  {
    id: "mono",
    displayName: "Monospace",
    cssStack:
      'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
  },
]);

export const DEFAULT_FONT_FAMILY_ID: FontFamilyId = "inter";

/**
 * Lower and upper bounds for the font scale multiplier. Clamped so a bad
 * input (or a theme recommendation out of range) cannot break the layout.
 */
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;
export const DEFAULT_FONT_SCALE = 1.0;
export const FONT_SCALE_STEP = 0.05;
export const FONT_SCALE_LEVELS: readonly number[] = Object.freeze(
  Array.from(
    {
      length: Math.round((FONT_SCALE_MAX - FONT_SCALE_MIN) / FONT_SCALE_STEP) + 1,
    },
    (_, index) => Number((FONT_SCALE_MIN + index * FONT_SCALE_STEP).toFixed(2)),
  ),
);

export const TITLE_BAR_CONTROL_IDS = [
  "pomodoro",
  "music",
  "theme",
  "performance",
  "settings",
  "compactTabs",
] as const;

export type TitleBarControlId = (typeof TITLE_BAR_CONTROL_IDS)[number];
export type TitleBarVisibility = Record<TitleBarControlId, boolean>;

export const DEFAULT_TITLE_BAR_VISIBILITY: TitleBarVisibility = Object.freeze({
  pomodoro: true,
  music: true,
  theme: true,
  performance: true,
  settings: true,
  compactTabs: false,
});

/**
 * Clamp an arbitrary number into the supported font-scale range. Non-finite
 * inputs fall back to the default scale.
 */
export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SCALE;
  if (value < FONT_SCALE_MIN) return FONT_SCALE_MIN;
  if (value > FONT_SCALE_MAX) return FONT_SCALE_MAX;
  return value;
}

/**
 * Look up a font family option by its ID. Returns undefined for unknown
 * IDs or non-string inputs.
 */
export function getFontFamilyById(
  id: FontFamilyId | undefined | null,
): FontFamilyOption | undefined {
  if (!id || typeof id !== "string") return undefined;
  return FONT_FAMILIES.find((f) => f.id === id);
}

/**
 * Resolve a stored font family ID to a CSS font-family stack. Unknown IDs
 * resolve to the default option's stack so a removed or typo'd setting
 * cannot render the app unstyled.
 */
export function resolveFontFamilyStack(id: FontFamilyId | undefined | null): string {
  const option = getFontFamilyById(id) ?? getFontFamilyById(DEFAULT_FONT_FAMILY_ID);
  // DEFAULT_FONT_FAMILY_ID is guaranteed to be in FONT_FAMILIES, so option is
  // never undefined; the non-null assertion is a type-system formality.
  return option!.cssStack;
}

export function isTitleBarControlId(value: unknown): value is TitleBarControlId {
  return typeof value === "string"
    && TITLE_BAR_CONTROL_IDS.includes(value as TitleBarControlId);
}

/**
 * Normalize persisted title bar visibility. Unknown keys are ignored and
 * missing values stay visible, so old configs survive new controls.
 */
export function parseTitleBarVisibility(value: unknown): TitleBarVisibility {
  const visibility: TitleBarVisibility = { ...DEFAULT_TITLE_BAR_VISIBILITY };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return visibility;
  }
  const record = value as Record<string, unknown>;
  for (const id of TITLE_BAR_CONTROL_IDS) {
    if (typeof record[id] === "boolean") {
      visibility[id] = record[id];
    }
  }
  return visibility;
}

export function shouldNormalizeTitleBarVisibility(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;

  const validIds = new Set<string>(TITLE_BAR_CONTROL_IDS);
  const record = value as Record<string, unknown>;
  for (const [key, stored] of Object.entries(record)) {
    if (!validIds.has(key) || typeof stored !== "boolean") return true;
  }
  return false;
}

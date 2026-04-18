import {
  type FontFamilyId,
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SCALE,
  clampFontScale,
  getFontFamilyById,
  resolveFontFamilyStack,
} from "./preferences";

const FONT_FAMILY_STORAGE_KEY = "ganbaruai-font-family";
const FONT_SCALE_STORAGE_KEY = "ganbaruai-font-scale";

function loadSavedFontFamilyId(): FontFamilyId {
  if (typeof localStorage === "undefined") return DEFAULT_FONT_FAMILY_ID;
  const saved = localStorage.getItem(FONT_FAMILY_STORAGE_KEY);
  if (saved && getFontFamilyById(saved)) return saved;
  return DEFAULT_FONT_FAMILY_ID;
}

function loadSavedFontScale(): number {
  if (typeof localStorage === "undefined") return DEFAULT_FONT_SCALE;
  const saved = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
  if (!saved) return DEFAULT_FONT_SCALE;
  const parsed = parseFloat(saved);
  if (Number.isNaN(parsed)) return DEFAULT_FONT_SCALE;
  return clampFontScale(parsed);
}

let fontFamilyId = $state<FontFamilyId>(loadSavedFontFamilyId());
let fontScale = $state<number>(loadSavedFontScale());

function applyPreferencesToDom(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--font-family", resolveFontFamilyStack(fontFamilyId));
  root.style.setProperty("--font-scale", String(fontScale));
}

// Apply initial preferences on module load so first paint matches stored
// values. The CSS fallbacks keep the app readable if this runs late.
if (typeof document !== "undefined") {
  applyPreferencesToDom();
}

function setFontFamily(id: FontFamilyId): void {
  if (!getFontFamilyById(id)) return;
  fontFamilyId = id;
  applyPreferencesToDom();
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(FONT_FAMILY_STORAGE_KEY, id);
  }
}

function setFontScale(value: number): void {
  const clamped = clampFontScale(value);
  fontScale = clamped;
  applyPreferencesToDom();
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(clamped));
  }
}

/**
 * Access app-wide user preferences (font family, font scale). Returns
 * getters so Svelte's reactivity picks up changes in consuming components.
 */
export function getPreferences() {
  return {
    get fontFamilyId(): FontFamilyId {
      return fontFamilyId;
    },
    get fontScale(): number {
      return fontScale;
    },
    /** List of curated font family options for building a picker. */
    get fontFamilies(): readonly (typeof FONT_FAMILIES)[number][] {
      return FONT_FAMILIES;
    },
    setFontFamily,
    setFontScale,
    resetFontScale() {
      setFontScale(DEFAULT_FONT_SCALE);
    },
  };
}

import {
  type FontFamilyId,
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SCALE,
  clampFontScale,
  getFontFamilyById,
  resolveFontFamilyStack,
} from "./preferences";
import { getConfigKey, setConfigKey } from "../vault/config";

const FONT_FAMILY_CONFIG_KEY = "preferences.fontFamilyId";
const FONT_SCALE_CONFIG_KEY = "preferences.fontScale";
const EVENT_TZ_DISPLAY_KEY = "preferences.eventTimezoneDisplay";

export type EventTimezoneDisplay = "device" | "homeZone";
const DEFAULT_EVENT_TZ_DISPLAY: EventTimezoneDisplay = "device";

function loadSavedFontFamilyId(): FontFamilyId {
  const saved = getConfigKey<string | undefined>(FONT_FAMILY_CONFIG_KEY, undefined);
  if (saved && getFontFamilyById(saved)) return saved;
  return DEFAULT_FONT_FAMILY_ID;
}

function loadSavedFontScale(): number {
  const saved = getConfigKey<number | undefined>(FONT_SCALE_CONFIG_KEY, undefined);
  if (typeof saved !== "number" || !Number.isFinite(saved)) return DEFAULT_FONT_SCALE;
  return clampFontScale(saved);
}

function loadSavedEventTzDisplay(): EventTimezoneDisplay {
  const saved = getConfigKey<string | undefined>(EVENT_TZ_DISPLAY_KEY, undefined);
  if (saved === "device" || saved === "homeZone") return saved;
  return DEFAULT_EVENT_TZ_DISPLAY;
}

let fontFamilyId = $state<FontFamilyId>(loadSavedFontFamilyId());
let fontScale = $state<number>(loadSavedFontScale());
let eventTimezoneDisplay = $state<EventTimezoneDisplay>(loadSavedEventTzDisplay());

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
  setConfigKey(FONT_FAMILY_CONFIG_KEY, id);
}

function setFontScale(value: number): void {
  const clamped = clampFontScale(value);
  fontScale = clamped;
  applyPreferencesToDom();
  setConfigKey(FONT_SCALE_CONFIG_KEY, clamped);
}

function setEventTimezoneDisplay(value: EventTimezoneDisplay): void {
  eventTimezoneDisplay = value;
  setConfigKey(EVENT_TZ_DISPLAY_KEY, value);
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
    get eventTimezoneDisplay(): EventTimezoneDisplay {
      return eventTimezoneDisplay;
    },
    setFontFamily,
    setFontScale,
    setEventTimezoneDisplay,
    resetFontFamily() {
      setFontFamily(DEFAULT_FONT_FAMILY_ID);
    },
    resetFontScale() {
      setFontScale(DEFAULT_FONT_SCALE);
    },
    resetEventTimezoneDisplay() {
      setEventTimezoneDisplay(DEFAULT_EVENT_TZ_DISPLAY);
    },
  };
}

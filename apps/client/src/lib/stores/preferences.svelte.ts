import {
  type FontFamilyId,
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SCALE,
  DEFAULT_CALENDAR_DIM_PAST_EVENTS,
  DEFAULT_MUSIC_PAUSE_ON_POMODORO_PAUSE,
  DEFAULT_CALENDAR_TIME_FORMAT,
  DEFAULT_TITLE_BAR_VISIBILITY,
  type CalendarTimeFormat,
  type TitleBarControlId,
  type TitleBarVisibility,
  clampFontScale,
  getFontFamilyById,
  isCalendarTimeFormat,
  isTitleBarControlId,
  parseTitleBarVisibility,
  resolveFontFamilyStack,
  shouldNormalizeTitleBarVisibility,
} from "./preferences";
import { getConfigKey, setConfigKey } from "../vault/config";

const FONT_FAMILY_CONFIG_KEY = "preferences.fontFamilyId";
const FONT_SCALE_CONFIG_KEY = "preferences.fontScale";
const EVENT_TZ_DISPLAY_KEY = "preferences.eventTimezoneDisplay";
const CALENDAR_TIME_FORMAT_CONFIG_KEY = "preferences.calendarTimeFormat";
const CALENDAR_DIM_PAST_EVENTS_CONFIG_KEY = "preferences.calendarDimPastEvents";
const MUSIC_PAUSE_ON_POMODORO_PAUSE_CONFIG_KEY = "preferences.musicPauseOnPomodoroPause";
const TITLE_BAR_VISIBILITY_CONFIG_KEY = "preferences.titleBarVisibility";

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

function loadSavedCalendarTimeFormat(): CalendarTimeFormat {
  const saved = getConfigKey<unknown>(CALENDAR_TIME_FORMAT_CONFIG_KEY, undefined);
  if (isCalendarTimeFormat(saved)) return saved;
  return DEFAULT_CALENDAR_TIME_FORMAT;
}

function loadSavedCalendarDimPastEvents(): boolean {
  const saved = getConfigKey<unknown>(CALENDAR_DIM_PAST_EVENTS_CONFIG_KEY, undefined);
  if (typeof saved === "boolean") return saved;
  return DEFAULT_CALENDAR_DIM_PAST_EVENTS;
}

function loadSavedMusicPauseOnPomodoroPause(): boolean {
  const saved = getConfigKey<unknown>(MUSIC_PAUSE_ON_POMODORO_PAUSE_CONFIG_KEY, undefined);
  if (typeof saved === "boolean") return saved;
  return DEFAULT_MUSIC_PAUSE_ON_POMODORO_PAUSE;
}

function loadSavedTitleBarVisibility(): TitleBarVisibility {
  const saved = getConfigKey<unknown>(TITLE_BAR_VISIBILITY_CONFIG_KEY, undefined);
  const parsed = parseTitleBarVisibility(saved);
  if (shouldNormalizeTitleBarVisibility(saved)) {
    setConfigKey(TITLE_BAR_VISIBILITY_CONFIG_KEY, parsed);
  }
  return parsed;
}

let fontFamilyId = $state<FontFamilyId>(loadSavedFontFamilyId());
let fontScale = $state<number>(loadSavedFontScale());
let eventTimezoneDisplay = $state<EventTimezoneDisplay>(loadSavedEventTzDisplay());
let calendarTimeFormat = $state<CalendarTimeFormat>(loadSavedCalendarTimeFormat());
let calendarDimPastEvents = $state<boolean>(loadSavedCalendarDimPastEvents());
let musicPauseOnPomodoroPause = $state<boolean>(loadSavedMusicPauseOnPomodoroPause());
let titleBarVisibility = $state<TitleBarVisibility>(loadSavedTitleBarVisibility());

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

function setCalendarTimeFormat(value: CalendarTimeFormat): void {
  if (!isCalendarTimeFormat(value)) return;
  calendarTimeFormat = value;
  setConfigKey(CALENDAR_TIME_FORMAT_CONFIG_KEY, value);
}

function setCalendarDimPastEvents(value: boolean): void {
  calendarDimPastEvents = value;
  setConfigKey(CALENDAR_DIM_PAST_EVENTS_CONFIG_KEY, value);
}

function setMusicPauseOnPomodoroPause(value: boolean): void {
  musicPauseOnPomodoroPause = value;
  setConfigKey(MUSIC_PAUSE_ON_POMODORO_PAUSE_CONFIG_KEY, value);
}

function setTitleBarControlVisible(id: TitleBarControlId, visible: boolean): void {
  if (!isTitleBarControlId(id)) return;
  titleBarVisibility = { ...titleBarVisibility, [id]: visible };
  setConfigKey(TITLE_BAR_VISIBILITY_CONFIG_KEY, titleBarVisibility);
}

function toggleTitleBarControl(id: TitleBarControlId): void {
  setTitleBarControlVisible(id, !titleBarVisibility[id]);
}

function resetTitleBarVisibility(): void {
  titleBarVisibility = { ...DEFAULT_TITLE_BAR_VISIBILITY };
  setConfigKey(TITLE_BAR_VISIBILITY_CONFIG_KEY, titleBarVisibility);
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
    get calendarTimeFormat(): CalendarTimeFormat {
      return calendarTimeFormat;
    },
    get calendarDimPastEvents(): boolean {
      return calendarDimPastEvents;
    },
    get musicPauseOnPomodoroPause(): boolean {
      return musicPauseOnPomodoroPause;
    },
    get titleBarVisibility(): TitleBarVisibility {
      return titleBarVisibility;
    },
    setFontFamily,
    setFontScale,
    setEventTimezoneDisplay,
    setCalendarTimeFormat,
    setCalendarDimPastEvents,
    setMusicPauseOnPomodoroPause,
    setTitleBarControlVisible,
    toggleTitleBarControl,
    resetFontFamily() {
      setFontFamily(DEFAULT_FONT_FAMILY_ID);
    },
    resetFontScale() {
      setFontScale(DEFAULT_FONT_SCALE);
    },
    resetEventTimezoneDisplay() {
      setEventTimezoneDisplay(DEFAULT_EVENT_TZ_DISPLAY);
    },
    resetCalendarTimeFormat() {
      setCalendarTimeFormat(DEFAULT_CALENDAR_TIME_FORMAT);
    },
    resetCalendarDimPastEvents() {
      setCalendarDimPastEvents(DEFAULT_CALENDAR_DIM_PAST_EVENTS);
    },
    resetMusicPauseOnPomodoroPause() {
      setMusicPauseOnPomodoroPause(DEFAULT_MUSIC_PAUSE_ON_POMODORO_PAUSE);
    },
    resetTitleBarVisibility,
  };
}

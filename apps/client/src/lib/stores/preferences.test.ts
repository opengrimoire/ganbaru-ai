import { describe, it, expect } from "vitest";
import {
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY_ID,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  DEFAULT_FONT_SCALE,
  DEFAULT_CALENDAR_DIM_PAST_EVENTS,
  DEFAULT_MUSIC_PAUSE_ON_POMODORO_PAUSE,
  DEFAULT_CALENDAR_TIME_FORMAT,
  DEFAULT_FOCUS_IDLE_PAUSE_ON_EVENT_CREATE,
  DEFAULT_FOCUS_IDLE_THRESHOLD_MINUTES,
  DEFAULT_FOCUS_BREAK_END_WARNING_SECONDS,
  DEFAULT_FOCUS_BREAK_FINISHED_REPEAT_SECONDS,
  DEFAULT_FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES,
  FOCUS_IDLE_THRESHOLD_MINUTES_MAX,
  FOCUS_IDLE_THRESHOLD_MINUTES_MIN,
  FOCUS_BREAK_SOUND_INTERVAL_SECONDS,
  FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES,
  DEFAULT_TITLE_BAR_VISIBILITY,
  TITLE_BAR_CONTROL_IDS,
  clampFocusIdleThresholdMinutes,
  clampFontScale,
  getFontFamilyById,
  isCalendarTimeFormat,
  isFocusBreakSoundIntervalSeconds,
  isFocusPauseNotificationIntervalMinutes,
  isTitleBarControlId,
  parseFocusBreakSoundIntervalSeconds,
  parseFocusPauseNotificationIntervalMinutes,
  parseTitleBarVisibility,
  resolveFontFamilyStack,
  shouldNormalizeTitleBarVisibility,
} from "./preferences";

describe("FONT_FAMILIES registry", () => {
  it("includes the default font family ID", () => {
    expect(FONT_FAMILIES.some((f) => f.id === DEFAULT_FONT_FAMILY_ID)).toBe(true);
  });

  it("has unique IDs across all options", () => {
    const ids = FONT_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every option carries a non-empty CSS font stack", () => {
    for (const option of FONT_FAMILIES) {
      expect(option.cssStack.length).toBeGreaterThan(0);
    }
  });

  it("every option carries a user-visible display name", () => {
    for (const option of FONT_FAMILIES) {
      expect(option.displayName.length).toBeGreaterThan(0);
    }
  });

  it("is frozen to prevent mutation", () => {
    expect(Object.isFrozen(FONT_FAMILIES)).toBe(true);
  });
});

describe("clampFontScale", () => {
  it("returns the value unchanged when it sits within range", () => {
    expect(clampFontScale(1.0)).toBe(1.0);
    expect(clampFontScale(0.9)).toBe(0.9);
    expect(clampFontScale(1.2)).toBe(1.2);
  });

  it("clamps values below the minimum up to FONT_SCALE_MIN", () => {
    expect(clampFontScale(0.5)).toBe(FONT_SCALE_MIN);
    expect(clampFontScale(-1)).toBe(FONT_SCALE_MIN);
    expect(clampFontScale(0)).toBe(FONT_SCALE_MIN);
  });

  it("clamps values above the maximum down to FONT_SCALE_MAX", () => {
    expect(clampFontScale(2)).toBe(FONT_SCALE_MAX);
    expect(clampFontScale(100)).toBe(FONT_SCALE_MAX);
  });

  it("accepts the exact boundary values", () => {
    expect(clampFontScale(FONT_SCALE_MIN)).toBe(FONT_SCALE_MIN);
    expect(clampFontScale(FONT_SCALE_MAX)).toBe(FONT_SCALE_MAX);
  });

  it("falls back to the default scale for non-finite inputs", () => {
    expect(clampFontScale(Number.NaN)).toBe(DEFAULT_FONT_SCALE);
    expect(clampFontScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FONT_SCALE);
    expect(clampFontScale(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_FONT_SCALE);
  });
});

describe("getFontFamilyById", () => {
  it("returns the option for a registered ID", () => {
    const option = getFontFamilyById(DEFAULT_FONT_FAMILY_ID);
    expect(option?.id).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("returns undefined for unknown IDs", () => {
    expect(getFontFamilyById("does-not-exist")).toBeUndefined();
  });

  it("returns undefined for null, undefined, and empty inputs", () => {
    expect(getFontFamilyById(null)).toBeUndefined();
    expect(getFontFamilyById(undefined)).toBeUndefined();
    expect(getFontFamilyById("")).toBeUndefined();
  });
});

describe("resolveFontFamilyStack", () => {
  it("returns the stack for a known ID", () => {
    const stack = resolveFontFamilyStack(DEFAULT_FONT_FAMILY_ID);
    const defaultOption = FONT_FAMILIES.find(
      (f) => f.id === DEFAULT_FONT_FAMILY_ID,
    );
    expect(stack).toBe(defaultOption!.cssStack);
  });

  it("falls back to the default option's stack for unknown IDs", () => {
    const defaultOption = FONT_FAMILIES.find(
      (f) => f.id === DEFAULT_FONT_FAMILY_ID,
    );
    expect(resolveFontFamilyStack("nope")).toBe(defaultOption!.cssStack);
  });

  it("falls back to the default option's stack for null/undefined", () => {
    const defaultOption = FONT_FAMILIES.find(
      (f) => f.id === DEFAULT_FONT_FAMILY_ID,
    );
    expect(resolveFontFamilyStack(null)).toBe(defaultOption!.cssStack);
    expect(resolveFontFamilyStack(undefined)).toBe(defaultOption!.cssStack);
  });
});

describe("calendar appearance preferences", () => {
  it("defaults to 24-hour time and dimmed past event colors", () => {
    expect(DEFAULT_CALENDAR_TIME_FORMAT).toBe("24h");
    expect(DEFAULT_CALENDAR_DIM_PAST_EVENTS).toBe(true);
  });

  it("accepts supported calendar time formats only", () => {
    expect(isCalendarTimeFormat("24h")).toBe(true);
    expect(isCalendarTimeFormat("12h")).toBe(true);
    expect(isCalendarTimeFormat("24-hour")).toBe(false);
    expect(isCalendarTimeFormat(true)).toBe(false);
    expect(isCalendarTimeFormat(undefined)).toBe(false);
  });
});

describe("music pomodoro preferences", () => {
  it("pauses music on pomodoro pause by default", () => {
    expect(DEFAULT_MUSIC_PAUSE_ON_POMODORO_PAUSE).toBe(true);
  });
});

describe("focus preferences", () => {
  it("defaults idle pause to enabled with a 3 minute threshold", () => {
    expect(DEFAULT_FOCUS_IDLE_PAUSE_ON_EVENT_CREATE).toBe(true);
    expect(DEFAULT_FOCUS_IDLE_THRESHOLD_MINUTES).toBe(3);
  });

  it("uses fixed break screen sound intervals with 10 seconds as the default", () => {
    expect(FOCUS_BREAK_SOUND_INTERVAL_SECONDS).toEqual([0, 10, 15, 30, 60]);
    expect(Object.isFrozen(FOCUS_BREAK_SOUND_INTERVAL_SECONDS)).toBe(true);
    expect(DEFAULT_FOCUS_BREAK_FINISHED_REPEAT_SECONDS).toBe(10);
    expect(DEFAULT_FOCUS_BREAK_END_WARNING_SECONDS).toBe(10);
  });

  it("uses fixed paused focus notification intervals with 3 minutes as the default", () => {
    expect(FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES).toEqual([0, 3, 5, 10, 15]);
    expect(Object.isFrozen(FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES)).toBe(true);
    expect(DEFAULT_FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES).toBe(3);
  });

  it("accepts only supported break screen sound intervals", () => {
    expect(isFocusBreakSoundIntervalSeconds(0)).toBe(true);
    expect(isFocusBreakSoundIntervalSeconds(10)).toBe(true);
    expect(isFocusBreakSoundIntervalSeconds(15)).toBe(true);
    expect(isFocusBreakSoundIntervalSeconds(30)).toBe(true);
    expect(isFocusBreakSoundIntervalSeconds(60)).toBe(true);
    expect(isFocusBreakSoundIntervalSeconds(20)).toBe(false);
    expect(isFocusBreakSoundIntervalSeconds("10")).toBe(false);
    expect(isFocusBreakSoundIntervalSeconds(null)).toBe(false);
  });

  it("accepts only supported paused focus notification intervals", () => {
    expect(isFocusPauseNotificationIntervalMinutes(0)).toBe(true);
    expect(isFocusPauseNotificationIntervalMinutes(3)).toBe(true);
    expect(isFocusPauseNotificationIntervalMinutes(5)).toBe(true);
    expect(isFocusPauseNotificationIntervalMinutes(10)).toBe(true);
    expect(isFocusPauseNotificationIntervalMinutes(15)).toBe(true);
    expect(isFocusPauseNotificationIntervalMinutes(1)).toBe(false);
    expect(isFocusPauseNotificationIntervalMinutes("3")).toBe(false);
    expect(isFocusPauseNotificationIntervalMinutes(null)).toBe(false);
  });

  it("falls back when parsing unsupported break screen sound intervals", () => {
    expect(parseFocusBreakSoundIntervalSeconds(30, 10)).toBe(30);
    expect(parseFocusBreakSoundIntervalSeconds(20, 10)).toBe(10);
    expect(parseFocusBreakSoundIntervalSeconds("10", 10)).toBe(10);
  });

  it("falls back when parsing unsupported paused focus notification intervals", () => {
    expect(parseFocusPauseNotificationIntervalMinutes(5, 3)).toBe(5);
    expect(parseFocusPauseNotificationIntervalMinutes(1, 3)).toBe(3);
    expect(parseFocusPauseNotificationIntervalMinutes("3", 3)).toBe(3);
  });

  it("clamps idle threshold minutes to the supported list", () => {
    expect(clampFocusIdleThresholdMinutes(FOCUS_IDLE_THRESHOLD_MINUTES_MIN)).toBe(
      FOCUS_IDLE_THRESHOLD_MINUTES_MIN,
    );
    expect(clampFocusIdleThresholdMinutes(FOCUS_IDLE_THRESHOLD_MINUTES_MAX)).toBe(
      FOCUS_IDLE_THRESHOLD_MINUTES_MAX,
    );
    expect(clampFocusIdleThresholdMinutes(0)).toBe(FOCUS_IDLE_THRESHOLD_MINUTES_MIN);
    expect(clampFocusIdleThresholdMinutes(16)).toBe(FOCUS_IDLE_THRESHOLD_MINUTES_MAX);
  });

  it("rounds fractional values and falls back for non-finite inputs", () => {
    expect(clampFocusIdleThresholdMinutes(4.4)).toBe(4);
    expect(clampFocusIdleThresholdMinutes(4.5)).toBe(5);
    expect(clampFocusIdleThresholdMinutes(Number.NaN)).toBe(
      DEFAULT_FOCUS_IDLE_THRESHOLD_MINUTES,
    );
  });
});

describe("title bar visibility helpers", () => {
  it("accepts registered title bar control IDs only", () => {
    expect(isTitleBarControlId("pomodoro")).toBe(true);
    expect(isTitleBarControlId("music")).toBe(true);
    expect(isTitleBarControlId("settings")).toBe(true);
    expect(isTitleBarControlId("compactTabs")).toBe(true);
    expect(isTitleBarControlId("reset")).toBe(false);
    expect(isTitleBarControlId("help")).toBe(false);
    expect(isTitleBarControlId("calendarTab")).toBe(false);
    expect(isTitleBarControlId("todoTab")).toBe(false);
    expect(isTitleBarControlId("tabs")).toBe(false);
    expect(isTitleBarControlId("window-controls")).toBe(false);
    expect(isTitleBarControlId(null)).toBe(false);
  });

  it("has a default visibility value for every registered control", () => {
    expect(Object.keys(DEFAULT_TITLE_BAR_VISIBILITY).sort()).toEqual(
      [...TITLE_BAR_CONTROL_IDS].sort(),
    );
    expect(DEFAULT_TITLE_BAR_VISIBILITY.performance).toBe(false);
  });

  it("parses stored booleans and fills missing values with defaults", () => {
    expect(
      parseTitleBarVisibility({
        compactTabs: true,
        music: false,
        performance: true,
      }),
    ).toEqual({
      ...DEFAULT_TITLE_BAR_VISIBILITY,
      compactTabs: true,
      music: false,
      performance: true,
    });
  });

  it("ignores legacy tab hiding values so tabs remain available", () => {
    expect(
      parseTitleBarVisibility({
        tabs: false,
        calendarTab: false,
        todoTab: false,
      }),
    ).toEqual(DEFAULT_TITLE_BAR_VISIBILITY);
  });

  it("ignores unknown keys and non-boolean values", () => {
    expect(
      parseTitleBarVisibility({
        compactTabs: "true",
        reset: true,
        settings: false,
        unknown: false,
      }),
    ).toEqual({
      ...DEFAULT_TITLE_BAR_VISIBILITY,
      settings: false,
    });
  });

  it("normalizes obsolete or malformed stored title bar visibility", () => {
    expect(shouldNormalizeTitleBarVisibility(undefined)).toBe(false);
    expect(shouldNormalizeTitleBarVisibility({
      settings: false,
      compactTabs: true,
    })).toBe(false);
    expect(shouldNormalizeTitleBarVisibility({ help: true })).toBe(true);
    expect(shouldNormalizeTitleBarVisibility({ settings: "false" })).toBe(true);
    expect(shouldNormalizeTitleBarVisibility(null)).toBe(true);
  });

  it("falls back to defaults for malformed stored values", () => {
    expect(parseTitleBarVisibility(null)).toEqual(DEFAULT_TITLE_BAR_VISIBILITY);
    expect(parseTitleBarVisibility([])).toEqual(DEFAULT_TITLE_BAR_VISIBILITY);
    expect(parseTitleBarVisibility("bad")).toEqual(DEFAULT_TITLE_BAR_VISIBILITY);
  });
});

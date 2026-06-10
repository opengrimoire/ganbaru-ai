import type { PomodoroPhase } from "@ganbaru-ai/shared-types";

export type PomodoroBreakPhase = "short_break" | "long_break";
export type PomodoroRhythmKind = "count" | "sequence";
export type PomodoroRhythmSource = "preset" | "custom";
export type PomodoroPresetKey = "auto" | "creative" | "balanced" | "deep" | "extended";

export const MIN_FOCUS_MINUTES = 1;
export const MAX_FOCUS_MINUTES = 120;
export const MIN_SHORT_BREAK_MINUTES = 1;
export const MAX_SHORT_BREAK_MINUTES = 30;
export const MIN_LONG_BREAK_MINUTES = 1;
export const MAX_LONG_BREAK_MINUTES = 60;
export const MIN_RHYTHM_POSITIONS = 1;
export const MAX_RHYTHM_POSITIONS = 12;

export interface CountPomodoroRhythm {
  kind: "count";
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakAfterFocusCount: number;
}

export interface SequencePomodoroRhythmStep {
  focusDurationMinutes: number;
  breakPhase: PomodoroBreakPhase;
  breakDurationMinutes: number;
}

export interface SequencePomodoroRhythm {
  kind: "sequence";
  steps: SequencePomodoroRhythmStep[];
}

export type PomodoroRhythm = CountPomodoroRhythm | SequencePomodoroRhythm;

export interface PomodoroConfig {
  rhythm: PomodoroRhythm;
  rhythmSource: PomodoroRhythmSource;
  presetKey: PomodoroPresetKey | null;
  /** Minutes of idle (no mouse or keyboard) before auto-pausing. null means disabled. */
  idleTimeoutMinutes: number | null;
}

export interface PomodoroBreakInfo {
  phase: PomodoroBreakPhase;
  durationMinutes: number;
}

export interface PlannedRhythmSegment {
  rhythmPosition: number;
  phase: PomodoroPhase;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
}

export interface RhythmState {
  focusOffsetMinutes: number;
  rhythmPosition: number;
}

export interface RhythmPlan {
  segments: PlannedRhythmSegment[];
  trailingState: RhythmState;
}

export const COUNT_PRESET_RHYTHMS: Record<PomodoroPresetKey, CountPomodoroRhythm> = {
  auto: {
    kind: "count",
    focusDurationMinutes: 40,
    shortBreakMinutes: 5,
    longBreakMinutes: 10,
    longBreakAfterFocusCount: 4,
  },
  creative: {
    kind: "count",
    focusDurationMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakAfterFocusCount: 4,
  },
  balanced: {
    kind: "count",
    focusDurationMinutes: 30,
    shortBreakMinutes: 5,
    longBreakMinutes: 10,
    longBreakAfterFocusCount: 4,
  },
  deep: {
    kind: "count",
    focusDurationMinutes: 40,
    shortBreakMinutes: 5,
    longBreakMinutes: 10,
    longBreakAfterFocusCount: 4,
  },
  extended: {
    kind: "count",
    focusDurationMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 10,
    longBreakAfterFocusCount: 4,
  },
};

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  rhythm: { ...COUNT_PRESET_RHYTHMS.auto },
  rhythmSource: "preset",
  presetKey: "auto",
  idleTimeoutMinutes: null,
};

export function createPresetPomodoroConfig(
  presetKey: PomodoroPresetKey,
  idleTimeoutMinutes: number | null = null,
): PomodoroConfig {
  return {
    rhythm: { ...COUNT_PRESET_RHYTHMS[presetKey] },
    rhythmSource: "preset",
    presetKey,
    idleTimeoutMinutes,
  };
}

export function createCustomCountPomodoroConfig(
  rhythm: Omit<CountPomodoroRhythm, "kind">,
  idleTimeoutMinutes: number | null = null,
): PomodoroConfig {
  return {
    rhythm: { kind: "count", ...rhythm },
    rhythmSource: "custom",
    presetKey: null,
    idleTimeoutMinutes,
  };
}

export function createCustomSequencePomodoroConfig(
  steps: SequencePomodoroRhythmStep[],
  idleTimeoutMinutes: number | null = null,
): PomodoroConfig {
  return {
    rhythm: { kind: "sequence", steps: steps.map((step) => ({ ...step })) },
    rhythmSource: "custom",
    presetKey: null,
    idleTimeoutMinutes,
  };
}

export function clonePomodoroConfig(config: PomodoroConfig): PomodoroConfig {
  if (config.rhythm.kind === "count") {
    return {
      rhythm: { ...config.rhythm },
      rhythmSource: config.rhythmSource,
      presetKey: config.presetKey,
      idleTimeoutMinutes: config.idleTimeoutMinutes,
    };
  }
  return {
    rhythm: {
      kind: "sequence",
      steps: config.rhythm.steps.map((step) => ({ ...step })),
    },
    rhythmSource: config.rhythmSource,
    presetKey: config.presetKey,
    idleTimeoutMinutes: config.idleTimeoutMinutes,
  };
}

export function rhythmPositionCount(config: PomodoroConfig): number {
  if (config.rhythm.kind === "count") {
    return Math.max(MIN_RHYTHM_POSITIONS, Math.floor(config.rhythm.longBreakAfterFocusCount));
  }
  return Math.max(MIN_RHYTHM_POSITIONS, config.rhythm.steps.length);
}

export function normalizeRhythmPosition(config: PomodoroConfig, position: number): number {
  const count = rhythmPositionCount(config);
  if (!Number.isFinite(position)) return 1;
  const floored = Math.floor(position);
  if (floored < 1) return 1;
  const zeroBased = ((floored - 1) % count + count) % count;
  return zeroBased + 1;
}

export function nextRhythmPosition(config: PomodoroConfig, position: number): number {
  return normalizeRhythmPosition(config, normalizeRhythmPosition(config, position) + 1);
}

export function focusDurationMinutesAtPosition(
  config: PomodoroConfig,
  position: number,
): number {
  if (config.rhythm.kind === "count") return config.rhythm.focusDurationMinutes;
  const index = normalizeRhythmPosition(config, position) - 1;
  return config.rhythm.steps[index]?.focusDurationMinutes ?? 1;
}

export function breakAfterFocusPosition(
  config: PomodoroConfig,
  position: number,
): PomodoroBreakInfo {
  if (config.rhythm.kind === "count") {
    const normalized = normalizeRhythmPosition(config, position);
    const isLong = normalized === rhythmPositionCount(config);
    return {
      phase: isLong ? "long_break" : "short_break",
      durationMinutes: isLong
        ? config.rhythm.longBreakMinutes
        : config.rhythm.shortBreakMinutes,
    };
  }

  const index = normalizeRhythmPosition(config, position) - 1;
  const step = config.rhythm.steps[index];
  return {
    phase: step?.breakPhase ?? "short_break",
    durationMinutes: step?.breakDurationMinutes ?? 1,
  };
}

export function phaseDurationMinutesAtPosition(
  phase: PomodoroPhase,
  config: PomodoroConfig,
  rhythmPosition: number,
): number {
  if (phase === "focus") {
    return focusDurationMinutesAtPosition(config, rhythmPosition);
  }
  return breakAfterFocusPosition(config, rhythmPosition).durationMinutes;
}

export function configEquals(a: PomodoroConfig, b: PomodoroConfig): boolean {
  if (a.rhythmSource !== b.rhythmSource) return false;
  if (a.presetKey !== b.presetKey) return false;
  if (a.idleTimeoutMinutes !== b.idleTimeoutMinutes) return false;
  if (a.rhythm.kind !== b.rhythm.kind) return false;

  if (a.rhythm.kind === "count" && b.rhythm.kind === "count") {
    return a.rhythm.focusDurationMinutes === b.rhythm.focusDurationMinutes &&
      a.rhythm.shortBreakMinutes === b.rhythm.shortBreakMinutes &&
      a.rhythm.longBreakMinutes === b.rhythm.longBreakMinutes &&
      a.rhythm.longBreakAfterFocusCount === b.rhythm.longBreakAfterFocusCount;
  }

  if (a.rhythm.kind === "sequence" && b.rhythm.kind === "sequence") {
    if (a.rhythm.steps.length !== b.rhythm.steps.length) return false;
    return a.rhythm.steps.every((step, index) => {
      const other = b.rhythm.kind === "sequence" ? b.rhythm.steps[index] : undefined;
      return !!other &&
        step.focusDurationMinutes === other.focusDurationMinutes &&
        step.breakPhase === other.breakPhase &&
        step.breakDurationMinutes === other.breakDurationMinutes;
    });
  }

  return false;
}

export function deriveRhythmPlan(
  config: PomodoroConfig,
  eventDurationMinutes: number,
  initialFocusOffsetMinutes: number = 0,
  initialRhythmPosition: number = 1,
): RhythmPlan {
  if (eventDurationMinutes <= 0) {
    return {
      segments: [],
      trailingState: {
        focusOffsetMinutes: Math.max(0, initialFocusOffsetMinutes),
        rhythmPosition: normalizeRhythmPosition(config, initialRhythmPosition),
      },
    };
  }

  const segments: PlannedRhythmSegment[] = [];
  let offset = 0;
  let position = normalizeRhythmPosition(config, initialRhythmPosition);
  let focusOffset = Math.max(0, initialFocusOffsetMinutes);

  function remainingEventMinutes(): number {
    return Math.max(0, eventDurationMinutes - offset);
  }

  function pushFocus(maxDurationMinutes: number): boolean {
    const duration = Math.min(maxDurationMinutes, remainingEventMinutes());
    if (duration <= 0) return false;
    segments.push({
      rhythmPosition: position,
      phase: "focus",
      startOffsetMinutes: offset,
      endOffsetMinutes: offset + duration,
    });
    offset += duration;
    focusOffset += duration;
    return duration >= maxDurationMinutes;
  }

  function pushBreak(breakInfo: PomodoroBreakInfo): void {
    const duration = Math.min(breakInfo.durationMinutes, remainingEventMinutes());
    if (duration <= 0) return;
    segments.push({
      rhythmPosition: position,
      phase: breakInfo.phase,
      startOffsetMinutes: offset,
      endOffsetMinutes: offset + duration,
    });
    offset += duration;
    focusOffset = 0;
    position = nextRhythmPosition(config, position);
  }

  if (focusOffset > 0) {
    const focusDuration = focusDurationMinutesAtPosition(config, position);
    if (focusOffset < focusDuration) {
      const completedFocus = pushFocus(focusDuration - focusOffset);
      if (!completedFocus || offset >= eventDurationMinutes) {
        return {
          segments,
          trailingState: { focusOffsetMinutes: focusOffset, rhythmPosition: position },
        };
      }
    }

    if (focusOffset >= focusDuration && offset < eventDurationMinutes) {
      pushBreak(breakAfterFocusPosition(config, position));
    }
  }

  while (offset < eventDurationMinutes) {
    focusOffset = 0;
    const focusDuration = focusDurationMinutesAtPosition(config, position);
    const completedFocus = pushFocus(focusDuration);
    if (!completedFocus || offset >= eventDurationMinutes) {
      return {
        segments,
        trailingState: { focusOffsetMinutes: focusOffset, rhythmPosition: position },
      };
    }

    pushBreak(breakAfterFocusPosition(config, position));
  }

  return {
    segments,
    trailingState: { focusOffsetMinutes: focusOffset, rhythmPosition: position },
  };
}

export function deriveInitialPhaseFromInheritedFocus(
  config: PomodoroConfig,
  inheritedFocusMinutes: number,
  inheritedRhythmPosition: number,
): {
  phase: PomodoroPhase;
  rhythmPosition: number;
  remainingSeconds: number;
  inheritedFocusSeconds: number;
} {
  const position = normalizeRhythmPosition(config, inheritedRhythmPosition);
  const inherited = Math.max(0, inheritedFocusMinutes);
  const focusMinutes = focusDurationMinutesAtPosition(config, position);
  if (inherited >= focusMinutes) {
    const breakInfo = breakAfterFocusPosition(config, position);
    return {
      phase: breakInfo.phase,
      rhythmPosition: position,
      remainingSeconds: breakInfo.durationMinutes * 60,
      inheritedFocusSeconds: focusMinutes * 60,
    };
  }

  return {
    phase: "focus",
    rhythmPosition: position,
    remainingSeconds: Math.max(0, focusMinutes - inherited) * 60,
    inheritedFocusSeconds: inherited * 60,
  };
}

export function isValidPomodoroConfig(config: PomodoroConfig): boolean {
  if (config.rhythmSource === "preset") {
    if (!config.presetKey || !(config.presetKey in COUNT_PRESET_RHYTHMS)) return false;
  } else if (config.rhythmSource === "custom") {
    if (config.presetKey !== null) return false;
  } else {
    return false;
  }

  if (
    config.idleTimeoutMinutes !== null &&
    (!Number.isInteger(config.idleTimeoutMinutes) || config.idleTimeoutMinutes < 0)
  ) {
    return false;
  }

  if (config.rhythm.kind === "count") {
    return isBoundedInteger(config.rhythm.focusDurationMinutes, MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES) &&
      isBoundedInteger(config.rhythm.shortBreakMinutes, MIN_SHORT_BREAK_MINUTES, MAX_SHORT_BREAK_MINUTES) &&
      isBoundedInteger(config.rhythm.longBreakMinutes, MIN_LONG_BREAK_MINUTES, MAX_LONG_BREAK_MINUTES) &&
      isBoundedInteger(
        config.rhythm.longBreakAfterFocusCount,
        MIN_RHYTHM_POSITIONS,
        MAX_RHYTHM_POSITIONS,
      );
  }

  return config.rhythm.steps.length >= MIN_RHYTHM_POSITIONS &&
    config.rhythm.steps.length <= MAX_RHYTHM_POSITIONS &&
    config.rhythm.steps.every((step) => {
      const maxBreak = step.breakPhase === "long_break"
        ? MAX_LONG_BREAK_MINUTES
        : MAX_SHORT_BREAK_MINUTES;
      return isBoundedInteger(step.focusDurationMinutes, MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES) &&
        (step.breakPhase === "short_break" || step.breakPhase === "long_break") &&
        isBoundedInteger(step.breakDurationMinutes, 1, maxBreak);
    });
}

function isBoundedInteger(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

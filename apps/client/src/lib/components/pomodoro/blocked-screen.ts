export type PomodoroBlockedScreenState =
  | "idle"
  | "idle_failed"
  | "break_countdown"
  | "break_finished";

export const POMODORO_OVERLAY_BLOCKER_ACTION_EVENT =
  "pomodoro-overlay-blocker-action";

export interface PomodoroBlockedScreenActionHint {
  key: string;
  label: string;
  tone?: "default" | "danger" | "success";
}

export interface PomodoroBlockedScreenCopy {
  title: string | null;
  status: string | null;
  subtitle: string | null;
  tone: "neutral" | "danger";
  primaryHint: PomodoroBlockedScreenActionHint | null;
  secondaryHint: PomodoroBlockedScreenActionHint | null;
}

export interface PomodoroBlockedScreenPalette {
  background: string;
  mainText: string;
  mutedText: string;
  subtleText: string;
}

export type PomodoroOverlayBlockerAction =
  | { kind: "pointer" }
  | {
      kind: "keydown";
      code: string;
      key: string;
      ctrlKey: boolean;
      shiftKey: boolean;
    };

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

export function parsePomodoroOverlayBlockerAction(
  payload: unknown,
): PomodoroOverlayBlockerAction | null {
  if (!isPayloadRecord(payload)) return null;
  if (payload.kind === "pointer") return { kind: "pointer" };
  if (
    payload.kind === "keydown" &&
    typeof payload.code === "string" &&
    typeof payload.key === "string"
  ) {
    return {
      kind: "keydown",
      code: payload.code,
      key: payload.key,
      ctrlKey: optionalBoolean(payload.ctrlKey),
      shiftKey: optionalBoolean(payload.shiftKey),
    };
  }
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function palette(background: string, mainText: string): PomodoroBlockedScreenPalette {
  return {
    background,
    mainText,
    mutedText: hexToRgba(mainText, 0.72),
    subtleText: hexToRgba(mainText, 0.56),
  };
}

const BLOCKED_SCREEN_PALETTES: Record<
  PomodoroBlockedScreenState,
  PomodoroBlockedScreenPalette
> = {
  idle: palette("#A33728", "#F9D573"),
  idle_failed: palette("#A33728", "#F9D573"),
  break_countdown: palette("#035B33", "#FFFFFF"),
  break_finished: palette("#EEBA04", "#0D0502"),
};

export function parsePomodoroBlockedScreenState(
  value: string | null,
): PomodoroBlockedScreenState {
  switch (value) {
    case "idle":
    case "idle_failed":
    case "break_countdown":
    case "break_finished":
      return value;
    default:
      return "break_countdown";
  }
}

export function pomodoroBlockedScreenStateFromOverlayKind(
  overlayKind: string | null,
): PomodoroBlockedScreenState {
  return overlayKind === "idle" ? "idle" : "break_countdown";
}

export function pomodoroBlockedScreenPalette(
  state: PomodoroBlockedScreenState,
): PomodoroBlockedScreenPalette {
  return BLOCKED_SCREEN_PALETTES[state];
}

export function formatBlockedScreenDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function shouldShowBlockedScreenDateTime(state: PomodoroBlockedScreenState): boolean {
  return state !== "break_finished";
}

export function formatBlockedScreenDateTime(
  date: Date,
  locales?: Intl.LocalesArgument,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locales, {
    dateStyle: "full",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export function remainingSecondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

export function elapsedSecondsSince(startMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function delayUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, targetMs - nowMs);
}

export function formatBreakExtensionHint(
  extensionMinutes: number,
  maxExtensionMinutes: number,
): string | null {
  const safeExtensionMinutes = Math.max(0, Math.floor(extensionMinutes));
  const safeMaxExtensionMinutes = Math.max(0, Math.floor(maxExtensionMinutes));
  if (safeExtensionMinutes >= safeMaxExtensionMinutes) return null;
  return "Press Ctrl+Shift+Space to extend the break";
}

export function shouldScheduleIdleAlert(targetMs: number, failureDueAtMs: number): boolean {
  return targetMs < failureDueAtMs;
}

export function nextIntervalTargetAfter(
  currentTargetMs: number,
  intervalMs: number,
  nowMs: number,
): number {
  const safeIntervalMs = Math.max(1, Math.floor(intervalMs));
  let nextTargetMs = currentTargetMs + safeIntervalMs;
  if (nextTargetMs <= nowMs) {
    const missedIntervals = Math.floor((nowMs - nextTargetMs) / safeIntervalMs) + 1;
    nextTargetMs += missedIntervals * safeIntervalMs;
  }
  return nextTargetMs;
}

export function pomodoroBlockedScreenCopy(
  state: PomodoroBlockedScreenState,
): PomodoroBlockedScreenCopy {
  switch (state) {
    case "idle":
      return {
        title: "Focus session paused",
        status: null,
        subtitle: null,
        tone: "neutral",
        primaryHint: { key: "Space", label: "resume focus" },
        secondaryHint: null,
      };
    case "idle_failed":
      return {
        title: "Focus session failed",
        status: null,
        subtitle: null,
        tone: "danger",
        primaryHint: { key: "Space", label: "restart focus" },
        secondaryHint: null,
      };
    case "break_countdown":
      return {
        title: null,
        status: null,
        subtitle: null,
        tone: "neutral",
        primaryHint: { key: "Ctrl+Shift+Space", label: "extend the break" },
        secondaryHint: { key: "3x Esc", label: "skip the break entirely", tone: "danger" },
      };
    case "break_finished":
      return {
        title: "Break complete",
        status: null,
        subtitle: "acknowledge when ready",
        tone: "neutral",
        primaryHint: null,
        secondaryHint: null,
      };
  }
}

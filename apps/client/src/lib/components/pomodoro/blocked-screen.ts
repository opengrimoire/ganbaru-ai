export type PomodoroBlockedScreenState =
  | "idle"
  | "idle_failed"
  | "break_countdown"
  | "break_finished";

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

export function remainingSecondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

export function elapsedSecondsSince(startMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function delayUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, targetMs - nowMs);
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
        status: "idle",
        subtitle: null,
        tone: "neutral",
        primaryHint: { key: "Space", label: "resume focus" },
        secondaryHint: { key: "Esc", label: "stop session", tone: "danger" },
      };
    case "idle_failed":
      return {
        title: "Focus session failed",
        status: "focus lost",
        subtitle: null,
        tone: "danger",
        primaryHint: { key: "Space", label: "restart focus" },
        secondaryHint: { key: "Esc", label: "stop session", tone: "danger" },
      };
    case "break_countdown":
      return {
        title: null,
        status: null,
        subtitle: null,
        tone: "neutral",
        primaryHint: { key: "Ctrl+Shift+Space", label: "extend the break 1 minute" },
        secondaryHint: { key: "3x Esc", label: "skip the break entirely", tone: "danger" },
      };
    case "break_finished":
      return {
        title: "Break complete",
        status: null,
        subtitle: "press any key or click to continue",
        tone: "neutral",
        primaryHint: null,
        secondaryHint: null,
      };
  }
}

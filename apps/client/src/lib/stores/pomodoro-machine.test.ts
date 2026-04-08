import { describe, it, expect } from "vitest";
import {
  configEquals,
  phaseDurationSeconds,
  decideTick,
  decideAdvancePhase,
  decideTransition,
  decideStartFromBlock,
  decideReconfigure,
  decideIdleCheck,
  DEFAULT_CONFIG,
  TIME_MULTIPLIER,
  SUSPEND_THRESHOLD_MS,
  NOTIFICATION_THRESHOLD,
  type TimerSnapshot,
  type PomodoroConfig,
  type TransitionInput,
  type StartFromBlockInput,
  type ReconfigureInput,
  type IdleCheckInput,
} from "./pomodoro-machine";

// --- Helpers ---

const NOW = 1_700_000_000_000;

function makeSnapshot(overrides: Partial<TimerSnapshot> = {}): TimerSnapshot {
  return {
    phase: "focus",
    remainingSeconds: 2400,
    currentCycle: 1,
    totalCycles: 4,
    isRunning: true,
    config: { ...DEFAULT_CONFIG },
    completedPomodoros: 0,
    skipNextBreak: false,
    notificationShown: false,
    phaseEndTime: NOW + 2400_000,
    activeBlockId: "block-1",
    activeBlockEndMs: NOW + 3600_000,
    blockExpired: false,
    lastTickMs: NOW - 1000,
    sessionStartTime: new Date(NOW - 60_000).toISOString(),
    hasOvertimeInterval: false,
    suspendedAway: false,
    idlePaused: false,
    idleTimeoutMs: null,
    ...overrides,
  };
}

// ============================================================
// configEquals
// ============================================================

describe("configEquals", () => {
  it("returns true for identical configs", () => {
    expect(configEquals({ ...DEFAULT_CONFIG }, { ...DEFAULT_CONFIG })).toBe(true);
  });

  it("returns false when focusMinutes differs", () => {
    expect(configEquals(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, focusMinutes: 25 })).toBe(false);
  });

  it("returns false when shortBreakMinutes differs", () => {
    expect(configEquals(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, shortBreakMinutes: 10 })).toBe(false);
  });

  it("returns false when longBreakMinutes differs", () => {
    expect(configEquals(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, longBreakMinutes: 20 })).toBe(false);
  });

  it("returns false when cyclesBeforeLongBreak differs", () => {
    expect(configEquals(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, cyclesBeforeLongBreak: 2 })).toBe(false);
  });
});

// ============================================================
// phaseDurationSeconds
// ============================================================

describe("phaseDurationSeconds", () => {
  const cfg: PomodoroConfig = {
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
  };

  it("returns focusMinutes * 60 for focus", () => {
    expect(phaseDurationSeconds("focus", cfg)).toBe(1500);
  });

  it("returns shortBreakMinutes * 60 for short_break", () => {
    expect(phaseDurationSeconds("short_break", cfg)).toBe(300);
  });

  it("returns longBreakMinutes * 60 for long_break", () => {
    expect(phaseDurationSeconds("long_break", cfg)).toBe(900);
  });
});

// ============================================================
// decideTick
// ============================================================

describe("decideTick", () => {
  describe("suspend detection", () => {
    it("returns suspend_block_active when gap exceeds threshold and block still active", () => {
      const snap = makeSnapshot({ lastTickMs: NOW - 20_000 });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("suspend_block_active");
      if (result.kind === "suspend_block_active") {
        expect(result.awaySeconds).toBe(20);
      }
    });

    it("returns suspend_and_block_expired when gap exceeds threshold and block also expired", () => {
      const snap = makeSnapshot({
        lastTickMs: NOW - 20_000,
        activeBlockEndMs: NOW - 5_000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("suspend_and_block_expired");
    });

    it("does not detect suspend when lastTickMs is null (first tick)", () => {
      const snap = makeSnapshot({ lastTickMs: null });
      const result = decideTick(snap, NOW);
      expect(result.kind).not.toBe("suspend_block_active");
      expect(result.kind).not.toBe("suspend_and_block_expired");
    });

    it("does not detect suspend when gap is exactly at threshold", () => {
      const snap = makeSnapshot({ lastTickMs: NOW - SUSPEND_THRESHOLD_MS });
      const result = decideTick(snap, NOW);
      expect(result.kind).not.toBe("suspend_block_active");
      expect(result.kind).not.toBe("suspend_and_block_expired");
    });

    it("detects suspend when gap is one ms over threshold", () => {
      const snap = makeSnapshot({ lastTickMs: NOW - SUSPEND_THRESHOLD_MS - 1 });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("suspend_block_active");
    });

    it("preserves pre-suspend remaining from phaseEndTime, not remainingSeconds", () => {
      // phaseEndTime says 120s left, but remainingSeconds field says 2400
      const snap = makeSnapshot({
        lastTickMs: NOW - 20_000,
        phaseEndTime: NOW - 20_000 + 120_000, // 120s from lastTickMs
        remainingSeconds: 2400,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("suspend_block_active");
      if (result.kind === "suspend_block_active") {
        expect(result.preSuspendRemainingSeconds).toBe(120);
      }
    });

    it("computes awaySeconds as round((now - lastTickMs) / 1000)", () => {
      const snap = makeSnapshot({ lastTickMs: NOW - 45_500 });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("suspend_block_active");
      if (result.kind === "suspend_block_active") {
        expect(result.awaySeconds).toBe(46); // Math.round(45.5)
      }
    });

    it("defaults remaining to 0 when phaseEndTime is null during suspend", () => {
      const snap = makeSnapshot({
        lastTickMs: NOW - 20_000,
        phaseEndTime: null,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("suspend_block_active");
      if (result.kind === "suspend_block_active") {
        expect(result.preSuspendRemainingSeconds).toBe(0);
      }
    });
  });

  describe("block expiry", () => {
    it("returns block_expired when now equals activeBlockEndMs exactly", () => {
      const snap = makeSnapshot({ activeBlockEndMs: NOW, lastTickMs: NOW - 1000 });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("block_expired");
    });

    it("returns block_expired when now exceeds activeBlockEndMs by 1ms", () => {
      const snap = makeSnapshot({ activeBlockEndMs: NOW - 1, lastTickMs: NOW - 1000 });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("block_expired");
    });

    it("does not return block_expired when now is 1ms before activeBlockEndMs", () => {
      const snap = makeSnapshot({ activeBlockEndMs: NOW + 1, lastTickMs: NOW - 1000 });
      const result = decideTick(snap, NOW);
      expect(result.kind).not.toBe("block_expired");
    });

    it("skips block expiry check when activeBlockEndMs is null", () => {
      const snap = makeSnapshot({ activeBlockEndMs: null, lastTickMs: NOW - 1000 });
      const result = decideTick(snap, NOW);
      expect(result.kind).not.toBe("block_expired");
    });
  });

  describe("countdown", () => {
    it("returns countdown with ceiling-rounded remaining", () => {
      const snap = makeSnapshot({
        phaseEndTime: NOW + 120_500,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("countdown");
      if (result.kind === "countdown") {
        expect(result.remainingSeconds).toBe(121); // ceil(120.5)
      }
    });

    it("returns 1 when phaseEndTime is 1ms ahead", () => {
      const snap = makeSnapshot({
        phaseEndTime: NOW + 1,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      if (result.kind === "countdown" || result.kind === "countdown_with_notification") {
        expect(result.remainingSeconds).toBe(1);
      }
    });

    it("returns 1 when phaseEndTime is 999ms ahead", () => {
      const snap = makeSnapshot({
        phaseEndTime: NOW + 999,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      if (result.kind === "countdown" || result.kind === "countdown_with_notification") {
        expect(result.remainingSeconds).toBe(1);
      }
    });

    it("returns 2 when phaseEndTime is 1001ms ahead", () => {
      const snap = makeSnapshot({
        phaseEndTime: NOW + 1001,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      if (result.kind === "countdown" || result.kind === "countdown_with_notification") {
        expect(result.remainingSeconds).toBe(2);
      }
    });

    it("keeps snapshot remaining when phaseEndTime is null", () => {
      const snap = makeSnapshot({
        phaseEndTime: null,
        remainingSeconds: 500,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("countdown");
      if (result.kind === "countdown") {
        expect(result.remainingSeconds).toBe(500);
      }
    });
  });

  describe("timer at zero", () => {
    it("returns break_finished for short_break at 0", () => {
      const snap = makeSnapshot({
        phase: "short_break",
        phaseEndTime: NOW - 1,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("break_finished");
    });

    it("returns break_finished for long_break at 0", () => {
      const snap = makeSnapshot({
        phase: "long_break",
        phaseEndTime: NOW - 1,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("break_finished");
    });

    it("returns focus_finished for focus at 0", () => {
      const snap = makeSnapshot({
        phase: "focus",
        phaseEndTime: NOW - 1,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("focus_finished");
    });
  });

  describe("notification", () => {
    it("returns countdown_with_notification at exactly 60s when not shown", () => {
      const snap = makeSnapshot({
        phase: "focus",
        phaseEndTime: NOW + NOTIFICATION_THRESHOLD * 1000,
        notificationShown: false,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("countdown_with_notification");
      if (result.kind === "countdown_with_notification") {
        expect(result.remainingSeconds).toBe(NOTIFICATION_THRESHOLD);
      }
    });

    it("returns plain countdown at 60s if already shown", () => {
      const snap = makeSnapshot({
        phase: "focus",
        phaseEndTime: NOW + NOTIFICATION_THRESHOLD * 1000,
        notificationShown: true,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("countdown");
    });

    it("returns plain countdown at 60s during break", () => {
      const snap = makeSnapshot({
        phase: "short_break",
        phaseEndTime: NOW + NOTIFICATION_THRESHOLD * 1000,
        notificationShown: false,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("countdown");
    });

    it("returns plain countdown at 61s and 59s", () => {
      const snap61 = makeSnapshot({
        phase: "focus",
        phaseEndTime: NOW + 61_000,
        notificationShown: false,
        lastTickMs: NOW - 1000,
      });
      expect(decideTick(snap61, NOW).kind).toBe("countdown");

      const snap59 = makeSnapshot({
        phase: "focus",
        phaseEndTime: NOW + 59_000,
        notificationShown: false,
        lastTickMs: NOW - 1000,
      });
      expect(decideTick(snap59, NOW).kind).toBe("countdown");
    });
  });

  describe("priority ordering", () => {
    it("suspend takes priority over block expiry", () => {
      // Both conditions true: gap > threshold AND block expired
      const snap = makeSnapshot({
        lastTickMs: NOW - 20_000,
        activeBlockEndMs: NOW - 1,
      });
      const result = decideTick(snap, NOW);
      // Should be suspend variant, not plain block_expired
      expect(result.kind).toBe("suspend_and_block_expired");
    });

    it("block expiry takes priority over countdown", () => {
      const snap = makeSnapshot({
        activeBlockEndMs: NOW,
        phaseEndTime: NOW + 120_000,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("block_expired");
    });

    it("timer-at-zero takes priority over notification check", () => {
      // phaseEndTime in past, so remaining = 0
      const snap = makeSnapshot({
        phase: "focus",
        phaseEndTime: NOW - 1,
        notificationShown: false,
        lastTickMs: NOW - 1000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("focus_finished");
    });

    it("suspend_and_block_expired takes priority over standalone block_expired", () => {
      const snap = makeSnapshot({
        lastTickMs: NOW - 30_000,
        activeBlockEndMs: NOW - 10_000,
      });
      const result = decideTick(snap, NOW);
      expect(result.kind).toBe("suspend_and_block_expired");
    });
  });
});

// ============================================================
// decideAdvancePhase
// ============================================================

describe("decideAdvancePhase", () => {
  describe("focus phase", () => {
    it("returns skip_break_to_focus when skipNextBreak is true", () => {
      const snap = makeSnapshot({ phase: "focus", skipNextBreak: true });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("skip_break_to_focus");
    });

    it("skip: advances cycle when currentCycle < totalCycles", () => {
      const snap = makeSnapshot({
        phase: "focus",
        skipNextBreak: true,
        currentCycle: 2,
        totalCycles: 4,
      });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("skip_break_to_focus");
      if (result.kind === "skip_break_to_focus") {
        expect(result.nextCycle).toBe(3);
      }
    });

    it("skip: resets cycle to 1 when currentCycle >= totalCycles", () => {
      const snap = makeSnapshot({
        phase: "focus",
        skipNextBreak: true,
        currentCycle: 4,
        totalCycles: 4,
      });
      const result = decideAdvancePhase(snap);
      if (result.kind === "skip_break_to_focus") {
        expect(result.nextCycle).toBe(1);
      }
    });

    it("returns focus_to_long_break when currentCycle equals totalCycles", () => {
      const snap = makeSnapshot({
        phase: "focus",
        currentCycle: 4,
        totalCycles: 4,
      });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("focus_to_long_break");
    });

    it("returns focus_to_long_break when currentCycle exceeds totalCycles", () => {
      const snap = makeSnapshot({
        phase: "focus",
        currentCycle: 5,
        totalCycles: 4,
      });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("focus_to_long_break");
    });

    it("long break sets nextCycle to 1", () => {
      const snap = makeSnapshot({
        phase: "focus",
        currentCycle: 4,
        totalCycles: 4,
      });
      const result = decideAdvancePhase(snap);
      if (result.kind === "focus_to_long_break") {
        expect(result.nextCycle).toBe(1);
      }
    });

    it("long break uses longBreakMinutes for duration", () => {
      const snap = makeSnapshot({
        phase: "focus",
        currentCycle: 4,
        totalCycles: 4,
        config: { ...DEFAULT_CONFIG, longBreakMinutes: 15 },
      });
      const result = decideAdvancePhase(snap);
      if (result.kind === "focus_to_long_break") {
        expect(result.remainingSeconds).toBe(15 * TIME_MULTIPLIER);
      }
    });

    it("returns focus_to_short_break when currentCycle < totalCycles", () => {
      const snap = makeSnapshot({
        phase: "focus",
        currentCycle: 2,
        totalCycles: 4,
      });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("focus_to_short_break");
    });

    it("short break sets nextCycle to currentCycle + 1", () => {
      const snap = makeSnapshot({
        phase: "focus",
        currentCycle: 2,
        totalCycles: 4,
      });
      const result = decideAdvancePhase(snap);
      if (result.kind === "focus_to_short_break") {
        expect(result.nextCycle).toBe(3);
      }
    });

    it("handles totalCycles = 1 (every break is long)", () => {
      const snap = makeSnapshot({
        phase: "focus",
        currentCycle: 1,
        totalCycles: 1,
      });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("focus_to_long_break");
    });
  });

  describe("break phase", () => {
    it("returns break_to_focus for short_break", () => {
      const snap = makeSnapshot({ phase: "short_break" });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("break_to_focus");
    });

    it("returns break_to_focus for long_break", () => {
      const snap = makeSnapshot({ phase: "long_break" });
      const result = decideAdvancePhase(snap);
      expect(result.kind).toBe("break_to_focus");
    });

    it("uses focusMinutes for duration", () => {
      const snap = makeSnapshot({
        phase: "short_break",
        config: { ...DEFAULT_CONFIG, focusMinutes: 25 },
      });
      const result = decideAdvancePhase(snap);
      if (result.kind === "break_to_focus") {
        expect(result.remainingSeconds).toBe(25 * TIME_MULTIPLIER);
      }
    });

    it("returns correct seconds (minutes * 60)", () => {
      const snap = makeSnapshot({ phase: "long_break" });
      const result = decideAdvancePhase(snap);
      if (result.kind === "break_to_focus") {
        expect(result.remainingSeconds).toBe(DEFAULT_CONFIG.focusMinutes * 60);
      }
    });
  });
});

// ============================================================
// decideTransition
// ============================================================

describe("decideTransition", () => {
  const baseInput: TransitionInput = {
    previousConfig: { ...DEFAULT_CONFIG },
    newConfig: { ...DEFAULT_CONFIG },
    phase: "focus",
    remainingSeconds: 1200, // 20 min left of 40 min focus -> 20 min accumulated
    currentCycle: 1,
    totalCycles: 4,
    blockExpired: false,
  };

  describe("trigger break", () => {
    it("triggers when accumulated equals threshold exactly", () => {
      // 40min old, 0 remaining -> 40min accumulated. New threshold 40min -> triggers
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 0,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 40 },
      };
      const result = decideTransition(input);
      expect(result.kind).toBe("trigger_break");
    });

    it("triggers when accumulated exceeds threshold", () => {
      // 40min old, 0 remaining -> 40min accumulated. New threshold 25min -> triggers
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 0,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25 },
      };
      const result = decideTransition(input);
      expect(result.kind).toBe("trigger_break");
    });

    it("returns short_break when currentCycle < newConfig.cyclesBeforeLongBreak", () => {
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 0,
        currentCycle: 1,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25, cyclesBeforeLongBreak: 4 },
      };
      const result = decideTransition(input);
      if (result.kind === "trigger_break") {
        expect(result.breakPhase).toBe("short_break");
      }
    });

    it("returns long_break when currentCycle >= newConfig.cyclesBeforeLongBreak", () => {
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 0,
        currentCycle: 4,
        totalCycles: 4,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25, cyclesBeforeLongBreak: 4 },
      };
      const result = decideTransition(input);
      if (result.kind === "trigger_break") {
        expect(result.breakPhase).toBe("long_break");
      }
    });

    it("long break resets cycle to 1", () => {
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 0,
        currentCycle: 4,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25, cyclesBeforeLongBreak: 4 },
      };
      const result = decideTransition(input);
      if (result.kind === "trigger_break") {
        expect(result.nextCycle).toBe(1);
      }
    });

    it("short break advances cycle", () => {
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 0,
        currentCycle: 2,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25, cyclesBeforeLongBreak: 4 },
      };
      const result = decideTransition(input);
      if (result.kind === "trigger_break") {
        expect(result.nextCycle).toBe(3);
      }
    });

    it("returns correct accumulatedFocusSeconds", () => {
      // 40min old focus, 600s (10min) remaining -> 30min accumulated
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 600,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25 },
      };
      const result = decideTransition(input);
      if (result.kind === "trigger_break") {
        expect(result.accumulatedFocusSeconds).toBe(1800); // 30 * 60
      }
    });
  });

  describe("continue focus", () => {
    it("continues when accumulated is less than threshold", () => {
      // 40min old, 1200s remaining -> 20min accumulated. New threshold 40min -> continues
      const input: TransitionInput = { ...baseInput };
      const result = decideTransition(input);
      expect(result.kind).toBe("continue_focus");
    });

    it("computes correct remaining = newThreshold - accumulated", () => {
      // 40min old, 1200s remaining -> 20min accumulated. New 40min threshold -> 20min remaining
      const input: TransitionInput = { ...baseInput };
      const result = decideTransition(input);
      if (result.kind === "continue_focus") {
        expect(result.remainingSeconds).toBe(1200);
      }
    });

    it("sets resetNotification true when new remaining > NOTIFICATION_THRESHOLD", () => {
      const input: TransitionInput = { ...baseInput }; // 1200s remaining > 60
      const result = decideTransition(input);
      if (result.kind === "continue_focus") {
        expect(result.resetNotification).toBe(true);
      }
    });

    it("sets resetNotification false when remaining <= NOTIFICATION_THRESHOLD", () => {
      // 40min old, 2340s remaining -> 60s accumulated. New 2min threshold -> 60s remaining
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 2340,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 2 },
      };
      const result = decideTransition(input);
      if (result.kind === "continue_focus") {
        expect(result.resetNotification).toBe(false);
      }
    });

    it("transition to larger focus gives more remaining", () => {
      // 40min old, 1200s remaining -> 20min accumulated. New 60min -> 40min remaining
      const input: TransitionInput = {
        ...baseInput,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 60 },
      };
      const result = decideTransition(input);
      if (result.kind === "continue_focus") {
        expect(result.remainingSeconds).toBe(2400); // (60 - 20) * 60
      }
    });

    it("transition to smaller focus gives less remaining", () => {
      // 40min old, 1800s remaining -> 10min accumulated. New 25min -> 15min remaining
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 1800,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25 },
      };
      const result = decideTransition(input);
      if (result.kind === "continue_focus") {
        expect(result.remainingSeconds).toBe(900); // (25 - 10) * 60
      }
    });
  });

  describe("fresh start", () => {
    it("returns fresh_start when blockExpired and phase is short_break", () => {
      const input: TransitionInput = {
        ...baseInput,
        phase: "short_break",
        blockExpired: true,
      };
      const result = decideTransition(input);
      expect(result.kind).toBe("fresh_start");
    });

    it("returns fresh_start when blockExpired and phase is long_break", () => {
      const input: TransitionInput = {
        ...baseInput,
        phase: "long_break",
        blockExpired: true,
      };
      const result = decideTransition(input);
      expect(result.kind).toBe("fresh_start");
    });

    it("uses newConfig.focusMinutes for duration", () => {
      const input: TransitionInput = {
        ...baseInput,
        phase: "short_break",
        blockExpired: true,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25 },
      };
      const result = decideTransition(input);
      if (result.kind === "fresh_start") {
        expect(result.remainingSeconds).toBe(25 * TIME_MULTIPLIER);
      }
    });
  });

  describe("keep break", () => {
    it("returns keep_break for short_break when not expired", () => {
      const input: TransitionInput = {
        ...baseInput,
        phase: "short_break",
        blockExpired: false,
      };
      expect(decideTransition(input).kind).toBe("keep_break");
    });

    it("returns keep_break for long_break when not expired", () => {
      const input: TransitionInput = {
        ...baseInput,
        phase: "long_break",
        blockExpired: false,
      };
      expect(decideTransition(input).kind).toBe("keep_break");
    });
  });

  describe("edge cases", () => {
    it("zero focusMinutes triggers break immediately", () => {
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 2400,
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 0 },
      };
      const result = decideTransition(input);
      // accumulated = 40*60 - 2400 = 0, threshold = 0, 0 >= 0 -> trigger
      expect(result.kind).toBe("trigger_break");
    });

    it("negative remainingSeconds clamps accumulated to >= 0", () => {
      // remainingSeconds > oldFocusDuration: accumulated would be negative, clamped to 0
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 3000, // more than 40*60=2400
        newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25 },
      };
      const result = decideTransition(input);
      // accumulated = max(0, 2400 - 3000) = 0, threshold = 1500 -> continue
      expect(result.kind).toBe("continue_focus");
      if (result.kind === "continue_focus") {
        expect(result.remainingSeconds).toBe(1500);
      }
    });

    it("same focusMinutes on both configs", () => {
      const input: TransitionInput = {
        ...baseInput,
        remainingSeconds: 600,
      };
      const result = decideTransition(input);
      if (result.kind === "continue_focus") {
        expect(result.remainingSeconds).toBe(600);
      }
    });
  });
});

// ============================================================
// decideStartFromBlock
// ============================================================

describe("decideStartFromBlock", () => {
  const baseInput: StartFromBlockInput = {
    currentBlockId: "block-1",
    incomingBlockId: "block-1",
    incomingConfig: { ...DEFAULT_CONFIG },
    currentConfig: { ...DEFAULT_CONFIG },
    currentEndMs: NOW + 3600_000,
    incomingEndMs: NOW + 3600_000,
    hasOvertimeInterval: false,
  };

  describe("same block", () => {
    it("returns noop when incomingEndMs is null", () => {
      const result = decideStartFromBlock({
        ...baseInput,
        incomingEndMs: null,
      });
      expect(result.kind).toBe("noop");
    });

    it("returns noop when neither config nor end changed", () => {
      const result = decideStartFromBlock(baseInput);
      expect(result.kind).toBe("noop");
    });

    it("returns update_end_only when in overtime with end changed", () => {
      const newEnd = NOW + 7200_000;
      const result = decideStartFromBlock({
        ...baseInput,
        hasOvertimeInterval: true,
        incomingEndMs: newEnd,
      });
      expect(result.kind).toBe("update_end_only");
      if (result.kind === "update_end_only") {
        expect(result.newEndMs).toBe(newEnd);
      }
    });

    it("returns update_end_only when in overtime even with config changed", () => {
      const result = decideStartFromBlock({
        ...baseInput,
        hasOvertimeInterval: true,
        incomingConfig: { ...DEFAULT_CONFIG, focusMinutes: 25 },
        incomingEndMs: NOW + 7200_000,
      });
      expect(result.kind).toBe("update_end_only");
    });

    it("returns reconfigure when config changed and not in overtime", () => {
      const newCfg = { ...DEFAULT_CONFIG, focusMinutes: 25 };
      const result = decideStartFromBlock({
        ...baseInput,
        incomingConfig: newCfg,
      });
      expect(result.kind).toBe("reconfigure");
      if (result.kind === "reconfigure") {
        expect(result.newConfig).toEqual(newCfg);
      }
    });

    it("returns rebuild_segments when only end changed and not in overtime", () => {
      const newEnd = NOW + 7200_000;
      const result = decideStartFromBlock({
        ...baseInput,
        incomingEndMs: newEnd,
      });
      expect(result.kind).toBe("rebuild_segments");
      if (result.kind === "rebuild_segments") {
        expect(result.newEndMs).toBe(newEnd);
      }
    });

    it("config equality uses all four fields", () => {
      // Only cyclesBeforeLongBreak differs
      const result = decideStartFromBlock({
        ...baseInput,
        incomingConfig: { ...DEFAULT_CONFIG, cyclesBeforeLongBreak: 2 },
      });
      expect(result.kind).toBe("reconfigure");
    });
  });

  describe("different/new block", () => {
    it("returns transition when currentBlockId is set and end valid", () => {
      const result = decideStartFromBlock({
        ...baseInput,
        incomingBlockId: "block-2",
        incomingEndMs: NOW + 7200_000,
      });
      expect(result.kind).toBe("transition");
    });

    it("returns new_session when currentBlockId is null", () => {
      const result = decideStartFromBlock({
        ...baseInput,
        currentBlockId: null,
        incomingBlockId: "block-2",
      });
      expect(result.kind).toBe("new_session");
    });

    it("returns new_session when different block but incomingEndMs is null", () => {
      const result = decideStartFromBlock({
        ...baseInput,
        incomingBlockId: "block-2",
        incomingEndMs: null,
      });
      expect(result.kind).toBe("new_session");
    });

    it("returns new_session when both currentBlockId and incomingEndMs are null", () => {
      const result = decideStartFromBlock({
        ...baseInput,
        currentBlockId: null,
        incomingBlockId: "block-2",
        incomingEndMs: null,
      });
      expect(result.kind).toBe("new_session");
    });

    it("differentiates transition from new_session based on currentBlockId", () => {
      const withActive = decideStartFromBlock({
        ...baseInput,
        currentBlockId: "block-1",
        incomingBlockId: "block-2",
        incomingEndMs: NOW + 7200_000,
      });
      const withoutActive = decideStartFromBlock({
        ...baseInput,
        currentBlockId: null,
        incomingBlockId: "block-2",
        incomingEndMs: NOW + 7200_000,
      });
      expect(withActive.kind).toBe("transition");
      expect(withoutActive.kind).toBe("new_session");
    });
  });
});

// ============================================================
// decideReconfigure
// ============================================================

describe("decideReconfigure", () => {
  const baseInput: ReconfigureInput = {
    phase: "focus",
    remainingSeconds: 1200, // 20 min left of 40 min = 20 min elapsed
    currentConfig: { ...DEFAULT_CONFIG },
    newConfig: { ...DEFAULT_CONFIG },
    hasOvertimeInterval: false,
  };

  it("computes new remaining from elapsed + new config", () => {
    // 20 min elapsed. New focus = 50 min -> 30 min remaining
    const result = decideReconfigure({
      ...baseInput,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 50 },
    });
    expect(result.newRemainingSeconds).toBe(1800);
  });

  it("clamps elapsed to 0 when remaining exceeds old duration", () => {
    // remaining=3000 > oldDuration=2400 -> elapsed = max(0, 2400-3000) = 0
    // new focus 25min -> 1500 - 0 = 1500
    const result = decideReconfigure({
      ...baseInput,
      remainingSeconds: 3000,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 25 },
    });
    expect(result.newRemainingSeconds).toBe(1500);
  });

  it("clamps new remaining to 0 when elapsed exceeds new duration", () => {
    // 20 min elapsed. New focus = 15 min -> max(0, 900-1200) = 0
    const result = decideReconfigure({
      ...baseInput,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 15 },
    });
    expect(result.newRemainingSeconds).toBe(0);
  });

  it("exits overtime when in overtime and new remaining is positive", () => {
    const result = decideReconfigure({
      ...baseInput,
      hasOvertimeInterval: true,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 50 },
    });
    expect(result.exitOvertime).toBe(true);
  });

  it("does not exit overtime when new remaining is 0", () => {
    const result = decideReconfigure({
      ...baseInput,
      hasOvertimeInterval: true,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 15 },
    });
    expect(result.exitOvertime).toBe(false);
  });

  it("does not exit overtime when not in overtime", () => {
    const result = decideReconfigure({
      ...baseInput,
      hasOvertimeInterval: false,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 50 },
    });
    expect(result.exitOvertime).toBe(false);
  });

  it("resets notification when focus and remaining > 60", () => {
    const result = decideReconfigure({
      ...baseInput,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 50 },
    });
    expect(result.resetNotification).toBe(true);
  });

  it("does not reset notification for break phase", () => {
    const result = decideReconfigure({
      ...baseInput,
      phase: "short_break",
      remainingSeconds: 100,
      newConfig: { ...DEFAULT_CONFIG, shortBreakMinutes: 10 },
    });
    expect(result.resetNotification).toBe(false);
  });

  it("does not reset notification when remaining <= 60", () => {
    // 39 min elapsed. New focus = 40 min -> 60s remaining. Not > 60, so no reset.
    const result = decideReconfigure({
      ...baseInput,
      remainingSeconds: 60, // 39m40s elapsed
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 40 },
    });
    expect(result.resetNotification).toBe(false);
  });

  it("handles focus duration increased (more time added)", () => {
    // 20 min elapsed. Old 40, new 60 -> 40 min remaining
    const result = decideReconfigure({
      ...baseInput,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 60 },
    });
    expect(result.newRemainingSeconds).toBe(2400);
  });

  it("handles focus duration decreased (time reduced)", () => {
    // 20 min elapsed. Old 40, new 30 -> 10 min remaining
    const result = decideReconfigure({
      ...baseInput,
      newConfig: { ...DEFAULT_CONFIG, focusMinutes: 30 },
    });
    expect(result.newRemainingSeconds).toBe(600);
  });

  it("handles short_break reconfigure", () => {
    // 2 min elapsed of 5 min break. New 10 min -> 8 min remaining
    const result = decideReconfigure({
      ...baseInput,
      phase: "short_break",
      remainingSeconds: 180, // 3 min left of 5 min
      newConfig: { ...DEFAULT_CONFIG, shortBreakMinutes: 10 },
    });
    expect(result.newRemainingSeconds).toBe(480); // 10*60 - 2*60
  });

  it("handles long_break reconfigure", () => {
    // 5 min elapsed of 10 min break. New 20 min -> 15 min remaining
    const result = decideReconfigure({
      ...baseInput,
      phase: "long_break",
      remainingSeconds: 300, // 5 min left of 10 min
      newConfig: { ...DEFAULT_CONFIG, longBreakMinutes: 20 },
    });
    expect(result.newRemainingSeconds).toBe(900); // 20*60 - 5*60
  });

  it("preserves elapsed across config change", () => {
    // 10 min elapsed. Old 40 -> new 40. Remaining should stay 1800 (30 min)
    const result = decideReconfigure({
      ...baseInput,
      remainingSeconds: 1800,
    });
    expect(result.newRemainingSeconds).toBe(1800);
  });
});

// ============================================================
// decideIdleCheck
// ============================================================

describe("decideIdleCheck", () => {
  const baseInput: IdleCheckInput = {
    isRunning: true,
    phase: "focus",
    suspendedAway: false,
    idlePaused: false,
    idleTimeoutMs: 300_000, // 5 minutes
    webcamInUse: false,
    idleMs: 0,
    phaseEndTime: NOW + 2400_000,
  };

  describe("skip conditions", () => {
    it("skips when not running", () => {
      const result = decideIdleCheck({ ...baseInput, isRunning: false }, NOW);
      expect(result.kind).toBe("skip");
    });

    it("skips when phase is short_break", () => {
      const result = decideIdleCheck({ ...baseInput, phase: "short_break" }, NOW);
      expect(result.kind).toBe("skip");
    });

    it("skips when phase is long_break", () => {
      const result = decideIdleCheck({ ...baseInput, phase: "long_break" }, NOW);
      expect(result.kind).toBe("skip");
    });

    it("skips when already suspended", () => {
      const result = decideIdleCheck({ ...baseInput, suspendedAway: true }, NOW);
      expect(result.kind).toBe("skip");
    });

    it("skips when already idle paused", () => {
      const result = decideIdleCheck({ ...baseInput, idlePaused: true }, NOW);
      expect(result.kind).toBe("skip");
    });

    it("skips when idleTimeoutMs is null", () => {
      const result = decideIdleCheck({ ...baseInput, idleTimeoutMs: null }, NOW);
      expect(result.kind).toBe("skip");
    });

    it("skips when webcam is in use", () => {
      const result = decideIdleCheck(
        { ...baseInput, webcamInUse: true, idleMs: 600_000 },
        NOW,
      );
      expect(result.kind).toBe("skip");
    });

    it("skips when idleMs is below threshold", () => {
      const result = decideIdleCheck({ ...baseInput, idleMs: 200_000 }, NOW);
      expect(result.kind).toBe("skip");
    });

    it("skips when idleMs is 1ms below threshold", () => {
      const result = decideIdleCheck({ ...baseInput, idleMs: 299_999 }, NOW);
      expect(result.kind).toBe("skip");
    });
  });

  describe("trigger", () => {
    it("triggers when idleMs equals threshold exactly", () => {
      const result = decideIdleCheck({ ...baseInput, idleMs: 300_000 }, NOW);
      expect(result.kind).toBe("trigger_idle");
    });

    it("triggers when idleMs exceeds threshold", () => {
      const result = decideIdleCheck({ ...baseInput, idleMs: 600_000 }, NOW);
      expect(result.kind).toBe("trigger_idle");
    });

    it("computes idleStartMs as nowMs - idleMs", () => {
      const result = decideIdleCheck({ ...baseInput, idleMs: 300_000 }, NOW);
      if (result.kind === "trigger_idle") {
        expect(result.idleStartMs).toBe(NOW - 300_000);
      }
    });

    it("computes preSuspendRemaining from phaseEndTime and idleStartMs", () => {
      // phaseEndTime = NOW + 2400s. idleStart = NOW - 300s.
      // remaining = ceil((NOW+2400000 - (NOW-300000)) / 1000) = ceil(2700) = 2700
      const result = decideIdleCheck({ ...baseInput, idleMs: 300_000 }, NOW);
      if (result.kind === "trigger_idle") {
        expect(result.preSuspendRemainingSeconds).toBe(2700);
      }
    });

    it("returns 0 remaining when phaseEndTime is null", () => {
      const result = decideIdleCheck(
        { ...baseInput, idleMs: 300_000, phaseEndTime: null },
        NOW,
      );
      if (result.kind === "trigger_idle") {
        expect(result.preSuspendRemainingSeconds).toBe(0);
      }
    });
  });

  describe("combined skip conditions", () => {
    it("skips when idle exceeds threshold but webcam in use", () => {
      const result = decideIdleCheck(
        { ...baseInput, idleMs: 600_000, webcamInUse: true },
        NOW,
      );
      expect(result.kind).toBe("skip");
    });

    it("skips when idle exceeds threshold but already suspended", () => {
      const result = decideIdleCheck(
        { ...baseInput, idleMs: 600_000, suspendedAway: true },
        NOW,
      );
      expect(result.kind).toBe("skip");
    });
  });
});

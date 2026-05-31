import { describe, expect, it } from "vitest";
import {
  delayUntil,
  elapsedSecondsSince,
  formatBlockedScreenDuration,
  nextIntervalTargetAfter,
  pomodoroBlockedScreenCopy,
  remainingSecondsUntil,
} from "./blocked-screen";

describe("blocked pomodoro screen helpers", () => {
  it("formats minute timers", () => {
    expect(formatBlockedScreenDuration(0)).toBe("00:00");
    expect(formatBlockedScreenDuration(59)).toBe("00:59");
    expect(formatBlockedScreenDuration(65)).toBe("01:05");
  });

  it("formats hour timers only when needed", () => {
    expect(formatBlockedScreenDuration(3600)).toBe("01:00:00");
    expect(formatBlockedScreenDuration(3723)).toBe("01:02:03");
  });

  it("clamps invalid negative timers", () => {
    expect(formatBlockedScreenDuration(-12)).toBe("00:00");
  });

  it("computes remaining seconds from an absolute target", () => {
    expect(remainingSecondsUntil(10_000, 8_100)).toBe(2);
    expect(remainingSecondsUntil(10_000, 10_000)).toBe(0);
    expect(remainingSecondsUntil(10_000, 11_000)).toBe(0);
  });

  it("computes elapsed seconds from an absolute start", () => {
    expect(elapsedSecondsSince(10_000, 10_999)).toBe(0);
    expect(elapsedSecondsSince(10_000, 11_000)).toBe(1);
    expect(elapsedSecondsSince(10_000, 9_000)).toBe(0);
  });

  it("computes non-negative delay to a target", () => {
    expect(delayUntil(10_000, 9_250)).toBe(750);
    expect(delayUntil(10_000, 10_000)).toBe(0);
    expect(delayUntil(10_000, 11_000)).toBe(0);
  });

  it("skips missed interval targets after a delayed callback", () => {
    expect(nextIntervalTargetAfter(10_000, 10_000, 10_500)).toBe(20_000);
    expect(nextIntervalTargetAfter(10_000, 10_000, 25_000)).toBe(30_000);
    expect(nextIntervalTargetAfter(10_000, 10_000, 30_000)).toBe(40_000);
  });

  it("uses restart copy for failed idle sessions", () => {
    const copy = pomodoroBlockedScreenCopy("idle_failed");
    expect(copy.title).toBe("Focus session failed");
    expect(copy.primaryHint?.label).toBe("restart focus");
  });

  it("keeps break completion dismissible by key or click", () => {
    const copy = pomodoroBlockedScreenCopy("break_finished");
    expect(copy.title).toBe("Break complete");
    expect(copy.subtitle).toBe("press any key or click to continue");
  });
});

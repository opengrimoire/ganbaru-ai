import { describe, expect, it } from "vitest";
import {
  delayUntil,
  elapsedSecondsSince,
  formatBreakExtensionHint,
  formatBlockedScreenDateTime,
  formatBlockedScreenDuration,
  nextIntervalTargetAfter,
  parsePomodoroBlockedScreenState,
  pomodoroBlockedScreenPalette,
  pomodoroBlockedScreenCopy,
  pomodoroBlockedScreenStateFromOverlayKind,
  remainingSecondsUntil,
  shouldScheduleIdleAlert,
  shouldShowBlockedScreenDateTime,
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

  it("formats date and time through Intl", () => {
    const date = new Date("2026-05-31T13:45:00Z");
    const label = formatBlockedScreenDateTime(date, "en-US", { timeZone: "UTC" });
    expect(label).toBe("Sunday, May 31, 2026 at 1:45 PM");
  });

  it("shows date and time except on the break finished screen", () => {
    expect(shouldShowBlockedScreenDateTime("break_countdown")).toBe(true);
    expect(shouldShowBlockedScreenDateTime("idle")).toBe(true);
    expect(shouldShowBlockedScreenDateTime("idle_failed")).toBe(true);
    expect(shouldShowBlockedScreenDateTime("break_finished")).toBe(false);
  });

  it("uses distinct state palettes", () => {
    expect(pomodoroBlockedScreenPalette("idle")).toMatchObject({
      background: "#A33728",
      mainText: "#F9D573",
    });
    expect(pomodoroBlockedScreenPalette("break_countdown")).toMatchObject({
      background: "#035B33",
      mainText: "#FFFFFF",
    });
    expect(pomodoroBlockedScreenPalette("break_finished")).toMatchObject({
      background: "#EEBA04",
      mainText: "#0D0502",
    });
  });

  it("maps overlay query state to blocked screen state", () => {
    expect(parsePomodoroBlockedScreenState("idle_failed")).toBe("idle_failed");
    expect(parsePomodoroBlockedScreenState("break_finished")).toBe("break_finished");
    expect(parsePomodoroBlockedScreenState("unknown")).toBe("break_countdown");
    expect(pomodoroBlockedScreenStateFromOverlayKind("idle")).toBe("idle");
    expect(pomodoroBlockedScreenStateFromOverlayKind("break")).toBe("break_countdown");
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

  it("keeps the exact focus failure boundary for the failure sound", () => {
    expect(shouldScheduleIdleAlert(59_999, 60_000)).toBe(true);
    expect(shouldScheduleIdleAlert(60_000, 60_000)).toBe(false);
    expect(shouldScheduleIdleAlert(60_001, 60_000)).toBe(false);
  });

  it("keeps break extension hint stable until the cap is reached", () => {
    expect(formatBreakExtensionHint(0, 3)).toBe(
      "Press Ctrl+Shift+Space to extend the break",
    );
    expect(formatBreakExtensionHint(1, 3)).toBe(
      "Press Ctrl+Shift+Space to extend the break",
    );
    expect(formatBreakExtensionHint(3, 3)).toBeNull();
  });

  it("uses restart copy for failed idle sessions", () => {
    const copy = pomodoroBlockedScreenCopy("idle_failed");
    expect(copy.title).toBe("Focus session failed");
    expect(copy.status).toBeNull();
    expect(copy.primaryHint?.label).toBe("restart focus");
    expect(copy.secondaryHint).toBeNull();
  });

  it("does not expose a stop action on idle screens", () => {
    expect(pomodoroBlockedScreenCopy("idle").status).toBeNull();
    expect(pomodoroBlockedScreenCopy("idle").secondaryHint).toBeNull();
    expect(pomodoroBlockedScreenCopy("idle_failed").secondaryHint).toBeNull();
  });

  it("uses generic break completion acknowledgement copy", () => {
    const copy = pomodoroBlockedScreenCopy("break_finished");
    expect(copy.title).toBe("Break complete");
    expect(copy.subtitle).toBe("acknowledge when ready");
  });
});

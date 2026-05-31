import { describe, expect, it } from "vitest";
import {
  formatBlockedScreenDuration,
  pomodoroBlockedScreenCopy,
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

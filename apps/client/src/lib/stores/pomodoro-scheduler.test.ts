import { describe, expect, it } from "vitest";
import type { CalendarEvent, PomodoroConfig } from "$lib/components/calendar/types";
import { createPresetPomodoroConfig } from "$lib/pomodoro/rhythm";
import { selectActivePomodoroBlock } from "./pomodoro-scheduler";

const config: PomodoroConfig = createPresetPomodoroConfig("auto");

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "start" | "end">): CalendarEvent {
  return {
    title: overrides.id,
    timezone: "America/Monterrey",
    calendarId: "local",
    pomodoroConfig: config,
    ...overrides,
  };
}

describe("selectActivePomodoroBlock", () => {
  const now = new Date(2026, 4, 25, 10, 15);

  it("returns undefined when no pomodoro event overlaps now", () => {
    expect(
      selectActivePomodoroBlock(
        [
          event({ id: "past", start: "2026-05-25 09:00", end: "2026-05-25 10:00" }),
          event({ id: "plain", start: "2026-05-25 10:00", end: "2026-05-25 11:00", pomodoroConfig: undefined }),
        ],
        { now, activeBlockId: null },
      ),
    ).toBeUndefined();
  });

  it("treats second-precision event ends as expired immediately after the cut second", () => {
    expect(
      selectActivePomodoroBlock(
        [
          event({ id: "cut", start: "2026-05-25 10:00", end: "2026-05-25 10:15:30" }),
        ],
        { now: new Date(2026, 4, 25, 10, 15, 31), activeBlockId: null },
      ),
    ).toBeUndefined();
  });

  it("keeps the current active block when it is still a candidate", () => {
    const long = event({ id: "long", start: "2026-05-25 09:00", end: "2026-05-25 12:00" });
    const short = event({ id: "short", start: "2026-05-25 10:00", end: "2026-05-25 10:30" });

    expect(
      selectActivePomodoroBlock([short, long], { now, activeBlockId: "long" }),
    ).toBe(long);
  });

  it("picks the candidate with the shortest remaining duration", () => {
    const long = event({ id: "long", start: "2026-05-25 09:00", end: "2026-05-25 12:00" });
    const short = event({ id: "short", start: "2026-05-25 10:00", end: "2026-05-25 10:30" });

    expect(
      selectActivePomodoroBlock([long, short], { now, activeBlockId: null }),
    ).toBe(short);
  });

  it("uses creation time as the deterministic tie-breaker", () => {
    const newer = event({
      id: "newer",
      start: "2026-05-25 10:00",
      end: "2026-05-25 11:00",
      createdAt: "2026-05-20T10:00:00Z",
    });
    const older = event({
      id: "older",
      start: "2026-05-25 10:00",
      end: "2026-05-25 11:00",
      createdAt: "2026-05-19T10:00:00Z",
    });

    expect(
      selectActivePomodoroBlock([newer, older], { now, activeBlockId: null }),
    ).toBe(older);
  });

  it("prefers a recently interrupted block before normal tiebreakers", () => {
    const interrupted = event({
      id: "interrupted",
      start: "2026-05-25 09:00",
      end: "2026-05-25 12:00",
    });
    const shorter = event({
      id: "shorter",
      start: "2026-05-25 10:00",
      end: "2026-05-25 10:30",
    });

    expect(
      selectActivePomodoroBlock(
        [shorter, interrupted],
        {
          now,
          activeBlockId: null,
          recentlyInterruptedBlockIds: new Set(["interrupted"]),
        },
      ),
    ).toBe(interrupted);
  });
});

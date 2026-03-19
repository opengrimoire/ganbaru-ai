import { describe, it, expect } from "vitest";
import {
  recurrenceToRrule,
  rruleToRecurrence,
  presetToRecurrence,
  recurrenceToPreset,
  formatRecurrenceLabel,
} from "./rrule";
import type { RecurrenceConfig, RecurrencePreset } from "./types";

describe("recurrenceToRrule", () => {
  it("serializes simple daily", () => {
    const config: RecurrenceConfig = { frequency: "daily", interval: 1, end: { type: "never" } };
    expect(recurrenceToRrule(config)).toBe("FREQ=DAILY");
  });

  it("serializes interval", () => {
    const config: RecurrenceConfig = { frequency: "daily", interval: 3, end: { type: "never" } };
    expect(recurrenceToRrule(config)).toBe("FREQ=DAILY;INTERVAL=3");
  });

  it("serializes weekdays", () => {
    const config: RecurrenceConfig = {
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO", "WE", "FR"],
      end: { type: "never" },
    };
    expect(recurrenceToRrule(config)).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("serializes count end", () => {
    const config: RecurrenceConfig = {
      frequency: "weekly",
      interval: 2,
      end: { type: "count", count: 10 },
    };
    expect(recurrenceToRrule(config)).toBe("FREQ=WEEKLY;INTERVAL=2;COUNT=10");
  });

  it("serializes until end", () => {
    const config: RecurrenceConfig = {
      frequency: "monthly",
      interval: 1,
      end: { type: "until", date: "2026-06-15" },
    };
    expect(recurrenceToRrule(config)).toBe("FREQ=MONTHLY;UNTIL=20260615");
  });
});

describe("rruleToRecurrence", () => {
  it("parses simple daily", () => {
    const config = rruleToRecurrence("FREQ=DAILY");
    expect(config.frequency).toBe("daily");
    expect(config.interval).toBe(1);
    expect(config.weekdays).toBeUndefined();
    expect(config.end).toEqual({ type: "never" });
  });

  it("parses interval", () => {
    const config = rruleToRecurrence("FREQ=DAILY;INTERVAL=3");
    expect(config.interval).toBe(3);
  });

  it("parses BYDAY", () => {
    const config = rruleToRecurrence("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(config.weekdays).toEqual(["MO", "WE", "FR"]);
  });

  it("parses COUNT", () => {
    const config = rruleToRecurrence("FREQ=WEEKLY;COUNT=10");
    expect(config.end).toEqual({ type: "count", count: 10 });
  });

  it("parses UNTIL in YYYYMMDD format", () => {
    const config = rruleToRecurrence("FREQ=MONTHLY;UNTIL=20260615");
    expect(config.end).toEqual({ type: "until", date: "2026-06-15" });
  });

  it("falls back to repeatUntil column", () => {
    const config = rruleToRecurrence("FREQ=DAILY", "2026-04-01");
    expect(config.end).toEqual({ type: "until", date: "2026-04-01" });
  });

  it("prefers UNTIL over repeatUntil column", () => {
    const config = rruleToRecurrence("FREQ=DAILY;UNTIL=20260615", "2026-04-01");
    expect(config.end).toEqual({ type: "until", date: "2026-06-15" });
  });

  it("parses legacy weekdays preset", () => {
    const config = rruleToRecurrence("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(config.frequency).toBe("weekly");
    expect(config.weekdays).toEqual(["MO", "TU", "WE", "TH", "FR"]);
    expect(config.interval).toBe(1);
  });
});

describe("preset round-trips", () => {
  const presets: Exclude<RecurrencePreset, "none">[] = [
    "daily",
    "weekdays",
    "weekly",
    "monthly",
    "yearly",
  ];

  for (const preset of presets) {
    it(`round-trips ${preset}`, () => {
      const config = presetToRecurrence(preset)!;
      expect(config).toBeDefined();
      const rrule = recurrenceToRrule(config);
      const parsed = rruleToRecurrence(rrule);
      expect(recurrenceToPreset(parsed)).toBe(preset);
    });
  }

  it("returns undefined for 'none'", () => {
    expect(presetToRecurrence("none")).toBeUndefined();
  });
});

describe("recurrenceToPreset", () => {
  it("returns null for custom interval", () => {
    const config: RecurrenceConfig = { frequency: "daily", interval: 2, end: { type: "never" } };
    expect(recurrenceToPreset(config)).toBeNull();
  });

  it("returns null for non-never end", () => {
    const config: RecurrenceConfig = {
      frequency: "daily",
      interval: 1,
      end: { type: "count", count: 5 },
    };
    expect(recurrenceToPreset(config)).toBeNull();
  });

  it("returns null for custom weekday set", () => {
    const config: RecurrenceConfig = {
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO", "WE"],
      end: { type: "never" },
    };
    expect(recurrenceToPreset(config)).toBeNull();
  });
});

describe("formatRecurrenceLabel", () => {
  it("formats daily", () => {
    expect(
      formatRecurrenceLabel({ frequency: "daily", interval: 1, end: { type: "never" } }),
    ).toBe("Daily");
  });

  it("formats every N days", () => {
    expect(
      formatRecurrenceLabel({ frequency: "daily", interval: 3, end: { type: "never" } }),
    ).toBe("Every 3 days");
  });

  it("formats weekly with weekdays", () => {
    expect(
      formatRecurrenceLabel({
        frequency: "weekly",
        interval: 1,
        weekdays: ["MO", "WE", "FR"],
        end: { type: "never" },
      }),
    ).toBe("Weekly on Mon, Wed, Fri");
  });

  it("formats every N weeks with weekdays", () => {
    expect(
      formatRecurrenceLabel({
        frequency: "weekly",
        interval: 2,
        weekdays: ["MO", "WE"],
        end: { type: "never" },
      }),
    ).toBe("Every 2 weeks on Mon, Wed");
  });

  it("appends until date", () => {
    expect(
      formatRecurrenceLabel({
        frequency: "daily",
        interval: 1,
        end: { type: "until", date: "2026-03-17" },
      }),
    ).toBe("Daily, ends Mar 17");
  });

  it("appends count", () => {
    expect(
      formatRecurrenceLabel({
        frequency: "weekly",
        interval: 1,
        end: { type: "count", count: 5 },
      }),
    ).toBe("Weekly, 5 times");
  });

  it("formats monthly", () => {
    expect(
      formatRecurrenceLabel({ frequency: "monthly", interval: 1, end: { type: "never" } }),
    ).toBe("Monthly");
  });

  it("formats yearly", () => {
    expect(
      formatRecurrenceLabel({ frequency: "yearly", interval: 1, end: { type: "never" } }),
    ).toBe("Yearly");
  });
});

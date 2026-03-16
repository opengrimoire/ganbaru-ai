import { describe, it, expect } from "vitest";
import { repeatRuleToRrule, rruleToRepeatRule } from "./rrule";
import type { RepeatRule } from "./types";

describe("repeatRuleToRrule", () => {
  it("returns null for 'none'", () => {
    expect(repeatRuleToRrule("none")).toBeNull();
  });

  it("converts daily", () => {
    expect(repeatRuleToRrule("daily")).toBe("FREQ=DAILY");
  });

  it("converts weekdays", () => {
    expect(repeatRuleToRrule("weekdays")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  it("converts weekly", () => {
    expect(repeatRuleToRrule("weekly")).toBe("FREQ=WEEKLY");
  });

  it("converts monthly", () => {
    expect(repeatRuleToRrule("monthly")).toBe("FREQ=MONTHLY");
  });

  it("converts yearly", () => {
    expect(repeatRuleToRrule("yearly")).toBe("FREQ=YEARLY");
  });
});

describe("rruleToRepeatRule", () => {
  it("returns undefined for null", () => {
    expect(rruleToRepeatRule(null)).toBeUndefined();
  });

  it("returns undefined for unknown rrule", () => {
    expect(rruleToRepeatRule("FREQ=SECONDLY")).toBeUndefined();
  });

  it("round-trips all presets", () => {
    const rules: Exclude<RepeatRule, "none">[] = ["daily", "weekdays", "weekly", "monthly", "yearly"];
    for (const rule of rules) {
      const rrule = repeatRuleToRrule(rule);
      expect(rruleToRepeatRule(rrule)).toBe(rule);
    }
  });
});

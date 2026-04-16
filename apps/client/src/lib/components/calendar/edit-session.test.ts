import { describe, it, expect } from "vitest";
import { fieldEqual, isDirtyDiff } from "./edit-session.svelte";

describe("fieldEqual", () => {
  it("treats two undefined values as equal", () => {
    expect(fieldEqual(undefined, undefined)).toBe(true);
  });

  it("treats two null values as equal", () => {
    expect(fieldEqual(null, null)).toBe(true);
  });

  it("distinguishes null from undefined", () => {
    expect(fieldEqual(null, undefined)).toBe(false);
  });

  it("compares primitives strictly", () => {
    expect(fieldEqual("a", "a")).toBe(true);
    expect(fieldEqual("a", "b")).toBe(false);
    expect(fieldEqual(1, 1)).toBe(true);
    expect(fieldEqual(1, "1")).toBe(false);
    expect(fieldEqual(false, false)).toBe(true);
    expect(fieldEqual(true, false)).toBe(false);
  });

  it("distinguishes empty string from undefined", () => {
    // Baseline and changes use the same normalization rules, so "" should
    // only ever appear when the field is literally empty.
    expect(fieldEqual("", undefined)).toBe(false);
    expect(fieldEqual("", "")).toBe(true);
  });

  it("deep-compares arrays", () => {
    expect(fieldEqual([0, 5, 10], [0, 5, 10])).toBe(true);
    expect(fieldEqual([0, 5], [0, 5, 10])).toBe(false);
    expect(fieldEqual([], [])).toBe(true);
  });

  it("deep-compares objects", () => {
    const a = { focusDurationMinutes: 40, shortBreakMinutes: 5 };
    const b = { focusDurationMinutes: 40, shortBreakMinutes: 5 };
    const c = { focusDurationMinutes: 25, shortBreakMinutes: 5 };
    expect(fieldEqual(a, b)).toBe(true);
    expect(fieldEqual(a, c)).toBe(false);
  });

  it("treats object vs undefined as unequal", () => {
    expect(fieldEqual({ a: 1 }, undefined)).toBe(false);
    expect(fieldEqual(undefined, { a: 1 })).toBe(false);
  });
});

describe("isDirtyDiff", () => {
  it("returns false when both sides are empty", () => {
    expect(isDirtyDiff({}, {})).toBe(false);
  });

  it("returns false when every field matches the baseline", () => {
    const baseline = {
      title: "Meeting",
      start: "2026-04-16 10:00",
      end: "2026-04-16 11:00",
      color: "azure" as const,
      notifications: [0, 5],
    };
    const changes = { ...baseline };
    expect(isDirtyDiff(changes, baseline)).toBe(false);
  });

  it("returns true when a single field differs", () => {
    const baseline = { title: "Meeting", start: "2026-04-16 10:00" };
    const changes = { title: "Meeting!", start: "2026-04-16 10:00" };
    expect(isDirtyDiff(changes, baseline)).toBe(true);
  });

  it("returns false after a field is reverted to baseline", () => {
    const baseline = { title: "Meeting" };

    // User types a change
    let changes: Partial<typeof baseline> = { title: "Meet" };
    expect(isDirtyDiff(changes, baseline)).toBe(true);

    // User reverts
    changes = { title: "Meeting" };
    expect(isDirtyDiff(changes, baseline)).toBe(false);
  });

  it("detects changes via partial patches against a baseline", () => {
    // Simulates a drag emitting { start, end } only, while baseline has full shape.
    const baseline = {
      title: "Focus",
      start: "2026-04-16 09:00",
      end: "2026-04-16 10:00",
    };
    // Drag moved the block an hour later but panel hasn't emitted title.
    const changes = { start: "2026-04-16 10:00", end: "2026-04-16 11:00" };
    expect(isDirtyDiff(changes, baseline)).toBe(true);
  });

  it("returns false when a drag is undone by reverting to original times", () => {
    const baseline = {
      title: "Focus",
      start: "2026-04-16 09:00",
      end: "2026-04-16 10:00",
    };
    // Drag then drag-back to original positions.
    const changes = { start: "2026-04-16 09:00", end: "2026-04-16 10:00" };
    expect(isDirtyDiff(changes, baseline)).toBe(false);
  });

  it("deep-compares nested pomodoro config", () => {
    const pomodoro = {
      focusDurationMinutes: 40,
      shortBreakMinutes: 5,
      longBreakMinutes: 10,
      pomodoroCount: 4,
      idleTimeoutMinutes: 1,
    };
    const baseline = { pomodoroConfig: pomodoro };
    const same = { pomodoroConfig: { ...pomodoro } };
    const different = { pomodoroConfig: { ...pomodoro, focusDurationMinutes: 25 } };
    expect(isDirtyDiff(same, baseline)).toBe(false);
    expect(isDirtyDiff(different, baseline)).toBe(true);
  });

  it("treats a toggled-off-then-on notification set as clean", () => {
    const baseline = { notifications: [0, 30] };
    // User toggled notifications off: changes has undefined.
    let changes: Partial<typeof baseline> = { notifications: undefined };
    expect(isDirtyDiff(changes, baseline)).toBe(true);
    // User toggled back on with the same values.
    changes = { notifications: [0, 30] };
    expect(isDirtyDiff(changes, baseline)).toBe(false);
  });

  it("flags dirty when changes add a key absent in baseline", () => {
    const baseline = { title: "Meeting" };
    const changes = { title: "Meeting", color: "ruby" as const };
    expect(isDirtyDiff(changes, baseline)).toBe(true);
  });

  it("does not flag dirty for baseline keys absent from changes", () => {
    // Merge semantics: the final event is {...baseline, ...changes}, so
    // a baseline field not overridden by changes keeps its baseline value
    // and must not count as a diff. This matters for partial patches such
    // as a drag that only emits start/end.
    const baseline = { title: "Meeting", description: "Weekly sync" };
    const changes = { title: "Meeting" };
    expect(isDirtyDiff(changes, baseline)).toBe(false);
  });

  it("ignores keys where both sides are undefined", () => {
    // The panel's emit shape always includes undefined for uncustomized fields.
    // Matching undefineds on both sides must not count as a diff.
    const baseline = { title: "X", color: undefined, description: undefined };
    const changes = { title: "X", color: undefined, description: undefined };
    expect(isDirtyDiff(changes, baseline)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { generateSynthEvents, mulberry32, DEFAULT_SEED } from "./synth";

const ANCHOR = new Date(2026, 3, 30); // 2026-04-30 local

describe("mulberry32", () => {
  it("produces the same first values for the same seed", () => {
    const a = mulberry32(0x1234);
    const b = mulberry32(0x1234);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it("diverges for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let diverged = false;
    for (let i = 0; i < 10; i++) {
      if (a() !== b()) {
        diverged = true;
        break;
      }
    }
    expect(diverged).toBe(true);
  });

  it("produces values in [0, 1)", () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("generateSynthEvents", () => {
  it("produces the same first events for the same seed", () => {
    const a = generateSynthEvents({ count: 50, anchor: ANCHOR, seed: DEFAULT_SEED });
    const b = generateSynthEvents({ count: 50, anchor: ANCHOR, seed: DEFAULT_SEED });
    expect(a).toEqual(b);
  });

  it("locks the first five events as a golden snapshot for v1", () => {
    // Drift in this snapshot means the synth distribution changed. Either
    // bump SYNTH_VERSION (and update the calendar grouping) or revert. See
    // docs/features/performance-benchmark.md.
    const events = generateSynthEvents({ count: 5, anchor: ANCHOR, seed: DEFAULT_SEED });
    expect(events.length).toBe(5);
    for (const e of events) {
      expect(typeof e.title).toBe("string");
      expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(e.start)).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(e.end)).toBe(true);
    }
    // Snapshot pinned: title shape, start, end. If this fails after a
    // distribution change, bump SYNTH_VERSION before updating the snapshot.
    expect(events).toMatchSnapshot();
  });

  it("respects the requested count", () => {
    const events = generateSynthEvents({ count: 100, anchor: ANCHOR, seed: DEFAULT_SEED });
    expect(events.length).toBe(100);
  });

  it("produces all events within [anchor - 365, anchor + 365]", () => {
    const events = generateSynthEvents({ count: 500, anchor: ANCHOR, seed: DEFAULT_SEED });
    const lower = new Date(ANCHOR);
    lower.setDate(lower.getDate() - 365);
    const upper = new Date(ANCHOR);
    upper.setDate(upper.getDate() + 365);
    for (const e of events) {
      const startDate = e.start.split(" ")[0];
      const [y, m, d] = startDate.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      expect(dt.getTime()).toBeGreaterThanOrEqual(lower.getTime());
      expect(dt.getTime()).toBeLessThanOrEqual(upper.getTime());
    }
  });

  it("produces a mixed shape, roughly matching the documented distribution", () => {
    const events = generateSynthEvents({ count: 1000, anchor: ANCHOR, seed: DEFAULT_SEED });
    const counts = {
      allDay: 0,
      withAlarmsOrAttendees: 0,
      recurring: 0,
      withDescription: 0,
      plain: 0,
    };
    for (const e of events) {
      if (e.allDay) counts.allDay++;
      else if (e.alarms || e.attendees) counts.withAlarmsOrAttendees++;
      else if (e.recurrence) counts.recurring++;
      else if (e.description) counts.withDescription++;
      else counts.plain++;
    }
    // Generous tolerance bands; the test guards against gross distribution
    // drift, not exact ratio drift (PRNG variance is fine).
    expect(counts.allDay).toBeGreaterThan(20);
    expect(counts.allDay).toBeLessThan(80);
    expect(counts.withAlarmsOrAttendees).toBeGreaterThan(20);
    expect(counts.withAlarmsOrAttendees).toBeLessThan(80);
    expect(counts.recurring).toBeGreaterThan(60);
    expect(counts.recurring).toBeLessThan(140);
    expect(counts.withDescription).toBeGreaterThan(60);
    expect(counts.withDescription).toBeLessThan(140);
    expect(counts.plain).toBeGreaterThan(600);
    expect(counts.plain).toBeLessThan(800);
  });

  it("end time is at or after start time", () => {
    const events = generateSynthEvents({ count: 200, anchor: ANCHOR, seed: DEFAULT_SEED });
    for (const e of events) {
      expect(e.end >= e.start).toBe(true);
    }
  });
});

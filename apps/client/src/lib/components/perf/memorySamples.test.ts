import { describe, it, expect } from "vitest";
import { formatElapsed, pickTicks, samplesToCSV, SAMPLE_CAP, SAMPLE_INTERVAL_MS } from "./memorySamples";
import type { MemorySample } from "./memorySamples";

describe("formatElapsed", () => {
  it("renders sub-minute durations as M:SS", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(500)).toBe("0:01");
    expect(formatElapsed(59_000)).toBe("0:59");
  });

  it("renders sub-hour durations as M:SS", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(125_000)).toBe("2:05");
    expect(formatElapsed(59 * 60_000 + 30_000)).toBe("59:30");
  });

  it("renders multi-hour durations as H:MM:SS", () => {
    expect(formatElapsed(60 * 60_000)).toBe("1:00:00");
    expect(formatElapsed(2 * 60 * 60_000 + 5 * 60_000 + 9_000)).toBe("2:05:09");
  });

  it("clamps negative inputs to zero", () => {
    expect(formatElapsed(-1)).toBe("0:00");
  });
});

describe("pickTicks", () => {
  it("returns three ticks at narrow widths", () => {
    const ticks = pickTicks(0, 10_000, 180);
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toBe(0);
    expect(ticks[2]).toBe(10_000);
  });

  it("returns four ticks at wider widths", () => {
    const ticks = pickTicks(0, 30_000, 260);
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toBe(0);
    expect(ticks[3]).toBe(30_000);
  });

  it("collapses to a single tick when domain has no span", () => {
    expect(pickTicks(5_000, 5_000, 260)).toEqual([5_000]);
  });
});

describe("samplesToCSV", () => {
  function sample(t: number, total: number, procs: { name: string; mb: number }[]): MemorySample {
    return { t, totalMb: total, processes: procs };
  }

  it("returns an empty string for an empty buffer", () => {
    expect(samplesToCSV([])).toBe("");
  });

  it("emits a header plus one row per sample with sorted process columns", () => {
    const csv = samplesToCSV([
      sample(0, 250.5, [
        { name: "client", mb: 80.1 },
        { name: "WebKitWebProcess", mb: 150.2 },
      ]),
      sample(5_000, 260.0, [
        { name: "client", mb: 82.0 },
        { name: "WebKitWebProcess", mb: 158.0 },
      ]),
    ]);
    const [header, row1, row2] = csv.split("\n");
    expect(header).toBe("t_ms,total_mb,WebKitWebProcess,client");
    expect(row1).toBe("0,250.50,150.20,80.10");
    expect(row2).toBe("5000,260.00,158.00,82.00");
  });

  it("leaves a missing process cell empty when only some samples include it", () => {
    const csv = samplesToCSV([
      sample(0, 100, [{ name: "client", mb: 100 }]),
      sample(5_000, 260, [
        { name: "client", mb: 80 },
        { name: "NetworkProcess", mb: 180 },
      ]),
    ]);
    const [header, row1, row2] = csv.split("\n");
    expect(header).toBe("t_ms,total_mb,NetworkProcess,client");
    expect(row1).toBe("0,100.00,,100.00");
    expect(row2).toBe("5000,260.00,180.00,80.00");
  });
});

describe("constants", () => {
  it("SAMPLE_CAP times SAMPLE_INTERVAL_MS spans one hour", () => {
    expect(SAMPLE_CAP * SAMPLE_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});

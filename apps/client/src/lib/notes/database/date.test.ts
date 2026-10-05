import { describe, expect, it } from "vitest";
import { notesDatabaseDateBoundaryValid, notesDatabaseDateValue, notesDatabaseTimeZoneValid } from "./date";

describe("Notes database dates", () => {
  it("accepts calendar dates, local wall times, and offset timestamps", () => {
    for (const value of ["2024-02-29", "2026-10-01T09:30", "2026-10-01T09:30:10.123", "2026-10-01T09:30:00-06:00", "2026-10-01T15:30:00Z"]) {
      expect(notesDatabaseDateBoundaryValid(value)).toBe(true);
    }
  });
  it("rejects impossible calendar boundaries instead of accepting date-shaped text", () => {
    for (const value of ["2026-02-29", "2026-04-31", "2026-10-01T24:00", "2026-10-01T09:60", "2026-10-01garbage", "2026-10-01T09:00+25:00"]) {
      expect(notesDatabaseDateBoundaryValid(value)).toBe(false);
    }
  });
  it("retains all canonical date fields without coercing external values", () => {
    expect(notesDatabaseDateValue({ start: "2026-10-01", end: "2026-10-03", time_zone: "America/Monterrey" }))
      .toEqual({ start: "2026-10-01", end: "2026-10-03", time_zone: "America/Monterrey" });
    expect(notesDatabaseDateValue({ start: 123, end: false })).toBeNull();
    expect(notesDatabaseTimeZoneValid("America/Monterrey")).toBe(true);
    expect(notesDatabaseTimeZoneValid("Unknown/Nowhere")).toBe(false);
  });
});

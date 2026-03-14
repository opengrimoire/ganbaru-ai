import { describe, it, expect } from "vitest";
import { calculateActivityXp } from "./xp";

describe("calculateActivityXp", () => {
  it("returns 2 XP per minute at default focus score", () => {
    expect(calculateActivityXp(25)).toBe(50);
    expect(calculateActivityXp(50)).toBe(100);
    expect(calculateActivityXp(1)).toBe(2);
  });

  it("applies will focus score multiplier", () => {
    expect(calculateActivityXp(25, 1.5)).toBe(75);
    expect(calculateActivityXp(25, 2.0)).toBe(100);
    expect(calculateActivityXp(25, 0.5)).toBe(25);
  });

  it("rounds to nearest integer", () => {
    expect(calculateActivityXp(7, 1.3)).toBe(18); // 7 * 2 * 1.3 = 18.2
  });

  it("returns 0 for 0 minutes", () => {
    expect(calculateActivityXp(0)).toBe(0);
  });
});

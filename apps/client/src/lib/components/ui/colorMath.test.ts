import { describe, it, expect } from "vitest";
import {
  clampChannel,
  clampHue,
  clampPercent,
  normalizeHex,
  hexToRgb,
  hexToRgba,
  rgbToHex,
  rgbaToHex,
  rgbToHsv,
  hsvToRgb,
  hexToHsv,
  hsvToHex,
} from "./colorMath";

describe("clampChannel", () => {
  it("rounds and clamps to 0..255", () => {
    expect(clampChannel(-10)).toBe(0);
    expect(clampChannel(0)).toBe(0);
    expect(clampChannel(127.6)).toBe(128);
    expect(clampChannel(255)).toBe(255);
    expect(clampChannel(999)).toBe(255);
  });

  it("returns 0 for non-finite numbers", () => {
    expect(clampChannel(Number.NaN)).toBe(0);
    expect(clampChannel(Number.POSITIVE_INFINITY)).toBe(255);
    expect(clampChannel(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("clampHue", () => {
  it("wraps into 0..360", () => {
    expect(clampHue(0)).toBe(0);
    expect(clampHue(360)).toBe(0);
    expect(clampHue(450)).toBe(90);
    expect(clampHue(-30)).toBe(330);
  });
});

describe("clampPercent", () => {
  it("clamps to 0..100", () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(101)).toBe(100);
  });
});

describe("normalizeHex", () => {
  it("accepts 6-digit hex with or without leading #", () => {
    expect(normalizeHex("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeHex("a1b2c3")).toBe("#a1b2c3");
  });

  it("expands 3-digit hex", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("123")).toBe("#112233");
  });

  it("trims whitespace", () => {
    expect(normalizeHex("  #fff  ")).toBe("#ffffff");
  });

  it("rejects invalid input", () => {
    expect(normalizeHex("not-a-color")).toBeNull();
    expect(normalizeHex("#ggg")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("preserves 8-digit hex when alpha is not ff", () => {
    expect(normalizeHex("#11223380")).toBe("#11223380");
    expect(normalizeHex("11223380")).toBe("#11223380");
  });

  it("collapses 8-digit hex with ff alpha to 6-digit", () => {
    expect(normalizeHex("#112233ff")).toBe("#112233");
  });

  it("expands 4-digit hex", () => {
    expect(normalizeHex("#abcd")).toBe("#aabbccdd");
    expect(normalizeHex("#abcf")).toBe("#aabbcc");
  });
});

describe("hexToRgba / rgbaToHex", () => {
  it("defaults alpha to 255 for 6-digit input", () => {
    expect(hexToRgba("#808080")).toEqual({ r: 128, g: 128, b: 128, a: 255 });
  });

  it("parses 8-digit hex alpha", () => {
    expect(hexToRgba("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 });
  });

  it("round-trips through rgba", () => {
    const samples = [
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 17, g: 42, b: 200, a: 255 },
      { r: 240, g: 100, b: 30, a: 128 },
      { r: 255, g: 255, b: 255, a: 1 },
    ];
    for (const { r, g, b, a } of samples) {
      const hex = rgbaToHex(r, g, b, a);
      const rgba = hexToRgba(hex);
      expect(rgba).toEqual({ r, g, b, a });
    }
  });

  it("emits 6-digit hex when alpha is 255", () => {
    expect(rgbaToHex(0, 0, 0, 255)).toBe("#000000");
    expect(rgbaToHex(255, 255, 255, 255)).toBe("#ffffff");
  });

  it("emits 8-digit hex when alpha is less than 255", () => {
    expect(rgbaToHex(0, 0, 0, 0)).toBe("#00000000");
    expect(rgbaToHex(255, 0, 0, 128)).toBe("#ff000080");
  });

  it("hexToRgb drops alpha from 8-digit input", () => {
    expect(hexToRgb("#ff000080")).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe("hexToRgb / rgbToHex", () => {
  it("round-trips primary colors", () => {
    for (const hex of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"]) {
      const rgb = hexToRgb(hex);
      expect(rgb).not.toBeNull();
      if (!rgb) continue;
      expect(rgbToHex(rgb.r, rgb.g, rgb.b)).toBe(hex);
    }
  });

  it("decodes mid-range colors", () => {
    expect(hexToRgb("#80a040")).toEqual({ r: 128, g: 160, b: 64 });
  });

  it("returns null for invalid hex", () => {
    expect(hexToRgb("garbage")).toBeNull();
  });
});

describe("rgbToHsv / hsvToRgb", () => {
  it("converts pure red", () => {
    const hsv = rgbToHsv(255, 0, 0);
    expect(hsv.h).toBeCloseTo(0, 5);
    expect(hsv.s).toBe(100);
    expect(hsv.v).toBe(100);
  });

  it("converts pure green", () => {
    const hsv = rgbToHsv(0, 255, 0);
    expect(hsv.h).toBeCloseTo(120, 5);
    expect(hsv.s).toBe(100);
    expect(hsv.v).toBe(100);
  });

  it("converts pure blue", () => {
    const hsv = rgbToHsv(0, 0, 255);
    expect(hsv.h).toBeCloseTo(240, 5);
    expect(hsv.s).toBe(100);
    expect(hsv.v).toBe(100);
  });

  it("zero saturation when all channels equal", () => {
    const hsv = rgbToHsv(128, 128, 128);
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBeCloseTo(50.196, 1);
  });

  it("round-trips RGB through HSV within rounding tolerance", () => {
    const samples = [
      { r: 17, g: 42, b: 200 },
      { r: 240, g: 100, b: 30 },
      { r: 5, g: 5, b: 5 },
      { r: 200, g: 200, b: 240 },
    ];
    for (const { r, g, b } of samples) {
      const hsv = rgbToHsv(r, g, b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1);
    }
  });
});

describe("hexToHsv / hsvToHex", () => {
  it("round-trips representative hex colors", () => {
    const samples = [
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffffff",
      "#000000",
      "#a1b2c3",
      "#abcdef",
      "#80a040",
    ];
    for (const hex of samples) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      if (!hsv) continue;
      const back = hsvToHex(hsv.h, hsv.s, hsv.v);
      const original = hexToRgb(hex);
      const recovered = hexToRgb(back);
      if (!original || !recovered) throw new Error("hex parse failed");
      expect(Math.abs(original.r - recovered.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(original.g - recovered.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(original.b - recovered.b)).toBeLessThanOrEqual(1);
    }
  });

  it("returns null when given invalid hex", () => {
    expect(hexToHsv("not-a-color")).toBeNull();
  });
});

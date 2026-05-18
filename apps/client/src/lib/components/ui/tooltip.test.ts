import { describe, expect, it } from "vitest";

import {
  calculateTooltipPosition,
  deriveTooltipPalette,
  parseCssColor,
  relativeLuminance,
  type TooltipRect,
} from "./tooltip";

function rect(values: Partial<TooltipRect>): TooltipRect {
  const left = values.left ?? 0;
  const top = values.top ?? 0;
  const width = values.width ?? 0;
  const height = values.height ?? 0;
  return {
    left,
    top,
    width,
    height,
    right: values.right ?? left + width,
    bottom: values.bottom ?? top + height,
  };
}

describe("calculateTooltipPosition", () => {
  it("places the tooltip above the anchor when it fits", () => {
    expect(
      calculateTooltipPosition(
        rect({ left: 100, top: 100, width: 40, height: 30 }),
        rect({ width: 80, height: 30 }),
        { width: 320, height: 240 },
      ),
    ).toEqual({
      left: 80,
      top: 60,
      arrowLeft: 40,
      placement: "top",
    });
  });

  it("places the tooltip below the anchor near the top edge", () => {
    expect(
      calculateTooltipPosition(
        rect({ left: 100, top: 6, width: 40, height: 30 }),
        rect({ width: 80, height: 30 }),
        { width: 320, height: 240 },
      ),
    ).toEqual({
      left: 80,
      top: 46,
      arrowLeft: 40,
      placement: "bottom",
    });
  });

  it("clamps the bubble while keeping the arrow aimed at the anchor", () => {
    expect(
      calculateTooltipPosition(
        rect({ left: 4, top: 100, width: 24, height: 24 }),
        rect({ width: 120, height: 30 }),
        { width: 320, height: 240 },
      ),
    ).toEqual({
      left: 8,
      top: 60,
      arrowLeft: 12,
      placement: "top",
    });
  });

  it("clamps the arrow inset near the right edge", () => {
    expect(
      calculateTooltipPosition(
        rect({ left: 292, top: 100, width: 24, height: 24 }),
        rect({ width: 120, height: 30 }),
        { width: 320, height: 240 },
      ),
    ).toEqual({
      left: 192,
      top: 60,
      arrowLeft: 108,
      placement: "top",
    });
  });
});

describe("parseCssColor", () => {
  it("parses common CSS color formats", () => {
    expect(parseCssColor("#102030")).toEqual({ r: 16, g: 32, b: 48, a: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.4)")).toEqual({ r: 10, g: 20, b: 30, a: 0.4 });
    expect(parseCssColor("rgb(100% 0% 50% / 50%)")).toEqual({ r: 255, g: 0, b: 127.5, a: 0.5 });
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.75)")).toEqual({ r: 255, g: 127.5, b: 0, a: 0.75 });
  });

  it("rejects missing or transparent colors", () => {
    expect(parseCssColor(undefined)).toBeNull();
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("not a color")).toBeNull();
  });
});

describe("deriveTooltipPalette", () => {
  const lightTokens = {
    background: "#F4F4F7",
    foreground: "#141420",
    popover: "#FFFFFF",
    popoverForeground: "#141420",
  };
  const darkTokens = {
    background: "#27282A",
    foreground: "#ECECF2",
    popover: "#353638",
    popoverForeground: "#ECECF2",
  };

  it("uses a dark tooltip on a light local surface", () => {
    const palette = deriveTooltipPalette("rgb(244, 244, 247)", lightTokens);
    const background = parseCssColor(palette.background);
    const foreground = parseCssColor(palette.foreground);

    expect(background && relativeLuminance(background)).toBeLessThan(0.1);
    expect(foreground && relativeLuminance(foreground)).toBeGreaterThan(0.9);
    expect(palette.border).toBe("rgba(255, 255, 255, 0.2)");
  });

  it("uses a light tooltip on a dark local surface", () => {
    const palette = deriveTooltipPalette("rgb(39, 40, 42)", darkTokens);
    const background = parseCssColor(palette.background);
    const foreground = parseCssColor(palette.foreground);

    expect(background && relativeLuminance(background)).toBeGreaterThan(0.8);
    expect(foreground && relativeLuminance(foreground)).toBeLessThan(0.05);
    expect(palette.border).toBe("rgba(0, 0, 0, 0.18)");
  });

  it("chooses against the local surface instead of the global theme mode", () => {
    const palette = deriveTooltipPalette("rgb(255, 255, 255)", darkTokens);
    const background = parseCssColor(palette.background);

    expect(background && relativeLuminance(background)).toBeLessThan(0.1);
  });
});

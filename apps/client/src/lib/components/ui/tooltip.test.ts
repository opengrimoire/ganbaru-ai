import { describe, expect, it } from "vitest";

import { calculateTooltipPosition, type TooltipRect } from "./tooltip";

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

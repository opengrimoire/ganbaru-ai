import { describe, expect, it } from "vitest";
import {
  pickSelectPopoverGeometry,
  type SelectPopoverRect,
} from "./customSelectPosition";

const boundary: SelectPopoverRect = {
  top: 100,
  right: 500,
  bottom: 500,
  left: 100,
  width: 400,
  height: 400,
};

function trigger(overrides: Partial<SelectPopoverRect> = {}): SelectPopoverRect {
  return {
    top: 200,
    right: 320,
    bottom: 228,
    left: 200,
    width: 120,
    height: 28,
    ...overrides,
  };
}

describe("pickSelectPopoverGeometry", () => {
  it("places the dropdown below the trigger when it fits", () => {
    expect(
      pickSelectPopoverGeometry({
        triggerRect: trigger(),
        boundaryRect: boundary,
        contentHeight: 160,
      }),
    ).toMatchObject({
      top: 234,
      left: 200,
      maxHeight: 258,
      placement: "below",
    });
  });

  it("opens above without overlapping the trigger when below is cramped", () => {
    const result = pickSelectPopoverGeometry({
      triggerRect: trigger({ top: 430, bottom: 458 }),
      boundaryRect: boundary,
      contentHeight: 160,
    });

    expect(result.placement).toBe("above");
    expect(result.top + Math.min(160, result.maxHeight)).toBeLessThanOrEqual(424);
  });

  it("caps a long dropdown to the available settings height", () => {
    const result = pickSelectPopoverGeometry({
      triggerRect: trigger(),
      boundaryRect: boundary,
      contentHeight: 700,
    });

    expect(result.placement).toBe("below");
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(boundary.bottom - 8);
  });

  it("keeps the dropdown inside the right edge of the settings boundary", () => {
    const result = pickSelectPopoverGeometry({
      triggerRect: trigger({ left: 440, right: 560, width: 120 }),
      boundaryRect: boundary,
      contentHeight: 100,
    });

    expect(result.left + result.maxWidth).toBeLessThanOrEqual(boundary.right - 8);
    expect(result.minWidth).toBe(120);
  });

  it("shrinks the minimum width when the boundary is narrower than the trigger", () => {
    const result = pickSelectPopoverGeometry({
      triggerRect: trigger({ left: 120, right: 620, width: 500 }),
      boundaryRect: boundary,
      contentHeight: 100,
    });

    expect(result.minWidth).toBe(384);
    expect(result.maxWidth).toBe(384);
  });
});

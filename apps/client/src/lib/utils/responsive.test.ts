import { describe, expect, it } from "vitest";
import {
  clampPanelRect,
  classifyViewport,
  isSizeClassAtLeast,
  pickToolbarItems,
} from "./responsive";

describe("classifyViewport", () => {
  it("classifies wide desktop viewports", () => {
    expect(classifyViewport(1200, 800)).toBe("wide");
  });

  it("classifies regular desktop viewports below the wide threshold", () => {
    expect(classifyViewport(900, 650)).toBe("regular");
    expect(classifyViewport(1200, 650)).toBe("regular");
  });

  it("classifies compact viewports when width or height drops below regular", () => {
    expect(classifyViewport(700, 640)).toBe("compact");
    expect(classifyViewport(900, 500)).toBe("compact");
  });

  it("classifies narrow viewports before micro", () => {
    expect(classifyViewport(420, 640)).toBe("narrow");
  });

  it("uses micro for very small width or height", () => {
    expect(classifyViewport(320, 640)).toBe("micro");
    expect(classifyViewport(600, 320)).toBe("micro");
  });

  it("treats invalid dimensions as micro", () => {
    expect(classifyViewport(Number.NaN, 800)).toBe("micro");
    expect(classifyViewport(800, Number.POSITIVE_INFINITY)).toBe("micro");
  });
});

describe("isSizeClassAtLeast", () => {
  it("compares classes by responsive capacity", () => {
    expect(isSizeClassAtLeast("wide", "regular")).toBe(true);
    expect(isSizeClassAtLeast("compact", "regular")).toBe(false);
    expect(isSizeClassAtLeast("micro", "micro")).toBe(true);
  });
});

describe("pickToolbarItems", () => {
  const items = [
    { id: "close", width: 32, priority: 0, alwaysVisible: true },
    { id: "timer", width: 32, priority: 1 },
    { id: "settings", width: 32, priority: 2 },
    { id: "help", width: 32, priority: 4 },
    { id: "reset", width: 32, priority: 5 },
  ] as const;

  it("keeps always-visible items even when they exceed available width", () => {
    expect(pickToolbarItems(items, 16)).toEqual({
      visible: ["close"],
      overflow: ["timer", "settings", "help", "reset"],
    });
  });

  it("packs optional items by priority while preserving output order", () => {
    expect(pickToolbarItems(items, 96)).toEqual({
      visible: ["close", "timer", "settings"],
      overflow: ["help", "reset"],
    });
  });

  it("does not pack lower-priority items before higher-priority items", () => {
    expect(pickToolbarItems(items, 128)).toEqual({
      visible: ["close", "timer", "settings", "help"],
      overflow: ["reset"],
    });
  });
});

describe("clampPanelRect", () => {
  it("keeps a panel inside the viewport margins", () => {
    expect(
      clampPanelRect(
        { x: 500, y: 500, width: 200, height: 160 },
        { width: 640, height: 520 },
        16,
      ),
    ).toEqual({ x: 424, y: 344, width: 200, height: 160 });
  });

  it("shrinks panels that cannot fit inside the viewport", () => {
    expect(
      clampPanelRect(
        { x: 0, y: 0, width: 420, height: 400 },
        { width: 320, height: 260 },
        { top: 20, right: 12, bottom: 12, left: 12 },
      ),
    ).toEqual({ x: 12, y: 20, width: 296, height: 228 });
  });
});

import { describe, expect, it } from "vitest";
import {
  clampPanelRect,
  classifyViewport,
  getResponsivePanelWidth,
  isSizeClassAtLeast,
  pickColorPickerGeometry,
  pickEventPanelLayout,
  pickThemeEditorGeometry,
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

describe("getResponsivePanelWidth", () => {
  it("uses the max width when the viewport can fit it with margins", () => {
    expect(getResponsivePanelWidth(900, 320, 8)).toBe(320);
    expect(getResponsivePanelWidth(336, 320, 8)).toBe(320);
  });

  it("shrinks to the viewport width minus both margins", () => {
    expect(getResponsivePanelWidth(280, 320, 8)).toBe(264);
    expect(getResponsivePanelWidth(335, 320, 8)).toBe(319);
  });

  it("never returns a negative width", () => {
    expect(getResponsivePanelWidth(12, 320, 8)).toBe(0);
  });
});

describe("pickEventPanelLayout", () => {
  const anchorWithSideRoom = { x: 360, y: 120, width: 80, height: 40 };
  const centeredAnchor = { x: 220, y: 120, width: 80, height: 40 };

  it("uses anchored mode on wide viewports when the panel fits beside the anchor", () => {
    expect(
      pickEventPanelLayout({
        viewport: { width: 1200, height: 700 },
        anchor: anchorWithSideRoom,
      }),
    ).toBe("anchored");
  });

  it("keeps anchored mode on medium viewports when side placement still fits", () => {
    expect(
      pickEventPanelLayout({
        viewport: { width: 700, height: 500 },
        anchor: anchorWithSideRoom,
      }),
    ).toBe("anchored");
  });

  it("uses centered mode when side placement does not fit but the panel width does", () => {
    expect(
      pickEventPanelLayout({
        viewport: { width: 400, height: 500 },
        anchor: centeredAnchor,
      }),
    ).toBe("centered");
  });

  it("uses bottom sheet mode below the full-width threshold when height is usable", () => {
    expect(
      pickEventPanelLayout({
        viewport: { width: 335, height: 500 },
        anchor: centeredAnchor,
      }),
    ).toBe("bottom");
  });

  it("uses fullscreen mode when usable height is below the minimum", () => {
    expect(
      pickEventPanelLayout({
        viewport: { width: 700, height: 337 },
        anchor: anchorWithSideRoom,
      }),
    ).toBe("fullscreen");
    expect(
      pickEventPanelLayout({
        viewport: { width: 335, height: 337 },
        anchor: centeredAnchor,
      }),
    ).toBe("fullscreen");
  });
});

describe("pickThemeEditorGeometry", () => {
  it("uses the desktop floating panel when the preferred width fits", () => {
    expect(pickThemeEditorGeometry({ viewport: { width: 1200, height: 800 } })).toEqual({
      layout: "floating",
      density: "comfortable",
      rect: { x: 250, y: 80, width: 700, height: 640 },
      canDrag: true,
    });
  });

  it("keeps the floating editor when a compact desktop still fits it", () => {
    expect(
      pickThemeEditorGeometry({ viewport: { width: 760, height: 640 } }),
    ).toEqual({
      layout: "floating",
      density: "comfortable",
      rect: { x: 30, y: 64, width: 700, height: 512 },
      canDrag: true,
    });
  });

  it("uses a bottom sheet when width cannot fit the desktop editor", () => {
    expect(
      pickThemeEditorGeometry({ viewport: { width: 700, height: 640 } }),
    ).toEqual({
      layout: "sheet",
      density: "comfortable",
      rect: { x: 16, y: 163, width: 668, height: 461 },
      canDrag: false,
    });
  });

  it("uses compact sheet density on narrow viewports", () => {
    expect(
      pickThemeEditorGeometry({ viewport: { width: 420, height: 700 } }),
    ).toEqual({
      layout: "sheet",
      density: "compact",
      rect: { x: 16, y: 180, width: 388, height: 504 },
      canDrag: false,
    });
  });

  it("uses fullscreen recovery mode on micro or very short viewports", () => {
    expect(
      pickThemeEditorGeometry({ viewport: { width: 360, height: 700 } }).layout,
    ).toBe("fullscreen");
    expect(
      pickThemeEditorGeometry({ viewport: { width: 700, height: 320 } }).layout,
    ).toBe("fullscreen");
  });
});

describe("pickColorPickerGeometry", () => {
  const trigger = { x: 320, y: 120, width: 26, height: 26 };

  it("uses an anchored popover when it fits", () => {
    expect(
      pickColorPickerGeometry({
        viewport: { width: 900, height: 700 },
        trigger,
      }),
    ).toEqual({
      layout: "popover",
      rect: { x: 320, y: 152, width: 228, height: 280 },
    });
  });

  it("clamps anchored popovers inside the right edge", () => {
    expect(
      pickColorPickerGeometry({
        viewport: { width: 500, height: 700 },
        trigger: { x: 460, y: 120, width: 26, height: 26 },
      }),
    ).toEqual({
      layout: "popover",
      rect: { x: 264, y: 152, width: 228, height: 280 },
    });
  });

  it("uses a sheet on narrow but usable viewports", () => {
    expect(
      pickColorPickerGeometry({
        viewport: { width: 420, height: 700 },
        trigger,
      }),
    ).toEqual({
      layout: "sheet",
      rect: { x: 8, y: 412, width: 404, height: 280 },
    });
  });

  it("uses a constrained sheet when the picker cannot fit at full height", () => {
    expect(
      pickColorPickerGeometry({
        viewport: { width: 320, height: 300 },
        trigger,
      }),
    ).toEqual({
      layout: "sheet",
      rect: { x: 8, y: 50, width: 304, height: 242 },
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

  it("lets collapsed floating panels move lower than their expanded size", () => {
    const viewport = { width: 1112, height: 977 };

    expect(
      clampPanelRect(
        { x: 138, y: 850, width: 924, height: 640 },
        viewport,
        16,
      ).y,
    ).toBe(321);

    expect(
      clampPanelRect(
        { x: 138, y: 850, width: 924, height: 106 },
        viewport,
        16,
      ).y,
    ).toBe(850);
  });
});

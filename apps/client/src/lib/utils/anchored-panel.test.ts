import { describe, expect, it } from "vitest";
import { anchoredPanelStyle, type AnchoredPanelInput } from "./anchored-panel";

const ANCHOR: AnchoredPanelInput = {
  triggerRect: { top: 40, right: 480, bottom: 72, left: 448 },
  viewportWidth: 800,
  viewportHeight: 600,
  preferredWidth: 320,
  preferredMaxHeight: 240,
};

describe("Anchored floating panel geometry", () => {
  it("preserves start alignment and supports end alignment for narrow settings triggers", () => {
    expect(anchoredPanelStyle(ANCHOR)).toContain("left:448px");
    expect(anchoredPanelStyle({ ...ANCHOR, horizontalAlign: "end" })).toContain("left:160px");
  });

  it("clamps both horizontal alignments inside a narrow viewport", () => {
    const input = { ...ANCHOR, viewportWidth: 280 };
    expect(anchoredPanelStyle(input)).toContain("left:8px");
    expect(anchoredPanelStyle(input)).toContain("width:264px");
    expect(anchoredPanelStyle({ ...input, horizontalAlign: "end" })).toContain("left:8px");
  });

  it("opens above a low trigger while keeping the whole panel in bounds", () => {
    const style = anchoredPanelStyle({ ...ANCHOR, triggerRect: { top: 550, right: 480, bottom: 582, left: 448 } });
    expect(style).toContain("top:306px");
    expect(style).toContain("max-height:240px");
  });

  it("limits panel height to the available space when both directions are constrained", () => {
    const style = anchoredPanelStyle({ ...ANCHOR, viewportHeight: 160 });
    expect(style).toContain("top:76px");
    expect(style).toContain("max-height:76px");
  });
});

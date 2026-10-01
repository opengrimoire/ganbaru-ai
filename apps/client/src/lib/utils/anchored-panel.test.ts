// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { anchoredPanelContentHeight, anchoredPanelStyle, anchoredPanelWidth, type AnchoredPanelInput } from "./anchored-panel";

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
    expect(anchoredPanelWidth(input)).toBe(264);
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

  it("keeps short content below the anchor without using the height limit as its actual height", () => {
    const style = anchoredPanelStyle({ ...ANCHOR, viewportHeight: 230, contentHeight: 82.75,
      triggerRect: { top: 100, right: 480, bottom: 128, left: 448 } });
    expect(style).toContain("top:132px");
    expect(style).toContain("max-height:90px");
  });

  it("positions short content above a low anchor while retaining room for natural sizing", () => {
    const style = anchoredPanelStyle({ ...ANCHOR, viewportHeight: 230, contentHeight: 82.75,
      triggerRect: { top: 170, right: 480, bottom: 198, left: 448 } });
    expect(style).toContain("top:83px");
    expect(style).toContain("max-height:158px");
  });

  it("measures fractional intrinsic content and borders without including overflowing descendants", () => {
    const panel = document.createElement("div");
    panel.style.borderTopWidth = "1.25px";
    panel.style.borderBottomWidth = "1.25px";
    const header = document.createElement("div");
    const content = document.createElement("div");
    panel.append(header, content);
    document.body.append(panel);
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 40.25));
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 80.25));
    vi.spyOn(content, "scrollHeight", "get").mockReturnValue(1_000);
    expect(anchoredPanelContentHeight(panel, [header, content])).toBe(123);
    panel.remove();
    vi.restoreAllMocks();
  });
});

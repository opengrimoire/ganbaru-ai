import { describe, expect, it } from "vitest";
import { pickSoundscapePopoverGeometry, SOUNDSCAPE_POPOVER_WIDTH } from "./soundscape-popover-position";

const boundary = { top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 };

describe("soundscape flyout placement", () => {
  it("opens closely above and centered on the button pair", () => {
    const position = pickSoundscapePopoverGeometry(
      { top: 300, bottom: 324, left: 400, right: 452, width: 52, height: 24 },
      boundary,
      SOUNDSCAPE_POPOVER_WIDTH,
      60,
    );
    expect(position.placement).toBe("above");
    expect(position.top).toBe(234);
    expect(position.left).toBe(300);
    expect(position.width).toBe(SOUNDSCAPE_POPOVER_WIDTH);
  });

  it("falls back below when the panel cannot fit above", () => {
    const position = pickSoundscapePopoverGeometry(
      { top: 40, bottom: 64, left: 400, right: 424, width: 24, height: 24 },
      boundary,
      SOUNDSCAPE_POPOVER_WIDTH,
      60,
    );
    expect(position.placement).toBe("below");
    expect(position.top).toBe(70);
  });

  it("keeps the same width and stays inside the viewport near its edge", () => {
    const position = pickSoundscapePopoverGeometry(
      { top: 300, bottom: 324, left: 430, right: 482, width: 52, height: 24 },
      { top: 0, left: 0, right: 500, bottom: 600, width: 500, height: 600 },
      SOUNDSCAPE_POPOVER_WIDTH,
      60,
    );
    expect(position.left).toBe(240);
    expect(position.width).toBe(SOUNDSCAPE_POPOVER_WIDTH);
    expect(position.left + (position.width ?? 0)).toBe(492);
  });
});

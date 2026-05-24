import { describe, expect, it } from "vitest";
import { shouldShowEventContour } from "./event-block-state";

describe("event block contour state", () => {
  it("shows contours only for explicit editing, preview, or grabbing state", () => {
    expect(shouldShowEventContour({})).toBe(false);
    expect(shouldShowEventContour({ editing: true })).toBe(true);
    expect(shouldShowEventContour({ preview: true })).toBe(true);
    expect(shouldShowEventContour({ grabbing: true })).toBe(true);
  });
});

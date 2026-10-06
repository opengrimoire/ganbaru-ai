import { describe, expect, it } from "vitest";
import { scrollEdgeFade } from "./scroll-edge-fade";

describe("scroll edge fade", () => {
  it("does not fade content that fits", () => {
    expect(scrollEdgeFade({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 })).toBe("none");
    expect(scrollEdgeFade({ scrollTop: 0, scrollHeight: 200.5, clientHeight: 200 })).toBe("none");
  });

  it("fades only the bottom at the start of scrollable content", () => {
    expect(scrollEdgeFade({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 })).toBe("bottom");
  });

  it("fades both edges in the middle of scrollable content", () => {
    expect(scrollEdgeFade({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 })).toBe("both");
  });

  it("fades only the top at the end, tolerating fractional offsets", () => {
    expect(scrollEdgeFade({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 })).toBe("top");
    expect(scrollEdgeFade({ scrollTop: 199.5, scrollHeight: 400, clientHeight: 200 })).toBe("top");
  });
});

import { describe, expect, it } from "vitest";
import { pairingFrameToLuma } from "./pairing-camera";

describe("pairingFrameToLuma", () => {
  it("converts bounded RGBA pixels to grayscale", () => {
    expect(
      pairingFrameToLuma(
        new Uint8ClampedArray([
          255, 0, 0, 255,
          0, 255, 0, 255,
          0, 0, 255, 255,
        ]),
      ),
    ).toEqual(new Uint8Array([76, 150, 29]));
  });

  it("rejects incomplete pixels", () => {
    expect(() => pairingFrameToLuma(new Uint8ClampedArray([1, 2, 3]))).toThrow(
      "Invalid pairing camera frame",
    );
  });
});

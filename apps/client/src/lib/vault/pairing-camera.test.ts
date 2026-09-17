import { describe, expect, it } from "vitest";
import { pairingFrameCrop, pairingFrameToLuma } from "./pairing-camera";

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

describe("pairingFrameCrop", () => {
  it("selects the centered visible square from a landscape frame", () => {
    expect(pairingFrameCrop(1920, 1080)).toEqual({
      sourceX: 420,
      sourceY: 0,
      sourceSize: 1080,
      outputSize: 1080,
    });
  });

  it("selects the centered visible square from a portrait frame", () => {
    expect(pairingFrameCrop(1080, 1920)).toEqual({
      sourceX: 0,
      sourceY: 420,
      sourceSize: 1080,
      outputSize: 1080,
    });
  });

  it("bounds oversized frames without enlarging small frames", () => {
    expect(pairingFrameCrop(4000, 3000).outputSize).toBe(1080);
    expect(pairingFrameCrop(640, 480).outputSize).toBe(480);
  });

  it("rejects invalid camera dimensions", () => {
    expect(() => pairingFrameCrop(0, 720)).toThrow("Invalid pairing camera dimensions");
    expect(() => pairingFrameCrop(Number.NaN, 720)).toThrow(
      "Invalid pairing camera dimensions",
    );
  });
});

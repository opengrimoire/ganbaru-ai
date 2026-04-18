import { describe, it, expect } from "vitest";
import {
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY_ID,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  DEFAULT_FONT_SCALE,
  clampFontScale,
  getFontFamilyById,
  resolveFontFamilyStack,
} from "./preferences";

describe("FONT_FAMILIES registry", () => {
  it("includes the default font family ID", () => {
    expect(FONT_FAMILIES.some((f) => f.id === DEFAULT_FONT_FAMILY_ID)).toBe(true);
  });

  it("has unique IDs across all options", () => {
    const ids = FONT_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every option carries a non-empty CSS font stack", () => {
    for (const option of FONT_FAMILIES) {
      expect(option.cssStack.length).toBeGreaterThan(0);
    }
  });

  it("every option carries a user-visible display name", () => {
    for (const option of FONT_FAMILIES) {
      expect(option.displayName.length).toBeGreaterThan(0);
    }
  });

  it("is frozen to prevent mutation", () => {
    expect(Object.isFrozen(FONT_FAMILIES)).toBe(true);
  });
});

describe("clampFontScale", () => {
  it("returns the value unchanged when it sits within range", () => {
    expect(clampFontScale(1.0)).toBe(1.0);
    expect(clampFontScale(0.9)).toBe(0.9);
    expect(clampFontScale(1.2)).toBe(1.2);
  });

  it("clamps values below the minimum up to FONT_SCALE_MIN", () => {
    expect(clampFontScale(0.5)).toBe(FONT_SCALE_MIN);
    expect(clampFontScale(-1)).toBe(FONT_SCALE_MIN);
    expect(clampFontScale(0)).toBe(FONT_SCALE_MIN);
  });

  it("clamps values above the maximum down to FONT_SCALE_MAX", () => {
    expect(clampFontScale(2)).toBe(FONT_SCALE_MAX);
    expect(clampFontScale(100)).toBe(FONT_SCALE_MAX);
  });

  it("accepts the exact boundary values", () => {
    expect(clampFontScale(FONT_SCALE_MIN)).toBe(FONT_SCALE_MIN);
    expect(clampFontScale(FONT_SCALE_MAX)).toBe(FONT_SCALE_MAX);
  });

  it("falls back to the default scale for non-finite inputs", () => {
    expect(clampFontScale(Number.NaN)).toBe(DEFAULT_FONT_SCALE);
    expect(clampFontScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FONT_SCALE);
    expect(clampFontScale(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_FONT_SCALE);
  });
});

describe("getFontFamilyById", () => {
  it("returns the option for a registered ID", () => {
    const option = getFontFamilyById(DEFAULT_FONT_FAMILY_ID);
    expect(option?.id).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("returns undefined for unknown IDs", () => {
    expect(getFontFamilyById("does-not-exist")).toBeUndefined();
  });

  it("returns undefined for null, undefined, and empty inputs", () => {
    expect(getFontFamilyById(null)).toBeUndefined();
    expect(getFontFamilyById(undefined)).toBeUndefined();
    expect(getFontFamilyById("")).toBeUndefined();
  });
});

describe("resolveFontFamilyStack", () => {
  it("returns the stack for a known ID", () => {
    const stack = resolveFontFamilyStack(DEFAULT_FONT_FAMILY_ID);
    const defaultOption = FONT_FAMILIES.find(
      (f) => f.id === DEFAULT_FONT_FAMILY_ID,
    );
    expect(stack).toBe(defaultOption!.cssStack);
  });

  it("falls back to the default option's stack for unknown IDs", () => {
    const defaultOption = FONT_FAMILIES.find(
      (f) => f.id === DEFAULT_FONT_FAMILY_ID,
    );
    expect(resolveFontFamilyStack("nope")).toBe(defaultOption!.cssStack);
  });

  it("falls back to the default option's stack for null/undefined", () => {
    const defaultOption = FONT_FAMILIES.find(
      (f) => f.id === DEFAULT_FONT_FAMILY_ID,
    );
    expect(resolveFontFamilyStack(null)).toBe(defaultOption!.cssStack);
    expect(resolveFontFamilyStack(undefined)).toBe(defaultOption!.cssStack);
  });
});

import { describe, expect, it } from "vitest";
import {
  formatShortcut,
  hasOnlyShortcutModifier,
  hasShortcutModifier,
  isApplePlatform,
  shortcutParts,
} from "./keyboard-shortcuts";

describe("keyboard shortcuts", () => {
  it("detects Apple platforms from navigator-style platform strings", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("iPad")).toBe(true);
    expect(isApplePlatform("Linux x86_64")).toBe(false);
    expect(isApplePlatform("Win32")).toBe(false);
  });

  it("formats the primary modifier for the current platform", () => {
    expect(formatShortcut("Mod + Shift + T", "Linux x86_64")).toBe("Ctrl + Shift + T");
    expect(formatShortcut("Mod + Shift + T", "MacIntel")).toBe("Cmd + Shift + T");
    expect(shortcutParts("Mod + Enter", "MacIntel")).toEqual(["Cmd", "Enter"]);
  });

  it("matches the platform primary modifier", () => {
    const ctrlEvent = {
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    };
    const metaEvent = {
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
    };

    expect(hasShortcutModifier(ctrlEvent, "Linux x86_64")).toBe(true);
    expect(hasShortcutModifier(metaEvent, "Linux x86_64")).toBe(false);
    expect(hasShortcutModifier(ctrlEvent, "MacIntel")).toBe(false);
    expect(hasShortcutModifier(metaEvent, "MacIntel")).toBe(true);
  });

  it("matches exact modifier combinations", () => {
    expect(
      hasOnlyShortcutModifier(
        { altKey: false, ctrlKey: true, metaKey: false, shiftKey: true },
        { shift: true },
        "Linux x86_64",
      ),
    ).toBe(true);
    expect(
      hasOnlyShortcutModifier(
        { altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
        { shift: true },
        "Linux x86_64",
      ),
    ).toBe(false);
  });
});

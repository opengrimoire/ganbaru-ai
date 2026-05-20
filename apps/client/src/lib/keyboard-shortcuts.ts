export const SHORTCUT_MODIFIER_TOKEN = "Mod";

export interface KeyboardModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface ShortcutModifierOptions {
  shift?: boolean;
}

function currentPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

export function isApplePlatform(platform: string = currentPlatform()): boolean {
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

export function shortcutModifierLabel(platform: string = currentPlatform()): "Ctrl" | "Cmd" {
  return isApplePlatform(platform) ? "Cmd" : "Ctrl";
}

export function shortcutParts(
  shortcut: string,
  platform: string = currentPlatform(),
): string[] {
  const modLabel = shortcutModifierLabel(platform);
  return shortcut.split(" + ").map((part) =>
    part === SHORTCUT_MODIFIER_TOKEN ? modLabel : part,
  );
}

export function formatShortcut(
  shortcut: string,
  platform: string = currentPlatform(),
): string {
  return shortcutParts(shortcut, platform).join(" + ");
}

export function hasShortcutModifier(
  event: Pick<KeyboardModifierState, "ctrlKey" | "metaKey">,
  platform: string = currentPlatform(),
): boolean {
  return isApplePlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export function hasOnlyShortcutModifier(
  event: KeyboardModifierState,
  options: ShortcutModifierOptions = {},
  platform: string = currentPlatform(),
): boolean {
  return hasShortcutModifier(event, platform)
    && !event.altKey
    && event.shiftKey === (options.shift ?? false);
}

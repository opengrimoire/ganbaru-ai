// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguagePreference } from "$lib/i18n/translator.svelte";
import { createNotesDesignCover, createNotesLocalFilePageCover } from "$lib/notes/page-cover";
import type { NotesPageCoverAssetMetadata } from "$lib/notes/page-cover";
import type { NotesPageCover } from "$lib/notes/types";
import NotesPageCoverMenu from "./NotesPageCoverMenu.svelte";

const images = vi.hoisted(() => ({ pick: vi.fn(), save: vi.fn() }));
const preferences = vi.hoisted(() => ({ values: new Map<string, unknown>(), save: vi.fn() }));
vi.mock("$lib/vault/config", () => ({
  ensureConfigLoaded: async () => {},
  getConfigKey: (key: string, fallback: unknown) => preferences.values.get(key) ?? fallback,
  setConfigKey: preferences.save,
}));
vi.mock("$lib/api/notes-page-covers", () => ({
  pickNotesPageCoverImageFile: images.pick,
  saveNotesPageCoverImageDataUrl: images.save,
  notesPageCoverAssetUrl: vi.fn(async () => "data:image/png;base64,preview"),
}));
const asset: NotesPageCoverAssetMetadata = {
  relativePath: `notes/page-covers/${"a".repeat(64)}.png`, originalName: "image.png",
  contentType: "image/png", byteSize: 42, sha256: "a".repeat(64),
};
let component: ReturnType<typeof mount> | undefined;
beforeEach(async () => {
  await setLanguagePreference("en", { persist: false });
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
  preferences.values.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Find a visible action by its accessible label or localized text. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.getAttribute("aria-label") === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Missing cover action: ${label}`);
  return found;
}

/** Mount one page's picker with a focus-return target. */
async function open(onSelect = vi.fn(async (_cover: NotesPageCover | null) => {}), cover: NotesPageCover | null = createNotesDesignCover("contours", 4)) {
  const trigger = document.createElement("button");
  const onClose = vi.fn();
  document.body.append(trigger);
  component = mount(NotesPageCoverMenu, { target: document.body, props: { cover, trigger, onSelect, onClose } });
  await tick();
  return { trigger, onSelect, onClose };
}

describe("Notes cover selection", () => {
  it("applies a design on selection with removal in the header and no preview or confirmation footer", async () => {
    const { onSelect, onClose } = await open();
    expect(document.querySelector('[aria-label="Cover preview"]')).toBeNull();
    const referencedShapes = [...document.querySelectorAll<SVGUseElement>("svg use")];
    expect(referencedShapes.length).toBeGreaterThan(0);
    for (const shape of referencedShapes) {
      const reference = shape.getAttribute("href");
      expect(reference?.startsWith("#")).toBe(true);
      const definition = document.getElementById(reference!.slice(1));
      expect(definition).not.toBeNull();
      expect(shape.ownerSVGElement?.contains(definition)).toBe(true);
    }
    expect([...document.querySelectorAll("button")].some((entry) => ["Apply", "Cancel", "Close"].includes(entry.textContent?.trim() ?? ""))).toBe(false);
    expect(button("Remove").parentElement?.querySelector('[role="tablist"]')).not.toBeNull();
    const nature = button("Nature");
    expect(nature.querySelector("linearGradient, radialGradient")).toBeNull();
    nature.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(createNotesDesignCover("botanical", 4));
    expect(images.save).not.toHaveBeenCalled();
  });

  it("uses the shared color palette to recolor the existing design immediately and keeps the picker open", async () => {
    const { onSelect, onClose } = await open();
    button("Theme colors").click();
    await tick();
    expect(document.querySelectorAll(".swatch-selected")).toHaveLength(1);
    button("Theme color 1").click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith(createNotesDesignCover("contours", 0)));
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    expect(preferences.save).toHaveBeenCalledWith("notes.coverPicker.defaultColor", 0);
    button("Theme colors").click();
    await tick();
    button("Automatic").click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(createNotesDesignCover("contours", "default")));
  });

  it("offers a color beside the selected design when Ask every time is enabled", async () => {
    preferences.values.set("notes.coverPicker.askEveryTime", true);
    const { onSelect, onClose } = await open();
    await tick();
    button("Studio").click();
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    button("Theme color 8").click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(createNotesDesignCover("studio", 7));
  });

  it("allows retrying a failed immediate save by selecting the design again", async () => {
    const onSelect = vi.fn(async (_cover: NotesPageCover | null) => {}).mockRejectedValueOnce(new Error("Storage unavailable"));
    const { onClose } = await open(onSelect);
    button("Grid").click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable"));
    expect(onClose).not.toHaveBeenCalled();
    button("Grid").click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("uses the icon upload panel and immediately applies a chosen image", async () => {
    images.pick.mockResolvedValueOnce(asset);
    const { onSelect, onClose } = await open();
    button("Upload").click();
    await tick();
    button("Upload an image").click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(createNotesLocalFilePageCover(asset));
    expect(document.querySelector("img")).toBeNull();
  });

  it("ignores file selection after Escape closes the page's picker", async () => {
    let finish: ((value: NotesPageCoverAssetMetadata) => void) | undefined;
    images.pick.mockReturnValueOnce(new Promise<NotesPageCoverAssetMetadata>((resolve) => { finish = resolve; }));
    const { trigger, onSelect, onClose } = await open();
    button("Upload").click();
    await tick();
    button("Upload an image").click();
    await tick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    finish?.(asset);
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies image focal edits without a separate confirmation", async () => {
    const { onSelect, onClose } = await open(vi.fn(async (_cover: NotesPageCover | null) => {}), createNotesLocalFilePageCover(asset));
    button("Reposition image").click();
    await tick();
    const position = document.querySelector<HTMLButtonElement>('button[aria-label^="Select the subject"]')!;
    position.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "file", focal_point: { x: 0.52, y: 0.5 } }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

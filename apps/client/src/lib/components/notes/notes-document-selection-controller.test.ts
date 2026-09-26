// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { createBlockWrite } from "$lib/notes/block-factory";
import type { NotesBlock } from "$lib/notes/types";
import { createNotesDocumentSelectionController } from "./notes-document-selection-controller.svelte";
import { createNotesBlockSelectionController } from "./notes-block-selection-controller.svelte";
import { createNotesBlockNavigationController } from "./notes-block-navigation-controller";

/** Mount real selection listeners on independent editing hosts. */
function harness(count = 3, type: NotesBlock["type"] = "paragraph") {
  const ids = Array.from({ length: count }, (_, index) => `block-${index}`);
  const blocks = new Map(ids.map((id) => [id, {
    ...createBlockWrite(id, type, id), object: "block", parent: { type: "page_id", page_id: "page" },
    created_time: "", last_edited_time: "", has_children: false, in_trash: false,
    source_provider: null, source_object_id: null, source_last_edited_time: null,
  } as NotesBlock]));
  const list = document.createElement("div");
  list.innerHTML = ids.map((id) => `<div data-notes-selectable-block-id="${id}"><div role="textbox" contenteditable="true" data-notes-block-id="${id}">${id}</div></div>`).join("");
  document.body.append(list);
  const replace = vi.fn(async () => undefined);
  const hydrate = vi.fn(async () => undefined);
  const focus = vi.fn();
  const indent = vi.fn(async () => undefined);
  const navigation = createNotesBlockNavigationController({
    readListElement: () => list, readRenderedBlockIds: () => ids,
    readBlock: (id) => blocks.get(id), requestFocus: focus,
  });
  const focusRow = vi.fn();
  const blockSelection = createNotesBlockSelectionController({
    undo: vi.fn(async () => true), redo: vi.fn(async () => true),
    readPageId: () => "page", readListElement: () => list, readRenderedBlockIds: () => ids,
    readTreeState: () => ({ blocksById: Object.fromEntries(blocks), childIdsByParentId: { page: ids } }),
    blockIdFromEvent: navigation.blockIdFromEvent, targetIsEditable: navigation.targetIsEditable,
    targetIsSelectionZone: navigation.targetIsSelectionZone, focusTextEditorAtEnd: navigation.focusTextEditorAtEnd,
    focusRow, handleNavigationKeydown: navigation.handleKeydown,
    pasteBlocks: async () => null, duplicateBlocks: async () => null,
    moveBlocks: async () => undefined, deleteBlocks: async () => undefined,
  });
  const blockDelegates = blockSelection.delegation(list);
  const controller = createNotesDocumentSelectionController({
    readIds: () => ids, readPageId: () => "page", readBlock: (id) => blocks.get(id),
    hydrate, replace, indent, format: vi.fn(async () => undefined), focus, clearBlockSelection: () => blockSelection.setSelection(null),
    undo: vi.fn(async () => true), redo: vi.fn(async () => true),
  });
  const attached = controller.delegation(list);
  const editor = (index: number) => list.querySelector<HTMLElement>(`[data-notes-block-id="${ids[index]}"]`)!;
  const key = (index: number, key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
    editor(index).dispatchEvent(event);
    return event;
  };
  return { controller, blockSelection, focusRow, replace, indent, hydrate, focus, blocks, ids, editor, key,
    destroy() { attached.destroy(); blockDelegates.destroy(); },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "caretPositionFromPoint"); document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); });

describe("Notes document selection", () => {
  it.each(["paragraph", "numbered_list_item", "bulleted_list_item", "to_do"] as const)(
    "places a caret near a padding or marker click in a %s row without selecting the block",
    async (type) => {
      const h = harness(3, type);
      const root = h.editor(1);
      const row = root.parentElement!;
      const marker = document.createElement("span");
      marker.textContent = "2.";
      row.prepend(marker);
      vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(30, 20, 100, 60));
      const hit = vi.fn((x: number, y: number) => x >= 30 && x < 130 && y >= 20 && y < 80
        ? { offsetNode: root.firstChild, offset: x < 50 ? 4 : 7 } : null);
      Object.defineProperty(document, "caretPositionFromPoint", { configurable: true, value: hit });
      h.blockSelection.setSelection({ anchorBlockId: h.ids[0], focusBlockId: h.ids[0], selectedBlockIds: [h.ids[0]] });
      for (const [target, x, expected] of [[marker, 10, 4], [row, 150, 7]] as const) {
        const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 65 });
        target.dispatchEvent(event);
        await tick();
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(root);
        expect(window.getSelection()?.focusNode).toBe(root.firstChild);
        expect(window.getSelection()?.focusOffset).toBe(expected);
        expect(h.focus).toHaveBeenLastCalledWith({ blockId: h.ids[1], offset: expected }, true);
        expect(window.getSelection()?.isCollapsed).toBe(true);
        expect(h.blockSelection.selection).toBeNull();
        expect(row.hasAttribute("data-notes-block-selected")).toBe(false);
        expect(h.focusRow).not.toHaveBeenCalled();
      }
      h.key(1, "ArrowDown", { shiftKey: true });
      await tick();
      expect(h.controller.selection?.focus.blockId).toBe(h.ids[2]);
      expect(h.blockSelection.selection).toBeNull();
      h.destroy();
    },
  );

  it("extends text from a row margin with Shift-click and dragging, including within one editor", async () => {
    const h = harness();
    let hitIndex = 1;
    let offset = 2;
    Object.defineProperty(document, "caretPositionFromPoint", { configurable: true,
      value: () => ({ offsetNode: h.editor(hitIndex).firstChild, offset }),
    });
    window.getSelection()?.collapse(h.editor(0).firstChild, 1);
    h.editor(1).parentElement!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
    expect(h.controller.selection).toEqual({ anchor: { blockId: h.ids[0], offset: 1 }, focus: { blockId: h.ids[1], offset: 2 } });
    h.editor(1).parentElement!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    offset = 5;
    h.editor(1).dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, buttons: 1 }));
    expect(window.getSelection()?.toString()).toBe("ock");
    hitIndex = 2;
    offset = 4;
    // Pointer capture can keep the original target while the hit moves into another row.
    h.editor(1).parentElement!.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, buttons: 1 }));
    expect(h.controller.selection).toEqual({ anchor: { blockId: h.ids[1], offset: 2 }, focus: { blockId: h.ids[2], offset: 4 } });
    expect(h.blockSelection.selection).toBeNull();
    await tick();
    h.destroy();
  });

  it("focuses an empty row when its padding has no browser caret hit", () => {
    const h = harness();
    const root = h.editor(1);
    root.replaceChildren();
    const block = h.blocks.get(h.ids[1])!;
    h.blocks.set(block.id, { ...block, ...createBlockWrite(block.id, "paragraph", "") } as NotesBlock);
    root.parentElement!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    expect(document.activeElement).toBe(root);
    expect(window.getSelection()?.focusNode).toBe(root);
    expect(window.getSelection()?.focusOffset).toBe(0);
    expect(h.focus).toHaveBeenLastCalledWith({ blockId: h.ids[1], offset: 0 }, true);
    expect(h.blockSelection.selection).toBeNull();
    h.destroy();
  });

  it("leaves row controls to their own pointer handlers even when a block was selected", () => {
    const h = harness();
    for (const tag of ["button", "input", "select", "a"]) {
      const control = document.createElement(tag);
      h.editor(1).parentElement!.append(control);
      h.blockSelection.setSelection({ anchorBlockId: h.ids[0], focusBlockId: h.ids[0], selectedBlockIds: [h.ids[0]] });
      const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, shiftKey: true });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(h.blockSelection.selection).toBeNull();
      expect(h.controller.selection).toBeNull();
      expect(h.focusRow).not.toHaveBeenCalled();
    }
    h.destroy();
  });

  it.each(["paragraph", "numbered_list_item", "bulleted_list_item", "to_do"] as const)(
    "excludes the untouched endpoint row when indenting a keyboard selection in %s blocks",
    async (type) => {
      const h = harness(4, type);
      for (const backward of [false, true]) {
        h.controller.clear();
        const origin = backward ? 3 : 1;
        window.getSelection()?.collapse(h.editor(origin).firstChild, 0);
        if (backward) {
          await h.controller.select({ anchor: { blockId: h.ids[3], offset: 0 }, focus: { blockId: h.ids[1], offset: 0 } });
        } else {
          h.key(origin, "ArrowDown", { shiftKey: true });
          await tick();
          h.key(origin, "ArrowDown", { shiftKey: true });
          await tick();
        }
        const selected = h.controller.selection;
        expect(selected).toEqual({
          anchor: { blockId: h.ids[origin], offset: 0 },
          focus: { blockId: h.ids[backward ? 1 : 3], offset: 0 },
        });
        h.key(origin, "Tab");
        await vi.waitFor(() => expect(h.indent).toHaveBeenLastCalledWith(h.ids.slice(1, 3), "nest", selected));
        h.key(origin, "Tab", { shiftKey: true });
        await vi.waitFor(() => expect(h.indent).toHaveBeenLastCalledWith(h.ids.slice(1, 3), "outdent", selected));
        expect(h.controller.selection).toEqual(selected);
        const setData = vi.fn();
        const copy = new Event("copy", { bubbles: true, cancelable: true });
        Object.defineProperty(copy, "clipboardData", { value: { setData } });
        h.editor(origin).dispatchEvent(copy);
        expect(setData).toHaveBeenCalledWith("text/plain", "block-1\nblock-2\n");
      }
      h.destroy();
    },
  );

  it("contracts across the line break before removing the previous row's last character", async () => {
    const h = harness(4, "numbered_list_item");
    const native = window.getSelection()!;
    await h.controller.select({ anchor: { blockId: h.ids[1], offset: 0 }, focus: { blockId: h.ids[3], offset: 0 } });
    h.key(1, "ArrowLeft", { shiftKey: true });
    await tick();
    expect(h.controller.selection?.focus).toEqual({ blockId: h.ids[2], offset: 7 });
    // jsdom has no Selection.modify. Model the browser's movement inside this text node.
    Object.defineProperty(native, "modify", { configurable: true, value: () => {
      native.collapse(native.focusNode, native.focusOffset - 1);
    } });
    try {
      h.key(1, "ArrowLeft", { shiftKey: true });
      await tick();
      expect(h.controller.selection?.focus).toEqual({ blockId: h.ids[2], offset: 6 });
      const setData = vi.fn();
      const cut = new Event("cut", { bubbles: true, cancelable: true });
      Object.defineProperty(cut, "clipboardData", { value: { setData } });
      h.editor(1).dispatchEvent(cut);
      expect(setData).toHaveBeenCalledWith("text/plain", "block-1\nblock-");
      expect(h.replace).toHaveBeenCalledWith(h.ids.slice(1, 3), 0, 6, "", undefined, {
        anchor: { blockId: h.ids[1], offset: 0 }, focus: { blockId: h.ids[2], offset: 6 },
      });
    } finally {
      Reflect.deleteProperty(native, "modify");
      h.destroy();
    }
  });

  it.each(["Tab", "Unidentified"])("routes Tab and Shift+Tab over the full document selection without moving focus (key: %s)", async (key) => {
    const h = harness();
    window.getSelection()?.collapse(h.editor(1).firstChild, 2);
    h.key(1, "a", { ctrlKey: true });
    await tick();
    const selected = h.controller.selection;
    expect(h.key(1, "Tab").defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(h.indent).toHaveBeenLastCalledWith(h.ids, "nest", selected));
    expect(h.key(1, key, { code: "Tab", shiftKey: true }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(h.indent).toHaveBeenLastCalledWith(h.ids, "outdent", selected));
    expect(h.controller.selection).toEqual(selected);
    h.destroy();
  });

  it("selects the whole document from a text caret, including more than 200 blocks", async () => {
    const h = harness(220);
    window.getSelection()?.collapse(h.editor(1).firstChild, 2);
    expect(h.key(1, "a", { ctrlKey: true }).defaultPrevented).toBe(true);
    await tick();
    expect(h.controller.renderIds).toEqual([]);
    expect(h.controller.selection?.focus.blockId).toBe(h.ids.at(-1));
    expect(window.getSelection()?.anchorNode).toBe(h.editor(0).firstChild);
    expect(window.getSelection()?.focusNode).toBe(h.editor(219).firstChild);
    h.destroy();
  });

  it("paints every text segment even when the native selection stays inside the active editor", async () => {
    class TestHighlight {
      constructor(...ranges: Range[]) { this.ranges = ranges; }
      ranges: Range[];
    }
    const registry = new Map<string, TestHighlight>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", TestHighlight);
    const h = harness();
    const native = window.getSelection()!;
    vi.spyOn(native, "setBaseAndExtent").mockImplementation(() => native.collapse(h.editor(1).firstChild, 2));
    await h.controller.select({ anchor: { blockId: h.ids[0], offset: 6 }, focus: { blockId: h.ids[2], offset: 5 } });
    expect(native.anchorNode).toBe(h.editor(1).firstChild);
    expect([...registry.values()][0].ranges.map((range) => range.toString())).toEqual(["0", "block-1", "block"]);
    h.editor(0).parentElement!.remove();
    h.controller.repaint();
    expect([...registry.values()][0].ranges.map((range) => range.toString())).toEqual(["block-1", "block"]);
    h.controller.clear();
    expect(registry.size).toBe(0);
    expect(document.querySelector("[data-notes-painted-selection]")).toBeNull();
    h.destroy();
  });

  it("repaints and edits the complete restored selection after replacement", async () => {
    class TestHighlight {
      constructor(...ranges: Range[]) { this.ranges = ranges; }
      ranges: Range[];
    }
    const registry = new Map<string, TestHighlight>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", TestHighlight);
    const h = harness();
    h.key(1, "a", { ctrlKey: true });
    const saved = h.controller.selection!;
    await h.controller.replace("");
    expect(registry.size).toBe(0);
    // Undo restores the tree before asking the document controller to restore this range.
    await h.controller.select(saved);
    expect([...registry.values()][0].ranges.map((range) => range.toString())).toEqual(h.ids);
    h.key(0, "X");
    expect(h.replace).toHaveBeenLastCalledWith(h.ids, 0, Number.MAX_SAFE_INTEGER, "X", undefined, saved);
    await tick();
    h.destroy();
  });

  it("keeps selection highlights isolated between open editors and removes them on unmount", () => {
    const registry = new Map<string, object>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", class { constructor(..._ranges: Range[]) {} });
    const first = harness();
    const second = harness();
    first.key(0, "a", { ctrlKey: true });
    second.key(0, "a", { ctrlKey: true });
    expect(registry.size).toBe(2);
    first.destroy();
    expect(registry.size).toBe(1);
    second.destroy();
    expect(registry.size).toBe(0);
  });

  it("keeps text typed while a whole-page replacement loads its offscreen content", async () => {
    const h = harness();
    const missing = h.blocks.get(h.ids[2])!;
    h.blocks.delete(missing.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.hydrate.mockImplementation(async () => { await gate; h.blocks.set(missing.id, missing); });
    h.key(0, "a", { ctrlKey: true });
    h.key(0, "X");
    h.key(0, "Y");
    await tick();
    release();
    await vi.waitFor(() => expect(h.replace).toHaveBeenCalledWith(h.ids, 0, Number.MAX_SAFE_INTEGER, "XY", undefined, { anchor: { blockId: h.ids[0], offset: 0 }, focus: { blockId: h.ids[h.ids.length - 1], offset: Number.MAX_SAFE_INTEGER } }));
    h.destroy();
  });

  it("does not let a cancelled hydration discard typing for a newer selection", async () => {
    const h = harness();
    const missing = h.blocks.get(h.ids[2])!;
    h.blocks.delete(missing.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.hydrate.mockImplementation(async () => { await gate; h.blocks.set(missing.id, missing); });
    h.key(0, "a", { ctrlKey: true });
    h.key(0, "X");
    await vi.waitFor(() => expect(h.hydrate).toHaveBeenCalled());
    h.controller.clear();
    h.key(0, "a", { ctrlKey: true });
    h.key(0, "Y");
    h.key(0, "Z");
    release();
    await vi.waitFor(() => expect(h.replace).toHaveBeenCalledExactlyOnceWith(h.ids, 0, Number.MAX_SAFE_INTEGER, "YZ", undefined, { anchor: { blockId: h.ids[0], offset: 0 }, focus: { blockId: h.ids[h.ids.length - 1], offset: Number.MAX_SAFE_INTEGER } }));
    h.destroy();
  });

  it("moves the caret across block edges and navigates to the complete document boundary", () => {
    const h = harness();
    window.getSelection()?.collapse(h.editor(1).firstChild, 0);
    expect(h.key(1, "ArrowLeft").defaultPrevented).toBe(true);
    expect(h.focus).toHaveBeenLastCalledWith({ blockId: h.ids[0], offset: Number.MAX_SAFE_INTEGER });
    expect(h.key(1, "End", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(h.focus).toHaveBeenLastCalledWith({ blockId: h.ids[2], offset: Number.MAX_SAFE_INTEGER });
    h.destroy();
  });

  it("extends backwards across an editing host boundary without rounding to whole blocks", async () => {
    const h = harness();
    window.getSelection()?.collapse(h.editor(1).firstChild, 0);
    h.key(1, "ArrowLeft", { shiftKey: true });
    await tick(); await tick(); await tick();
    expect(h.controller.selection).toEqual({
      anchor: { blockId: h.ids[1], offset: 0 }, focus: { blockId: h.ids[0], offset: 7 },
    });
    h.destroy();
  });

  it("extends to the document boundary and replaces a reverse partial range", async () => {
    const h = harness();
    window.getSelection()?.collapse(h.editor(1).firstChild, 3);
    h.key(1, "Home", { ctrlKey: true, shiftKey: true });
    await tick();
    h.key(1, "X");
    expect(h.replace).toHaveBeenCalledWith(h.ids.slice(0, 2), 0, 3, "X", undefined, { anchor: { blockId: h.ids[1], offset: 3 }, focus: { blockId: h.ids[0], offset: 0 } });
    await tick();
    expect(h.controller.selection).toBeNull();
    h.destroy();
  });

  it("keeps the original text anchor when Shift-clicking another editor", async () => {
    const h = harness();
    window.getSelection()?.collapse(h.editor(0).firstChild, 2);
    Object.defineProperty(document, "caretPositionFromPoint", { configurable: true, value: () => ({ offsetNode: h.editor(2).firstChild, offset: 4 }) });
    h.editor(2).dispatchEvent(new MouseEvent("pointerdown", { button: 0, shiftKey: true, bubbles: true, cancelable: true }));
    expect(h.controller.selection).toEqual({ anchor: { blockId: h.ids[0], offset: 2 }, focus: { blockId: h.ids[2], offset: 4 } });
    h.destroy();
  });

  it("retains partial endpoints while dragging across editing hosts", () => {
    const h = harness();
    let target = 0;
    Object.defineProperty(document, "caretPositionFromPoint", { configurable: true, value: () => ({ offsetNode: h.editor(target).firstChild, offset: target === 0 ? 2 : 4 }) });
    h.editor(0).dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));
    target = 2;
    h.editor(2).dispatchEvent(new MouseEvent("pointermove", { buttons: 1, bubbles: true, cancelable: true }));
    expect(h.controller.selection).toEqual({ anchor: { blockId: h.ids[0], offset: 2 }, focus: { blockId: h.ids[2], offset: 4 } });
    h.destroy();
  });

  it("commits composed text once for the entire range instead of saving the temporary host text", async () => {
    const h = harness();
    await h.controller.select({ anchor: { blockId: h.ids[0], offset: 2 }, focus: { blockId: h.ids[2], offset: 4 } });
    const restoreSelection = vi.spyOn(window.getSelection()!, "setBaseAndExtent");
    h.editor(0).dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    h.controller.repaint();
    expect(restoreSelection).not.toHaveBeenCalled();
    h.editor(0).dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertCompositionText", data: "に", isComposing: true }));
    expect(h.replace).not.toHaveBeenCalled();
    h.editor(0).dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    expect(h.replace).toHaveBeenCalledExactlyOnceWith(h.ids, 2, 4, "日本", undefined, { anchor: { blockId: h.ids[0], offset: 2 }, focus: { blockId: h.ids[2], offset: 4 } });
    h.destroy();
  });

  it("copies partial endpoints with line separators and removes listeners on destroy", async () => {
    const h = harness();
    await h.controller.select({ anchor: { blockId: h.ids[0], offset: 6 }, focus: { blockId: h.ids[2], offset: 5 } });
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    h.editor(0).dispatchEvent(event);
    expect(setData).toHaveBeenCalledWith("text/plain", "0\nblock-1\nblock");
    h.destroy();
    expect(h.key(0, "a", { ctrlKey: true }).defaultPrevented).toBe(false);
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { attachNotesBlockSelectionDelegates, createNotesBlockSelectionController } from "./notes-block-selection-controller.svelte";

describe("Notes block selection controller", () => {
  it("removes delegated listeners when the list action is destroyed", () => {
    const node = document.createElement("div");
    const pointerDown = vi.fn();
    const pointerOver = vi.fn();
    const keydown = vi.fn();
    const action = attachNotesBlockSelectionDelegates(node, { pointerDown, pointerOver, keydown });

    node.dispatchEvent(new Event("pointerdown"));
    node.dispatchEvent(new Event("pointerover"));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect([pointerDown, pointerOver, keydown].map((handler) => handler.mock.calls.length))
      .toEqual([1, 1, 1]);

    action.destroy();
    node.dispatchEvent(new Event("pointerdown"));
    node.dispatchEvent(new Event("pointerover"));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect([pointerDown, pointerOver, keydown].map((handler) => handler.mock.calls.length))
      .toEqual([1, 1, 1]);
  });
});

/** Builds a rendered list with contenteditable blocks and selectable margins. */
function selectionHarness() {
  const list = document.createElement("div");
  list.innerHTML = ["first", "second", "third"].map((id) => `<div data-notes-selectable-block-id="${id}" data-notes-block-selection-zone><div contenteditable="true">${id}</div></div>`).join("");
  const row = (id: string) => list.querySelector<HTMLElement>(`[data-notes-selectable-block-id="${id}"]`)!;
  const undo = vi.fn(async () => true);
  const controller = createNotesBlockSelectionController({
    undo, redo: vi.fn(async () => true), readPageId: () => "page", readListElement: () => list,
    readRenderedBlockIds: () => ["first", "second", "third"],
    readTreeState: () => ({ blocksById: {}, childIdsByParentId: {} }),
    blockIdFromEvent: (event) => event.target instanceof Element ? event.target.closest<HTMLElement>("[data-notes-selectable-block-id]")?.dataset.notesSelectableBlockId ?? null : null,
    targetIsEditable: (target) => target instanceof Element && target.closest("[contenteditable]") !== null,
    targetIsSelectionZone: () => true, focusTextEditorAtEnd: () => true,
    focusRow: vi.fn(), handleNavigationKeydown: () => false,
    pasteBlocks: async () => null, duplicateBlocks: async () => null,
    moveBlocks: async () => undefined, deleteBlocks: async () => undefined,
  });
  const delegates = controller.delegation(list);
  const pointer = (target: HTMLElement, type: string, shiftKey = false) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, shiftKey });
    Object.defineProperty(event, "pointerId", { value: 1 });
    target.dispatchEvent(event);
  };
  return { controller, row, pointer, undo, destroy: delegates.destroy };
}

describe("Notes block selection gestures", () => {
  it("selects a margin range and supports select all and undo from a focused row", () => {
    const h = selectionHarness();
    h.pointer(h.row("first"), "pointerdown");
    h.pointer(h.row("third"), "pointerdown", true);
    expect(h.controller.selection?.selectedBlockIds).toEqual(["first", "second", "third"]);
    h.row("third").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "z", ctrlKey: true }));
    expect(h.undo).toHaveBeenCalledOnce();
    expect(h.controller.selection).toBeNull();
    h.row("first").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a", ctrlKey: true }));
    expect(h.controller.selection?.selectedBlockIds).toEqual(["first", "second", "third"]);
    h.destroy();
  });

  it("leaves text drags to the document selection controller", () => {
    const h = selectionHarness();
    h.pointer(h.row("first").firstElementChild as HTMLElement, "pointerdown");
    h.pointer(h.row("first"), "pointerover");
    expect(h.controller.selection).toBeNull();
    h.pointer(h.row("second"), "pointerover");
    expect(h.controller.selection).toBeNull();
    h.destroy();
  });
});

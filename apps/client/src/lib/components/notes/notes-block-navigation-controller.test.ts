// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotesBlock } from "$lib/notes/types";
import { createNotesBlockNavigationController } from "./notes-block-navigation-controller";

function paragraph(id: string): NotesBlock {
  return {
    object: "block",
    id,
    parent: { type: "page_id", page_id: "page-1" },
    created_time: "2026-01-01T00:00:00Z",
    last_edited_time: "2026-01-01T00:00:00Z",
    has_children: false,
    in_trash: false,
    type: "paragraph",
    source_provider: null,
    source_object_id: null,
    source_last_edited_time: null,
    paragraph: { rich_text: [], color: "default" },
  };
}

function mockRangeGeometry(rect: DOMRect, rects: DOMRectList): void {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => rects,
  });
}

describe("Notes block navigation controller", () => {
  it("does not inherit a containing layout's block-selection zone into a text row", () => {
    const list = document.createElement("div");
    list.innerHTML = `<div data-notes-selectable-block-id="layout" data-notes-block-selection-zone>
      <div data-notes-selectable-block-id="text"><span class="marker">1.</span></div>
    </div>`;
    const controller = createNotesBlockNavigationController({
      readListElement: () => list, readRenderedBlockIds: () => [], readBlock: () => undefined, requestFocus: vi.fn(),
    });
    expect(controller.targetIsSelectionZone(list.firstElementChild)).toBe(true);
    expect(controller.targetIsSelectionZone(list.querySelector(".marker"))).toBe(false);
  });

  afterEach(() => {
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it("moves from the last visual position of one editor to the next rendered block", () => {
    mockRangeGeometry({
      width: 0,
      height: 0,
    } as DOMRect, [] as unknown as DOMRectList);
    const list = document.createElement("div");
    list.innerHTML = `
      <div data-notes-selectable-block-id="first"><div contenteditable="true" role="textbox" data-notes-block-id="first">a</div></div>
      <div data-notes-selectable-block-id="second"><div contenteditable="true" role="textbox" data-notes-block-id="second"></div></div>
    `;
    document.body.append(list);
    const editor = list.querySelector<HTMLElement>("[data-notes-block-id='first']")!;
    const text = editor.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const requestFocus = vi.fn();
    const blocks = new Map([
      ["first", paragraph("first")],
      ["second", paragraph("second")],
    ]);
    const controller = createNotesBlockNavigationController({
      readListElement: () => list,
      readRenderedBlockIds: () => ["first", "second"],
      readBlock: (id) => blocks.get(id),
      requestFocus,
    });
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: editor });
    expect(controller.handleKeydown(event, "first")).toBe(true);
    expect(requestFocus).toHaveBeenCalledWith("second", { start: 0, end: 0 });
  });

  it("keeps an arrow key within a wrapped block before the last visual line", () => {
    mockRangeGeometry({
      top: 100,
      left: 40,
      width: 0,
      height: 18,
    } as DOMRect, [
      { top: 100, bottom: 118, left: 40, right: 160, width: 120, height: 18 },
      { top: 120, bottom: 138, left: 40, right: 100, width: 60, height: 18 },
    ] as unknown as DOMRectList);
    const list = document.createElement("div");
    list.innerHTML = `
      <div data-notes-selectable-block-id="first"><div contenteditable="true" role="textbox" data-notes-block-id="first">ab</div></div>
      <div data-notes-selectable-block-id="second"><div contenteditable="true" role="textbox" data-notes-block-id="second"></div></div>
    `;
    document.body.append(list);
    const editor = list.querySelector<HTMLElement>("[data-notes-block-id='first']")!;
    const range = document.createRange();
    range.setStart(editor.firstChild!, 1);
    range.collapse(true);
    document.getSelection()?.addRange(range);
    const requestFocus = vi.fn();
    const controller = createNotesBlockNavigationController({
      readListElement: () => list,
      readRenderedBlockIds: () => ["first", "second"],
      readBlock: (id) => id === "first" || id === "second" ? paragraph(id) : undefined,
      requestFocus,
    });
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: editor });
    expect(controller.handleKeydown(event, "first")).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(requestFocus).not.toHaveBeenCalled();
  });
});

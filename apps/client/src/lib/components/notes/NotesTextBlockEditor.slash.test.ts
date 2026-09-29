// @vitest-environment jsdom
import { mount, tick, unmount, type ComponentProps } from "svelte";
import { fromStore, writable } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyBlockUpdate, createBlockUpdate, createBlockWrite } from "$lib/notes/block-factory";
import { notesTextSelectionFromEditableRoot, restoreNotesEditableSelection } from "$lib/notes/editor-selection";
import { EMPTY_NOTES_BUTTON_BLOCK_STATUS } from "$lib/notes/button-block";
import { EMPTY_NOTES_TEMPLATE_BLOCK_STATUS } from "$lib/notes/template-block";
import type { NotesBlock, NotesBlockType } from "$lib/notes/types";
import NotesTextBlockEditor from "./NotesTextBlockEditor.svelte";
import { createNotesBlockSelectionController } from "./notes-block-selection-controller.svelte";

let component: ReturnType<typeof mount> | undefined;
let releaseDelegates: (() => void) | undefined;
afterEach(async () => {
  releaseDelegates?.();
  releaseDelegates = undefined;
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
});

/** Use a reactive block to exercise the real input, lazy menu, and conversion path. */
async function editor(blockType: NotesBlockType = "paragraph", text = "", indentationDepth = 0, initialFocusBlockId = "block") {
  const block: NotesBlock = {
    ...createBlockWrite("block", blockType, text), object: "block", parent: { type: "page_id", page_id: "page" },
    created_time: "", last_edited_time: "", has_children: false, in_trash: false,
    source_provider: null, source_object_id: null, source_last_edited_time: null,
  } as NotesBlock;
  const blocks = writable(block);
  const current = fromStore(blocks);
  const onConvert = vi.fn();
  const onTextInput = vi.fn((_id: string, value: string) => blocks.update((block) => applyBlockUpdate(block, createBlockUpdate(block.type, value))));
  const onKeyboardAction = vi.fn();
  const onFocusBlock = vi.fn();
  const readMentionTargets = vi.fn(() => []);
  const releaseMentionTargets = vi.fn();
  const acquireMentionTargets = vi.fn(() => releaseMentionTargets);
  const onPasteRichHtml = vi.fn((_id: string, _start: number, _end: number, _html: string) => false);
  const props: ComponentProps<typeof NotesTextBlockEditor> = {
    get block() { return current.current; }, previousBlockType: null, isOnlyBlock: true, indentationDepth,
    focusBlockId: initialFocusBlockId, focusRequestId: 1, focusSelection: { start: 0, end: 0 },
    mentionTargets: { read: readMentionTargets, acquire: acquireMentionTargets }, commentAnchors: [], suggestionAnchors: [],
    templateStatus: EMPTY_NOTES_TEMPLATE_BLOCK_STATUS, buttonStatus: EMPTY_NOTES_BUTTON_BLOCK_STATUS,
    onTextInput,
    onConvert, onReplaceRichText: vi.fn(), onInsertPageMention: vi.fn(), onInsertDateMention: vi.fn(),
    onInsertObjectMention: vi.fn(), onApplyTextLink: vi.fn(), onInsertInlineEquation: vi.fn(),
    onPastePlainText: () => false, onPasteRichHtml, onApplyTextAnnotations: vi.fn(),
    onCreateInlineComment: vi.fn(), onCreateInlineSuggestion: vi.fn(), onKeyboardAction,
    onUndo: vi.fn(), onRedo: vi.fn(), onAddBelow: vi.fn(), onConvertToToggleHeading: vi.fn(),
    onColorChange: vi.fn(), onCopyLink: vi.fn(), onDuplicate: vi.fn(), onUseTemplate: vi.fn(),
    onAddTemplateChild: vi.fn(), onUseButton: vi.fn(), onAddButtonChild: vi.fn(), onButtonIconChange: vi.fn(),
    onButtonInsertPositionChange: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onDelete: vi.fn(),
    onToggleOpen: vi.fn(), onCodeLanguageChange: vi.fn(), onFocusBlock,
  };
  const list = document.createElement("div");
  const row = document.createElement("div");
  row.dataset.notesSelectableBlockId = "block";
  row.tabIndex = -1;
  list.append(row);
  document.body.append(list);
  const focusRow = vi.fn(() => row.focus());
  const navigationKeydown = vi.fn(() => false);
  const blockSelection = createNotesBlockSelectionController({
    hydrateSubtrees: async (ids) => ids,
    readPageId: () => "page", readListElement: () => list, readRenderedBlockIds: () => ["block"],
    readTreeState: () => ({ blocksById: {}, childIdsByParentId: {} }),
    blockIdFromEvent: () => "block",
    targetIsEditable: (target) => target instanceof Element && !!target.closest('[contenteditable="true"]'),
    targetIsSelectionZone: () => false, focusTextEditorAtEnd: () => true, focusRow,
    handleNavigationKeydown: navigationKeydown, undo: async () => false, redo: async () => false,
    pasteBlocks: async () => null, duplicateBlocks: async () => null,
    moveBlocks: async () => undefined, deleteBlocks: async () => undefined,
  });
  releaseDelegates = blockSelection.delegation(list).destroy;
  component = mount(NotesTextBlockEditor, { target: row, props });
  await tick(); await tick();
  const host = document.querySelector<HTMLElement>('[role="textbox"]')!;
  host.focus();
  const input = async (data: string, inputType = "insertText") => {
    const event = new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true });
    host.dispatchEvent(event);
    await tick(); await tick();
    return event;
  };
  return { host, input, onConvert, onTextInput, onKeyboardAction, onPasteRichHtml, onFocusBlock, row, blockSelection, focusRow, navigationKeydown, readMentionTargets, acquireMentionTargets, releaseMentionTargets };
}

describe("Notes typed slash commands", () => {
  it("reads and acquires mention data only while the mention menu is open", async () => {
    const h = await editor();
    await h.input("Ordinary text ");
    expect(h.readMentionTargets).not.toHaveBeenCalled();
    expect(h.acquireMentionTargets).not.toHaveBeenCalled();
    await h.input("@");
    expect(h.readMentionTargets).toHaveBeenCalled();
    expect(h.acquireMentionTargets).toHaveBeenCalledOnce();
    h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick();
    expect(h.releaseMentionTargets).toHaveBeenCalledOnce();
  });

  it("delegates slash-note clearing to the lifecycle command without an extra paragraph save", async () => {
    const h = await editor();
    await h.input("/Note");
    await vi.waitFor(() => expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1));
    h.onTextInput.mockClear();
    h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(h.onConvert).toHaveBeenCalledExactlyOnceWith("block", "child_page", true);
    expect(h.onTextInput).not.toHaveBeenCalled();
  });

  it("reports native editor focus without requesting viewport scrolling", async () => {
    const h = await editor("paragraph", "Clicked text", 0, "another-block");
    expect(h.onFocusBlock).toHaveBeenCalledExactlyOnceWith("block", true);
  });

  it.each([false, true])("opens and filters through input, then applies a heading (software Enter: %s)", async (softwareEnter) => {
    const h = await editor();
    expect(h.host.hasAttribute("data-placeholder")).toBe(false);
    expect(h.host.hasAttribute("aria-placeholder")).toBe(false);
    await h.input("/");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await h.input("h2");
    await vi.waitFor(() => expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2));
    if (softwareEnter) expect((await h.input("", "insertParagraph")).defaultPrevented).toBe(true);
    else h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(h.onConvert).toHaveBeenCalledExactlyOnceWith("block", "heading_2", true);
    await tick();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("pauses the menu during composition and restores search after the composed query commits", async () => {
    const h = await editor();
    await h.input("/");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    h.host.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await tick();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    h.host.replaceChildren(document.createTextNode("/h2"));
    window.getSelection()?.collapse(h.host.firstChild, 3);
    h.host.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "h2" }));
    await vi.waitFor(() => expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2));
    h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(h.onConvert).toHaveBeenCalledExactlyOnceWith("block", "heading_2", true);
  });

  it("dismisses the slash panel without selecting or focusing the whole block", async () => {
    const h = await editor();
    await h.input("/");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    for (let attempt = 0; attempt < 2; attempt += 1) {
      h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await tick();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(h.blockSelection.selection).toBeNull();
      expect(h.row.hasAttribute("data-notes-block-selected")).toBe(false);
      expect(document.activeElement).toBe(h.host);
      expect(h.focusRow).not.toHaveBeenCalled();
    }
    await h.input("continue");
    expect(h.host.textContent).toBe("/continue");
  });

  it("routes both arrow keys to the slash menu before block navigation", async () => {
    const h = await editor();
    await h.input("/");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const items = menu.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    expect(items.length).toBeGreaterThan(1);
    await vi.waitFor(() => expect(h.host.getAttribute("aria-activedescendant")).toBeTruthy());
    expect(items[0].dataset.active).toBe("true");

    const up = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    h.host.dispatchEvent(up);
    await tick();
    expect(up.defaultPrevented).toBe(true);
    expect(h.navigationKeydown).not.toHaveBeenCalled();
    expect([...items].findIndex((item) => item.dataset.active === "true")).toBe(items.length - 1);
    expect(document.activeElement).toBe(h.host);

    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    h.host.dispatchEvent(down);
    await tick();
    expect(down.defaultPrevented).toBe(true);
    expect(h.navigationKeydown).not.toHaveBeenCalled();
    expect(items[0].dataset.active).toBe("true");
    expect(document.activeElement).toBe(h.host);
  });

  it("retains literal slash text after dismissal and reopens after deleting the trigger", async () => {
    const h = await editor();
    await h.input("/");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await h.input("h");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(h.host.textContent).toBe("/h");
    await h.input("", "deleteContentBackward");
    await h.input("", "deleteContentBackward");
    await h.input("/");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
  });
});

describe("Notes list input", () => {
  it.each(["paragraph", "bulleted_list_item", "numbered_list_item"] as const)("outdents %s before removing markers or text with hardware and software Backspace", async (type) => {
    const h = await editor(type, "Keep text", 3);
    restoreNotesEditableSelection(h.host, { start: 0, end: 0 });
    h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    expect(h.onKeyboardAction).toHaveBeenLastCalledWith("block", { type: "outdent", preventDefault: true, selection: { start: 0, end: 0 } });
    await h.input("", "deleteContentBackward");
    expect(h.onKeyboardAction).toHaveBeenLastCalledWith("block", { type: "outdent", preventDefault: true, selection: { start: 0, end: 0 } });
    expect(h.host.textContent).toBe("Keep text");
  });

  it.each(["Tab", "Unidentified"])("indents and unindents code text without moving its block (key: %s)", async (key) => {
    const h = await editor("code", "value");
    restoreNotesEditableSelection(h.host, { start: 0, end: 0 });
    h.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await tick();
    expect(h.host.textContent).toBe("\tvalue");
    const outdent = new KeyboardEvent("keydown", { key, code: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    h.host.dispatchEvent(outdent);
    expect(outdent.defaultPrevented).toBe(true);
    await tick();
    expect(h.host.textContent).toBe("value");
    expect(h.onKeyboardAction).not.toHaveBeenCalled();
  });

  it.each([false, true])("handles Tab with Shift=%s without browser focus navigation", async (shiftKey) => {
    const h = await editor("bulleted_list_item", "Keep this text");
    restoreNotesEditableSelection(h.host, { start: 2, end: 5 });
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    h.host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.onKeyboardAction).toHaveBeenLastCalledWith("block", {
      type: shiftKey ? "outdent" : "nest", preventDefault: true, selection: { start: 2, end: 5 },
    });
    expect(document.activeElement).toBe(h.host);
    expect(h.focusRow).not.toHaveBeenCalled();
  });

  it.each([
    { type: "paragraph", depth: 0 },
    { type: "paragraph", depth: 3 },
    { type: "bulleted_list_item", depth: 0 },
    { type: "bulleted_list_item", depth: 3 },
    { type: "numbered_list_item", depth: 3 },
  ] as const)("routes WebKitGTK Shift+Tab in $type at depth $depth without moving the caret", async ({ type, depth }) => {
    const h = await editor(type, "Keep this text", depth);
    const selection = { start: 2, end: 5 };
    restoreNotesEditableSelection(h.host, selection);
    const event = new KeyboardEvent("keydown", {
      key: "Unidentified", code: "Tab", shiftKey: true, bubbles: true, cancelable: true,
    });
    h.host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.onKeyboardAction).toHaveBeenCalledExactlyOnceWith("block", {
      type: "outdent", preventDefault: true, selection,
    });
    expect(notesTextSelectionFromEditableRoot(h.host)).toEqual(selection);
    expect(document.activeElement).toBe(h.host);
    expect(h.focusRow).not.toHaveBeenCalled();
    expect(h.host.textContent).toBe("Keep this text");
  });

  it.each(["numbered_list_item", "bulleted_list_item", "to_do"] as const)(
    "removes %s formatting through hardware and software Backspace without deleting text", async (type) => {
      const h = await editor(type, "Keep this text");
      restoreNotesEditableSelection(h.host, { start: 0, end: 0 });
      const key = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
      h.host.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      expect(h.onKeyboardAction).toHaveBeenLastCalledWith("block", { type: "remove_block_format", preventDefault: true });
      h.onKeyboardAction.mockClear();
      const input = await h.input("", "deleteContentBackward");
      expect(input.defaultPrevented).toBe(true);
      expect(h.onKeyboardAction).toHaveBeenCalledExactlyOnceWith("block", { type: "remove_block_format", preventDefault: true });
      expect(h.host.textContent).toBe("Keep this text");
    },
  );

  it("deletes selected list text without stripping its list formatting", async () => {
    const h = await editor("numbered_list_item", "Keep this text");
    restoreNotesEditableSelection(h.host, { start: 0, end: 5 });
    await h.input("", "deleteContentBackward");
    expect(h.onKeyboardAction).not.toHaveBeenCalled();
    expect(h.host.textContent).toBe("this text");
  });
});


describe("Notes native clipboard events", () => {
  it.each(["copy", "cut"])("exports a partial heading as semantic HTML on %s", async (type) => {
    const h = await editor("heading_2", "before selected after");
    restoreNotesEditableSelection(h.host, { start: 7, end: 15 });
    const setData = vi.fn();
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    h.host.dispatchEvent(event);
    await tick();
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", "## selected");
    expect(setData).toHaveBeenCalledWith("text/html", "<h2>selected</h2>");
    expect(h.host.textContent).toBe(type === "cut" ? "before  after" : "before selected after");
  });

  it("retains text when a native cut cannot write the clipboard", async () => {
    const h = await editor("paragraph", "keep this");
    restoreNotesEditableSelection(h.host, { start: 0, end: 9 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const event = new Event("cut", { bubbles: true, cancelable: true });
      h.host.dispatchEvent(event);
      await tick();
      expect(event.defaultPrevented).toBe(true);
      expect(h.host.textContent).toBe("keep this");
      expect(warning).toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });
});


describe("Notes clipboard format routing", () => {
  it("reconciles paired Markdown and HTML headings before passing native paste to the store", async () => {
    const h = await editor();
    h.onPasteRichHtml.mockReturnValue(true);
    restoreNotesEditableSelection(h.host, { start: 0, end: 0 });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: {
      getData: (type: string) => type === "text/plain" ? "# Title" : "<h2>Title</h2>",
    } });
    h.host.dispatchEvent(event);
    await tick();
    expect(event.defaultPrevented).toBe(true);
    expect(h.onPasteRichHtml).toHaveBeenCalledExactlyOnceWith("block", 0, 0, "<h1>Title</h1>");
  });
});

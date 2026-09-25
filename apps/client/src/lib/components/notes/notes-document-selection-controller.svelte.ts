import { notesRichTextFormattingShortcutAnnotationName } from "$lib/notes/rich-text-shortcuts";
import type { NotesRichTextAnnotationName } from "$lib/notes/rich-text";
import { tick } from "svelte";
import { blockPlainText, isTextEditableBlock } from "$lib/notes/block-factory";
import { createNotesDocumentSelectionPainter, findEditableDomPoint, notesEditableOffsetFromDomPoint } from "$lib/notes/editor-selection";
import { notesDocumentRange, type NotesDocumentPoint, type NotesDocumentSelection } from "$lib/notes/editor-selection";
import type { NotesBlock } from "$lib/notes/types";

const EDITOR = "[contenteditable='true'][data-notes-block-id][role='textbox']";
interface DocumentSelectionOptions {
  readIds: () => readonly string[];
  readPageId: () => string;
  readBlock: (id: string) => NotesBlock | undefined;
  hydrate: (ids: readonly string[]) => Promise<void>;
  replace: (ids: readonly string[], start: number, end: number, text: string, html?: string, documentSelection?: NotesDocumentSelection) => Promise<void>;
  format: (ids: readonly string[], start: number, end: number, annotation: NotesRichTextAnnotationName, documentSelection?: NotesDocumentSelection) => Promise<void>;
  focus: (point: NotesDocumentPoint) => void;
  restoreFocusAfterEdit?: () => void;
  clearBlockSelection: () => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
}

/** Own text ranges across block editing hosts before individual editors handle input. */
export function createNotesDocumentSelectionController(options: DocumentSelectionOptions) {
  let selection = $state<NotesDocumentSelection | null>(null);
  let pinnedIds = $state<string[]>([]);
  let error = $state<string | null>(null);
  let menu = $state<{ x: number; y: number } | null>(null);
  let list: HTMLDivElement | null = null;
  let pointerAnchor: NotesDocumentPoint | null = null;
  let request = 0;
  let replacementText: string | null = null;
  let alive = true;
  let composing = false;
  let painter: ReturnType<typeof createNotesDocumentSelectionPainter> | null = null;

  function editor(id: string): HTMLElement | undefined {
    return Array.from(list?.querySelectorAll<HTMLElement>(EDITOR) ?? []).find((node) => node.dataset.notesBlockId === id);
  }

  function point(node: Node | null, offset: number): NotesDocumentPoint | null {
    const root = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(EDITOR);
    if (!root || !node || !list?.contains(root)) return null;
    const textOffset = notesEditableOffsetFromDomPoint(root, node, offset);
    return textOffset === null ? null : { blockId: root.dataset.notesBlockId!, offset: textOffset };
  }

  function nativeSelection(): NotesDocumentSelection | null {
    const native = list?.ownerDocument.getSelection();
    const anchor = point(native?.anchorNode ?? null, native?.anchorOffset ?? 0);
    const focus = point(native?.focusNode ?? null, native?.focusOffset ?? 0);
    return anchor && focus ? { anchor, focus } : null;
  }

  function length(id: string): number {
    const block = options.readBlock(id);
    return block ? blockPlainText(block).length : 0;
  }

  function adjacentTextId(id: string, forward: boolean): string | undefined {
    const ids = options.readIds();
    const index = ids.indexOf(id);
    const candidates = forward ? ids.slice(index + 1) : ids.slice(0, index).reverse();
    return candidates.find((candidate) => {
      const block = options.readBlock(candidate);
      return !block || isTextEditableBlock(block.type);
    });
  }

  function clear(): void {
    request += 1;
    selection = null;
    replacementText = null;
    pinnedIds = [];
    menu = null;
    list?.removeAttribute("data-notes-document-selection");
    painter?.clear();
  }

  function paint(): void {
    if (!selection || !list || composing) { painter?.clear(); return; }
    list.setAttribute("data-notes-document-selection", "");
    const ids = options.readIds();
    const selected = notesDocumentRange(ids, selection);
    if (!selected) { painter?.clear(); return; }
    const selectedIds = new Set(selected.blockIds);
    const roots = Array.from(list.querySelectorAll<HTMLElement>("[data-notes-selectable-block-id]"))
      .filter((node) => selectedIds.has(node.dataset.notesSelectableBlockId ?? ""));
    const ranges = roots.flatMap((row) => {
      const id = row.dataset.notesSelectableBlockId!;
      const root = editor(id);
      const range = list!.ownerDocument.createRange();
      if (root) {
        const start = findEditableDomPoint(root, id === selected.start.blockId ? selected.start.offset : 0);
        const end = findEditableDomPoint(root, id === selected.end.blockId ? selected.end.offset : length(id));
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
      } else {
        range.selectNodeContents(row.querySelector(".notes-block-surface") ?? row);
      }
      return range.collapsed ? [] : [range];
    });
    painter?.paint(ranges);
    const startRow = roots[0];
    const endRow = roots.at(-1);
    if (!startRow || !endRow) return;
    const startId = startRow.dataset.notesSelectableBlockId!;
    const endId = endRow.dataset.notesSelectableBlockId!;
    const startEditor = editor(startId);
    const endEditor = editor(endId);
    const startOffset = startId === selected.start.blockId ? selected.start.offset : 0;
    const endOffset = endId === selected.end.blockId ? selected.end.offset : length(endId);
    const start = startEditor ? findEditableDomPoint(startEditor, startOffset) : { node: startRow, offset: 0 };
    const end = endEditor ? findEditableDomPoint(endEditor, endOffset) : { node: endRow, offset: endRow.childNodes.length };
    const forward = selected.start === selection.anchor;
    const anchor = forward ? start : end;
    const focus = forward ? end : start;
    list.ownerDocument.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  }

  async function select(next: NotesDocumentSelection): Promise<void> {
    const page = options.readPageId();
    const token = ++request;
    const range = notesDocumentRange(options.readIds(), next);
    if (!range) return;
    options.clearBlockSelection();
    selection = next;
    pinnedIds = entireDocument() ? [] : range.blockIds;
    list?.setAttribute("data-notes-document-selection", "");
    paint();
    if (next.anchor.blockId === next.focus.blockId && editor(next.anchor.blockId)) { clear(); return; }
    await tick();
    if (!alive || token !== request || page !== options.readPageId()) return;
    if (!entireDocument() && range.blockIds.some((id) => !options.readBlock(id))) await options.hydrate(range.blockIds);
    await tick();
    if (!alive || token !== request || page !== options.readPageId()) return;
    paint();
  }

  async function run(action: () => Promise<void>): Promise<void> {
    try { error = null; await action(); }
    catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  }

  function entireDocument(): boolean {
    const selected = range();
    return !!selected && selected.start.offset === 0 && selected.end.offset === Number.MAX_SAFE_INTEGER
      && selected.blockIds.length === options.readIds().length;
  }

  async function hydrateSelection(ids: readonly string[]): Promise<void> {
    if (ids.every((id) => options.readBlock(id))) return;
    const token = request;
    const page = options.readPageId();
    pinnedIds = [...ids];
    await tick();
    if (!alive || token !== request || page !== options.readPageId()) return;
    await options.hydrate(ids);
  }

  function range() { return selection ? notesDocumentRange(options.readIds(), selection) : null; }

  function text(): string {
    const selected = range();
    if (!selected) return "";
    return selected.blockIds.map((id, index) => {
      const block = options.readBlock(id);
      if (!block) throw new Error("Notes selection content is still loading");
      const value = blockPlainText(block);
      return value.slice(index === 0 ? selected.start.offset : 0,
        index === selected.blockIds.length - 1 ? selected.end.offset : value.length);
    }).join("\n");
  }

  async function replace(value: string, html?: string): Promise<void> {
    if (replacementText !== null) { replacementText += value; return; }
    const selected = range();
    if (!selected) return;
    const page = options.readPageId();
    const token = request;
    replacementText = value;
    try {
      if (selected.blockIds.some((id) => !options.readBlock(id))) await hydrateSelection(selected.blockIds);
      if (!alive || token !== request || page !== options.readPageId()) return;
      await options.replace(selected.blockIds, selected.start.offset, selected.end.offset, replacementText ?? value, html, selection ?? undefined);
      if (!alive || token !== request || page !== options.readPageId()) return;
      clear();
      options.restoreFocusAfterEdit?.();
    } finally { if (token === request) replacementText = null; }
  }

  async function copy(cut = false): Promise<void> {
    const selected = range();
    if (!selected) return;
    const page = options.readPageId();
    const token = request;
    if (selected.blockIds.some((id) => !options.readBlock(id))) await hydrateSelection(selected.blockIds);
    if (!alive || token !== request || page !== options.readPageId()) return;
    await navigator.clipboard.writeText(text());
    if (token !== request) return;
    if (cut) await replace("");
    menu = null;
  }

  async function format(annotation: NotesRichTextAnnotationName): Promise<void> {
    const selected = range();
    if (!selected) return;
    const token = request;
    await hydrateSelection(selected.blockIds);
    if (!alive || token !== request) return;
    await options.format(selected.blockIds, selected.start.offset, selected.end.offset, annotation, selection ?? undefined);
    await tick();
    paint();
  }

  function pointAt(x: number, y: number): NotesDocumentPoint | null {
    const doc = list?.ownerDocument;
    if (!doc) return null;
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position) return point(position.offsetNode, position.offset);
    const caretDoc = doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const caret = caretDoc.caretRangeFromPoint?.(x, y);
    return caret ? point(caret.startContainer, caret.startOffset) : null;
  }

  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("[data-notes-selection-menu]")) return;
    const root = event.target.closest(EDITOR);
    if (!root) { clear(); return; }
    const hit = pointAt(event.clientX, event.clientY);
    const previous = selection ?? nativeSelection();
    if (event.shiftKey && hit && previous) {
      event.preventDefault(); event.stopPropagation();
      pointerAnchor = previous.anchor;
      void run(() => select({ anchor: previous.anchor, focus: hit }));
    } else {
      clear();
      pointerAnchor = hit;
    }
  }

  function pointerMove(event: PointerEvent): void {
    if (!pointerAnchor || !(event.buttons & 1)) return;
    const hit = pointAt(event.clientX, event.clientY);
    if (!hit || (hit.blockId === pointerAnchor.blockId && !selection)) return;
    event.preventDefault();
    void run(() => select({ anchor: pointerAnchor!, focus: hit }));
  }

  async function extend(event: KeyboardEvent, current: NotesDocumentSelection): Promise<void> {
    const ids = options.readIds();
    const forward = ["ArrowRight", "ArrowDown", "End"].includes(event.key);
    let focus = current.focus;
    if ((event.ctrlKey || event.metaKey) && ["Home", "End"].includes(event.key)) {
      focus = { blockId: forward ? ids[ids.length - 1] : ids[0], offset: forward ? Number.MAX_SAFE_INTEGER : 0 };
    } else {
      if (!editor(focus.blockId)) {
        const token = request;
        options.focus(focus);
        await tick();
        if (!alive || token !== request) return;
        if (!options.readBlock(focus.blockId)) await options.hydrate([focus.blockId]);
        await tick();
        if (!alive || token !== request) return;
      }
      const root = editor(focus.blockId);
      const native = list?.ownerDocument.getSelection();
      if (!native) return;
      if (!root) {
        const adjacent = adjacentTextId(focus.blockId, forward);
        if (adjacent) await select({ anchor: current.anchor, focus: { blockId: adjacent, offset: forward ? 0 : Number.MAX_SAFE_INTEGER } });
        return;
      }
      const dom = findEditableDomPoint(root, focus.offset);
      native.collapse(dom.node, dom.offset);
      const beforeRect = native.rangeCount ? native.getRangeAt(0).getBoundingClientRect?.() : null;
      const granularity = event.key === "Home" || event.key === "End" ? "lineboundary"
        : event.key === "ArrowUp" || event.key === "ArrowDown" ? "line"
        : event.ctrlKey || event.metaKey ? "word" : "character";
      native.modify?.("move", forward ? "forward" : "backward", granularity);
      const moved = point(native.focusNode, native.focusOffset);
      const afterRect = native.rangeCount ? native.getRangeAt(0).getBoundingClientRect?.() : null;
      const stoppedOnSameLine = granularity === "line" && beforeRect && afterRect
        && beforeRect.height > 0 && afterRect.height > 0 && Math.abs(beforeRect.top - afterRect.top) < 1;
      if (moved && !stoppedOnSameLine && (moved.blockId !== focus.blockId || moved.offset !== focus.offset)) focus = moved;
      else if (event.key.startsWith("Arrow")) {
        const adjacent = adjacentTextId(focus.blockId, forward);
        if (adjacent) {
          if (!options.readBlock(adjacent) || !editor(adjacent)) {
            const token = request;
            const page = options.readPageId();
            pinnedIds = [...new Set([...pinnedIds, focus.blockId, adjacent])];
            await tick();
            if (!alive || token !== request || page !== options.readPageId()) return;
            if (!options.readBlock(adjacent)) await options.hydrate(pinnedIds);
            await tick();
            if (!alive || token !== request || page !== options.readPageId()) return;
          }
          const adjacentEditor = editor(adjacent);
          const rect = adjacentEditor?.getBoundingClientRect();
          const hit = granularity === "line" && rect && beforeRect
            ? pointAt(beforeRect.left, forward ? rect.top + 1 : rect.bottom - 1) : null;
          focus = hit?.blockId === adjacent ? hit : { blockId: adjacent, offset: forward ? 0 : length(adjacent) };
        }
      }
    }
    await select({ anchor: current.anchor, focus });
    const root = editor(focus.blockId);
    root?.scrollIntoView?.({ block: "nearest" });
  }

  function keydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || !(event.target instanceof Element)) return;
    if (!event.target.closest(EDITOR) && !event.target.matches("[data-notes-selectable-block-id]") && !selection) return;
    if (event.target.closest("[data-notes-selection-menu]")) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (replacementText !== null && !modifier && !event.altKey) {
      if (event.key.length === 1 || ["Enter", "Backspace", "Delete"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Backspace") replacementText = Array.from(replacementText).slice(0, -1).join("");
        else if (event.key !== "Delete") replacementText += event.key === "Enter" ? "\n" : event.key;
        return;
      }
    }
    if (modifier && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault(); event.stopPropagation();
      const ids = options.readIds();
      if (ids.length) void run(() => select({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[ids.length - 1], offset: Number.MAX_SAFE_INTEGER } }));
      return;
    }
    const current = selection ?? nativeSelection();
    if (modifier && !event.shiftKey && !event.altKey && ["Home", "End"].includes(event.key)) {
      const ids = options.readIds();
      const id = event.key === "Home" ? ids[0] : ids.at(-1);
      if (id) {
        event.preventDefault(); event.stopPropagation(); clear();
        options.focus({ blockId: id, offset: event.key === "Home" ? 0 : Number.MAX_SAFE_INTEGER });
      }
      return;
    }
    if (!selection && current && !modifier && !event.shiftKey && !event.altKey
      && current.anchor.blockId === current.focus.blockId && current.anchor.offset === current.focus.offset
      && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      const forward = event.key === "ArrowRight";
      if (current.focus.offset === (forward ? length(current.focus.blockId) : 0)) {
        const adjacent = adjacentTextId(current.focus.blockId, forward);
        if (adjacent) {
          event.preventDefault(); event.stopPropagation();
          options.focus({ blockId: adjacent, offset: forward ? 0 : Number.MAX_SAFE_INTEGER });
          return;
        }
      }
    }
    if (event.shiftKey && !event.altKey && current && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      void run(() => extend(event, current));
      return;
    }
    if (!selection) return;
    const key = event.key.toLowerCase();
    const annotation = notesRichTextFormattingShortcutAnnotationName(event);
    if (annotation) {
      event.preventDefault(); event.stopPropagation(); void run(() => format(annotation));
      return;
    }
    if (modifier && ["z", "y"].includes(key)) {
      event.preventDefault(); event.stopPropagation(); clear();
      void run(async () => { await (key === "y" || event.shiftKey ? options.redo() : options.undo()); });
    } else if (!modifier && ["Backspace", "Delete", "Enter"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      void run(() => replace(event.key === "Enter" ? "\n" : ""));
    } else if (!modifier && !event.altKey && event.key.length === 1) {
      event.preventDefault(); event.stopPropagation(); void run(() => replace(event.key));
    } else if (!modifier && (event.key.startsWith("Arrow") || event.key === "Escape")) {
      event.preventDefault(); event.stopPropagation();
      const selected = range();
      const target = selected && (["ArrowLeft", "ArrowUp"].includes(event.key) ? selected.start : selected.end);
      clear();
      if (target) {
        options.focus(target);
        const root = editor(target.blockId);
        if (root) { root.focus({ preventScroll: true }); const dom = findEditableDomPoint(root, target.offset); root.ownerDocument.getSelection()?.collapse(dom.node, dom.offset); }
      }
    }
  }

  function clipboard(event: ClipboardEvent): void {
    if (!selection) return;
    event.preventDefault(); event.stopPropagation();
    if (event.type === "paste") {
      const plainText = event.clipboardData?.getData("text/plain") ?? "";
      const html = event.clipboardData?.getData("text/html") || undefined;
      if (plainText || html) void run(() => replace(plainText, html));
      return;
    }
    const selected = range();
    if (selected?.blockIds.some((id) => !options.readBlock(id))) {
      void run(() => copy(event.type === "cut"));
      return;
    }
    try {
      if (!event.clipboardData) throw new Error("Notes clipboard is unavailable");
      event.clipboardData.setData("text/plain", text());
      if (event.type === "cut") void run(() => replace(""));
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  }

  function beforeInput(event: InputEvent): void {
    if (!selection) return;
    event.stopPropagation();
    if (composing) return;
    event.preventDefault();
    if (event.inputType === "insertFromComposition") return;
    if (event.inputType.startsWith("insert") && event.data !== null) void run(() => replace(event.data!));
    else if (event.inputType.startsWith("delete")) void run(() => replace(""));
  }

  function compositionStart(event: CompositionEvent): void {
    if (!selection || !(event.target instanceof Element)) return;
    const root = event.target.closest<HTMLElement>(EDITOR);
    if (!root) return;
    composing = true;
    painter?.clear();
    const offset = root.dataset.notesBlockId === selection.anchor.blockId ? selection.anchor.offset : 0;
    const dom = findEditableDomPoint(root, offset);
    root.ownerDocument.getSelection()?.collapse(dom.node, dom.offset);
  }

  function compositionEnd(event: CompositionEvent): void {
    if (!composing) return;
    composing = false;
    if (event.data) void run(() => replace(event.data));
    else paint();
  }

  function input(event: Event): void {
    if (selection) event.stopPropagation();
  }

  function contextMenu(event: MouseEvent): void {
    if (!selection) return;
    event.preventDefault(); event.stopPropagation();
    menu = { x: event.clientX, y: event.clientY };
  }

  return {
    get pinnedIds() { return pinnedIds; },
    get renderIds() { return entireDocument() ? [] : pinnedIds; },
    repaint: paint,
    get selection() { return selection; },
    get error() { return error; },
    get menu() { return menu; },
    clear, select, copy, replace, format, run,
    closeMenu() {
      menu = null;
      const root = selection ? editor(selection.anchor.blockId) ?? list?.querySelector<HTMLElement>(EDITOR) : null;
      root?.focus({ preventScroll: true });
      paint();
    },
    async paste() {
      const token = request;
      const value = await navigator.clipboard.readText();
      if (token === request && value) await replace(value);
    },
    delegation(node: HTMLDivElement) {
      list = node; alive = true;
      painter = createNotesDocumentSelectionPainter(node);
      const view = node.ownerDocument.defaultView;
      let paintFrame: number | null = null;
      const repaint = () => {
        if (!selection || paintFrame !== null || !view) return;
        paintFrame = view.requestAnimationFrame(() => { paintFrame = null; paint(); });
      };
      const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(repaint);
      resizeObserver?.observe(node);
      node.ownerDocument.addEventListener("scroll", repaint, true);
      view?.addEventListener("resize", repaint);
      const stop = () => { pointerAnchor = null; };
      node.addEventListener("keydown", keydown, true);
      node.addEventListener("pointerdown", pointerDown, true);
      node.addEventListener("contextmenu", contextMenu, true);
      node.addEventListener("beforeinput", beforeInput, true);
      node.addEventListener("compositionstart", compositionStart, true);
      node.addEventListener("compositionend", compositionEnd, true);
      node.addEventListener("input", input, true);
      for (const type of ["copy", "cut", "paste"] as const) node.addEventListener(type, clipboard, true);
      node.ownerDocument.addEventListener("pointermove", pointerMove);
      node.ownerDocument.addEventListener("pointerup", stop);
      node.ownerDocument.addEventListener("pointercancel", stop);
      return { destroy() {
        alive = false; clear();
        resizeObserver?.disconnect();
        node.ownerDocument.removeEventListener("scroll", repaint, true);
        view?.removeEventListener("resize", repaint);
        if (paintFrame !== null) view?.cancelAnimationFrame(paintFrame);
        painter = null;
        node.removeEventListener("keydown", keydown, true);
        node.removeEventListener("pointerdown", pointerDown, true);
        node.removeEventListener("contextmenu", contextMenu, true);
        node.removeEventListener("beforeinput", beforeInput, true);
        node.removeEventListener("compositionstart", compositionStart, true);
        node.removeEventListener("compositionend", compositionEnd, true);
        node.removeEventListener("input", input, true);
        for (const type of ["copy", "cut", "paste"] as const) node.removeEventListener(type, clipboard, true);
        node.ownerDocument.removeEventListener("pointermove", pointerMove);
        node.ownerDocument.removeEventListener("pointerup", stop);
        node.ownerDocument.removeEventListener("pointercancel", stop);
        list = null;
      } };
    },
  };
}

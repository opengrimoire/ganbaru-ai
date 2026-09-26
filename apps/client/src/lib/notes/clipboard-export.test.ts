// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockEditableRichText, createBlockWrite } from "./block-factory";
import { notesClipboardContent, writeNotesClipboard } from "./clipboard-export";
import { createLinkedTextRichText, createTextRichText } from "./rich-text";
import { planNotesRichHtmlPaste } from "./rich-text-paste";
import type { NotesBlock } from "./types";

/** Create canonical blocks with arbitrary content and parent relationships. */
function block(id: string, type: NotesBlock["type"], text: string, parent?: string): NotesBlock {
  return {
    ...createBlockWrite(id, type, text), object: "block",
    parent: parent ? { type: "block_id", block_id: parent } : { type: "page_id", page_id: "page" },
    created_time: "", last_edited_time: "", has_children: false, in_trash: false,
    source_provider: null, source_object_id: null, source_last_edited_time: null,
  } as NotesBlock;
}

/** Parse exported HTML as an external consumer with no Ganbaru CSS. */
function fragment(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Notes clipboard export", () => {
  it.each(["heading_1", "heading_2", "heading_3", "heading_4", "heading_5", "heading_6"] as const)("exports %s as the matching Markdown heading", (type) => {
    const level = Number(type.slice(-1));
    const content = notesClipboardContent([{ block: block("title", type, "Title") }]);
    expect(content.plainText).toBe(`${"#".repeat(level)} Title`);
    expect(content.html).toBe(`<h${level}>Title</h${level}>`);
  });
  it("copies partial headings and inline semantics without leaking unselected text", () => {
    const heading = block("heading", "heading_2", "before styled after");
    const run = blockEditableRichText(heading)[0];
    run.annotations = { ...run.annotations, bold: true, italic: true, underline: true, strikethrough: true, code: true, color: "red" };
    const content = notesClipboardContent([{ block: heading, start: 7, end: 13 }]);
    expect(content.plainText).toBe("## <u><s><em><strong><code>styled</code></strong></em></s></u>");
    const html = fragment(content.html);
    expect(html.querySelector("h2 strong code")?.textContent).toBe("styled");
    expect(html.querySelectorAll("em, u, s")).toHaveLength(3);
    expect(html.querySelector("span")?.style.color).toBe("rgb(212, 76, 71)");
    expect(content.html).not.toMatch(/before|after|notes-rich-text-segment/);
    const pasted = planNotesRichHtmlPaste({ currentBlock: block("target", "paragraph", ""), selectionStart: 0, selectionEnd: 0, html: content.html, createId: () => "unused" });
    expect(pasted?.currentUpdate.type).toBe("heading_2");
    if (pasted?.currentUpdate.type !== "heading_2") throw new Error("Expected heading paste");
    expect(pasted.currentUpdate.heading_2.rich_text[0].annotations).toEqual(run.annotations);

  });

  it("escapes text and links and excludes unsafe link schemes", () => {
    const paragraph = block("p", "paragraph", "");
    if (paragraph.type !== "paragraph") throw new Error("Expected paragraph");
    paragraph.paragraph.rich_text = [
      createLinkedTextRichText('<img src=x onerror="bad()"> & link', 'https://example.com/?a=1&b=2'),
      { ...createTextRichText("unsafe"), href: "javascript:alert(1)" },
    ];
    const html = fragment(notesClipboardContent([{ block: paragraph }]).html);
    expect(html.querySelectorAll("a")).toHaveLength(1);
    expect(html.querySelector("a")?.getAttribute("href")).toBe("https://example.com/?a=1&b=2");
    expect(html.querySelector("img")).toBeNull();
    expect(html.textContent).toBe('<img src=x onerror="bad()"> & linkunsafe');
  });

  it("preserves mixed nested lists and numbering groups through HTML paste", () => {
    const entries = [
      block("a", "numbered_list_item", "First"),
      block("b", "bulleted_list_item", "Child", "a"),
      block("c", "numbered_list_item", "Grandchild", "b"),
      block("d", "numbered_list_item", "Second"),
      block("p", "paragraph", "Break"),
      block("e", "numbered_list_item", "Restart"),
    ].map((block) => ({ block }));
    const content = notesClipboardContent(entries);
    const html = fragment(content.html);
    expect(html.querySelector("ol > li > ul > li > ol > li")?.textContent).toBe("Grandchild");
    expect(Array.from(html.children).map((node) => node.tagName)).toEqual(["OL", "P", "OL"]);
    let id = 0;
    const paste = planNotesRichHtmlPaste({ currentBlock: block("target", "paragraph", ""), selectionStart: 0, selectionEnd: 0, html: content.html, createId: () => `pasted-${++id}` });
    expect(paste?.blockDepths).toEqual([0, 1, 2, 0, 0, 0]);
    expect(paste?.appendedBlocks.map((block) => block.type)).toEqual(["bulleted_list_item", "numbered_list_item", "numbered_list_item", "paragraph", "numbered_list_item"]);
  });

  it("preserves visual list indentation and normalizes a selection starting in a nested list", () => {
    const first = block("first", "bulleted_list_item", "First");
    const child = block("child", "numbered_list_item", "Child");
    if (child.type !== "numbered_list_item") throw new Error("Expected numbered item");
    child.numbered_list_item.ganbaru_indent = 1;
    expect(fragment(notesClipboardContent([{ block: first }, { block: child }]).html)
      .querySelector("ul > li > ol > li")?.textContent).toBe("Child");
    expect(notesClipboardContent([{ block: child }]).html).toBe("<ol><li>Child</li></ol>");
  });

  it("preserves code whitespace, task state, dividers, tables, and blank lines", () => {
    const code = block("code", "code", "  <tag>\n\tcode\n");
    const task = block("task", "to_do", "Done");
    if (task.type !== "to_do") throw new Error("Expected task");
    task.to_do.checked = true;
    const table = block("table", "table", "");
    const row = block("row", "table_row", "", "table");
    if (row.type !== "table_row") throw new Error("Expected row");
    row.table_row.cells = [[createTextRichText("A")], [createTextRichText("B")]];
    const content = notesClipboardContent([code, task, block("divider", "divider", ""), table, row,
      block("empty", "paragraph", ""), block("p", "paragraph", "End\nline")].map((block) => ({ block })));
    const html = fragment(content.html);
    expect(html.querySelector("pre code")?.textContent).toBe("  <tag>\n\tcode\n");
    expect(html.querySelector("input")?.checked).toBe(true);
    expect(html.querySelector("hr")).not.toBeNull();
    expect(Array.from(html.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual(["A", "B"]);
    expect(content.plainText).toContain("| A | B |");
    expect(content.plainText).toContain("End  \nline");
    expect(html.querySelector("p:last-child br")).not.toBeNull();
    expect(fragment(notesClipboardContent([{ block: row }]).html).querySelectorAll("table td")).toHaveLength(2);
  });

  it("writes both MIME types and propagates failed rich writes instead of permitting a cut", async () => {
    const write = vi.fn(async (_items: ClipboardItem[]) => undefined);
    const writeText = vi.fn(async () => undefined);
    class TestClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    await writeNotesClipboard({ plainText: "Heading", html: "<h1>Heading</h1>" });
    const item = write.mock.calls[0][0][0] as unknown as TestClipboardItem;
    expect(Object.keys(item.data)).toEqual(["text/plain", "text/html"]);
    expect(item.data["text/html"].type).toBe("text/html");
    write.mockRejectedValueOnce(new Error("denied"));
    await expect(writeNotesClipboard({ plainText: "text", html: "<p>text</p>" })).rejects.toThrow("denied");
    expect(writeText).not.toHaveBeenCalled();
  });
});

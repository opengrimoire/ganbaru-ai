import { describe, expect, it } from "vitest";
import {
  notesBlockMarker,
  notesNumberedListOrdinals,
  notesRichTextEditorClass,
  notesRichTextPreviewClass,
  notesTextareaClass,
} from "./block-editor-ui";

describe("notes block editor UI helpers", () => {
  it("numbers explicit indentation levels independently without interrupting the outer list", () => {
    const rows = [0, 1, 1, 2, 1, 0].map((indent, index) => ({ id: String(index), parentId: "page", type: "numbered_list_item", indent }));
    expect([...notesNumberedListOrdinals(rows).values()]).toEqual([1, 1, 2, 1, 3, 2]);
  });

  it("keeps heading and code editor classes distinct", () => {
    expect(notesTextareaClass("heading_1")).toContain("notes-heading-1");
    expect(notesTextareaClass("heading_2")).toContain("notes-heading-2");
    expect(notesTextareaClass("heading_3")).toContain("notes-heading-3");
    expect(notesTextareaClass("heading_4")).toContain("notes-heading-4");
    expect(notesTextareaClass("heading_1")).toContain("leading-[1.3]");
    expect(notesTextareaClass("code")).toContain("font-mono");
  });

  it("adds preview-only affordances on top of text block classes", () => {
    expect(notesRichTextPreviewClass("paragraph")).toContain("cursor-text");
    expect(notesRichTextPreviewClass("paragraph")).toContain("whitespace-pre-wrap");
  });

  it("adds rich editor affordances on top of text block classes", () => {
    expect(notesRichTextEditorClass("paragraph")).toContain("notes-rich-text-editor");
    expect(notesRichTextEditorClass("paragraph")).toContain("break-words");
    expect(notesRichTextEditorClass("paragraph")).toContain("notes-editor-body-text");
    expect(notesRichTextEditorClass("paragraph")).toContain("leading-normal");
    expect(notesRichTextEditorClass("paragraph")).not.toContain("focus-visible:ring");
    expect(notesRichTextEditorClass("code")).toContain("font-mono");
  });

  it("keeps ordinary text flush with the page title while padding code backgrounds", () => {
    expect(notesTextareaClass("paragraph")).not.toContain("pl-1");
    expect(notesTextareaClass("paragraph")).not.toContain("px-1");
    expect(notesTextareaClass("code")).toContain("pl-1");
  });

  it("returns stable visible markers for list-like blocks", () => {
    expect(notesBlockMarker("bulleted_list_item")).toBe("•");
    expect(notesBlockMarker("numbered_list_item")).toBe("1.");
    expect(notesBlockMarker("paragraph")).toBe("");
    expect(notesBlockMarker("numbered_list_item", 12)).toBe("12.");
  });
});

describe("numbered list sequences", () => {
  const item = (id: string, parentId = "page", type = "numbered_list_item") => ({ id, parentId, type });

  it("counts sibling items across nested content and resets only on a different sibling type", () => {
    expect([...notesNumberedListOrdinals([
      item("a"), item("child-a", "a"), item("child-b", "a"),
      item("child-text", "a", "paragraph"), item("child-c", "a"), item("b"),
      item("break", "page", "bulleted_list_item"), item("c"), item("d"),
      item("other-column", "column"), item("other-tab", "tab"),
    ])]).toEqual([
      ["a", 1], ["child-a", 1], ["child-b", 2], ["child-c", 1], ["b", 2],
      ["c", 1], ["d", 2], ["other-column", 1], ["other-tab", 1],
    ]);
  });

  it("uses the full outline so a window starting mid-list retains its ordinal", () => {
    const outline = Array.from({ length: 120 }, (_, index) => item(String(index)));
    const numbers = notesNumberedListOrdinals(outline);
    expect(numbers.get("99")).toBe(100);
    expect(numbers.get("119")).toBe(120);
    expect([...notesNumberedListOrdinals([outline[2], outline[0]])]).toEqual([["2", 1], ["0", 2]]);
    expect(notesNumberedListOrdinals([]).size).toBe(0);
  });
});

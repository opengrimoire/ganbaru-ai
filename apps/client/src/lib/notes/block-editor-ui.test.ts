import { describe, expect, it } from "vitest";
import {
  notesBlockMarker,
  notesRichTextEditorClass,
  notesRichTextPreviewClass,
  notesTextareaClass,
} from "./block-editor-ui";

describe("notes block editor UI helpers", () => {
  it("keeps heading and code editor classes distinct", () => {
    expect(notesTextareaClass("heading_1")).toContain("text-[1.875rem]");
    expect(notesTextareaClass("heading_2")).toContain("text-[1.5rem]");
    expect(notesTextareaClass("heading_3")).toContain("text-[1.25rem]");
    expect(notesTextareaClass("heading_4")).toContain("text-[1.125rem]");
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
  });
});

import { describe, expect, it } from "vitest";
import {
  chatComposerDocumentFromText,
  chatComposerDocumentVersioned,
  chatComposerMarkdown,
  chatComposerPlainText,
  parseChatComposerDocument,
  replaceChatComposerText,
  toggleChatComposerMark,
  type ChatComposerDocument,
} from "./rich-text";

describe("Chat composer rich text", () => {
  it("serializes supported marks to provider-facing Markdown", () => {
    const document: ChatComposerDocument = {
      lines: [{
        runs: [
          { text: "Plain ", marks: [] },
          { text: "bold", marks: ["bold"] },
          { text: " and ", marks: [] },
          { text: "italic", marks: ["italic"] },
          { text: " together", marks: ["bold", "italic"] },
        ],
      }],
    };

    expect(chatComposerMarkdown(document)).toBe("Plain **bold** and _italic_**_ together_**");
    expect(chatComposerPlainText(document)).toBe("Plain bold and italic together");
  });

  it("preserves empty and trailing lines during text replacement", () => {
    const initial = chatComposerDocumentFromText("Example");
    const withBreak = replaceChatComposerText(initial, { start: 7, end: 7 }, "\n").document;

    expect(chatComposerPlainText(withBreak)).toBe("Example\n");
    expect(withBreak.lines).toHaveLength(2);
    expect(withBreak.lines[1]?.runs).toEqual([]);

    const cleared = replaceChatComposerText(withBreak, { start: 0, end: 8 }, "").document;
    const typed = replaceChatComposerText(cleared, { start: 0, end: 0 }, "abcñ").document;
    expect(chatComposerPlainText(typed)).toBe("abcñ");
  });

  it("toggles marks across line boundaries without formatting the break", () => {
    const initial = chatComposerDocumentFromText("one\ntwo");
    const formatted = toggleChatComposerMark(initial, { start: 1, end: 6 }, "bold");

    expect(chatComposerMarkdown(formatted)).toBe("o**ne**\n**tw**o");
    expect(chatComposerPlainText(formatted)).toBe("one\ntwo");
    expect(chatComposerMarkdown(toggleChatComposerMark(formatted, { start: 1, end: 6 }, "bold")))
      .toBe("one\ntwo");
  });

  it("loads versioned rich content only when it matches the Markdown fallback", () => {
    const formatted = toggleChatComposerMark(
      chatComposerDocumentFromText("Important"),
      { start: 0, end: 9 },
      "bold",
    );
    const versioned = chatComposerDocumentVersioned(formatted);

    expect(parseChatComposerDocument(versioned, "**Important**")).toEqual(formatted);
    expect(parseChatComposerDocument(versioned, "Changed")).toEqual(chatComposerDocumentFromText("Changed"));
    expect(parseChatComposerDocument({
      schemaVersion: 1,
      value: { lines: [{ runs: [{ text: "Invalid\nline", marks: [] }] }] },
    }, "Fallback")).toEqual(chatComposerDocumentFromText("Fallback"));
    expect(parseChatComposerDocument({ schemaVersion: 99, value: {} }, "Fallback"))
      .toEqual(chatComposerDocumentFromText("Fallback"));
  });
});

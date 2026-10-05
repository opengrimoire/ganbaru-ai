import { describe, expect, it } from "vitest";
import { planNotesControlledTextEdit } from "./controlled-text-input";

describe("notes controlled text input", () => {
  it("inserts typed text at the current selection", () => {
    expect(planNotesControlledTextEdit({
      inputType: "insertText",
      data: "x",
      text: "Eample",
      selectionStart: 1,
      selectionEnd: 1,
    })).toEqual({
      text: "Example",
      selection: { start: 2, end: 2 },
    });
  });

  it("replaces selected text with inserted text", () => {
    expect(planNotesControlledTextEdit({
      inputType: "insertText",
      data: "world",
      text: "Hello selection",
      selectionStart: 6,
      selectionEnd: 15,
    })).toEqual({
      text: "Hello world",
      selection: { start: 11, end: 11 },
    });
  });

  it("deletes backward and forward without splitting surrogate pairs", () => {
    expect(planNotesControlledTextEdit({
      inputType: "deleteContentBackward",
      data: null,
      text: "A😀B",
      selectionStart: 3,
      selectionEnd: 3,
    })).toEqual({
      text: "AB",
      selection: { start: 1, end: 1 },
    });
    expect(planNotesControlledTextEdit({
      inputType: "deleteContentForward",
      data: null,
      text: "A😀B",
      selectionStart: 1,
      selectionEnd: 1,
    })).toEqual({
      text: "AB",
      selection: { start: 1, end: 1 },
    });
  });

  it("deletes selected ranges", () => {
    expect(planNotesControlledTextEdit({
      inputType: "deleteContentBackward",
      data: null,
      text: "Hello world",
      selectionStart: 5,
      selectionEnd: 11,
    })).toEqual({
      text: "Hello",
      selection: { start: 5, end: 5 },
    });
  });

  it("cuts only the selected text and keeps neighboring Unicode intact", () => {
    expect(planNotesControlledTextEdit({
      inputType: "deleteByCut",
      data: null,
      text: "A😀 selection B",
      selectionStart: 4,
      selectionEnd: 14,
    })).toEqual({
      text: "A😀 B",
      selection: { start: 4, end: 4 },
    });
  });

  it("inserts controlled soft newlines", () => {
    expect(planNotesControlledTextEdit({
      inputType: "insertLineBreak",
      data: null,
      text: "Hello",
      selectionStart: 5,
      selectionEnd: 5,
    })).toEqual({
      text: "Hello\n",
      selection: { start: 6, end: 6 },
    });
  });
});

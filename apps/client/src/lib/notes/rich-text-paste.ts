import DOMPurify, { type Config } from "dompurify";
import {
  blockEditableRichText,
  blockWithRichText,
  createCodePayload,
  createTextPayloadFromRichText,
} from "./block-factory";
import {
  createLinkedTextRichText,
  createTextRichText,
  defaultRichTextAnnotations,
  normalizeRichTextLinkUrl,
  replaceRichTextRange,
  richTextPlainText,
  richTextRangeSlice,
} from "./rich-text";
import {
  NOTES_CLIPBOARD_MAX_BLOCKS,
  NOTES_CLIPBOARD_MAX_TEXT_LENGTH,
} from "./block-clipboard";
import {
  NOTES_COLORS,
  type NotesBlock,
  type NotesBlockUpdate,
  type NotesBlockWrite,
  type NotesColor,
  type NotesRichText,
  type NotesRichTextAnnotations,
  type NotesRichTextLink,
} from "./types";

type NotesRichHtmlPasteBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "heading_4"
  | "heading_5"
  | "heading_6"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "quote"
  | "code";

interface NotesRichHtmlPasteSegment {
  type: NotesRichHtmlPasteBlockType;
  richText: NotesRichText[];
  depth?: number;
  language?: string;
}

interface NotesRichHtmlInlineContext {
  annotations: NotesRichTextAnnotations;
  linkUrl: string | null;
  preformatted: boolean;
}

export interface NotesRichHtmlPastePlan {
  currentUpdate: NotesBlockUpdate;
  appendedBlocks: NotesBlockWrite[];
  blockDepths: number[];
  focusBlockId: string;
  focusOffset: number;
}

export interface NotesRichHtmlPastePlanInput {
  currentBlock: NotesBlock;
  selectionStart: number;
  selectionEnd: number;
  html: string;
  createId: () => string;
}

const NOTES_RICH_HTML_MAX_LENGTH = 128 * 1024;

const SANITIZER_CONFIG = {
  ALLOWED_TAGS: [
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "i",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strike",
    "strong",
    "u",
    "ul",
  ],
  ALLOWED_ATTR: [
    "data-notes-bold",
    "data-notes-code",
    "data-notes-italic",
    "data-notes-link-url",
    "data-notes-rich-text-color",
    "data-notes-strikethrough",
    "data-notes-underline",
    "href",
    "style",
  ],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: [
    "base",
    "button",
    "embed",
    "form",
    "iframe",
    "img",
    "input",
    "link",
    "math",
    "meta",
    "object",
    "script",
    "select",
    "style",
    "svg",
    "textarea",
  ],
} satisfies Config;

const BLOCK_TAGS = new Set([
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "pre",
]);

function cloneAnnotations(
  annotations: NotesRichTextAnnotations,
): NotesRichTextAnnotations {
  return { ...annotations };
}

function annotationsEqual(
  left: NotesRichTextAnnotations,
  right: NotesRichTextAnnotations,
): boolean {
  return left.bold === right.bold
    && left.italic === right.italic
    && left.strikethrough === right.strikethrough
    && left.underline === right.underline
    && left.code === right.code
    && left.color === right.color;
}

function linksEqual(
  left: NotesRichTextLink | null,
  right: NotesRichTextLink | null,
): boolean {
  return (left?.url ?? null) === (right?.url ?? null);
}

function cloneRichTextItem(item: NotesRichText): NotesRichText {
  return structuredClone(item);
}

function appendRichTextItem(output: NotesRichText[], item: NotesRichText): void {
  if (!item.plain_text) return;
  const previous = output.at(-1);
  if (
    item.type === "text"
    && previous?.type === "text"
    && annotationsEqual(previous.annotations, item.annotations)
    && linksEqual(previous.text.link, item.text.link)
    && previous.href === item.href
  ) {
    previous.text.content += item.text.content;
    previous.plain_text += item.plain_text;
    return;
  }
  output.push(cloneRichTextItem(item));
}

function appendText(
  output: NotesRichText[],
  content: string,
  context: NotesRichHtmlInlineContext,
): void {
  if (!content) return;
  const item = context.linkUrl
    ? createLinkedTextRichText(content, context.linkUrl)
    : createTextRichText(content);
  item.annotations = cloneAnnotations(context.annotations);
  appendRichTextItem(output, item);
}

function normalizeHtmlText(text: string, preformatted: boolean): string {
  if (preformatted) return text.replace(/\r\n?/gu, "\n");
  return text.replace(/[\t\n\f\r ]+/gu, " ");
}

function normalizedTagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function booleanAttribute(element: Element, name: string): boolean | null {
  const value = element.getAttribute(name);
  if (value === null) return null;
  return value === "" || value === "true";
}

function notesColorFromAttribute(value: string | null): NotesColor | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  return NOTES_COLORS.some((color) => color === candidate)
    ? candidate as NotesColor
    : null;
}

function applyStyleAnnotations(
  element: Element,
  annotations: NotesRichTextAnnotations,
): void {
  if (!(element instanceof HTMLElement)) return;
  const weight = element.style.fontWeight.trim().toLocaleLowerCase();
  const numericWeight = Number.parseInt(weight, 10);
  if (weight === "bold" || weight === "bolder" || numericWeight >= 600) {
    annotations.bold = true;
  }
  const fontStyle = element.style.fontStyle.trim().toLocaleLowerCase();
  if (fontStyle === "italic" || fontStyle === "oblique") annotations.italic = true;
  const decoration = [
    element.style.textDecoration,
    element.style.textDecorationLine,
  ].join(" ").toLocaleLowerCase();
  if (decoration.includes("underline")) annotations.underline = true;
  if (decoration.includes("line-through")) annotations.strikethrough = true;
}

function contextForElement(
  element: Element,
  context: NotesRichHtmlInlineContext,
): NotesRichHtmlInlineContext {
  const tagName = normalizedTagName(element);
  const annotations = cloneAnnotations(context.annotations);
  if (tagName === "b" || tagName === "strong") annotations.bold = true;
  if (tagName === "i" || tagName === "em") annotations.italic = true;
  if (tagName === "u") annotations.underline = true;
  if (["s", "strike", "del"].includes(tagName)) annotations.strikethrough = true;
  if (tagName === "code") annotations.code = true;
  if (tagName === "pre") annotations.code = true;
  applyStyleAnnotations(element, annotations);
  if (booleanAttribute(element, "data-notes-bold") === true) annotations.bold = true;
  if (booleanAttribute(element, "data-notes-italic") === true) annotations.italic = true;
  if (booleanAttribute(element, "data-notes-underline") === true) annotations.underline = true;
  if (booleanAttribute(element, "data-notes-strikethrough") === true) {
    annotations.strikethrough = true;
  }
  if (booleanAttribute(element, "data-notes-code") === true) annotations.code = true;
  const color = notesColorFromAttribute(element.getAttribute("data-notes-rich-text-color"));
  if (color) annotations.color = color;

  const rawLink = element.getAttribute("data-notes-link-url")
    ?? (tagName === "a" ? element.getAttribute("href") : null);
  const linkUrl = rawLink === null
    ? context.linkUrl
    : normalizeRichTextLinkUrl(rawLink);
  return {
    annotations,
    linkUrl,
    preformatted: context.preformatted || tagName === "pre",
  };
}

function blockTypeForElement(
  element: Element,
  listType: "bulleted_list_item" | "numbered_list_item" | null,
): NotesRichHtmlPasteBlockType {
  switch (normalizedTagName(element)) {
    case "h1":
      return "heading_1";
    case "h2":
      return "heading_2";
    case "h3":
      return "heading_3";
    case "h4":
      return "heading_4";
    case "h5":
      return "heading_5";
    case "h6":
      return "heading_6";
    case "li":
      return listType ?? "bulleted_list_item";
    case "blockquote":
      return "quote";
    case "pre":
      return "code";
    default:
      return "paragraph";
  }
}

function hasDirectBlockChildren(element: Element): boolean {
  return Array.from(element.children).some((child) => {
    const tagName = normalizedTagName(child);
    return BLOCK_TAGS.has(tagName) || tagName === "ol" || tagName === "ul";
  });
}

function collectInline(
  node: Node,
  context: NotesRichHtmlInlineContext,
  output: NotesRichText[],
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    appendText(output, normalizeHtmlText(node.textContent ?? "", context.preformatted), context);
    return;
  }
  if (!(node instanceof Element)) return;
  const tagName = normalizedTagName(node);
  if (tagName === "br") {
    appendText(output, "\n", context);
    return;
  }
  if (tagName === "ul" || tagName === "ol") return;
  const separatesLines = tagName === "p" || tagName === "div";
  if (separatesLines && output.length && !richTextPlainText(output).endsWith("\n")) {
    appendText(output, "\n", context);
  }
  const childContext = contextForElement(node, context);
  for (const child of node.childNodes) {
    collectInline(child, childContext, output);
  }
  if (separatesLines) appendText(output, "\n", context);
}

function segmentFromElement(
  element: Element,
  context: NotesRichHtmlInlineContext,
  listType: "bulleted_list_item" | "numbered_list_item" | null,
): NotesRichHtmlPasteSegment {
  const tagName = normalizedTagName(element);
  if (tagName === "pre") {
    const content = normalizeHtmlText(element.textContent ?? "", true);
    return {
      type: "code",
      richText: content ? [createTextRichText(content)] : [],
      language: "plain text",
    };
  }
  const richText: NotesRichText[] = [];
  const childContext = contextForElement(element, context);
  for (const child of element.childNodes) {
    collectInline(child, childContext, richText);
  }
  const text = richTextPlainText(richText);
  return {
    type: blockTypeForElement(element, listType),
    richText: tagName === "li"
      ? richTextRangeSlice(richText, text.length - text.trimStart().length, text.trimEnd().length)
      : richText,
  };
}

function collectSegments(
  parent: ParentNode,
  context: NotesRichHtmlInlineContext,
  listType: "bulleted_list_item" | "numbered_list_item" | null,
  depth = 0,
): NotesRichHtmlPasteSegment[] {
  const segments: NotesRichHtmlPasteSegment[] = [];
  const inlineRichText: NotesRichText[] = [];
  const flushInline = () => {
    if (richTextPlainText(inlineRichText).trim().length === 0) {
      inlineRichText.length = 0;
      return;
    }
    segments.push({ type: "paragraph", depth, richText: [...inlineRichText] });
    inlineRichText.length = 0;
  };

  for (const child of parent.childNodes) {
    if (!(child instanceof Element)) {
      collectInline(child, context, inlineRichText);
      continue;
    }
    const tagName = normalizedTagName(child);
    if (tagName === "ol" || tagName === "ul") {
      flushInline();
      const childListType = tagName === "ol" ? "numbered_list_item" : "bulleted_list_item";
      segments.push(...collectSegments(child, contextForElement(child, context), childListType, depth));
      continue;
    }
    if (tagName === "div" && hasDirectBlockChildren(child)) {
      flushInline();
      segments.push(...collectSegments(child, contextForElement(child, context), listType, depth));
      continue;
    }
    if (BLOCK_TAGS.has(tagName)) {
      flushInline();
      segments.push({ ...segmentFromElement(child, context, listType), depth });
      if (tagName !== "pre") {
        // Nested list containers are handled by their nearest list ancestor.
        for (const list of child.querySelectorAll("ul, ol")) {
          const ancestorList = list.parentElement?.closest("ul, ol");
          if (ancestorList && child.contains(ancestorList)) continue;
          segments.push(...collectSegments(list, contextForElement(child, context),
            normalizedTagName(list) === "ol" ? "numbered_list_item" : "bulleted_list_item", depth + 1));
        }
      }
      continue;
    }
    collectInline(child, context, inlineRichText);
  }
  flushInline();
  return segments;
}

function sanitizeNotesRichHtml(html: string): DocumentFragment | null {
  if (!html.trim() || html.length > NOTES_RICH_HTML_MAX_LENGTH) return null;
  if (typeof document === "undefined") return null;
  const sanitized = DOMPurify.sanitize(html, SANITIZER_CONFIG);
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  return template.content;
}

function plainTextLength(segments: readonly NotesRichHtmlPasteSegment[]): number {
  if (segments.length === 0) return 0;
  return segments
    .map((segment) => richTextPlainText(segment.richText))
    .join("\n")
    .length;
}

function parseNotesRichHtmlPaste(html: string): NotesRichHtmlPasteSegment[] | null {
  const fragment = sanitizeNotesRichHtml(html);
  if (!fragment) return null;
  const context: NotesRichHtmlInlineContext = {
    annotations: defaultRichTextAnnotations(),
    linkUrl: null,
    preformatted: false,
  };
  const segments = collectSegments(fragment, context, null)
    .filter((segment, index, all) => segment.type.endsWith("_list_item")
      || (all[index + 1]?.depth ?? 0) > (segment.depth ?? 0)
      || richTextPlainText(segment.richText).trim().length > 0);
  if (segments.length === 0 || plainTextLength(segments) > NOTES_CLIPBOARD_MAX_TEXT_LENGTH) {
    return null;
  }
  return capSegments(segments);
}

function capSegments(
  segments: readonly NotesRichHtmlPasteSegment[],
): NotesRichHtmlPasteSegment[] {
  if (segments.length <= NOTES_CLIPBOARD_MAX_BLOCKS) return [...segments];
  const kept = segments.slice(0, NOTES_CLIPBOARD_MAX_BLOCKS - 1);
  const overflow = segments
    .slice(NOTES_CLIPBOARD_MAX_BLOCKS - 1)
    .map((segment) => richTextPlainText(segment.richText))
    .join("\n");
  return [
    ...kept,
    {
      type: "paragraph",
      richText: overflow ? [createTextRichText(overflow)] : [],
    },
  ];
}

function richTextOrEmptyText(richText: readonly NotesRichText[]): NotesRichText[] {
  return richText.length > 0 ? [...richText] : [createTextRichText("")];
}

function createUpdateForSegment(segment: NotesRichHtmlPasteSegment): NotesBlockUpdate {
  switch (segment.type) {
    case "heading_1":
      return {
        type: "heading_1",
        heading_1: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "heading_2":
      return {
        type: "heading_2",
        heading_2: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "heading_3":
      return {
        type: "heading_3",
        heading_3: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "heading_4":
      return {
        type: "heading_4",
        heading_4: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "heading_5":
      return {
        type: "heading_5",
        heading_5: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "heading_6":
      return {
        type: "heading_6",
        heading_6: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "bulleted_list_item":
      return {
        type: "bulleted_list_item",
        bulleted_list_item: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "numbered_list_item":
      return {
        type: "numbered_list_item",
        numbered_list_item: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "quote":
      return {
        type: "quote",
        quote: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
    case "code":
      return {
        type: "code",
        code: createCodePayload(richTextPlainText(segment.richText), segment.language),
      };
    case "paragraph":
      return {
        type: "paragraph",
        paragraph: createTextPayloadFromRichText(richTextOrEmptyText(segment.richText)),
      };
  }
}

function createWriteForSegment(
  id: string,
  segment: NotesRichHtmlPasteSegment,
): NotesBlockWrite {
  const update = createUpdateForSegment(segment);
  return { id, ...update };
}

function segmentWithSuffix(
  segment: NotesRichHtmlPasteSegment,
  suffix: readonly NotesRichText[],
): NotesRichHtmlPasteSegment {
  if (suffix.length === 0) return segment;
  if (segment.type === "code") {
    return {
      ...segment,
      richText: [createTextRichText(`${richTextPlainText(segment.richText)}${richTextPlainText(suffix)}`)],
    };
  }
  const end = richTextPlainText(segment.richText).length;
  return {
    ...segment,
    richText: replaceRichTextRange(segment.richText, end, end, suffix),
  };
}

export function planNotesRichHtmlPaste(
  input: NotesRichHtmlPastePlanInput,
): NotesRichHtmlPastePlan | null {
  if (input.currentBlock.type === "code") return null;
  const segments = parseNotesRichHtmlPaste(input.html);
  if (!segments) return null;

  const currentRichText = blockEditableRichText(input.currentBlock);
  const currentPlainText = richTextPlainText(currentRichText);
  const start = Math.max(0, Math.min(input.selectionStart, input.selectionEnd));
  const end = Math.min(
    currentPlainText.length,
    Math.max(input.selectionStart, input.selectionEnd),
  );
  const prefix = richTextRangeSlice(currentRichText, 0, start);
  const suffix = richTextRangeSlice(currentRichText, end, currentPlainText.length);
  const [firstSegment, ...remainingSegments] = segments;
  if (!firstSegment) return null;

  const shouldConvertCurrentBlock = input.currentBlock.type === "paragraph"
    && richTextPlainText(prefix).trim().length === 0;
  const currentSegment: NotesRichHtmlPasteSegment = {
    ...firstSegment,
    richText: shouldConvertCurrentBlock
      ? firstSegment.richText
      : replaceRichTextRange(currentRichText, start, currentPlainText.length, firstSegment.richText),
  };
  if (remainingSegments.length === 0) {
    const singleSegment = segmentWithSuffix(currentSegment, suffix);
    return {
      currentUpdate: shouldConvertCurrentBlock
        ? createUpdateForSegment(singleSegment)
        : blockWithRichText(
            input.currentBlock,
            replaceRichTextRange(currentRichText, start, end, firstSegment.richText),
          ),
      appendedBlocks: [],
      blockDepths: [0],
      focusBlockId: input.currentBlock.id,
      focusOffset: shouldConvertCurrentBlock
        ? richTextPlainText(firstSegment.richText).length
        : start + richTextPlainText(firstSegment.richText).length,
    };
  }

  const lastSegment = remainingSegments.at(-1);
  const appendedSegments = lastSegment
    ? [
        ...remainingSegments.slice(0, -1),
        segmentWithSuffix(lastSegment, suffix),
      ]
    : [];
  const appendedBlocks = appendedSegments.map((segment) => {
    const id = input.createId();
    return createWriteForSegment(id, segment);
  });
  return {
    currentUpdate: shouldConvertCurrentBlock
      ? createUpdateForSegment(currentSegment)
      : blockWithRichText(input.currentBlock, currentSegment.richText),
    appendedBlocks,
    blockDepths: segments.map((segment) => segment.depth ?? 0),
    focusBlockId: appendedBlocks.at(-1)?.id ?? input.currentBlock.id,
    focusOffset: lastSegment ? richTextPlainText(lastSegment.richText).length : 0,
  };
}

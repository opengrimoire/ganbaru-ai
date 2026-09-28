import { blockEditableRichText, blockIndent, blockPlainText, isHeadingBlockType } from "./block-factory";
import { blockColor, notesClipboardColorStyle } from "./block-color";
import { blockChildrenAreVisible, parentIdForBlock } from "./block-tree";
import { richTextPlainText, richTextRangeSlice } from "./rich-text";
import { notesMarkdownFence, notesRichTextMarkdown } from "./clipboard-markdown";
import { notesClipboardLinkUrl } from "./clipboard-links";
import type { NotesBlock, NotesRichText } from "./types";

export interface NotesClipboardContent {
  plainText: string;
  html: string;
}

export interface NotesClipboardBlock {
  block: NotesBlock;
  start?: number;
  end?: number;
}

interface ClipboardNode {
  entry: NotesClipboardBlock;
  children: ClipboardNode[];
}

/** Include hidden descendants of fully selected collapsed blocks in document order. */
export function notesDocumentClipboardBlockIds(
  visibleBlockIds: readonly string[],
  startOffset: number,
  endOffset: number,
  readBlock: (blockId: string) => NotesBlock | undefined,
  outlineSubtreeIds: (rootBlockIds: readonly string[]) => readonly string[],
): string[] {
  const collapsedRoots = new Set<string>();
  for (const [index, blockId] of visibleBlockIds.entries()) {
    const block = readBlock(blockId);
    if (!block) throw new Error("Notes selection content is still loading");
    const startsAtBlockStart = index > 0 || startOffset === 0;
    const endsAtBlockEnd = index < visibleBlockIds.length - 1
      || (endOffset > 0 && endOffset >= blockPlainText(block).length);
    if (startsAtBlockStart && endsAtBlockEnd && !blockChildrenAreVisible(block)) {
      collapsedRoots.add(blockId);
    }
  }
  const descendantsByRoot = new Map<string, string[]>();
  let currentRoot: string | null = null;
  if (collapsedRoots.size > 0) {
    for (const blockId of outlineSubtreeIds([...collapsedRoots])) {
      if (collapsedRoots.has(blockId)) {
        currentRoot = blockId;
        descendantsByRoot.set(blockId, []);
      } else if (currentRoot) {
        descendantsByRoot.get(currentRoot)?.push(blockId);
      }
    }
  }
  const included: string[] = [];
  const seen = new Set<string>();
  const append = (blockId: string): void => {
    if (seen.has(blockId)) return;
    seen.add(blockId);
    included.push(blockId);
  };
  for (const blockId of visibleBlockIds) {
    append(blockId);
    for (const descendantId of descendantsByRoot.get(blockId) ?? []) append(descendantId);
  }
  return included;
}

/** Escape user content for both HTML text and quoted attributes. */
function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}

/** Emit portable inline semantics without editor classes or collaboration metadata. */
function richTextHtml(items: readonly NotesRichText[]): string {
  return items.map((item) => {
    let html = escapeHtml(item.plain_text).replace(/\n/gu, "<br>");
    if (/ {2}|\t/u.test(item.plain_text)) html = `<span style="white-space: pre-wrap">${html}</span>`;
    const annotations = item.annotations;
    if (annotations.code) html = `<code>${html}</code>`;
    if (annotations.bold) html = `<strong>${html}</strong>`;
    if (annotations.italic) html = `<em>${html}</em>`;
    if (annotations.underline) html = `<u>${html}</u>`;
    if (annotations.strikethrough) html = `<s>${html}</s>`;
    if (annotations.color !== "default") {
      html = `<span data-notes-rich-text-color="${escapeHtml(annotations.color)}" style="${escapeHtml(notesClipboardColorStyle(annotations.color))}">${html}</span>`;
    }
    const rawUrl = item.type === "text" ? item.text.link?.url ?? item.href : item.href;
    const url = notesClipboardLinkUrl(rawUrl);
    return url ? `<a href="${escapeHtml(url)}">${html}</a>` : html;
  }).join("");
}

/** Read precisely the selected UTF-16 range, including partial endpoint blocks. */
function selectedRichText(entry: NotesClipboardBlock): NotesRichText[] {
  const items = blockEditableRichText(entry.block);
  return richTextRangeSlice(items, entry.start ?? 0, entry.end ?? richTextPlainText(items).length);
}

/** Group adjacent list items under valid list containers. */
function renderNodes(nodes: readonly ClipboardNode[], insideTable = false): string {
  let html = "";
  let list: "ul" | "ol" | "table" | null = null;
  for (const node of nodes) {
    const type = node.entry.block.type;
    const nextList = type === "numbered_list_item" ? "ol"
      : type === "bulleted_list_item" || type === "to_do" ? "ul"
        : type === "table_row" && !insideTable ? "table" : null;
    if (list !== nextList) {
      if (list) html += `</${list}>`;
      if (nextList) html += `<${nextList}>`;
      list = nextList;
    }
    html += renderNode(node);
  }
  return html + (list ? `</${list}>` : "");
}

/** Represent common blocks with HTML semantics and other blocks with readable text. */
function renderNode({ entry, children }: ClipboardNode): string {
  const { block } = entry;
  const content = richTextHtml(selectedRichText(entry));
  const descendants = renderNodes(children, block.type === "table");
  const color = blockColor(block);
  const style = color === "default" ? "" : ` style="${escapeHtml(notesClipboardColorStyle(color))}"`;
  if (isHeadingBlockType(block.type)) {
    const tag = `h${block.type.slice(-1)}`;
    return `<${tag}${style}>${content}</${tag}>${descendants}`;
  }
  switch (block.type) {
    case "toggle":
      // Keep descendants readable to rich clipboard importers even when this toggle is closed.
      return `<details open${block.toggle.ganbaru_open === false ? ' data-notes-toggle-open="false"' : ""}><summary${style}>${content}</summary>${descendants}</details>`;
    case "bulleted_list_item":
    case "numbered_list_item":
      return `<li${style}>${content}${descendants}</li>`;
    case "to_do":
      return `<li${style}><input type="checkbox" disabled${block.to_do.checked ? " checked" : ""}> ${content}${descendants}</li>`;
    case "callout": {
      const icon = block.callout.icon;
      const marker = icon?.type === "emoji" ? escapeHtml(icon.emoji) : "";
      const metadata = escapeHtml(JSON.stringify(icon));
      return `<aside data-notes-callout-icon-json="${metadata}" data-notes-callout-color="${escapeHtml(color)}"${style}><span data-notes-callout-marker>${marker}</span>${content ? `<p data-notes-callout-label>${content}</p>` : ""}${descendants}</aside>`;
    }
    case "quote":
      return `<blockquote${style}>${content}${descendants}</blockquote>`;
    case "code":
      return `<pre><code class="language-${escapeHtml(block.code.language)}">${escapeHtml(richTextPlainText(selectedRichText(entry)))}</code></pre>${descendants}`;
    case "divider":
      return `<hr>${descendants}`;
    case "table":
      return `<table><tbody>${children.map((node, rowIndex) => {
        const row = node.entry.block;
        if (row.type !== "table_row") return renderNode(node);
        return `<tr>${row.table_row.cells.map((cell, columnIndex) => {
          const columnHeader = block.table.has_column_header && rowIndex === 0;
          const rowHeader = block.table.has_row_header && columnIndex === 0;
          const tag = columnHeader || rowHeader ? "th" : "td";
          const scope = columnHeader ? ' scope="col"' : rowHeader ? ' scope="row"' : "";
          return `<${tag}${scope}>${richTextHtml(cell)}</${tag}>`;
        }).join("")}</tr>`;
      }).join("")}</tbody></table>`;
    case "table_row":
      return `<tr>${block.table_row.cells.map((cell) => `<td>${richTextHtml(cell)}</td>`).join("")}</tr>`;
    case "column":
    case "column_list":
    case "tab":
      return descendants;
    default:
      return `<p${style}>${content}</p>${descendants}`;
  }
}

/** Serialize block structure as Markdown for plain-text and Markdown editors. */
function renderMarkdown(nodes: readonly ClipboardNode[]): string {
  const parts: string[] = [];
  let previousList = "";
  let number = 0;
  for (const { entry, children } of nodes) {
    const { block } = entry;
    const items = selectedRichText(entry);
    const content = notesRichTextMarkdown(items);
    const descendants = renderMarkdown(children);
    const list = ["numbered_list_item", "bulleted_list_item", "to_do"].includes(block.type) ? block.type : "";
    number = list === "numbered_list_item" ? (previousList === list ? number + 1 : 1) : 0;
    let value = content;
    if (isHeadingBlockType(block.type)) value = `${"#".repeat(Number(block.type.slice(-1)))} ${content}`;
    else if (block.type === "toggle") {
      value = `- ${content}`;
      if (descendants) value += `\n\n${descendants.split("\n").map((line) => `    ${line}`).join("\n")}`;
    }
    else if (list) {
      const marker = block.type === "numbered_list_item" ? `${number}. `
        : block.type === "to_do" ? `- [${block.to_do.checked ? "x" : " "}] ` : "- ";
      const indent = " ".repeat(marker.length);
      value = marker + content.replace(/\n/gu, `\n${indent}`);
      if (descendants) value += `\n${descendants.split("\n").map((line) => indent + line).join("\n")}`;
    } else if (block.type === "code") {
      const text = richTextPlainText(items);
      const fence = notesMarkdownFence(text);
      const language = block.code.language === "plain text" ? "" : block.code.language.replace(/[\r\n`]/gu, "");
      value = `${fence}${language}\n${text}\n${fence}`;
    } else if (block.type === "divider") value = "---";
    else if (block.type === "callout") {
      const icon = block.callout.icon?.type === "emoji" ? `${block.callout.icon.emoji}\n\n` : "";
      const body = [content, descendants].filter(Boolean).join("\n\n");
      value = `<aside>\n${icon}${body}${body ? "\n\n" : ""}</aside>`;
    } else if (block.type === "quote") {
      value = [content, descendants].filter(Boolean).join("\n\n").split("\n").map((line) => `> ${line}`).join("\n");
    } else if (block.type === "table") {
      const rows = children.filter((node) => node.entry.block.type === "table_row");
      const lines = rows.map((node) => {
        const row = node.entry.block;
        if (row.type !== "table_row") return "";
        const cells = row.table_row.cells.map((cell) => notesRichTextMarkdown(cell)
          .replace(/(?<!\\)(?:\\\\)*\|/gu, (match) => match.slice(0, -1) + "\\|")
          .replace(/ *\n/gu, "<br>"));
        return `| ${cells.join(" | ")} |`;
      });
      if (lines.length) {
        const width = block.table.table_width;
        const header = block.table.has_column_header ? lines.shift()! : `| ${Array.from({ length: width }, () => "").join(" | ")} |`;
        value = [header, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...lines].join("\n");
      } else value = "";
    } else if (["column", "column_list", "tab"].includes(block.type)) value = descendants;
    if (descendants && !list && !["toggle", "quote", "callout", "table", "column", "column_list", "tab"].includes(block.type)) {
      value += `\n\n${descendants}`;
    }
    const separator = list && previousList === list ? "\n" : "\n\n";
    if (parts.length) parts.push(separator);
    parts.push(value);
    previousList = list;
  }
  return parts.join("");
}

/** Build HTML and plain text from selected model content, independent of mounted rows. */
export function notesClipboardContent(entries: readonly NotesClipboardBlock[]): NotesClipboardContent {
  const endsAtBoundary = entries.length > 1 && entries.at(-1)?.end === 0;
  const selectedEntries = endsAtBoundary ? entries.slice(0, -1) : entries;
  const roots: ClipboardNode[] = [];
  const byId = new Map<string, ClipboardNode>();
  const indentStacks = new Map<string, ClipboardNode[]>();
  for (const entry of selectedEntries) {
    const node: ClipboardNode = { entry, children: [] };
    const { block } = entry;
    const parentId = parentIdForBlock(block);
    const stack = indentStacks.get(parentId) ?? [];
    while (stack.length && blockIndent(stack[stack.length - 1].entry.block) >= blockIndent(block)) stack.pop();
    const parent = stack.at(-1) ?? (block.parent.type === "block_id" ? byId.get(parentId) : undefined);
    (parent?.children ?? roots).push(node);
    stack.push(node);
    indentStacks.set(parentId, stack);
    byId.set(block.id, node);
  }
  return {
    plainText: renderMarkdown(roots) + (endsAtBoundary ? "\n" : ""),
    html: renderNodes(roots) + (endsAtBoundary ? "<br>" : ""),
  };
}

/** Write both standard clipboard representations; failed writes must not authorize cuts. */
export async function writeNotesClipboard(content: NotesClipboardContent): Promise<void> {
  if (!navigator.clipboard) throw new Error("Notes clipboard is unavailable");
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob([content.plainText], { type: "text/plain" }),
      "text/html": new Blob([content.html], { type: "text/html" }),
    })]);
    return;
  }
  await navigator.clipboard.writeText(content.plainText);
}

/** Populate synchronous copy/cut events without requiring async clipboard permission. */
export function setNotesClipboardData(data: DataTransfer, content: NotesClipboardContent): void {
  data.setData("text/plain", content.plainText);
  data.setData("text/html", content.html);
}


/** Copy a cell or another inline-only field without introducing block markers. */
export function notesInlineClipboardContent(items: readonly NotesRichText[]): NotesClipboardContent {
  return { plainText: notesRichTextMarkdown(items), html: richTextHtml(items) };
}

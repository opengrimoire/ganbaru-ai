# Notes clipboard interoperability

Status: implemented portable-content handling with automated coverage. External application acceptance remains pending.

## Scope and evidence

Notes writes Markdown in `text/plain` and semantic markup in `text/html`. The receiving app chooses a representation. Keyboard copying, context-menu copying, cross-block text selections, whole-block copying, and table-cell text copying use the model rather than editor CSS. Native copy events provide both formats; menu operations depend on the webview clipboard API and emit Markdown alone where rich writes are unavailable.

Incoming text editors and document ranges accept sanitized HTML or Markdown. Table cells accept the same inline formatting and flatten block structure into text. Whole-block paste from a non-editable row remains an internal graph operation. If another app replaces the system clipboard, that operation discards its stale internal reference and returns focus to the text editor; external content can then be pasted there.

This contract concerns clipboard exchange. SQLite remains authoritative for Notes. File import/export, managed assets, and working Markdown have separate workflows.

Sources reviewed on 2026-09-26:

- [Obsidian basic syntax](https://obsidian.md/help/syntax) documents six heading levels, inline formatting, lists, tasks, links, and code.
- [Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown) describes CommonMark/GFM support and warns that Markdown inside HTML elements is not rendered. Underline combined with other marks therefore uses nested semantic HTML.
- [GFM](https://github.github.com/gfm/) defines the Markdown table, task, and strikethrough syntax used for portable exchange.
- [Notion import documentation](https://www.notion.com/help/import-data-into-notion) documents supported import formats and conversion limits. File-import support is not evidence that its clipboard reader preserves every feature.

Automated fixtures are synthetic semantic examples, not captured Notion or Obsidian clipboard payloads. The reported Notion heading discrepancy motivated matching-format reconciliation; its behavior has not been reproduced in a live external application in this environment.

## Supported semantics

| Content | Copy from Notes | Paste into Notes |
| --- | --- | --- |
| Headings | H1 through H6 in HTML and Markdown | H1 through H6; matching Markdown levels correct conflicting HTML levels without discarding inline styling |
| Paragraphs and line breaks | Semantic paragraphs and Markdown paragraph/hard-break syntax | Paragraphs and supported line breaks |
| Bold, italic, strike, inline code | Semantic HTML and Markdown | Both representations, including adjacent and overlapping annotations |
| Underline | HTML, including portable inline HTML in Markdown | Supported semantic inline HTML |
| Web/email links | Explicit HTTP, HTTPS, and mailto links | Supported links; relative destinations remain readable text without an invented host |
| Bullets, numbered lists, tasks | Nested lists and checked state | Mixed nested hierarchy and checked/unchecked tasks |
| Quotes and dividers | HTML and Markdown | Quote text, paragraph boundaries, and dividers |
| Fenced code | Safe variable-length fences and language metadata; literal HTML code text | Code text and language; existing code editors keep pasted source literal |
| Simple tables | HTML cells and header flags; GFM table syntax | Structured tables, rich cell text, headers, and retained surrounding text |
| Cell text selections | Markdown and semantic inline HTML | Inline styles retained; multiple blocks flattened into the cell |
| Partial/document selections | Selected UTF-16 ranges and hydrated offscreen content | Retained prefix/suffix, hierarchy, and undo/redo |

Matching-format reconciliation requires equivalent text, equal heading counts, and corresponding heading text. It never shifts arbitrary website headings globally.

## Approximations and limits

- Fonts, sizes, alignment, arbitrary CSS colors, and layout are not a cross-app fidelity guarantee. Notes emits its colors in HTML and understands its own color metadata; arbitrary external color palettes are not imported. Markdown has no standard color syntax.
- HTML preserves explicit blank blocks, repeated spaces, and tabs from Notes. Markdown consumers can collapse blank paragraphs or whitespace under their own rendering rules.
- Ordered lists use the Notes numbering model; arbitrary HTML start values, reversed numbering, and custom task states do not survive as distinct metadata.
- GFM requires a header row. Exporting a headerless table adds an empty header without promoting the first data row. Markdown cannot represent row-header flags or merged cells. HTML merged cells are expanded into a rectangle with content in the first covered cell.
- Nested tables and tables exceeding the supported width degrade to readable row/cell text. Oversized block structures flatten excess content rather than constructing invalid partial tables.
- Callouts and toggles transfer readable content and descendants, without portable callout styling or interactive collapse state. Columns flatten into document order.
- Relative paths lack a shared vault base. Image HTML and Markdown retain descriptions and source references as text; clipboard handling does not download images, import media bytes, or authorize foreign filesystem paths.
- Wikilinks, equations, highlights, footnotes, embeds, comments, database relations, synced objects, page identities, and plugin syntax have no general conversion contract. Available source text or labels can remain readable, but app-specific behavior is not recreated.
- Rich HTML is sanitized and bounded to 128 KiB; plain text is bounded to 64 KiB. Structured paste uses the shared 101-block bound, with readable flattening where applicable. Rejected content does not imply successful import.
- “Paste as plain text” in the text context menu inserts literal source. Clipboard permissions, webview capabilities, operating system behavior, and receiving-app settings affect available formats.

## Verification

Automated checks cover serialization and reparsing, matching heading levels, links and unsafe markup, nested lists, code delimiters, combinations of inline styles, table headers/cells/spans, Unicode, whitespace, empty blocks, insertion boundaries, clipboard write failures, and stale internal clipboard ownership. Delayed-storage tests exercise real editor actions, projection, persistence sequencing, and undo/redo for table and list pastes.

These checks establish behavior in our code. They do not establish that every version or mode of Notion or Obsidian consumes it identically. Follow the [manual clipboard acceptance matrix](../testing/notes-editor.md#clipboard-export-interoperability) on supported platforms. Record application versions, OS/webview, source mode, destination mode, clipboard formats, and observed semantic differences before claiming external-app acceptance.

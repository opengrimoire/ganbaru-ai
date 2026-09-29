# Notes clipboard interoperability

Status: implemented portable-content handling with automated coverage. External application acceptance remains pending.

## Scope and evidence

Notes writes readable Markdown in `text/plain` and semantic markup in `text/html`. The receiving app chooses a representation. Keyboard copying, context-menu copying, cross-block text selections, whole-block copying, and table-cell text copying use the model rather than editor CSS. A fully selected collapsed toggle contributes its hidden descendants, including in Ctrl/Cmd+A copies; a partial title selection does not. Native copy events provide both formats; menu operations depend on the webview clipboard API and emit Markdown alone where rich writes are unavailable.

Incoming text editors and document ranges accept sanitized HTML or Markdown. Table cells accept the same inline formatting and flatten block structure into text. Whole-block paste from a non-editable row remains an internal graph operation. If another app replaces the system clipboard, that operation discards its stale internal reference and returns focus to the text editor; external content can then be pasted there.

This contract concerns clipboard exchange. SQLite remains authoritative for Notes. File import/export, managed assets, and working Markdown have separate workflows.

Sources reviewed through 2026-09-28:

- [Obsidian basic syntax](https://obsidian.md/help/syntax) documents six heading levels, inline formatting, lists, tasks, links, and code.
- [Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown) describes CommonMark/GFM support and warns that Markdown inside HTML elements is not rendered. Underline combined with other marks therefore uses nested semantic HTML.
- [Obsidian callouts](https://obsidian.md/help/callouts) documents foldable `+` and `-` callouts. [Obsidian HTML guidance](https://obsidian.md/help/html) explains why Markdown inside `<details>` is not a reliable substitute for them.
- [GFM](https://github.github.com/gfm/) defines the Markdown table, task, and strikethrough syntax used for portable exchange.
- [Notion import documentation](https://www.notion.com/help/import-data-into-notion) documents supported import formats and conversion limits. File-import support is not evidence that its clipboard reader preserves every feature.
- [Notion keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts) documents toggle creation and open/close shortcuts, but does not define a clipboard format.
- [Notion content styling](https://www.notion.com/help/customize-and-style-your-content) documents callout icons, backgrounds, and nested content, but does not define a clipboard format.

Automated fixtures are synthetic semantic examples, not captured Notion or Obsidian clipboard payloads. The user observed that Notion copies toggles as nested bullets in plain text, and that pasting Notes HTML from a closed `<details>` into Notion omits its body. Notion does not publish a clipboard-format contract in the linked documentation. The reported Notion heading discrepancy motivated matching-format reconciliation; its behavior has not been reproduced in a live external application in this environment.

## Supported semantics

| Content | Copy from Notes | Paste into Notes |
| --- | --- | --- |
| Headings | H1 through H6 in HTML and Markdown | H1 through H6; matching Markdown levels correct conflicting HTML levels without discarding inline styling |
| Paragraphs and line breaks | Semantic paragraphs and Markdown paragraph/hard-break syntax | Paragraphs and supported line breaks |
| Bold, italic, strike, inline code | Semantic HTML and Markdown | Both representations, including adjacent and overlapping annotations |
| Underline | HTML, including portable inline HTML in Markdown | Supported semantic inline HTML |
| Web/email links | Explicit HTTP, HTTPS, and mailto links | Supported links; relative destinations remain readable text without an invented host |
| Local note rows | Title and `#notes?page=UUID` reference in Markdown; HTML includes the local source page identity | Same-vault rich paste creates independent canonical note copies, including nested notes; plain Markdown creates a page mention |
| Bullets, numbered lists, tasks | Nested lists and checked state | Mixed nested hierarchy and checked/unchecked tasks |
| Toggles | Open `<details><summary>` in HTML so child blocks stay available to rich paste readers; a Notes attribute records closed state. Plain text uses a nested bullet with indented child paragraphs | Sanitized `<details><summary>` and incoming foldable callouts become toggles with children and initial open state; a plain-text bullet remains a list |
| Callouts | Semantic `<aside>` in HTML with icon and color metadata; plain text uses a readable `<aside>` wrapper with an emoji line and nested Markdown blocks | Sanitized HTML and Notion-style plain-text `<aside>` wrappers become callouts with normal child blocks, including headings and nested callouts |
| Quotes and dividers | HTML and Markdown | Quote text, paragraph boundaries, and dividers |
| Fenced code | Safe variable-length fences and language metadata; literal HTML code text | Code text and language; existing code editors keep pasted source literal |
| Simple tables | HTML cells and header flags; GFM table syntax | Structured tables, rich cell text, headers, and retained surrounding text |
| Cell text selections | Markdown and semantic inline HTML | Inline styles retained; multiple blocks flattened into the cell |
| Partial/document selections | Selected UTF-16 ranges and hydrated offscreen content | Retained prefix/suffix, hierarchy, and undo/redo |

Heading reconciliation requires equivalent text, equal heading counts, and corresponding heading text. It never shifts arbitrary website headings globally. If a foldable Markdown callout and styled HTML contain the same words, Notes uses the Markdown structure when the HTML has no semantic `<details>` toggle.

Pasting a toggle into the middle of existing text keeps the prefix and suffix in surrounding blocks. The toggle title and its children remain a separate subtree. A pasted closed toggle keeps focus on a visible block instead of a hidden child.

Plain-text toggle children use indented blank lines to keep their paragraphs separate, matching the user's Notion copy example. Obsidian will ordinarily interpret that text as a nested bullet. Incoming foldable Obsidian callouts still import as toggles. The receiving app may choose HTML instead of Markdown. The user's observed Obsidian paste of two toggles with an omitted closed body joined their titles; external HTML conversion still needs a live retest.

## Approximations and limits

- Fonts, sizes, alignment, arbitrary CSS colors, and layout are not a cross-app fidelity guarantee. Notes emits its colors in HTML and understands its own color metadata; arbitrary external color palettes are not imported. Markdown has no standard color syntax.
- HTML preserves explicit blank blocks, repeated spaces, and tabs from Notes. Markdown consumers can collapse blank paragraphs or whitespace under their own rendering rules.
- Ordered lists use the Notes numbering model; arbitrary HTML start values, reversed numbering, and custom task states do not survive as distinct metadata.
- GFM requires a header row. Exporting a headerless table adds an empty header without promoting the first data row. Markdown cannot represent row-header flags or merged cells. HTML merged cells are expanded into a rectangle with content in the first covered cell.
- Nested tables and tables exceeding the supported width degrade to readable row/cell text. Oversized block structures flatten excess content rather than constructing invalid partial tables.
- Other applications may ignore `<aside>` or choose a different clipboard representation. Notes icon and color metadata round-trip through its own HTML, while plain text preserves only a leading emoji icon. Notes records closed toggle state in an HTML attribute while keeping copied details open for external rich paste. Another app may import that toggle as open. Incoming foldable Obsidian callouts preserve their marker's open state. Columns flatten into document order.
- There is no shared Markdown toggle syntax across Notion and Obsidian. Notes emits a readable nested bullet in plain text and semantic `<details>` in HTML. Another app may choose either representation, turn the toggle into a list, or ignore its open state.
- Relative paths lack a shared vault base. Image HTML and Markdown retain descriptions and source references as text; clipboard handling does not download images, import media bytes, or authorize foreign filesystem paths.
- Wikilinks, equations, highlights, footnotes, embeds, comments, database relations, synced objects, foreign page identities, and plugin syntax have no general conversion contract. Available source text or labels can remain readable, but app-specific behavior is not recreated. Local note-row HTML copies resolve through the active vault and fail visibly if the source is unavailable. Their Markdown references are local identifiers, not public sharing URLs or operating-system links.
- Rich HTML is sanitized and bounded to 128 KiB; plain text is bounded to 64 KiB. Structured paste uses the shared 101-block bound, with readable flattening where applicable. Rejected content does not imply successful import.
- “Paste as plain text” in the text context menu inserts literal source. Clipboard permissions, webview capabilities, operating system behavior, and receiving-app settings affect available formats.

## Verification

Automated checks cover serialization and reparsing, matching heading levels, links and unsafe markup, nested lists, toggles and foldable callouts, code delimiters, combinations of inline styles, table headers/cells/spans, Unicode, whitespace, empty blocks, insertion boundaries, clipboard write failures, and stale internal clipboard ownership. Delayed-storage tests exercise real editor actions, projection, persistence sequencing, and undo/redo for toggle entry, table paste, and list paste.

These checks establish behavior in our code. They do not establish that every version or mode of Notion or Obsidian consumes it identically. Follow the [manual clipboard acceptance matrix](../testing/notes-editor.md#clipboard-export-interoperability) on supported platforms. Record application versions, OS/webview, source mode, destination mode, clipboard formats, and observed semantic differences before claiming external-app acceptance.

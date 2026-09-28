# Notes blocks

Blocks are ordered children of a page or another compatible block. Their canonical type, payload, rich text, parent, order, and Trash state live in SQLite. Internal structural children such as table rows, columns, and tab labels are stored as blocks but rendered through their parent surface.

## Status terms

- **Implemented:** creation or preservation, editing, persistence, and current local rendering support the documented scope.
- **Implemented with limits:** the useful local behavior exists, but a named advanced operation remains unavailable.
- **Preserved:** imported content remains visible and exportable but is not fully editable.
- **Planned:** no complete local block contract exists yet.

## Catalog

| Family | Block types | Status | Important limits |
| --- | --- | --- | --- |
| Text | `paragraph`, `heading_1` through `heading_6`, `quote`, `callout` | Implemented | Headings 4 through 6 are local extensions beyond the current Notion API shape. Custom callout icon editing remains polish. |
| Lists | `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle` | Implemented | Nesting follows valid parent rules and hidden toggle children remain canonical. |
| Code and structure | `code`, `divider`, `equation` | Implemented | Equation rendering uses a safe local formula surface until a vetted renderer is selected. |
| Navigation | `child_page`, `breadcrumb`, `table_of_contents` | Implemented | Generated breadcrumb and heading text is derived rather than duplicated. |
| Databases | `child_database` | Implemented with limits | Six views, templates, relations, rollups, formulas, and typed row buttons exist. Broad destructive automation is unavailable. |
| Layout | `column_list`, `column`, `tab` | Implemented | Internal column and tab-label rows are not standalone document rows. |
| Simple tables | `table`, `table_row` | Implemented | This is a document table, distinct from a database table view. |
| Media and files | `image`, `video`, `audio`, `file`, `pdf` | Implemented | Remote references are explicit and local previews depend on validated managed assets and platform policy. |
| Web references | `bookmark`, `link_preview`, `embed` | Implemented | No automatic remote metadata fetch. Open actions allow only supported safe URL schemes. |
| Reuse | `template`, local `button` | Implemented with limits | Child-page descendants and broad external or destructive actions remain unavailable. |
| Synced content | `synced_block` | Implemented with limits | Originals and imported duplicates are preserved; live fanout editing and local duplicate creation are not implemented. |
| Unknown imports | `unsupported` | Preserved | Raw source metadata and warnings remain visible until deliberate conversion. |

## Text and list blocks

Text blocks share the rich-text editor and support conversion when the source and destination payloads are compatible. Color, annotations, links, mentions, comments, and child subtrees survive compatible conversions and duplication.

The editor shows block actions from a block surface's context menu. Text selection has its own context menu. Blocks can be inserted through the text context menu or keyboard editing commands; moving blocks remains available through block actions and multi-block selection. The editor does not show add or drag handles beside each block.

Block payloads may carry a nonnegative `ganbaru_indent` level relative to their structural parent. Text editing can adjust the level of a child, including an embedded block, to keep its visual position unchanged when its former parent is indented or outdented. This supports standalone row indentation without artificial parent blocks or a schema migration. Typing, conversion between text types, history, duplication, and ordinary Enter preserve it. List numbering and bullet presentation derive from sibling structure and relative indentation. To-do checked state is canonical block payload. Toggle open state can be local presentation metadata while toggle children remain canonical content.

A toggle's label is editable text. Enter in the label opens the toggle and creates a paragraph child from the text after the caret; a selected range is removed. Enter on an empty label creates an empty child. Opening an empty toggle with its chevron leaves the area beneath it blank until content is added. Closing the toggle removes its child rows from the rendered page without deleting them. Ctrl/Cmd+Enter opens or closes a focused toggle. Child paragraphs follow ordinary editing and outdent rules, so a new empty child can leave the toggle with Enter or Backspace. At the page margin, Backspace at the beginning of an empty toggle label converts the toggle to a paragraph.

The row Delete action loads a toggle's hidden children and moves them to the row's parent before removing the row. Deleting a whole-block selection removes the selected toggle subtree. Replacing a text range that fully includes a closed toggle also removes its hidden body; clearing the last selected toggle leaves an ordinary paragraph. Pending text and structural writes complete before the row is trashed.

## Child pages and navigation blocks

Child-page blocks stay paired with normal page rows. Converting a block to a child page creates the nested page, moves valid existing children into its body, and opens it without losing the parent link.

Breadcrumbs derive their path from the page graph and label missing, archived, or trashed ancestors. Table of contents derives from current heading blocks and focuses the selected heading.

## Columns

A column list owns internal column blocks, each of which owns normal content children. The editor renders one responsive layout, can add, remove, reorder, and resize columns, and can move blocks between them.

Removing a column moves its children to a valid neighboring column before deleting the container. Nested subtrees remain attached. Narrow layouts stack columns without rewriting their stored order or widths.

## Simple tables

A table owns table-row children whose cells are rich-text arrays. The parent stores width and header flags. The editor renders the table as one surface with cell keyboard navigation and row or column controls.

Simple tables do not gain database properties, filtering, sorting, row pages, relations, or views. Those belong to [Notes databases](databases.md).

## Tabs

A tab block owns internal paragraph labels, and each label owns its panel content. The editor hides label rows from the ordinary document flow and renders one tab surface.

Renaming, icon selection, add, remove, reorder, and block movement preserve panel children. Removing a tab relocates its content before deleting the internal label.

## Media and files

Media and file blocks use explicit source objects. New remote references require HTTPS and a type compatible with the block. Supported YouTube links can be stored for video blocks but are opened explicitly rather than embedded automatically in Notes.

Local attachments become managed assets with content-derived identity and reference ownership. Captions remain rich text. Generic files show metadata; supported local media can render bounded native previews.

Imported provider-hosted or upload references remain source placeholders and are not fetched silently. Replacing a reference is an explicit user action.

## Bookmarks, previews, and embeds

Bookmark, link-preview, and embed blocks store the original safe URL and local caption where applicable. Cards are derived from URL parts only. No remote page metadata is fetched automatically, which preserves privacy and avoids hidden network authority.

## Synced blocks

An original synced block can own ordinary children. A duplicate stores a source-block reference and remains a visible read-only reference placeholder. Ganbaru AI does not currently fan edits out across duplicates or create local duplicate graphs.

## Template blocks

A template block owns reusable child blocks. Running it duplicates the loaded child subtree at the configured position through normal canonical commands. Child-page descendants disable use because page identity pairing requires a separate safe duplication contract.

This local block remains supported even where an external provider no longer permits creating its equivalent through a public API.

## Button blocks

Local button blocks have a rich label, optional icon, and bounded typed actions. The implemented block action inserts a stored child subtree at a configured local position.

Webhooks, email, third-party actions, broad database edits, and destructive automation remain disabled until each action has a typed schema, authority model, confirmation behavior, and tests.

## Unsupported blocks

Unsupported imports remain visible with source type, warnings, and raw-payload availability. They participate in search and normal block lifecycle. Explicit conversion can create a readable summary or editable JSON representation; conversion never occurs silently.

## Validation

Type payloads, colors, URLs, IDs, parent compatibility, managed assets, and structural operations are validated in both frontend boundaries and canonical Rust commands. Unknown external data never becomes a typed block without validation.

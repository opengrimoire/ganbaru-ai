# Notes editor

## Editing model

The editor renders one canonical page block tree through bounded outlines and retained content windows. It can load long pages incrementally without treating the current rendered range as the complete document.

Block mutations use stable IDs and transactional commands. Multi-block move, duplicate, and Trash operations include unloaded descendants through canonical tree reads so hidden content cannot be lost.

## Rich text

Text-capable blocks store structured rich text with plain-text caches for search and summaries. Supported local formatting includes emphasis, underline, strike, code, colors, links, mentions, equations, and comments where the block type permits them.

Right-clicking text opens a compact context menu with formatting, block type, insert, link, comment, suggestion, and clipboard actions. A selected range stays visibly highlighted while the pointer-operated menu is open, and formatting applies to that range. Block type and insert actions are available at a caret. Comment and suggestion are direct menu actions. The formatting submenu includes a palette of labeled text and background swatches.

Paste converts supported rich text and block structure, sanitizes external markup, and preserves unsupported material visibly when practical. It never inserts executable HTML or unsafe URL schemes.

## Enter and line breaks

Enter in ordinary text splits the current block at the selection, removes selected text, preserves rich-text annotations on the correct side, and creates the appropriate sibling type.

Paragraphs, list items, to-dos, and toggles continue their type. Headings, quotes, and callouts continue into a paragraph. Enter on an empty structural text block converts it to a paragraph rather than creating an endless empty structure.

Shift+Enter inserts a soft line break. Code blocks keep Enter as a code newline and use a documented alternate command to leave the block.

## Backspace, nesting, and movement

Backspace in an empty block removes it unless it is the only visible editable block. Backspace at the start of compatible text merges into the previous block while retaining valid rich text and children.

Tab nests under a previous sibling only when that parent accepts the source type. Shift+Tab outdents only to a valid destination. Page roots, database surfaces, table internals, columns, and tab-label layers reject structurally invalid moves before persistence.

Pointer block movement and destination pickers preserve full subtrees. Moving a block across pages validates access, active state, ancestry, and target type.

## Undo and redo

Undo and redo record page-local snapshot pairs at the same semantic mutation boundaries as normal commands. Text bursts and consecutive Enter actions can group; formatting, links, mentions, paste, template use, buttons, and structural edits remain discrete.

Snapshots preserve focus and selection. Undo updates the local tree immediately and persists ordered canonical mutations. The recovery stack is bounded by count and serialized size and is derived state, not a second content source.

An undo failure never prevents the canonical page from loading. See [Notes editor testing](../../testing/notes-editor.md).

## Optimistic persistence

Typing and common structural edits update local state immediately. Per-block saves remain ordered. A save acknowledgement replaces local state only when no newer local revision exists.

**Planned for device synchronization:** text fields will use SQLite-persisted Yrs state and incremental Yjs-compatible editor operations. Current full-block payload writes are not a merge protocol. The adapter must preserve relative selections and comment anchors, composition and Unicode using UTF-16 offsets, local undo, and pending input after persistence failures. Canonical binary updates and deterministic rendering projections must commit together before acknowledging a save. See [Device linking and synchronization](../../data/sync.md).

Dependent operations such as rapid row creation, paste, and deletion preserve ordering without reloading the complete page after every write. A failed write leaves a visible recoverable state and never silently discards the local draft.

## Comments and suggestions

Page discussions, block comments, inline anchored comments, and text suggestions are collaboration metadata rather than block content. Comment and suggestion writes append versioned collaboration operations in the same transaction as canonical state changes.

Accepting or rejecting a suggestion validates the stored base context. Stale anchors or versions produce a conflict rather than applying text to the wrong range.

## Media and assets

Local media and files are copied into managed Notes assets after path, size, MIME, extension, and digest validation. Blocks store managed identities rather than raw absolute paths. External media remains an explicit HTTPS reference and is not fetched automatically when platform content policy disallows it.

Missing managed files show a recoverable unavailable state. Replacing or removing a block reference does not bypass deduplication, history pins, or ownership cleanup.

## Loading and focus

One internal page viewport owns long-content scrolling. Focus recovery scrolls that viewport and rejects stale focus requests from earlier rapid edits. Loading placeholders preserve approximate document position without becoming editable phantom blocks.

## Accessibility

Block handles, insert and conversion menus, formatting, comments, movement, media controls, database open actions, and page navigation are keyboard reachable. Selection and drag actions have non-pointer equivalents. Focus remains visible and returns to a stable nearby target after deletion, movement, dialogs, or responsive layout changes.

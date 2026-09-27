# Notes editor

**Status: Implemented editing core, with manual desktop and Android interaction acceptance still required.**

## Editing model

The editor presents a continuous document backed by a canonical page block tree. Blocks carry rich content and structure; they must not impose text selection boundaries. Lightweight outlines and retained content windows support incremental loading without treating the rendered window as the complete document.

Block mutations use stable IDs and transactional commands. Multi-block move, duplicate, and Trash operations include unloaded descendants through canonical tree reads so hidden content cannot be lost.

## Rich text

Text-capable blocks store structured rich text with plain-text caches for search and summaries. Supported local formatting includes emphasis, underline, strike, code, colors, links, mentions, equations, and comments where the block type permits them.

Right-clicking text opens a compact context menu with formatting, block type, insert, link, comment, suggestion, and clipboard actions. A selected range stays visibly highlighted while the pointer-operated menu is open, and formatting applies to that range. Block type and insert actions are available at a caret. Comment and suggestion are direct menu actions. The formatting submenu includes a palette of labeled text and background swatches.

Paste converts supported rich text and block structure, sanitizes external markup, and preserves unsupported material visibly when practical. It never inserts executable HTML or unsafe URL schemes.

## Headings

Six heading levels are implemented, matching the six-level Markdown structure documented by [Obsidian](https://obsidian.md/help/syntax). Create them through slash commands, the context menu, or one through six `#` characters followed by Space. All six support rich text, colors, toggle children, table-of-contents navigation, history, and undo/redo.

Heading typography shares the body font-scale setting across editing and historical previews. Levels 1 through 6 use 1.875, 1.5, 1.375, 1.25, 1.125, and 1 times the body size, with semibold weight and a 1.3 line height. Level 6 stays at body size for readability and is distinguished by weight; the page title remains larger than heading 1. Typography tokens live in the shared stylesheet.

Existing vaults receive a transactional migration widening the block and page-template type constraints. It copies each type before replacing its constrained column, preserving block IDs, payloads, parent links, and dependent rows with foreign keys enabled. New rows retain paragraph as the storage default; normal application writes continue to provide an explicit validated type.

## Slash commands

Empty editing rows remain visually blank, including when focused. Entering `/` into an empty text block opens a searchable command menu. Detection follows text input, including keyboard layouts that require Shift for `/` and software-keyboard input. During IME composition the panel pauses and resumes filtering once the composed query commits. Code blocks keep slash characters literal. Typing after `/` filters commands by their localized names and English aliases; `/#` through `/######` select the corresponding heading level.

The menu groups recent commands, basic blocks, media, advanced blocks, actions, and colors. It offers the content types and actions supported by Ganbaru. Up and Down change the active command and scroll it into view; Enter or Tab applies it. Escape, Close menu, moving focus away, or an outside click dismisses the panel without consuming literal slash text. Editing a dismissed query does not reopen it until the trigger is removed and entered again. Deleting the slash closes the menu.

The typed query remains in the editing row, with a search summary in the panel. The insertion menu also offers a search field when there is no editing host. Menus preserve editing focus on pointer selection, render outside clipped block rows within the current floating surface, and reposition above or below the slash trigger as space allows. The horizontal anchor stays stable while the query grows. Scroll and viewport changes, including the software keyboard viewport, update placement. Focus preloads the optional menu; loading and retry states remain visible when needed.

**Reference:** interaction follows Notion's [slash-command guide](https://www.notion.com/en-gb/help/guides/using-slash-commands) and [keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts), reviewed on 2026-09-25. The available commands are defined by Ganbaru’s local command catalog. Opening slash commands in the middle of existing prose remains outside the current empty-block trigger contract.

## Enter and line breaks

Enter in ordinary text splits the current block at the selection, removes selected text, preserves rich-text annotations on the correct side, and creates the appropriate sibling type.

Paragraphs, list items, to-dos, and toggles continue their type. Headings, quotes, and callouts continue into a paragraph. Enter on an empty structural text block converts it to a paragraph rather than creating an endless empty structure.

Shift+Enter inserts a soft line break. Code blocks keep Enter as a code newline and use a documented alternate command to leave the block.

## Lists

Consecutive numbered siblings display increasing ordinals starting at 1. Each parent has an independent sequence, so nested content does not interrupt the outer list; a different sibling block type ends the current sequence. Numbers derive from the complete ordered outline, including unmounted and unhydrated rows, and update immediately after insertion, removal, conversion, reordering, and undo. Lists in columns, tabs, and historical page previews follow the same rule. Number and bullet markers share the editable first line's font size, line height, and vertical padding.

## Backspace, nesting, and movement

Backspace at a collapsed caret at the start of a numbered item, bullet item, to-do, toggle, quote, callout, or heading first converts it to a paragraph. It removes the marker or block styling, preserves rich text and descendants, and keeps the caret at the start. This applies to empty items too, without removing the row or joining the preceding item. The conversion is one undo step. Hardware and software keyboards use the same rule; range deletion and deletion within text retain the current block type.

Backspace in other empty blocks removes them unless only one editable block remains. Backspace at the start of compatible ordinary text merges into the previous block while retaining valid rich text and children. Forward Delete retains its ordinary text-deletion behavior.

Tab increases indentation on ordinary text, headings, and list items, including an empty first row. Indentation is not limited by the presence of a previous sibling or by a small display-depth cap. Tab and Shift+Tab change only the current text row by one level. Other rows keep their visual depths, including existing children and later nested siblings. The editor adjusts parent relationships and relative indentation as needed to preserve document order. For example, indenting ABC in a list with depths `ABC: 0, DEF: 1, GHI: 0` produces `ABC: 1, DEF: 1, GHI: 0`. Repeating Tab can move ABC deeper than DEF without moving DEF. At the start of indented text, Backspace removes one level before removing a list marker; at the left margin, Backspace on a list removes the marker and keeps the text. Enter continues the current indentation, while Enter on an empty indented row reduces it one level before exiting list formatting. Code blocks use Tab and Shift+Tab to edit code whitespace.

Indentation updates locally before persistence and preserves the caret or selected range. Shift+Tab at the left margin leaves both text and focus unchanged. Editor Tab commands also recognize the physical Tab key when a webview cannot identify its logical key, including Shift+Tab on Linux. A document selection changes each explicitly selected text row once and records one undo step. Unselected descendants keep their depths; selecting both a parent and a child does not change the child twice. Required unmounted neighbours are loaded before the operation, and rapid commands remain ordered while that load is pending. Repeated commands use the latest local state. Nesting opens a collapsed toggle or toggle heading so the edited block stays visible. Page roots, database surfaces, table internals, columns, and tab-label layers remain structural boundaries. Explicit indentation does not create artificial empty parent blocks.

## Document selection

Ctrl/Cmd+A in the page body selects the complete body on the first press, including offscreen blocks. The title and embedded form controls retain their own selection behavior. Selecting the body does not mount or load every block first; clipboard and editing operations hydrate the required content in bounded requests.

Shift+Arrow, Ctrl/Cmd+Shift+Home/End, Shift-click, and pointer dragging extend text ranges across ordinary block editors. Ranges retain the anchor, direction, and UTF-16 offsets of both endpoints. Crossing a block boundary must not round partial text selections to whole blocks. Each rendered text segment receives an explicit highlight independently of the native editing-host selection. Both explicit and native highlights use the shared selection-background theme token. While explicit painting is active, the native selection background is transparent within that editor so translucent highlights do not stack and darken the active block. Native highlighting returns when explicit painting clears or has no visible geometry. Webviews without CSS custom highlights use an inert rectangle overlay. Highlight ranges refresh when the rendered window or layout changes and clear when selection ends. A selection within one editing host continues to use that editor's normal rich-text commands.

Cross-block ranges support copy, cut, deletion, replacement typing, multiline and sanitized rich-HTML paste, and basic annotation shortcuts. Replacement preserves the unselected prefix, suffix, and rich-text annotations. Unselected descendants survive removal of a selected parent. A range replacement or formatting change records one undo entry and uses the ordered persistence queue.

The end of a text range is exclusive. A selection ending at the start of a later row includes the preceding line break but none of that row's text. Tab and Shift+Tab leave that endpoint row's indentation unchanged, in either selection direction. Text formatting also leaves its text unchanged. Copy retains the selected line break, and cut or replacement preserves the unselected endpoint text. Shift+Left from that endpoint first removes the selected line break, then contracts into the previous row's text.

Selection alone displays no action bar or selected-block counter. Right-click opens selection actions. Cross-block text ranges offer clipboard, deletion, bold, italic, and underline actions; per-block text menus retain their richer link, comment, suggestion, and conversion controls.

Clicking a text row places the caret in its editor, including clicks on padding, indentation space, or a list marker. Those surrounding areas resolve to the nearest text position on the clicked visual line. They do not focus the row wrapper or enter whole-block selection. Shift-click and dragging from those areas extend ordinary text selection, within one row or across rows. Clicking text clears any previous whole-block selection. Buttons, checkboxes, links, and embedded controls keep their own interactions.

Explicit whole-block selection remains available from non-text block surfaces. A containing layout's selection area does not extend into its child text rows. Escape in editable text dismisses an active menu without selecting the block, moving focus to its wrapper, or replacing text selection with a full-row fill or outline. Escape from an intentional block selection clears it and returns to text editing when available. Its duplicate, movement, clipboard, and deletion actions live in the right-click menu and keyboard shortcuts.

**Partial:** highlight rendering and vertical caret movement depend on the platform webview and still require desktop and Android acceptance. Partial ranges retain their mounted span while extending; very large partial ranges can increase rendering cost. Embedded database fields, table-cell editors, and other form controls retain their own editing domains.

The [Notes clipboard interoperability contract](../../interop/notes-clipboard.md) defines supported semantics, deliberate approximations, and the remaining manual acceptance boundary.

**Implemented:** copy and cut emit both standard `text/html` and `text/plain` clipboard representations for single-block text, cross-block ranges, table-cell text, and whole-block selections. HTML uses semantic headings, inline formatting, links, lists, quotes, code, task checkboxes, and tables, independent of editor CSS or mounted rows. Partial endpoint text remains partial. Whole-block copying hydrates descendant bodies from the outline before writing the clipboard. The `text/plain` representation contains Markdown: heading markers, inline formatting, links, list and task markers, quotes, and fenced code. Paragraphs use Markdown block separators, literal Markdown punctuation is escaped, and partial endpoint text remains clipped to the selected range. This allows plain-text editors and Markdown apps to retain structure. Colors remain in HTML because Markdown has no standard color notation. Receiving apps choose which representation to accept and may convert HTML into Markdown.

Application-specific objects such as mentions and equations retain readable text, not portable interactive identities; managed media bytes and embedded databases are not transferred by text copy.

Normal paste accepts sanitized rich HTML and Markdown within the supported paste block catalog. When both representations have matching content and headings, the explicit Markdown heading levels determine the imported levels while HTML retains inline styling. Ordinary HTML headings without matching Markdown keep their own levels. Replacing an entire heading with another heading adopts the pasted level. Markdown `>` creates a quote. Explicit paste as plain text and pasting inside a code block keep literal text. HTML and GFM Markdown tables become structured tables with rectangular cells. Merged HTML cells expand into blank covered cells. Headerless tables receive an empty header row only in Markdown export, whose table syntax requires one.

Actual formatting fidelity depends on the receiving app and platform clipboard. Menu copy uses the Markdown text representation if the webview lacks the rich asynchronous clipboard API; native copy events provide both formats. Failed writes leave cut content intact.

Pointer block movement and destination pickers preserve full subtrees. Moving a block across pages validates access, active state, ancestry, and target type.

## Undo and redo

Undo and redo record page-local snapshot pairs at the same semantic mutation boundaries as normal commands. Text bursts and consecutive Enter actions can group; formatting, links, mentions, paste, template use, buttons, and structural edits remain discrete.

Snapshots preserve focus and selection, including both block IDs, UTF-16 offsets, and direction for document ranges. Undoing range deletion or replacement restores the complete active highlight; redo restores the resulting caret. Formatting history preserves the range in both directions. Older recovery entries without document ranges retain their recorded block-local selection. Undo updates the local tree immediately and persists ordered canonical mutations. The recovery stack is bounded by count and serialized size and is derived state, not a second content source.

An undo failure never prevents the canonical page from loading. See [Notes editor testing](../../testing/notes-editor.md).

## Optimistic persistence

Typing, Enter, merge, formatting, and common block updates change local content immediately. Structural edits update the visible outline in the same turn, including insertions in the middle of a page. Merge places the caret at the join. Typing saves, optimistic structural edits, and undo/redo share an ordered persistence queue. A save acknowledgement replaces local state only when no newer local revision exists.

**Planned for device synchronization:** text fields will use SQLite-persisted Yrs state and incremental Yjs-compatible editor operations. Current full-block payload writes are not a merge protocol. The adapter must preserve relative selections and comment anchors, composition and Unicode using UTF-16 offsets, local undo, and pending input after persistence failures. Canonical binary updates and deterministic rendering projections must commit together before acknowledging a save. See [Device linking and synchronization](../../data/sync.md).

Dependent operations such as rapid row creation, paste, and deletion preserve ordering without reloading the complete page after every write. A failed write pauses dependent queued writes, retains the local draft, and displays a save error with Retry. Retry resumes retained operations in order. Draft recovery is in memory: keep the window open until saving succeeds. Structural writes currently use ordered canonical commands, rather than a single SQLite transaction spanning the entire edit; a process interruption between those commands can leave a partially persisted edit.

## Comments and suggestions

Page discussions, block comments, inline anchored comments, and text suggestions are collaboration metadata rather than block content. Comment and suggestion writes append versioned collaboration operations in the same transaction as canonical state changes.

The title actions open compact panels next to their own controls. Clicking an open title action again closes its panel. Add icon, Add cover, and Add comment align their panels with the left edge of the action when viewport space permits. Cover selection shows visual presets, local image upload, and an external image URL where the platform permits it. Add comment opens the page discussion with a composer and scrollable threads. The discussion panel omits a comment count and separates sections and threads with spacing instead of divider lines. The comment fields use a subtle focus fill without an added outline. These panels stay inside the visible viewport and keep the same typography, spacing, and surface treatment as other Notes popovers.

Open and resolved comment threads load together with the page. Show resolved filters the loaded threads immediately without another request.

Accepting or rejecting a suggestion validates the stored base context. Stale anchors or versions produce a conflict rather than applying text to the wrong range.

## Media and assets

Local media and files are copied into managed Notes assets after path, size, MIME, extension, and digest validation. Blocks store managed identities rather than raw absolute paths. External media remains an explicit HTTPS reference and is not fetched automatically when platform content policy disallows it.

Missing managed files show a recoverable unavailable state. Replacing or removing a block reference does not bypass deduplication, history pins, or ownership cleanup.

## Loading and focus

One internal page viewport owns long-content scrolling. Clicking text or its surrounding row space preserves the current scroll position, including partially visible rows and blocks taller than the viewport. Native editor focus must not be interpreted as a request to center or reveal the whole block. Arrow-key movement within text and between rendered blocks leaves the viewport stable until the caret needs to be revealed. Programmatic focus uses the nearest required reveal instead of centering a row merely because no text range was supplied. Focus recovery estimates a scroll position for unloaded blocks only when the request permits scrolling, and rejects stale focus requests from earlier rapid edits. Loading placeholders preserve approximate document position without becoming editable phantom blocks.

## Accessibility

Block handles, insert and conversion menus, formatting, comments, movement, media controls, database open actions, and page navigation are keyboard reachable. Selection and drag actions have non-pointer equivalents. Focus remains visible and returns to a stable nearby target after deletion, movement, dialogs, or responsive layout changes.

## Empty body and deletion

An empty opened page receives a writable paragraph. Deleting all body blocks creates and focuses one empty paragraph immediately, and that paragraph belongs to the same undo step as the deletion. Deleting the only structural block, including a database, trashes the original block and inserts a separate paragraph so undo can restore the original identity. Pending storage writes must not prevent typing into the replacement or overwrite that typing when the append response arrives.

Opening a previously empty page creates one empty paragraph without taking focus from the title. Unloaded root outlines count as existing content and must not trigger empty-page recovery. Enter in the title moves focus to the beginning of the body, except during IME composition. Deleting the first of several blocks focuses the following block rather than the removed block.

### Pasted list hierarchy

**Implemented:** clipboard HTML lists and indented Markdown lists preserve parent and child blocks, including mixed bulleted and numbered lists. Child item text stays separate from its parent, inline HTML formatting survives, and sibling numbering follows each parent independently. Markdown nesting accepts spaces or tabs, retains indented continuation text, and allows blank lines between list items. Markdown task markers retain checked state. Pasting into a block or replacing a document range applies the hierarchy immediately and records one undo step. Existing block parent relationships provide storage; no clipboard-specific schema or migration is required.

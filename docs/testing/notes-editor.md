# Notes editor testing

Notes testing covers pure editing plans, canonical Rust commands, persistence ordering, imports, assets, databases, and manual interaction that cannot be proven by unit tests alone.

## Rich-text acceptance

Using a scratch page with other pages and relevant project objects available, verify:

- Typing, selection replacement, bold, italic, underline, strike, code, colors, links, mentions, and equations persist after reload.
- Selecting text alone leaves the editor unobstructed. Right-click selected text and confirm its highlight stays visible while the menu and its submenus are open; format it without losing the range. Right-click at a caret to convert or insert a block. Check the Format, Paragraph, Insert, color, link, and clipboard actions near viewport edges and with Escape.
- Enter splits at start, middle, end, and selected range while preserving rich annotations on the correct side.
- Shift+Enter inserts a soft break, and code-block Enter behavior remains distinct.
- Empty list, to-do, toggle, quote, and callout blocks return to paragraph appropriately.
- Backspace removes an empty block, protects the final block, and merges compatible text without losing children.
- Tab and Shift+Tab accept valid nesting and reject invalid parent combinations.
- Multi-block paste, rapid Enter, and immediate deletion of an empty to-do or paragraph while saving is pending persist in order. The deleted block stays removed after reopening the page, without duplicate rows or a block-not-found error.
- Undo and redo restore text, structure, focus, selection, template use, and button actions at expected boundaries.
- A failed or delayed save never overwrites a newer local revision.

## Block acceptance

- Check that the title action row sits evenly between the top edge of the note content and the title, with and without a cover, in full and side views.
- Confirm the page title and the first plain text block start at the same left edge in full and side page views, without shifting the title right.
- Confirm block rows have no left-side add or drag buttons. Right-click a non-text block surface to open block actions, while right-clicking editable text opens the text menu. Existing comment counts remain visible without shifting block content.
- Insert, convert, duplicate, move, nest, Trash, restore, and delete each supported block family.
- Verify internal table rows, columns, and tab labels never appear as stray document rows.
- Remove columns and tabs and confirm their child content relocates safely.
- Use template and button blocks with ordinary child content and verify prohibited child-page cases remain disabled with an explanation.
- Verify unsupported imported blocks remain visible, searchable, duplicable, and deliberately convertible.
- Verify block colors and compatible payload fields survive edit, conversion, duplication, history copy, and reload.

## Media and assets

- Attach supported local image, video, audio, PDF, and generic files.
- Reject oversized, mismatched, unsafe, missing, and unmanaged paths.
- Reload previews, remove and replace references, and verify ownership prevents premature asset deletion.
- Confirm external references never auto-fetch where content policy forbids it.
- Simulate a missing managed file and verify a recoverable unavailable state.

## Page and navigation acceptance

- Use Up and Down through wrapped text and adjacent blocks. Confirm the caret moves one visual line at a time and the viewport does not jump a visible block to the top; then jump to an unloaded block and confirm it scrolls into view.
- Open a page in full, side, and center modes. Confirm the editor has no separate header row, last edited, favorite, and page actions appear before project Notes settings in the workspace header, and preview close/view-mode controls stay reachable without covering title actions.
- Create root, folder, nested, and database-row pages with empty and authored titles.
- Move pages among project root, folders, and parent pages while preserving paired child blocks.
- Reject self, descendant, cross-project, inactive, and block-parent destinations where invalid.
- Favorite, reopen, archive, Trash, restore, and permanently delete pages and subtrees.
- Verify invalid restored parents produce safe root placement and an explanation.
- Verify favorites and recents change navigation only, not content or canonical placement.

## Working-folder Markdown

- Open an authorized Markdown file, edit, save atomically, refresh, copy its relative path, and open externally.
- Change the file externally during a dirty local edit and confirm Save refuses the stale revision.
- Verify unsafe paths, symbolic links, oversized files, generated directories, and unsupported encodings are excluded or diagnosed.

## Database acceptance

For table, board, gallery, list, calendar, and timeline:

- Create rows, edit supported properties, filter, sort, paginate, and open row pages.
- Confirm linked views share rows and schema but retain independent view settings.
- Exercise relation target validation and inverse links.
- Recompute rollups and formulas after source, target, schema, Trash, and restore changes.
- Create, apply, update, duplicate, default, and delete database templates.
- Run typed database buttons with and without confirmation and reject stale schemas.
- Verify late page or view responses cannot replace newer state.

## History and transfer acceptance

- Restore and copy page versions without moving current page placement.
- Preview and restore a project version, including pages now moved to another project.
- Confirm a safety version exists before destructive restore or import.
- Exercise Markdown, HTML, Notion, export-folder, CSV, graph, and agent-bridge transfers with supported and unsupported data.
- Confirm diagnostics identify approximations and never expose tokens or inaccessible content.

## Accessibility and responsive behavior

- Complete primary editing, navigation, comments, movement, block insertion, database interaction, history, and recovery with keyboard only.
- Verify focus returns predictably after menus, dialogs, deletion, movement, and responsive presentation changes.
- Confirm narrow layouts keep Archive, Trash, restore, and permanent-delete actions reachable.

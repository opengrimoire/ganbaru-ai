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
- A failed or delayed save never overwrites a newer local revision. Verify the save error is visible, the draft remains editable, and Retry persists retained writes before newer dependent edits.
- Merge two paragraphs, immediately press Enter at the join, type, undo several times, and redo. Confirm there are no temporary duplicate rows and the caret stays at the intended boundary.
- Split a middle paragraph repeatedly before storage responds, then undo and redo. Confirm following paragraphs and unloaded outline entries retain their positions.
- Press Ctrl/Cmd+A directly in a paragraph on pages shorter and longer than 200 blocks. Confirm the complete body is selected on the first press; copy includes the final offscreen block, and selecting alone does not render the entire long page.
- With Ctrl/Cmd+A active, confirm every visible text block is highlighted even when focus stays in the middle block. Scroll through a long page, resize the window, dismiss the range, and check that highlights follow the text and disappear. Confirm that the active block has the same highlight intensity as the other selected blocks in both light and dark themes. Clear the document range, then select within one block and confirm native highlighting returns. Repeat on a webview without CSS custom highlights.
- Extend selection in both directions with Shift+Arrow, Ctrl/Cmd+Shift+Home/End, Shift-click, and dragging. Start and end in the middle of words across wrapped lines, empty paragraphs, headings, and lists. Confirm endpoint offsets remain precise and reversing direction shrinks the selection.
- In four single-line rows, start at row 2's first character and press Shift+Down twice. Tab and Shift+Tab must affect only rows 2 and 3. Copy must include their text and the trailing line break without row 4's text; formatting must leave row 4 unchanged. Shift+Left first removes the selected line break, then its next press removes row 3's last character from the selection. Repeat with backward selections, paragraphs, numbered lists, bullets, and tasks. Cut, paste, and undo must preserve the unselected endpoint text.
- Replace a cross-block selection by typing, Enter, multiline paste, and rich HTML paste. Check retained prefix/suffix formatting, descendants outside the range, one-step undo, redo, and reopen after persistence.
- Repeat full-page replacement with delayed hydration while typing several characters. Confirm none are dropped. Navigate away before loading completes and confirm the old action cannot modify the new page.
- Click text-row padding, indentation space, bullet/number markers, and blank space after wrapped text. Confirm a caret appears on the clicked visual line without a full-row highlight or outline. Repeat with an empty row, nested text inside columns or tabs, and a previously selected non-text block. Shift-click and dragging from these areas must select text, including within the same row; subsequent Shift+Arrow must keep text selection. Check that buttons, task checkboxes, links, and embedded fields retain their normal interactions.
- In a long note, click text near the viewport's top and bottom edges, then click its row padding and markers. The viewport must stay at the same scroll position, including partially visible rows and blocks taller than the viewport. Repeat inside columns and tabs. Arrow-key navigation and explicit navigation to offscreen blocks must still reveal their targets as needed without centering every newly focused row.
- Select text and non-text blocks without opening any toolbar. Right-click to copy, cut, paste, delete, or format a text range; check duplicate and movement for non-text block selections. Confirm menu dismissal, keyboard navigation, and focus restoration.
- Check Ctrl/Cmd+A in the title, database fields, table cells, and dialogs remains scoped to those controls. Verify IME composition, emoji, and soft line breaks at cross-block selection boundaries on each supported webview.

Automated delayed-storage coverage connects the actual action, persistence, tree projection, and undo controllers in `notes-editor-transactions.test.ts`. It checks local results before storage is released and persisted results afterward, including range replacement, formatting, surviving descendants, and undo. Document-selection DOM tests cover independent editing hosts and keyboard/clipboard routing; hydration tests cover selections spanning multiple backend batches. These checks do not measure real Tauri input latency or replace the manual acceptance above.

## Block acceptance

- Check that the title action row sits evenly between the top edge of the note content and the title, with and without a cover, in full and side views.
- Open Add icon, Add cover, and Add comment near each viewport edge in full, side, and center views. Confirm each panel aligns with the left edge of its title action when space permits and stays visible after scrolling or resizing. Clicking each title action again should close its panel. Check the cover tabs, upload, URL, removal, and comment composer and thread scrolling in light and dark themes. The discussion panel should show no comment count or divider lines, and Show resolved should use the standard Notes checkbox. Comment fields should gain a subtle fill without an added focus outline. Open the actions with a keyboard, then confirm focus enters each panel and Escape returns focus to its trigger.
- On a page with open and resolved threads, toggle Show resolved repeatedly by clicking both the square and the text. Each click should change the filter once without another loading state, including after marking a thread read or resolving a thread. Switching pages must not reuse the earlier page's threads.
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

- Use Left and Right at text boundaries, and Up and Down through wrapped text and adjacent blocks. Confirm the caret moves one visual line at a time and the viewport does not jump a visible block to the top; then jump to an unloaded block and confirm it scrolls into view.
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

- Check the inline database title, view tabs, compact configuration panels, aligned table/list rows, and row overflow actions in light and dark themes and narrow page previews.
- Open Layout, Properties, Filter, Sort, Templates, New, and table More actions. Change settings, create a row, and reopen the page to confirm existing behavior is retained.
- Navigate custom dropdowns with arrows, Enter, Tab, and Escape. Opening a table status or relation cell must retain its grid position. Relation targets must remain selectable while options load.
- Open a dropdown inside a settings panel. First Escape closes the dropdown; second closes the panel. Verify clicking an option keeps the settings panel open, clicking elsewhere dismisses it, and focus returns appropriately.
- Open panels near viewport edges and inside horizontally scrolled tables. Add filters and sorts while open; confirm the panel resizes, scrolls, and never clips nested menus.
- Check schema, button, rollup, export, page-link, code-language, and tab-icon selectors use the shared dropdown and remain labelled and keyboard accessible.

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

### Document selection undo restoration

- Select the complete body with Ctrl+A, delete or type replacement text, then undo. All original text must return highlighted across blocks, and typing again must replace that complete range.
- Redo must restore the replacement and its collapsed caret; another undo must restore the complete range again.
- Repeat with a backward partial selection and with formatting. Both endpoints and the selection direction must survive undo and redo.

## Slash menu acceptance

- Focus an empty text row and confirm it has no placeholder. Type `/` using both an unshifted key and a keyboard layout that requires Shift. Repeat with a software keyboard and compose a query with an IME. The menu should pause during composition and resume after the query commits. The command panel must appear immediately, with a visible loading or retry state if its optional component is unavailable.
- Type `/h2`, `/##`, a localized command label, and a query with no matches. Confirm the command list updates and clearing or extending the query stays responsive.
- Navigate past the visible options using arrows. The active option must stay in view; Enter and Tab must apply that option and remove the command text. Pointer selection must retain editor focus.
- Escape, Close menu, outside click, and blur dismiss the menu while retaining literal text. After Escape, verify the caret remains in the editor with no full-row fill or outline, and repeat Escape before continuing to type. Escape without a menu must preserve ordinary text selection. Continuing that dismissed query must not reopen it. Remove and retype the slash to reopen it. Slash input in code blocks must stay literal.
- Open near each viewport edge, within narrow or nested Notes views, and with the software keyboard showing. Confirm the menu is not clipped, remains inside the viewport, and follows scrolling and resizing.
- Confirm the insertion menu search accepts localized labels, preserves supported commands, and reports no matches clearly. Check both light and dark themes.

Automated coverage includes shifted slash and input-driven opening, dismissed sessions, localized filtering, pointer focus preservation, portal cleanup, viewport placement, and scrolling the active command into view. Real webview layout and software-keyboard behavior still need manual acceptance.

## Empty body recovery

- Create a note, insert `/database`, delete its only block through selection and its block menu, and immediately type. A focused paragraph must replace the database without waiting for storage.
- Delete all blocks, undo, redo, and type again. The replacement paragraph must participate in the same undo step, and the original database identity must survive undo.
- Reopen a previously emptied note and enter body text. There must be one editable paragraph, with no duplicate after another reopen.
- Press Enter in the title to enter the body. Confirm IME Enter still commits composition. Delete the first block of a multi-block note and confirm focus moves to a surviving block.
- Repeat with delayed or failed persistence and with unloaded root outlines. New typing must survive delayed append responses, save failures must remain visible and retryable, and unloaded content must not be treated as an empty page.

## List numbering and exit behavior

- Create consecutive numbered items with Enter and verify 1, 2, 3, including sequences beyond 9 and 99. Scroll a long list so its beginning is unmounted and verify later numbers do not restart.
- Nest a numbered or bulleted list inside an item. Verify nested numbering starts at 1 and the next outer sibling continues the outer count. Insert a paragraph between ordered siblings and verify the next sequence starts at 1. Repeat inside columns, tabs, and a historical page preview.
- Insert, delete, reorder, indent, outdent, or convert an item, then undo and redo. Verify numbers update immediately in document order.
- Compare number and bullet baselines with the first editable line, including wrapped text and different app font scales. Multi-digit markers must remain fully visible.
- Backspace at the beginning of a populated or empty numbered item, bullet, to-do, toggle, quote, callout, and heading. Verify it becomes a paragraph, retains its rich text and children, and keeps the caret at offset zero. It must not merge with the previous item on that first press.
- Undo and redo that conversion, then continue typing while saving is pending. Reopen the note and verify content is retained. Repeat Backspace with a software keyboard, a selected text range, and a caret inside the text. Ordinary character/range deletion must retain list formatting.

## Six heading levels

- Create H1 through H6 with slash search (`/h5`, `/h6`, `/#####`, `/######`), context-menu conversion, and hash-plus-Space shortcuts. Verify all six appear in the table of contents and focus the correct row.
- Compare all six with the page title and body text. Sizes must decrease through H6 without going below body size; inspect wrapped headings and both app font-scale extremes. Check historical previews use the same hierarchy.
- Exercise Enter, Backspace at offset zero, rich-text formatting, colors, toggle children, undo/redo, save/reopen, templates, duplication, Markdown paste, and rich HTML paste for H5 and H6.
- Import and export all six levels as Markdown and HTML. Verify levels are retained, without depth-approximation warnings or invalid h7 output. Check an existing vault upgrades with content, descendants, and template blocks intact.

### Nested clipboard lists

- Copy a note from Obsidian containing bullets, nested numbered items, a third list level, and following paragraphs. Paste into an empty Notes row and across an existing selection. Verify separate item text, inline formatting, indentation, and sibling numbering.
- Repeat with plain Markdown using spaces and tabs, blank lines, continuation text, and checked tasks. Verify dedentation returns to the intended parent.
- Undo and redo the paste, then reopen the note. Verify the complete hierarchy and text survive each step.

Automated coverage exercises both clipboard parsers and the real editor projection, delayed persistence, and undo controllers. Actual clipboard output and rendering require manual app acceptance.

### Keyboard indentation

- Use Tab and Shift+Tab on paragraphs and mixed lists, including items with descendants. Verify immediate indentation, stable caret/selection, and unchanged text.
- Repeat while saves are delayed, then type and undo/redo. Verify ordered persistence and no focus jumps when saves finish.
- Indent under a collapsed toggle or toggle heading. Verify it opens and the child remains focused; undo restores the original structure and open state.
- Start with a new note and empty first body row. Press Tab more than eight times, type text, press Enter, and verify the new row keeps the same indentation. Repeat for bullets, numbers, and tasks.
- Use Shift+Tab and Backspace at offset zero to return to the left margin one level at a time. At the left margin, Backspace removes a list marker while keeping text. Shift+Tab at the left margin is a no-op.
- Select several rows, including both a parent and a child, and press Tab or Shift+Tab. Verify each selected text row changes once, unselected descendants retain their depths, selection remains, and one undo restores the operation.
- Use Tab and Shift+Tab within code, including a multiline selection. Verify whitespace changes and no block movement.
- Repeat Shift+Tab in the Linux Tauri app on both indented text and text at the left margin. Focus must remain in the same editor. Automated DOM regressions cover WebKitGTK events with `key: "Unidentified"` and `code: "Tab"`, including document selections and code whitespace; table navigation also recognizes that event format.

- Start with ABC at depth 0, DEF at depth 1, and GHI at depth 0. Indent ABC repeatedly and verify DEF remains at depth 1 and GHI at depth 0. Repeat with numbered lists, paragraphs, tasks, deeper descendants, and embedded blocks; verify numbering, undo/redo, and saved positions after reopening.
- Outdent a parent that already has several indentation levels. Its children and following nested siblings must retain their original depths and document order. Repeat when affected neighbours are outside the rendered window.
- Press Tab repeatedly immediately after opening a page while nested rows are still loading. Once loaded, only the requested row should change depth. Switching pages before loading finishes must cancel those pending indentation edits.

### Clipboard export interoperability

- Copy and cut a single text range, a cross-block range with partial endpoints, and a whole-block selection using keyboard shortcuts and context menus. Paste into Notion, Obsidian with HTML-to-Markdown conversion enabled, and a plain-text editor.
- Verify headings, bold, italic, underline, strikethrough, links, nested mixed lists, quotes, code whitespace, and multiline text. Check tasks and tables where the receiving app supports their HTML representations. Confirm no block handles, comments, editor controls, or unselected endpoint text appear.
- Copy an entire long page with offscreen content, then paste into another app. Confirm content is complete. Deny clipboard writes and verify a failed cut retains its source text.
- Paste copied headings, formatted text, links, and nested lists back into Notes. App-specific objects, media bytes, and embedded databases are outside the portable text-copy contract.

Automated coverage verifies model serialization, standard clipboard MIME types, semantic HTML paste, partial ranges, and native single-editor copy/cut events. Cross-application behavior still requires manual desktop acceptance.

- In a plain-text editor, copied headings must contain the matching number of `#` markers. Check Markdown emphasis, links, quotes, task state, escaped literal syntax, variable-length code fences, and list indentation.
- Copy the same H1/H2/H3 sequence from Notion into an empty paragraph and over a selected existing heading. Verify levels remain H1/H2/H3. Compare keyboard paste and context-menu paste, including a document range. Ordinary website H2 headings must remain H2 when no matching Markdown says otherwise.

- Repeat table transfer through HTML and Markdown-only clipboard data. Check headered and headerless tables, merged cells, literal pipes, cell line breaks, surrounding paragraph text, undo/redo, and reopen.
- Select formatted text inside a table cell and copy/cut/paste it in both directions. Pasting multiple blocks into one cell must retain readable text without creating unrelated table rows.
- Verify repeated spaces, tabs, Unicode, empty paragraphs, empty code blocks, and quotes containing multiple paragraphs. Compare Markdown-only rendering separately from HTML.
- Copy internal blocks, then copy different content in another app. Pasting on a block margin must not insert stale internal blocks; paste into the returned text editor to import the external content.
- Record real application and OS versions and both clipboard representations. Synthetic regression fixtures do not count as confirmed Notion or Obsidian acceptance. See the [interoperability contract](../interop/notes-clipboard.md).

## Page cover redesign acceptance

Automated coverage validates all design and palette combinations, focal crop geometry, invalid metadata, immediate selection, shared color controls, save retries, dismissal, late picker completion, duplication, templates, history, and export preservation or loss diagnostics.

Manual desktop and Android acceptance remains required:

- Compare all fourteen designs in light, dark, and custom themes, including gallery cards and historical previews.
- Check full pages, side previews, narrow phones, tablets, landscape, enlarged text, safe areas, and the software keyboard. Covers must leave room for the page title and content. On shallow desktop banners around 7:1, confirm Observatory, Nature, Atlas, Studio, Study, Mathematics, Programming, and Finance retain recognizable, proportionate subjects without vertical cropping. Check that narrow views and picker thumbnails retain the main subject and its connection to surrounding details. Nature and Studio should retain illustrated background details at both edges on wide screens. Nature should show sky, terrain, and water across the whole banner with no gradient wash. Verify referenced shapes and textures render correctly when several cover thumbnails are present. Contours should retain its existing appearance.
- Select designs, colors, uploads, and focal positions. Confirm each applies immediately and persists after reopening the page and app. Compare the header, color controls, Ask every time, upload, and removal with Add icon.
- Position subjects near image edges using pointer, touch, and keyboard. Verify that changing container size retains the subject where image bounds permit it.
- Exercise native selection, mobile file selection, paste, invalid images, and failed saves. Closing a picker or switching pages during selection must not update another page.
- Verify Escape, Android Back, outside dismissal, keyboard focus return, and color panels near viewport edges.

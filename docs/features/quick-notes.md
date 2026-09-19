# Quick notes

Quick notes is an app-wide capture surface for temporary thoughts, reminders, and small pieces of information. It is deliberately separate from [Notes](notes/README.md).

A Quick note has no project membership, page hierarchy, blocks, icons, covers, comments, backlinks, attachments, version history, import/export, or collaboration state.

## Collection

The title-bar control opens a floating collection panel on desktop and mobile. The panel stays within the visible viewport and adapts to narrow windows without becoming a primary destination.

The collection supports All, up to nine ordered tags, search, Archive, and Trash. A note has at most one tag. Numeric shortcuts can select All and tag views when the user is not typing or interacting with a nested modal.

Active notes have durable manual order with separate pinned and unpinned groups. Reordering inside a filtered tag view changes only the relative order of visible matching notes. Search, Archive, and Trash use relevance or lifecycle order and cannot be manually reordered.

Cards use a responsive masonry layout. Pointer users can drag from a valid card area; touch users use an explicit handle so scrolling remains reliable. Keyboard movement and live announcements provide an equivalent reorder path. Cancellation and persistence failure restore canonical order.

Search uses a local rebuildable SQLite projection. Collection reads are bounded. Loading and view changes keep stable controls available and do not expose unpositioned cards as a false final layout.

## Editor

The editor has an optional title and one multiline body with bold, italic, and underline. Paste retains supported text and formatting while flattening or dropping links, lists, media, scripts, styles, and raw HTML.

Titles are limited to 200 characters and bodies to 65,536 characters. Empty new drafts are discarded.

The background uses a theme-aware event-palette slot. Notes store the slot identity, so theme changes recolor them without rewriting content. Text chooses the stronger black or white contrast against the resolved background.

Edits autosave after a short debounce, and pending writes flush at relevant lifecycle boundaries. Revision checks prevent another window from silently overwriting newer content. Conflicts can reload the canonical note or preserve local work as a separate copy.

Revision-sensitive native writes return a stable `revision_conflict` code for stale revisions and `failed` for other failures. Recovery decisions use that code, never words in the diagnostic message.

## Lifecycle

Active notes can be pinned, archived, or moved to Trash. Archive and Trash clear pin state. Trash remembers whether the note came from active or Archive so restore returns it appropriately.

Trashed notes are read-only and are permanently deleted after seven days. Manual permanent deletion and Empty Trash require confirmation.

## Data ownership

Quick notes, tags, formatted text runs, lifecycle, order, color, revision, and derived search text are SQLite-canonical. Reordering is transactional and does not pretend content changed.

Quick notes creates no Markdown files and does not participate in Notes search, history, backlinks, exports, or collaboration.

## Accessibility

The panel and editor manage focus, close with Escape or Android Back as appropriate, and restore prior focus. DOM order remains canonical even when masonry changes visual placement. Reorder, tags, lifecycle, formatting, color, and close actions are keyboard reachable and have visible touch equivalents.

Reduced-motion preference disables displacement animation. At recovery-size windows, primary close, Save state, restore, and delete actions remain reachable.

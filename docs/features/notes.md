# Notes

The notes system is a block-based editor for capturing thoughts, project documentation, daily logs, and any other prose the user wants to keep. Notes are markdown files on disk (the user owns their data) with a SQLite index for fast search and backlinks.

This doc is a placeholder. Deeper design comes in a later pass.

## Two source-of-truth model

Notes follow the broader two-category data model (see `data/architecture.md`):

- **Markdown on disk** is the source of truth. The user can open the file in any editor; back it up with any tool; sync it via any mechanism.
- **SQLite indexes** the notes for full-text search, tag queries, and backlink resolution. The index is regenerated from the files; it never holds canonical content.

If the index drifts from the files (a user edits the markdown outside the app, then the app starts up), the index is rebuilt. The files are always right.

## Editor

The editor is built on Tiptap (a rich-text framework on top of ProseMirror). Block-based editing with slash commands for inserting headings, lists, code blocks, and other structures. Drag-to-reorder blocks. Markdown serialization on save.

## Backlinks and the Zettelkasten principle

Notes link bidirectionally. When note A references note B (e.g. via `[[Note B]]` syntax or any rendered link), note B's view shows that note A links to it. This supports the Zettelkasten principle: ideas gain value from being connected, not from being filed.

The backlink index is in SQLite, computed from the markdown content. Adding a link in note A's markdown causes the index to record a backlink on note B without requiring B's file to change.

## Note categories

Two well-known categories live alongside arbitrary user-created notes:

- **Daily notes.** One per calendar day. Auto-created on first access for the day, optionally with a template.
- **Project notes.** Attached to a project (see `features/project-management.md`). Used as working documents during the project's lifecycle phases.

Both are normal markdown files; the categories are conventions on file location within the vault, not different data models.

## Real-time collaboration

When the sync layer is active (see `data/sync.md`), notes can be edited collaboratively via Yjs CRDTs. Live cursors show presence. Conflict resolution is CRDT-native; the user does not see merge conflicts.

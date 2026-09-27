# Notes

Notes is a local page, block, database, link, history, and collaboration-ready knowledge system. Its canonical page graph lives in SQLite. Markdown is import, export, or bridge output unless the user is explicitly editing a separate working-folder Markdown file.

## Source-of-truth boundary

Two document models appear in the Notes workspace:

1. **Notes pages:** SQLite-canonical pages, blocks, databases, comments, assets, history, and links.
2. **Working-folder Markdown:** file-authoritative `.md` files from an authorized project working folder, edited as raw Markdown with revision-safe saves.

Working-folder Markdown never becomes a Notes page automatically. It does not gain block operations, comments, backlinks, Notes history, database relations, or collaboration metadata. Exported Notes Markdown is derivative and external edits are new import input, not authoritative edits to the source page.

## Current scope

| Capability | Status |
| --- | --- |
| Pages, folders, navigation, project scoping, favorites, recents, archive, and Trash | Implemented |
| Theme-aware designed covers, managed images, and responsive focal cropping | Implemented; manual platform acceptance pending |
| Rich-text block editor, keyboard structure, undo/redo, comments, suggestions, and managed assets | Implemented |
| Broad local block catalog and imported unsupported placeholders | Implemented with documented limits |
| Local databases with table, board, gallery, list, calendar, and timeline views | Implemented |
| Database templates, relations, rollups, formulas, and typed buttons | Implemented with bounded action limits |
| Markdown, HTML, Notion API/export-folder, CSV, graph, and agent-bridge transfer | Implemented with documented loss diagnostics |
| Page and project history, templates, archive, Trash, restore, and safety versions | Implemented |
| Backlinks, aliases, unresolved links, comments, suggestions, mentions, and local notifications | Implemented |
| Daily-note product surface | Planned |
| Multi-person encrypted sync | Planned |

## Product principles

- Canonical data survives editor, index, cache, and export changes.
- Unsupported imported content remains visible with diagnostics rather than disappearing silently.
- Managed local files have explicit ownership and validated paths.
- Search, backlinks, graph data, rollups, and formula output are rebuildable projections.
- Destructive restoration creates a safety version and applies canonical changes atomically.
- Page access also governs search, exports, notifications, AI context, history, and linked views.
- The editor stays usable for small notes without requiring database or collaboration concepts.

## Documentation map

- [Pages and navigation](pages-and-navigation.md)
- [Page covers](page-covers.md)
- [Editor](editor.md)
- [Blocks](blocks.md)
- [Databases](databases.md)
- [Import and export](import-export.md)
- [History and recovery](history-and-recovery.md)
- [Links and collaboration](links-and-collaboration.md)
- [Editor testing](../../testing/notes-editor.md)
- [Data architecture](../../data/architecture.md)
- [Schema reference](../../data/schema/README.md)

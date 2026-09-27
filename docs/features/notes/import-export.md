# Notes import and export

All transfers preserve the source-of-truth boundary. Imports create canonical SQLite pages, blocks, rows, comments, and assets. Exports are derivative views or diagnostic snapshots and never become authoritative merely because a file exists.

## Shared safety rules

- Every external response, file, archive entry, path, payload, and identifier is untrusted.
- Imports preview or prepare content before canonical writes when the format supports it.
- One canonical transaction owns each accepted unit of imported data.
- Local file references are copied only through the bounded managed-asset policy.
- Unsupported content is preserved visibly or reported. It does not disappear silently.
- Diagnostics never include secrets or inaccessible content.
- Exports state their loss boundaries and whether they include asset bytes.

## Markdown import

Markdown import creates a new page and normal blocks. It preserves heading levels 1 through 6 and supports paragraphs, safe inline links, lists, to-dos, quotes, dividers, fenced code, supported images, and simple tables. Safe frontmatter can provide a title.

Unknown frontmatter, unsafe or local file references, unsupported HTML, reference definitions, and syntax that cannot be represented return diagnostics. Unsupported source can become a visible preservation block when useful.

Imported Markdown records provenance, but the source text is not retained as editable authority.

## HTML import

HTML import sanitizes before conversion. It supports common text formatting, heading levels 1 through 6, links, lists, checkbox items, quotes, preformatted code, dividers, callouts, toggles, simple tables, and explicitly retained supported HTTPS media.

Scripts, styles, event attributes, unsafe URLs, SVG, iframes, and unapproved embedded content are removed and reported. Local and relative media references require the managed import-file flow.

## Notion API import

Notion API import uses a user-provided integration token for the current request only. The token is never stored in SQLite, configuration, page payloads, comments, or diagnostics.

The current adapter targets public Notion API version `2026-03-11`. It can import selected pages, recursively paginated block children, data-source schemas and rows, unresolved comments, and optional users.

Responses stream into strict byte limits before JSON parsing, require JSON media types, bound pagination and object counts, detect repeated cursors, cap retry waits, and cancel when the operation is dropped. Remote response bodies never appear in errors.

Supported objects convert to local Notion-shaped contracts. Unsupported blocks become visible placeholders. Unsupported properties degrade only through an explicit documented representation and diagnostic. Provider-hosted file URLs and upload identities are not downloaded automatically.

## Notion export-folder import

An already downloaded Notion export directory is scanned within bounded depth and entry counts. Hidden files, unsafe paths, symbolic links, and workspace sitemap artifacts are excluded.

Markdown and HTML reuse the canonical importers. Local links between exported files are rewritten to local Notes targets where identity can be established. Local assets are copied only when the user enables copying and the shared boundary validates the source.

CSV files can reconstruct data sources. The first column becomes title, remaining columns become compatible properties, and non-empty rows become row pages. A matching Markdown or HTML file can supply a row page body rather than creating a duplicate page.

## CSV database import

CSV import is a dry-run-first path into an existing data source. Column mapping can use property name or stable identity. Preview reports mapped and skipped columns, valid and invalid rows, and row-level diagnostics without writing.

Accepted rows become normal database row pages. Writable scalar, select-like, date, contact, place, and valid relation properties can import. Generated, computed, system, file, people, rollup, formula, unique-ID, and button values are skipped unless a dedicated safe conversion exists.

Invalid rows do not partially write broken property state.

## Markdown export

Markdown export renders ordered active blocks, safe rich text, supported mentions, equations, headings, lists, to-dos, toggles, callouts, quotes, code, dividers, simple tables, and media references. Comments are optional and omit local read state.

Markdown cannot represent every page, database, layout, color, asset, upload, or unsupported block losslessly. Those approximations and omissions appear in diagnostics. The output can always be regenerated from SQLite.

## HTML export

HTML export produces a readable static archive with page files, shared styling, a manifest, optional subpages, optional managed assets, comments, and database view manifests.

Local Notes links target included exported pages. Assets are copied only when requested and available. Database views export readable row data and settings rather than pretending to be a complete interactive database runtime.

## CSV database export

Current-view export applies the active table properties, filters, and sorts. Full-data export includes all active rows and current properties without view hiding.

Headers are deterministic. Cells use readable plain text, including available relation titles and computed output. Structured values that cannot round-trip through CSV produce warnings, so CSV is never presented as a complete database backup.

## JSON graph export

JSON graph export is a local diagnostic and backup-oriented snapshot of the Notes SQLite graph. It includes a schema version, applied migration context, object counts, warnings, and selected canonical families.

Callers can include or omit rebuildable indexes, history, templates, and local UI state. JSON columns export as JSON values rather than encoded strings. FTS shadow tables are omitted. Managed asset metadata and references can be included, but binary files remain outside the JSON and produce a clear warning.

## Agent bridge export

Agent bridge export creates deterministic readable Markdown for an explicitly selected Notes page and approved related context. It can include subpages, backlinks, database views, project tasks, and comments according to effective access.

The output begins with a source-of-truth warning, does not create canonical export rows, and does not embed managed asset bytes. It never includes restricted page names, counts, backlinks, rows, comments, tasks, or derived facts merely because they share a project.

This bridge is the current agent-readable Notes export. It is not the planned external `ganbaru-ai` CLI and does not authorize internal coding-agent access by itself.

## Round-trip diagnostics

Transfer surfaces report object counts and categorized outcomes such as preserved, approximated, skipped, unsupported, warning, and error. Diagnostics can point to safe source lines, object IDs, paths inside the selected root, CSV rows, or local Notes targets.

Navigation links in diagnostics are convenience only. They do not make the source file, folder, archive, CSV, JSON, or derivative output authoritative.

### Heading levels

Markdown and HTML transfers preserve all six heading levels. Markdown emits the matching count of `#` characters. HTML body headings use matching `h1` through `h6` elements instead of shifting levels beneath the page title, which prevents level 6 from being flattened or emitted as an invalid `h7`. Exported HTML uses the editor's relative heading-size hierarchy. Older imports that already flattened deep headings to level 4 cannot recover their original level without reimporting the source.

Explicit text indentation is preserved in JSON graph data and shown as relative margins in HTML export. Markdown export emits leading spaces for explicit indentation; Markdown readers may interpret deeply indented paragraphs as code according to their own syntax rules. Extremely large indentation values that exceed the bounded whitespace export budget produce a diagnostic while retaining the text.

## Page cover presentation

HTML and Markdown exports omit page cover appearance and report `page_cover_omitted` when a page has a cover. Graph export retains the editable cover descriptor, including theme palette identity and image focal coordinates. Static visual cover export is planned separately. See [Page covers](page-covers.md).

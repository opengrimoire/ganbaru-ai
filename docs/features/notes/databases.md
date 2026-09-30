# Notes databases

Local databases are structured views over Notes row pages. They follow useful public Notion concepts while remaining an independent local SQLite implementation.

## Database presentation

Status: partial, with real desktop and Android visual acceptance pending.

Database blocks render their current view directly in the page. A new database starts with one table view, a title field, and a row creation line. The editor does not require expanding a block or editing its property schema before rows become visible. The database's controls remain separate from document block selection, so clicking a cell, menu, or unused table space does not select the whole database block.

View tabs correspond to saved views in the database shell. The add-view picker creates one of the six implemented layouts: table, board, gallery, list, calendar, or timeline. A view can be renamed or duplicated with its own presentation settings. Deleting a view asks for confirmation and leaves rows and properties in its shared data source. The last view cannot be removed, and a data source retains a table view for property editing. Additional view types shown by Notion, including chart, dashboard, map, form, and feed, remain unimplemented.

New stays beside the view tabs across layouts. Its split-button menu applies existing page templates and links to template management; creating a template still starts from an existing row. The table puts Add property in the column header. Table, board, gallery, list, and calendar settings open in a side panel, with layout, property visibility, filters, sorts, and applicable template and transfer controls in anchored submenus. The data source property editor opens separately and shows one property's fields at a time. Configuration forms do not occupy the page before the rows. Applied filter and sort counts remain visible on their controls in settings. Board and date views retain contextual creation.

Table and list row actions use an overflow menu. Column width controls remain keyboard accessible and appear on header hover or focus on pointer devices. List properties align with their headers; secondary properties collapse on narrow layouts. A table preview appears only after a row is opened.

Panels stay within the viewport and outside clipped database containers. Their nested dropdowns preserve the owning dialog's focus boundary. Escape closes the innermost dropdown first, then its settings panel, returning focus to the invoking control. Leaving a panel dismisses it without pulling focus back. These controls change the same existing view configuration and row operations described below.

The separation of content, view settings, and property visibility follows [Notion's documented database controls](https://www.notion.com/help/views-filters-and-sorts). Notes and Projects use the same [collection components and visual rules](../collections.md), with domain-specific editors and actions.

Switching to another application tab unmounts the Notes UI but retains recently visited database row windows, view lists, templates, selected views, and horizontal scroll positions. Returning renders those snapshots immediately without another SQLite read when they remain current. The editor retains the note's vertical scroll separately. All six database layouts share this session behavior.

Successful Notes mutations, including row-body edits, schema changes, imports, and history restoration, invalidate database snapshots conservatively across the active vault. Linked views therefore refresh together. Mounted views defer refresh during their own writes, and tables also defer automatic refresh while a text cell has focus so it cannot replace active typing. Existing rows remain visible while canonical data loads. Concurrent reads share their work, and a response that predates invalidation cannot become current. Other desktop windows publish vault-scoped invalidations even while Notes is inactive. Switching vaults clears snapshots and rejects requests from the previous vault.

The session retains at most 32 resources with a combined serialized-data budget of 4 MiB, plus 32 small presentation entries. Least recently used resources are evicted first; an oversized response can render but is not retained. These limits bound cached data rather than measuring total JavaScript heap usage. No inactive database DOM or observers are retained, and eviction falls back to an ordinary load.

## Data source and view model

A child database creates a database shell, one canonical data source, an initial table view, and a visible `child_database` block in one transaction. A linked database view creates another shell and view that reference the same data source without duplicating rows or schema.

Each view owns independent presentation settings such as filters, sorts, visible properties, grouping, date range, and row-open mode. Views never become separate sources of row data.

Renaming a local database updates its block, database shell, and owned data source title together. Renaming a linked database changes only that linked shell and block, leaving the shared source title intact.

Imported title-only child databases remain visible preservation placeholders until they can be connected to local data.

## Row pages

Every row is a normal Notes page parented by its data source. It stores values matching the current property schema and a normal page body block tree.

Rows can open as full pages or responsive previews. Their body uses the same editor, history, comments, links, managed assets, Trash, and duplication behavior as other Notes pages.

Row pages stay out of the ordinary project root because the database view owns their primary navigation.

## Properties

Supported schemas include title, rich text, text, number, select, multi-select, status, date, checkbox, URL, email, phone, files, people, place, created and edited metadata, unique ID, relation, rollup, formula, and typed button properties.

The required title property cannot be hidden, deleted, or converted to another type. Select-like properties own stable option identities, labels, colors, and relevant status groups.

Writable cell types include ordinary text, number, boolean, select-like, date, contact, place, and relation values where the view can validate them. System metadata, computed values, and unsupported local people edits remain read-only.

## Table view

Table supports row creation from its final New page line or toolbar, template selection, inline cell editing, adding a property from the header, visible and hidden columns, column order and width, filters, sorts, keyboard cell navigation, and full-page or preview opening. Column edges support dragging and keyboard resizing, with one saved width update when the gesture completes.

Clicking New page or the table toolbar New immediately reserves a blank row and focuses its title. Creation starts without waiting for a name. The next New page line stays available, including while earlier rows are saving. Its hover highlight does not follow the control down when a new row takes its place. Empty titles remain empty in storage. Typing stays intact when creation returns; Enter or leaving the title saves it after creation. Enter on the last row moves focus to New page, and subsequent saves and refreshes preserve that control's focus. The creation response supplies canonical defaults and template values without a full table or template reload.

Title remains visible. Existing cell edits and submitted new-row edits reload the affected filtered and sorted window. Active titles and failed drafts stay visible while editing or retrying. A refresh started before a row finished creating cannot discard that row. Failed creation exposes an error and retry on the row, reuses its reserved page ID, and checks for an already committed page before reporting failure. Closing the table submits pending title drafts. Templates also accept a reserved page ID so a failed response can be recovered without creating another page.

## Board view

Board groups rows by a compatible property, retains empty and hidden groups, exposes selected card properties, filters and sorts, and supports row creation.

Board shares its Kanban columns, cards, drag feedback, action menus, and inline creation with Projects. Move actions in each card's menu provide keyboard and touch alternatives. Column counts use the backend group counts rather than only the currently loaded cards.

Dragging a card writes only when the grouping property has a safe local representation, such as select, status, checkbox, date, or supported multi-select behavior. Read-only or ambiguous group types disable drag writes.

## Gallery view

Gallery renders responsive cards with a page cover, selected files-property preview, or no image. It stores card size, fit behavior, visible properties, filters, sorts, and row-open mode.

Missing or unavailable media remains an explicit card state and does not remove the row.

## List view

List shows compact rows with title first, selected properties, optional grouping, hidden groups, filters, sorts, creation, and full-page or preview opening.

Grouping changes the view only and never changes page hierarchy.

## Calendar view

Calendar uses a selected date property, month range, visible properties, filters, and sorts. Date-range rows appear on every covered visible date. Creating from a day prefills the selected date property.

Day creation opens on demand instead of showing a text field in every cell. Cards use the shared compact card treatment and action menu. The month grid scrolls horizontally in narrow containers to keep dates and row titles readable.

This is a database view and does not create Ganbaru Calendar events automatically.

## Timeline view

Timeline uses a selected date property and a bounded visible range, with optional grouping, filters, sorts, row creation, and date-range resize controls. Resizing writes the same canonical date value used by table cells.

## Relations

A relation property targets one data source. Values reference rows from that source and are also normalized into link rows for validation, backlinks, and efficient reads. An optional inverse relation synchronizes only when its schema is valid.

Targets outside the configured source are rejected. Schema changes and row lifecycle operations rebuild or remove derived link facts without making those projections canonical.

## Rollups

Rollups select a relation, target property, and compatible calculation. Values are computed from current related rows and can use a rebuildable cache. They are never saved as canonical row property values.

Schema, relation, target-row, property, and lifecycle changes invalidate affected cached values. Unsupported combinations and computed-property cycles are rejected.

## Formulas

Formula properties store a bounded local expression and evaluate through a checked Rust expression engine. The language supports literals, property reads, arithmetic, comparisons, boolean logic, conditional and empty checks, formatting, length and containment, case conversion, and basic numeric helpers.

Formulas never use JavaScript evaluation. Unknown properties, dependency cycles, invalid types, and runtime failures produce typed errors. Successful outputs are derived, read-only values.

## Database templates

Database item templates are implemented and scoped to one data source. Creating a template from a row snapshots editable properties and the row's loaded body block tree into canonical template records.

Applying a template creates a new row page, maps stored property identities against the current schema, generates fresh block IDs, and copies the body. One template can be the default. Table row creation exposes template selection; blank creation remains available.

Templates can be listed, created, renamed, updated, duplicated, marked default, and deleted without changing rows that previously used them.

## Typed database buttons

Button properties are typed local row actions, not arbitrary automation blobs. The implemented action updates a configured property on the current row and can require confirmation.

The command reloads current schema and row state before applying the action. Broad edits, deletion, webhooks, mail, and third-party integrations remain unavailable until they have explicit schemas and authority boundaries.

## Bounded reads

All views apply filters and sorts before bounded row hydration and use stable cursors. Relation titles, rollups, formulas, buttons, covers, and previews hydrate only for returned rows. A late response for an older view state cannot replace the active result.

The exact table layout, query plans, and cache schema belong in [data documentation](../../data/README.md), not this feature contract.

Save feedback stays beside the inline database title. Fast saves remain visually quiet; a save lasting at least 600 ms shows the standard loading spinner without inserting a status row or dimming the database. Save errors remain visible and pending writes retain their duplicate-submission guards.

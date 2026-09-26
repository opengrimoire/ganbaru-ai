# Notes databases

Local databases are structured views over Notes row pages. They follow useful public Notion concepts while remaining an independent local SQLite implementation.

## Database presentation

Status: implemented, with real desktop and Android visual acceptance pending.

Database blocks are inline document regions with a title and icon-led view tabs. They share the application's dropdown control, typography, theme colors, and compact row treatment with Projects. Native operating-system select menus are not used in Notes.

Layout, visible properties, filters, sorts, and templates open in small anchored panels. Table, list, and gallery creation fields live behind New; board and date views retain contextual creation. Table transfer actions are available from More. Configuration forms should not occupy the page before a reader reaches the rows. Applied filter and sort counts remain visible while their panels are closed.

Table and list row actions use an overflow menu. Column width controls remain keyboard accessible and appear on header hover or focus on pointer devices. List properties align with their headers; secondary properties collapse on narrow layouts. A table preview appears only after a row is opened.

Panels stay within the viewport and outside clipped database containers. Their nested dropdowns preserve the owning dialog's focus boundary. Escape closes the innermost dropdown first, then its settings panel, returning focus to the invoking control. Leaving a panel dismisses it without pulling focus back. These controls change the same existing view configuration and row operations described below.

The separation of content, view settings, and property visibility follows [Notion's documented database controls](https://www.notion.com/help/views-filters-and-sorts); visual styling follows Ganbaru Projects.

## Data source and view model

A child database creates a database shell, one canonical data source, an initial table view, and a visible `child_database` block in one transaction. A linked database view creates another shell and view that reference the same data source without duplicating rows or schema.

Each view owns independent presentation settings such as filters, sorts, visible properties, grouping, date range, and row-open mode. Views never become separate sources of row data.

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

Table supports row creation, template selection, inline cell editing, visible and hidden columns, column order and width, filters, sorts, keyboard cell navigation, and full-page or preview opening.

Title remains visible. Changing a value reloads the affected filtered and sorted window rather than assuming the row remains in the same position.

## Board view

Board groups rows by a compatible property, retains empty and hidden groups, exposes selected card properties, filters and sorts, and supports row creation.

Dragging a card writes only when the grouping property has a safe local representation, such as select, status, checkbox, date, or supported multi-select behavior. Read-only or ambiguous group types disable drag writes.

## Gallery view

Gallery renders responsive cards with a page cover, selected files-property preview, or no image. It stores card size, fit behavior, visible properties, filters, sorts, and row-open mode.

Missing or unavailable media remains an explicit card state and does not remove the row.

## List view

List shows compact rows with title first, selected properties, optional grouping, hidden groups, filters, sorts, creation, and full-page or preview opening.

Grouping changes the view only and never changes page hierarchy.

## Calendar view

Calendar uses a selected date property, month range, visible properties, filters, and sorts. Date-range rows appear on every covered visible date. Creating from a day prefills the selected date property.

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

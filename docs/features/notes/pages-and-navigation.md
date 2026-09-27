# Notes pages and navigation

## Page model

A page has a stable identity, title, parent, optional project, icon, cover, properties, archive state, Trash state, timestamps, and optional import provenance. Its ordered block tree is stored separately and loaded in bounded ranges.

Page parents can represent workspace, page, data source, or other supported local contexts. Database row pages are ordinary Notes pages parented by a data source and use the same editor when opened.

An empty page title is valid and receives a localized fallback in navigation. Renaming a page updates derived navigation and link presentation without changing stable link identity.

## Folder model

Folders organize workspace-parented pages inside a project. They are navigation containers, not page blocks and not Markdown directories. Moving a page into a folder changes local placement without changing the page's canonical content.

Folders can nest within practical bounds. Moving a folder or page rejects self-parenting, descendant cycles, inactive destinations, and destinations outside the effective project scope.

## Child pages

A child page has both a normal page row and a paired `child_page` block in its parent document. The page and block share stable identity. Creation, rename, move, Trash, restore, and permanent deletion keep the pair synchronized.

Moving a page under another page creates or restores the paired child block at the destination. Moving it back to the project workspace hides the old paired block rather than leaving a broken navigation reference.

If a restored page's former parent is missing, archived, or in Trash, the page is promoted to a safe project root and the UI explains the placement.

## Project scope

Pages created from a project home, project-scoped picker, folder, or top-bar action belong to the selected project. Project navigation, search, destination pickers, and note flyouts show only content the current project and access policy permit.

Database row pages remain hidden from ordinary project roots because their database view owns their primary navigation. They still participate in search, links, history, and direct open flows.

## Favorites and recents

Favorites and recents are implemented device-local navigation metadata outside the canonical page graph.

Favoriting pins the page in Notes navigation and shows a star in the page action surface and navigation row. Opening or creating a page updates recents. Neither behavior changes parent, project, sort order, content, or collaboration history.

When a page is open, its last-edited detail, favorite control, and page actions share the workspace header immediately before project Notes settings. The editor has no separate page header. Side and center previews keep close and view-mode controls as compact overlays so the page content does not lose another row of height.
Floating application panels cover these header controls when open.

## Archive

Archive hides a page from active navigation, favorites, recents, active search, and active parent selection without placing it in Trash. The Archive view supports search and restore.

Restoring validates the stored parent. Invalid parents result in safe project-root placement. Archiving a page does not erase its history, assets, links, or content.

## Trash

Trashing applies to the reachable page subtree so active children do not remain under an inactive parent. Trashed pages disappear from active navigation and Archive but remain available in Trash for the configured recovery period.

Restore preserves valid structure and reactivates paired child-page blocks. Permanent deletion requires confirmation or retention expiry and removes the page subtree, paired blocks, and owned canonical content transactionally. Asset cleanup follows the ownership graph and history pins rather than deleting bytes solely because one live reference disappeared.

## Search and destination reads

Navigation, Archive, Trash, destination, and search surfaces use page summaries and bounded pagination rather than loading full page content. Search can match titles, aliases, blocks, database properties, comments, links, and managed file metadata according to access.

Opening a block or comment result loads the page and focuses the relevant target when it still exists. A stale or inaccessible target fails safely instead of opening another page with a similar title.

## Working-folder Markdown

Authorized project working folders can appear as source-aware roots when they contain supported Markdown descendants. Scanning is recursive and bounded, rejects symbolic links and unsafe paths, excludes common generated and dependency directories, and identifies truncated results.
An empty scan runs without showing the Working folders section. Existing roots remain visible during refresh, while switching projects clears the previous project's roots before scanning. Unavailable folders and scan errors remain visible.

Opening a file provides raw editing, sanitized preview, dirty state, explicit Save, Refresh, Open externally, and Copy relative path. Reads include a revision digest. Save requires the expected digest and uses atomic replacement.

If another tool changes the file while local edits are dirty, Notes refuses to overwrite it and offers Reload, Copy local text, or Open externally. Notes does not create, rename, move, or delete working-folder files in this surface.

Android omits working-folder Markdown because local project execution folders and desktop path authority are unavailable there.

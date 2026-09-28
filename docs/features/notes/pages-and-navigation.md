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
The last-edited detail opens its activity panel on hover or keyboard focus. Its highlight follows pointer hover or keyboard-visible focus and does not remain after a mouse click when the pointer leaves.
Floating application panels cover these header controls when open.
The project Notes settings popover grows to fit its content and scrolls when the available viewport space or the shared project settings height limit is reached.

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

## Shared Notes and Chat sidebar design

**Implemented:** Notes and Chat use the same theme-derived sidebar tint for both expanded and collapsed navigation, with a shared 17rem expanded desktop width, toolbar height, row spacing, typography, hover treatment, and selected-row highlight. Notes creation controls begin the toolbar; Chat places its always-visible search field before the collapse control. Both sidebars use the same toolbar button styling, with collapse at the trailing edge. Chat creation actions live in the channel section headers and menus. Feature-specific actions remain available, including Notes sorting and hierarchy controls and Chat channel sections and archive.

On desktop, the selected note or channel appears in the workspace header when its sidebar is collapsed. With the sidebar expanded, the selected item remains visible in navigation without repeating its name in the header. Mobile headers retain the selected item because navigation is a separate surface. An active Chat title edit remains visible until it is completed or canceled.

Notes search opens below the toolbar and focuses its field. Chat search stays in the toolbar and does not take focus automatically when navigation opens. Both features share the same search component and its fields have no focus outline. The clear button and Escape clear a nonempty query. Escape in an empty Notes search closes the field and returns focus to its toolbar button; the Chat field remains visible.

Page, folder, and channel rows expose an action button on pointer hover or visible keyboard focus, and always on touch layouts. Chat section headings keep both their create and action buttons visible. Pointer-initiated focus does not keep a row action visible after its menu closes. These buttons toggle the existing context actions without navigating. Escape dismisses the menu and returns focus to its trigger. Selected pages and channels use the theme selection color, while hover uses a lighter accent treatment. Row and section ellipsis buttons have no tooltip or separate hover background; their icons use the foreground color on hover, keyboard focus, or while the menu is open. Section create buttons keep their localized tooltip and use the same icon-only hover treatment. Mobile navigation preserves larger touch targets.

Chat channel names show a full-name tooltip only when the visible label is truncated by the sidebar width.

Chat channel, Chat section, Notes page, and Notes folder action menus share a 12rem panel width, surface, shadow, action spacing, and icon placement. Section menus open from the action button's left edge when space allows and stay within the viewport. Chat Move to opens its destination panel on hover and remains available by click or keyboard focus. Archive and Delete section keep their destructive color.

Highlight current file scrolls to the selected note and fades two brief pulses over its existing theme selection color.

Sidebar metrics have one shared CSS owner. Toolbar, navigation, and search icons use 14px and the compact stroke token. Toolbar buttons, row action buttons, Notes page disclosure controls, and Chat section action controls share the same desktop target size; touch controls meet the same minimum touch target. The rightmost action button in Notes rows, Chat channel rows, and Chat section headings shares one end inset so its center aligns across the sidebars. Navigation labels, section labels, and search text share the same scaled font size and line height, with weight 400 normally and 500 for the selected destination. The Notes and Chat search fields match the navigation-row highlight height, including when text scaling or touch targets enlarge the rows. Both expanded and collapsed toolbars keep the shared header height, while navigation rows use a shorter shared row height. General application and Chat SVG stroke rules exclude these sidebars so stylesheet loading order cannot change their icon thickness.

Chat section headings occupy one full navigation-row height, calculated from the shared line height and vertical padding. This keeps subsequent channels on the same row rhythm as Notes rather than introducing a shorter heading row. Channel, note, and folder identity icons use the same explicit compact size and stroke values; the shared row-icon class also covers custom Notes SVGs that do not carry Lucide's library class. Emoji and image page icons retain their content-specific rendering.

The Notes sidebar retains its expanded or collapsed state when switching application tabs within the same window session, matching Chat. Recreating the Notes view does not reset this choice.

# Notes links and collaboration

## Inline links

**Implemented:** linked text uses semantic anchors. In the editor, hovering a link opens a compact floating popover with its destination, Copy, and Edit. Clicking the text or destination opens the link, including Ctrl/Cmd-click. The preview preserves the caret and allows moving the pointer across its gap; leaving the link and preview dismisses it. Touch and text dragging do not trigger hover actions. Local note and database-block references use normal Notes navigation; web and email links open through the system handler. Read-only rich text opens links directly. Selecting linked text does not interrupt the selection or navigate.

Ctrl/Cmd+K and Edit open an anchored panel with Page or URL and Link title fields. The edit form stays open when the pointer leaves it. Available note titles can be searched without reading database rows. Apply and Remove link share the bottom action area beneath a divider aligned with the field margins. Both use plain text button styling, with an icon only for Remove link. Applying changes preserves surrounding text and inline formatting. Remove link keeps the text. Outside clicks and leaving the panel with keyboard focus dismiss it without taking focus back; Escape returns focus to the original text range. Resuming typing dismisses the preview. A delayed editor-panel load does not take focus back from another field. Invalid destinations, stale selections, and failed actions stay visible in the panel.

Pasting a single valid URL onto selected text applies the hyperlink while preserving the words and formatting. Document selections support this across text blocks with one undo step, leaving database blocks and code unchanged. Ordinary copied text still replaces the selection, and code and explicit paste as plain text keep their literal paste behavior.

Link panels use 80% of the rendered Notes paragraph font size and inherit it through their buttons and fields, including when portaled outside the note. Labels and errors scale with the panel text. The note's paragraph typography stays unchanged. They use a light shadow and a field border cue instead of an extra focus contour. They live outside the note's layout, reposition on scrolling and viewport changes, and scroll only when their full bordered height exceeds available space. They release their observers and hover timers when closed and load only when opened. Linking and copying a local database reference do not read or duplicate its rows or schema.

Local text links persist as `#notes?page=UUID` with an optional `block=UUID`. Links copied from the current app origin normalize to this portable form. Rust validates these identities before saving; navigation still checks whether the target is available. This does not register an operating-system URL scheme or create a public sharing URL.

External activation uses a Notes-owned native command on desktop and Android. It validates the existing rich-text URL bounds, allows only HTTP, HTTPS, and email destinations, and rejects embedded credentials before invoking the system handler. Local references stay within Notes navigation. The command does not fetch content or widen the generic opener allowlist.

## Stable links and aliases

Local Notes links resolve to stable page identities when known. Aliases provide alternate names for pages and database rows without changing the canonical title.

Title and alias resolution can help migrate imported or typed links, but once a target is chosen the source should store stable identity. Ambiguous matches remain unresolved rather than selecting whichever title appears first.

## Backlinks

Backlinks derive from child-page blocks, page mentions, local Notes links, comments, database relations, supported local-object mentions, and alias-aware resolution. They are a rebuildable projection, not canonical relationship data.

Backlinks respect access. A page never reveals the title, count, comment, row, or project context of an inaccessible source.

## Unresolved links

Unresolved local links remain visible and indexed with their source context. Resolving one rewrites the source to a stable page ID through the normal canonical command.

Resolution validates the source still contains the expected link and the selected target is active and accessible. A stale result does not rewrite newer content.

## Link facts and graph views

Link facts derive a graph across pages, row pages, blocks, properties, comments, managed files, application objects, and external URLs. Graph and related-content views are projections and can be rebuilt from canonical data.

## Comments

Notes supports page discussions, block comment threads, and inline text-range anchors. Comments retain author snapshots, status, timestamps, attachments, and soft-delete state. Per-user read state is local metadata rather than content.

Resolving a thread does not delete it. Inline anchors retain surrounding context so a moved or edited range can be identified or reported stale.

## Suggestions

Suggestions store original and proposed text, range and context anchors, author, version, and accepted or rejected state. Applying a suggestion checks the current block and base context. Conflicts remain visible for review rather than editing the wrong text.

## Mentions and notifications

Rich text can mention users, projects, tasks, pages, dates, and supported local objects. Reminder and participant mentions can create local notification rows. Delivery is owned by the local application or platform scheduler and never by a hosted Notes service.

Opening a note does not load the database mention catalog. A mention menu requests that data when opened, shares an in-flight request with other open menus, and releases it after the menus close. Reopening refreshes the catalog so database edits are reflected without retaining every row in each editor pane.

Notification previews and deep links obey the same effective page access as direct reads.

## Collaboration operations

Comment and suggestion mutations append local operation records with actor snapshots, entity versions, and explicit state transitions. Comment body edits currently use last-writer-wins metadata because there is no multi-author rich-text merge for comment bodies.

Resolve, reopen, accept, and reject operations validate base versions. Future sync must surface conflicting stale decisions rather than silently applying them.

## Access

Future collaboration can grant group-wide, project-wide, folder-subtree, page, comment, or task-context access. Project membership alone does not imply access to every Note.

Search, backlinks, mentions, notifications, history, templates, imports, exports, Chat links, reports, and AI context packages enforce the same effective access as direct page reads.

Inviting a participant requires an explicit history-visibility choice when prior content would become readable. Revocation stops future reads, exports, notifications, key access, and context assembly without rewriting legitimate shared history.

## Sync direction

Local editing remains SQLite-canonical. Future encrypted CRDT sync may coordinate changes over the same page and block graph, but it must preserve local canonical data, explicit access, conflict semantics, and derivative Markdown boundaries.

Exact encryption, key distribution, offline revocation, and multi-author conflict behavior belong to the [sync](../../data/sync.md) and [access-control](../../data/access-control.md) specifications.

## Daily and project notes

Project-note membership is implemented as page metadata and project-scoped navigation. Daily notes remain planned. Both are conventions over normal Notes pages, not separate Markdown folders or parallel document models.

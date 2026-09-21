# Music playlists and review

## Playlist identity

A playlist has a stable identity, localized or user-authored name, icon or emoji, order, shuffle setting, repeat mode, and ordered memberships. Built-in playlists have protected identity but user-controlled ordering and membership.

Fresh vaults provide practical starter playlists for common focus, break, meditation, exercise, hygiene, chores, cooking, and commute contexts. Built-in names and icons are localized and cannot be deleted or renamed. Custom playlists can be created, renamed, reordered, and deleted.

## Membership settings

A playlist membership connects one canonical media item to one playlist. It can define:

- Enabled state and stored order.
- Weighted selection frequency.
- Start and end positions.
- Skip ranges.
- Volume and playback rate overrides.
- Snooze behavior through the item's applicable playlist scope.

These settings belong to membership, not Calendar event assignment. The same item can behave differently in different playlists without duplicating media identity.

## Review workflow

Newly discovered items enter an explicit review state. Review presents source hierarchy, current item, metadata, artwork, availability, playlist choices, and repair actions without requiring the user to finish the entire queue before using Music.

Review state distinguishes unreviewed, reviewed, deferred, and ignored. Deferring or ignoring does not delete the item or its source. The complete Review projection, including ignored items, finishes loading before the builder is shown. A manual source refresh keeps the retained projection visible and replaces it once only after the refreshed Review projection is complete. Ignored items are hidden locally by default, the eye control reveals or hides the retained rows immediately without querying again, and ignored items can be returned to the unreviewed state individually or as a selection. Review-state changes update the retained projection without reloading it. A playlist can remain usable while review is incomplete.

The Review badge counts unique canonical items whose state is unreviewed. It does not add per-source totals, because one item can belong to several source collections and an item can temporarily have no collection relationship.

Opening the builder does not replace or restart current playlist playback when Review autoplay is off. Review autoplay or an explicit Review play action temporarily suspends the prior player source, queue, position, and play or pause state. The preview continues when the user visits another builder destination. Returning to the player restores that suspended state, even if the preview was paused. Explicit playback of another playlist and Calendar or Pomodoro automation supersede the suspended state instead of restoring it.

For YouTube videos, the player records duration when YouTube reports it during playback. Review uses that newly learned duration immediately even if its current item list has not refreshed, and the library retains it for later visits. Before YouTube provides a duration, Review keeps its existing time display.

After its first opening, the builder keeps its initialized workspace while the app shell remains active, including when the user moves between the builder and player or hides and reopens the Music panel. Its initial loading cover remains until the complete current item list is ready, so the visible list does not progressively fill after the workspace appears. Returning to Review restores the active item and durable draft state.

## Playlist management

Playlist management presents built-in and custom playlists in one stored order. It preserves the surrounding playlist context, keeps Cancel and Done in the existing header, and makes unrelated builder controls unavailable until management ends. Reordering starts from an explicit handle and supports pointer, touch, and keyboard operation. A failed save restores the prior order and reports the error.

Built-in edit and delete actions remain visibly unavailable with an explanation. Custom deletion explains what happens to memberships and never deletes the underlying library items or media files.

## Playlist item lists

Lists support bounded loading, search, sort, source and availability filters, snooze state, playback, concise metadata, membership settings, file location where supported, and removal from the current playlist.

Stored playlist order and selected sort are distinct. Sorting the view does not silently rewrite membership order.

## Sources explorer

Sources is a library explorer, not a configuration dashboard. It has two stable top-level roots: Local music and YouTube. Their displayed names are user-editable. Selecting a root, collection, or folder shows its immediate children and tracks in the main pane, while the side panel preserves the complete expandable hierarchy.

Local music contains each connected folder and mirrors its relative subfolder structure without copying or changing media files. A fresh vault attempts to connect the operating system Music folder as the initial child. Additional folders are added inside Local music rather than becoming new top-level source types.

YouTube accepts one link entry point for both videos and playlists. YouTube playlists retain their own named collection. Individual video links appear in the Saved videos collection so every online item participates in the same folder-shaped navigation model.

The YouTube link preview is a playable browse surface. A playlist preview shows the embedded playlist and its ordered video list, and selecting a row loads that video in the preview player. Ganbaru AI resolves the playlist and video names through YouTube's keyless metadata surface before saving them when possible. Metadata failure for one video does not block the playlist: the item remains playable and the normal player resolves its final metadata on first playback. Playlist refreshes preserve metadata that was already resolved.

YouTube track artwork loads for visible rows and the current or nearby Review items. Ganbaru AI keeps YouTube-supplied thumbnails in a size-bounded, device-local cache outside the vault, so revisiting Sources, Playlists, or Review does not request the same images again. Cached images expire before 30 days and are requested again only when needed. The app does not transform the supplied image or include these replaceable bytes in vault backups and transfers. YouTube rows and the Review media area give the supplied 4:3 image a rectangular slot rather than cropping or letterboxing it into a square. The small row thumbnail is decorative; the row's separate play control starts playback. If a thumbnail is unavailable, the placeholder remains visible.

The main pane follows the playlist browser's track presentation: artwork, title, artist, album, duration, availability, playback state, and applicable item actions remain visible without opening another workflow. Activating a track starts a normal player queue for the selected source branch, while activating a folder navigates into it. The Sources and playlist header controls only pause or resume an already loaded queue of the matching type. They remain available while navigating within that area and stay visibly disabled until row playback has established a queue.

YouTube play controls show a compact loading circle immediately when a start is requested. It remains until the embedded player reports playback, then becomes the pause control. A failed, canceled, or stalled start clears the feedback. Local music retains its immediate play and pause presentation.

Refresh, rename, repair, and removal actions are contextual to the selected root or collection. Removal presents the available scopes as a compact choice, shows only the consequence of the current selection, and names the final action explicitly. Disconnecting one device path is visually distinguished from removing a source or unused catalog tracks. Source health is reduced to an attention marker in the hierarchy and concise issue counts where relevant. Detailed repair decisions remain in the dedicated workflow.

## Snooze

Snooze temporarily excludes an item from one playlist or all playlists until a specified boundary. The UI explains the scope and end. Snooze is reversible and does not alter review state or source availability.

## Accessibility

Review, playlist navigation, membership selection, reorder, filters, item menus, and playback are keyboard reachable. Drag operations have equivalent keyboard commands and live announcements. Responsive layouts preserve destination labels and do not rely on unlabeled icons.

Source roots and folders use labeled rows, item counts, and chevrons with explicit expanded state. Local folder selection uses the operating system picker. YouTube uses one labeled link action and detects whether the link is a video or playlist. The following setup and other blocking builder workflows use the shared app-level dialog presentation rather than a panel-bounded overlay. Edit, delete, repair, relink, refresh, import, and export dialogs use one dim backdrop, one title and content hierarchy, and a consistent footer with explicit text actions. They trap focus, restore focus when closed, support Escape dismissal when the current operation is safe to interrupt, and cover the full visual viewport on desktop and mobile.

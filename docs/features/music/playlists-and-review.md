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

Opening the builder does not replace or restart current playlist playback when Review autoplay is off. Review autoplay or an explicit Review play action temporarily suspends the prior player source, queue, position, and play or pause state. The preview continues when the user visits another builder destination. Returning to the player restores that suspended state, even if the preview was paused. Explicit playback of another playlist and Calendar or Pomodoro automation supersede the suspended state instead of restoring it.

After its first opening, the builder keeps its initialized workspace while the app shell remains active, including when the user moves between the builder and player or hides and reopens the Music panel. Its initial loading cover remains until the complete current item list is ready, so the visible list does not progressively fill after the workspace appears. Returning to Review restores the active item and durable draft state.

## Playlist management

Playlist management presents built-in and custom playlists in one stored order. It preserves the surrounding playlist context, keeps Cancel and Done in the existing header, and makes unrelated builder controls unavailable until management ends. Reordering starts from an explicit handle and supports pointer, touch, and keyboard operation. A failed save restores the prior order and reports the error.

Built-in edit and delete actions remain visibly unavailable with an explanation. Custom deletion explains what happens to memberships and never deletes the underlying library items or media files.

## Playlist item lists

Lists support bounded loading, search, sort, source and availability filters, snooze state, playback, concise metadata, membership settings, file location where supported, and removal from the current playlist.

Stored playlist order and selected sort are distinct. Sorting the view does not silently rewrite membership order.

## Snooze

Snooze temporarily excludes an item from one playlist or all playlists until a specified boundary. The UI explains the scope and end. Snooze is reversible and does not alter review state or source availability.

## Accessibility

Review, playlist navigation, membership selection, reorder, filters, item menus, and playback are keyboard reachable. Drag operations have equivalent keyboard commands and live announcements. Responsive layouts preserve destination labels and do not rely on unlabeled icons.

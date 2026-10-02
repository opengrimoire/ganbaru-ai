# Music automation

Music automation selects playlist and soundscape behavior for Pomodoro phases without moving per-track configuration into Calendar events.

## Phase assignments

Assignments are defined independently for focus, short break, long break, and applicable no-Pomodoro context. Each phase can:

- Inherit from a lower-precedence source.
- Play a selected playlist automatically.
- Prepare a selected playlist without starting it.
- Pause music.
- Keep the current music.
- Select, pause, keep, or inherit a soundscape independently where supported.

Assignment records store playlist and soundscape intent. Start, end, skip, rate, volume, weighting, and enabled state remain playlist-membership behavior.

## Ownership and provenance

Current assignment owners include:

- **Project default:** the reusable project setting.
- **Event snapshot:** project intent copied when an event is created or explicitly refreshed.
- **Event override:** an explicit event-specific choice.
- **Work environment:** a planned context-specific source.

Runtime resolution reports the winning source and availability. Current precedence is event override, future work-environment assignment when present, then the event's project snapshot. Missing or deleted playlists and soundscapes produce an unavailable result rather than silently selecting another unrelated source.

Project defaults are real playlist selectors. They are not placeholder `None` fields.

The implemented Project settings UI exposes only Focus playlist, Short break playlist, and Long break playlist under Event defaults. Playlist choices play automatically and empty choices mean silence; each phase boundary starts a fresh track, avoiding the previous track when alternatives exist. Editing these defaults replaces older playback actions and independent background assignments. The broader assignment record and event override controls still support the behaviors listed above. Configuring background sounds within playlists is planned and is not part of Project settings.

## Calendar behavior

When a scheduled event becomes active, Calendar resolves its phase assignment and prepares or plays the selected context. Editing a project later does not silently rewrite an existing event snapshot. An explicit event override always remains distinguishable from inherited intent.

An event without Pomodoro can use its applicable context assignment. Future work environments may add another inherited layer, but that feature is not currently the canonical owner of Music settings.

## Pomodoro behavior

Phase transitions apply the corresponding assignment. Automation records enough context to explain why a playlist started, paused, or remained unchanged.

The user preference `Pause if the focus session is paused` pauses Music only when it was playing and records that Pomodoro caused the pause. Resume restarts Music only when that ownership still applies. Manual Music actions clear or supersede automation ownership as appropriate.

Calendar or Pomodoro transitions can supersede temporary Review playback. The UI keeps the resulting queue visible and explains the active assignment source.

## Soundscapes

Desktop soundscapes can run independently of playlist media. Each phase resolves soundscape behavior separately, allowing music to continue while a soundscape changes or vice versa. Platforms without a soundscape engine omit those actions rather than simulating them.

## Planned integrations

- Work environments can provide context-specific phase overrides once their product and storage model is implemented.
- A future sleep alarm can request a user-selected wake-up playlist after dismissal.
- A future edge panel can expose the same transport state without owning automation.

See [Projects settings and scheduling](../projects/settings-and-scheduling.md), [Pomodoro](../pomodoro/README.md), and [Work environments](../work-environments.md).

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

When a timed event without Pomodoro becomes active on desktop, the native Music owner reads canonical Calendar occurrences and resolves its assignment. The earliest-ending eligible event wins, with stable creation and identity tie-breakers. A committed open Focus run takes priority. Editing a project later does not silently rewrite an existing event snapshot. An explicit event override always remains distinguishable from inherited intent.

An event without Pomodoro can use its applicable context assignment. Future work environments may add another inherited layer, but that feature is not currently the canonical owner of Music settings.

## Pomodoro behavior

Committed native Focus transitions apply the corresponding playlist assignment through the native Music owner. The effect includes vault generation, execution revision, run and segment identity, deadlines, and a bounded validity lease. Duplicate delivery cannot restart a track or extend its original monotonic allowance; an explicit revoked lease or an expired deadline pauses playback still owned by that effect. Delayed older effects cannot revive it. Scheduled Calendar projections alone do not authorize Pomodoro playlist playback.

Music retains a separate manual-intent revision. An intervening manual action supersedes an earlier pause/resume token, and a later Focus phase can establish a new assignment. Assignment reads, playlist preparation and independent background intent use canonical native rows and the same accepted transaction. The frontend renders provenance and accepted background output, and hosts browser media adapters. It does not select automatic Calendar or Focus soundtracks.

The user preference `Pause if the focus session is paused` pauses Music only when it was playing and records that Pomodoro caused the pause. Resume restarts Music only when that ownership still applies. Manual Music actions clear or supersede automation ownership as appropriate.

Desktop Focus completion audio temporarily attenuates and pauses playing Music through its native owner, retaining the track position. Attenuation leaves persisted volume, mute, and playback rate intact. The audio source's actual completion releases attenuation; an interrupted output or a bounded timeout also requests restoration. Music resumes only when the original pause still owns the same session, track generation, manual revision, and Focus context. A manual control, replacement track, or changed Focus assignment supersedes that ownership and uses current settings. Restoration cannot restart a manually paused track or overwrite a newer volume choice. Completion audio therefore requires no frontend countdown or guessed asset duration. Physical desktop audio and browser-host acceptance remain pending.

Temporary Review playback defers automatic Calendar and Focus takeover. Leaving Review lets the native owner reconcile eligible automation without treating the deferred activation as already consumed. The UI keeps the resulting queue visible and explains the active assignment source.

## Soundscapes

Desktop soundscapes can run independently of playlist media. Each phase resolves soundscape behavior separately, allowing music to continue while a soundscape changes or vice versa. Platforms without a soundscape engine omit those actions rather than simulating them.

## Planned integrations

- Work environments can provide context-specific phase overrides once their product and storage model is implemented.
- A future sleep alarm can request a user-selected wake-up playlist after dismissal.
- A future edge panel can expose the same transport state without owning automation.

See [Projects settings and scheduling](../projects/settings-and-scheduling.md), [Pomodoro](../pomodoro/README.md), and [Work environments](../work-environments.md).

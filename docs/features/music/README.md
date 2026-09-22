# Music

Music provides persistent local and YouTube playback, playlist organization, review, soundscapes, and phase-based soundtrack automation. It supports focus without classifying a listener's music as objectively productive or distracting.

## Current scope

| Capability | Status |
| --- | --- |
| Persistent app-level player, transport, queue, shuffle, repeat, volume, rate, and resume | Implemented |
| Canonical local and YouTube library, source refresh, repair, artwork, search, and import/export | Implemented |
| Playlist membership settings, review, snooze, and playlist management | Implemented |
| Desktop local audio, local video, YouTube, soundscapes, tray, title-bar, and hardware controls | Implemented with platform codec limits |
| Android selected-folder local audio through Media3 | Implemented in source, broader release validation pending |
| Project and Calendar event phase soundtrack assignments | Implemented |
| Work-environment and sleep-alarm automation | Planned |
| YouTube input-locking presentation | Redesign required |

## Sources

Ganbaru AI supports local media selected by the user and YouTube through an embedded player. Music files remain in the user's own library. The vault stores structured library identity, playlist membership, settings, and playback state, not duplicate music files.

Spotify is unsupported because the available integration model does not fit this local open-source product. This is a product boundary, not a promise tied to volatile quota numbers.

## Player model

Playback belongs to one app-level host rather than the visible Music panel. Closing the panel keeps the current queue, source, position, volume, and appropriate background playback alive. Opening the panel reconnects to that same state.

The visible player can open above Calendar, Projects, or Notes. The playlist builder is a focused full workspace. Mobile uses the same canonical library and player contracts through an adaptive presentation.

## User control

Ganbaru AI does not infer whether a track is distracting. The user chooses playlists, membership settings, snoozes, and phase behavior. Listening statistics can support recency and frequency behavior without becoming a productivity score.

## Documentation map

- [Library and sources](library-and-sources.md)
- [Playback](playback.md)
- [Background sounds](soundscapes.md)
- [Playlists and review](playlists-and-review.md)
- [Automation](automation.md)
- [Android native services](../../platforms/android/native-services-and-data.md)
- [Desktop tray](../../platforms/desktop/tray.md)

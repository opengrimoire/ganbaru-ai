# Background sounds

**Implemented on desktop.** Background sounds play independently of Music. The player panel and builder put overall volume and playback on one row. Each sound section opens selection mode and volume adjustment in separate anchored panels from its heading. One sound at a time is the default; layered mode lets listeners toggle up to 16 sounds individually. The overall volume always changes every sound. Each section has a centered adjustment from -100% to +100%, with 0% leaving its level unchanged; this corresponds to a multiplier from 0 to 2. Simultaneous layers are normalized to reduce sudden loudness. The first-use overall volume is 10%, and later changes are retained.

Three generated noise textures are presented as rain-like sounds from soft to bright: brown, pink, and white noise. Their real noise types remain visible in the builder. These are generated noise, not recordings of rain.

Users may add their own local audio loops. Groups have a chosen name and icon and organize individually selectable sounds. A sound can be moved between groups or left in Other sounds. Group membership does not force simultaneous playback. Original audio files remain in place. Missing files can be repaired by selecting a new location on the current device; renaming or regrouping does not require the file to be available.

The vault stores sound definitions, groups, group membership, overall volume, section volume adjustments, playback selection, and the layering preference. Local file locations remain device-specific. Removing a group moves its sounds to Other sounds without deleting their definitions or audio files. Removing a sound definition never deletes its original file.

Soundtrack automation still selects one specified background sound when its phase starts; it does not silently add a layer to the listener's current selection. Platforms without the background-sound engine omit these controls.

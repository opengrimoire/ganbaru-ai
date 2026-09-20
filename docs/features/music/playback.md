# Music playback

## Persistent host

One app-level playback host owns the active source and queue. The Music panel, playlist builder, title bar, tray, media keys, Calendar automation, and Pomodoro automation issue commands against that owner.

Closing a visible panel does not stop playback. Explicit stop, end-of-queue behavior, an automation decision, application exit, or a platform lifecycle boundary can stop it.

## Transport and queue

The player supports play, pause, previous, next, seek where the backend supports it, volume, mute, rate, shuffle, and repeat. Queue identity remains stable across source transitions so controls do not flicker or temporarily target the prior item.

Clicking an inactive queue item starts it from the configured membership start. Clicking the active item toggles play and pause only where the surface communicates that behavior.

Shuffle selects from eligible playlist memberships according to the configured weighting and recency behavior. It never mutates the stored playlist order. Snoozed, disabled, missing, or unavailable items are skipped with an explainable reason.

## Resume state

Playback position, duration, status, queue context, and source generation persist with monotonic update ordering. A late save from an older source cannot overwrite newer state.

Resume respects membership start and end boundaries and does not resume an ended item as if it were paused. Unsupported or changed media reports a recoverable state rather than seeking blindly.

## Desktop local audio

Desktop local audio uses the Rust-owned audio backend for supported MP3, FLAC, AAC or ALAC in MP4/M4A, OGG Vorbis, and WAV/PCM media. Unsupported formats fail explicitly.

The backend owns decoding, pause, seek, duration, and output lifecycle. Hardware controls and desktop media metadata reflect the same canonical player state.

## Local video

Desktop local video uses the platform WebView media stack with an app-owned token-gated loopback source that serves only registered files and supports byte ranges. Platform codec support therefore follows the installed WebView media capabilities.

Ganbaru AI does not ship a separate cross-platform native video framework without measured evidence that the WebView path is inadequate. Local media registrations are bounded and released when no current visual or playback state needs them.

## Android playback

Android local audio uses an ExoPlayer owned by a Media3 session service. It continues appropriately when the Activity is backgrounded and participates in audio focus, media notifications, headset disconnection, lock-screen controls, and trusted system controllers.

Android does not compile or initialize the desktop audio backend or desktop loopback media host.

## YouTube playback and redesign gap

YouTube playback uses an embedded IFrame player through a local host that supplies the required HTTP embedding context. Embedding failures and owner restrictions are surfaced explicitly.

The current implementation disables pointer input on the embedded frame and places a transparent Ganbaru AI hit target across the visible player area. Current [YouTube Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) rules forbid overlays over any embedded player area. This presentation is an unresolved redesign gap.

Documentation must not claim that the current hit target is policy-compliant. A future design must preserve usable Ganbaru controls without covering or blocking required embedded-player interaction. The redesign must be reviewed against the current authoritative YouTube policy before compliance is claimed.

This gap does not authorize scraping, proxying, downloading, or bypassing embedding restrictions.

## Errors and recovery

Errors distinguish invalid input, missing local permission, missing or ambiguous file, unsupported format, media decode failure, network failure, embedding restriction, and unavailable source. Retry never duplicates queue items or revives a stale source generation.

When part of a saved playlist is unavailable, the player continues with the eligible subset and quietly identifies offline omissions. If a non-empty playlist has no playable tracks, the player links to its review workspace without replacing the playlist chooser with an error card. Selecting an empty playlist does not interrupt or replace the current playback state.

## Accessibility

Transport controls have stable accessible names and keyboard operation. Media status is conveyed through text and state, not motion alone. Fullscreen and compact surfaces preserve an exit path and do not trap focus.

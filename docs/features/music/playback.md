# Music playback

## Persistent host

One native Music session owns the active source, queue, generation, eligibility, listening records, and playback boundaries. The Music panel, playlist builder, title bar, tray, media keys, Calendar automation, and Pomodoro automation issue commands against that owner. Browser media and YouTube remain frontend adapters that report observations and execute generation-tagged effects.

The native session cutover is implemented in source. Physical desktop controls and Android background, Activity destruction, and lock-screen acceptance remain required before claiming release readiness.

After snoozing an item, the track preferences and playlist builder request native queue reconciliation. Rust determines the eligible successor or retained terminal selection; these surfaces do not issue a second Next or Pause based on an older frontend snapshot. The superseded frontend Calendar/Focus soundtrack coordinator is removed.

On desktop, native Calendar soundtrack activation reads bounded canonical occurrences and assignments. It selects the timed event with the earliest end, then creation order and stable identity, and schedules the next known boundary while refreshing for edits. All-day, cancelled and Focus-configured events cannot manufacture a Focus phase. An open committed Focus run takes priority over Calendar automation. Review playback defers automatic takeover, and manual playback changes remain effective until the next accepted activation.

Committed Focus phases and desktop Calendar activations share assignment precedence, queue preparation and background-layer preparation. Event overrides take precedence over work environments and event snapshots, including assignments that only select a background sound. The accepted state commits before decoder delivery. A background-only assignment leaves main music ownership unchanged. Missing sources remain explicit, and a failed Calendar read leaves unrelated playback running.

Automatic background intent is recorded separately from manual intent. Startup displays the actual native output and does not replay an automatic selection from a saved flag. Only a freshly accepted native phase or an explicit manual action may start it. Source preparation rechecks phase, state version, lifecycle revision and expiry before audible output. Timed-out workers retain their admission slots until they drain, and vault handoff waits for native background shutdown. The frontend background coordinator refreshes presentation after native acceptance.

Closing a visible panel does not stop playback. Explicit stop, end-of-queue behavior, an automation decision, application exit, or a platform lifecycle boundary can stop it.

Vault changes revoke new playback admission immediately and wait a bounded time for the native owner to pause, stop its backend, and release its database context. Reactivation is retained independently of the bounded command queue. A failed or cancelled transition cannot lose resume when that queue is full, and an older queued freeze cannot suspend the owner after a newer resume. Focus and Music share the native vault lifecycle revision rules.

Android delivery waits for actual main-thread SDK execution and revokes stale queued playback during vault transitions. The Android playback section defines the acknowledgement and cancellation limits. Desktop decoder effects share one admitted worker operation, including source preparation, with a bounded acknowledgement wait and cancellation checks before playback.

## Transport and queue

The player supports play, pause, previous, next, seek where the backend supports it, volume, mute, one playback-order control, and playlist repeat. The order control has three mutually exclusive choices: In order follows stored playlist membership order; Shuffle plays a randomized pass through eligible tracks without repeats before repeating a playlist; Mix is an ongoing weighted selection with replacement. Shuffle and Mix have short, keyboard-accessible help tooltips in the mode menu. The main player does not expose a speed control or speed shortcuts. Playlist membership rate overrides remain supported in stored playback settings. Queue identity remains stable across source transitions so controls do not flicker or temporarily target the prior item.

One compact track-preferences button replaces the speed control. The panel presents Mix frequency above snooze, with one shared scope selector for both. It starts on the playing playlist when the track belongs to it, otherwise on Everywhere. Everywhere snooze applies across playlists, while Everywhere Mix frequency updates all of the track's current playlist memberships. Mix frequency is disabled when the track has no playlist memberships. Five dice choices represent the five frequency levels, and mixed weights across playlists have no selected die. Each die uses the shared app tooltip for its relative chance, while only the selected frequency name appears beside the heading. When playback order is not Mix, a separate warning icon names the current mode with its icon and points to Mix with its dice icon; preferences can still be prepared in advance. These hints open above their triggers when there is room in the viewport, otherwise below. A frequency choice appears immediately and reverts if saving fails, without fading the panel during the write. Snooze offers 1 day, 1 week, and 1 month. Selecting one skips the playing track when its scope applies to the current queue; if nothing else can play, playback pauses. Returning to the track shows its active duration, and selecting that duration again removes the snooze. There is no indefinite choice or separate Resume action in this panel.

The player queue also marks snoozed tracks with a small clock beside the title. Clicking the clock removes the active Snooze without starting that track. A row shows its full-title tooltip only when the visible title is truncated; its accessible name remains the full title.

The current-track playlist button opens a compact list of the track's playlist memberships. Selecting rows only changes a draft. Save applies all additions and removals together, while closing the panel discards unsaved choices. Open in playlist builder goes to Review with the current track selected, clearing filters that hide it when needed. The panel does not offer playlist creation or file-location actions.

Clicking an inactive queue item starts it from the configured membership start. Clicking the active item toggles play and pause only where the surface communicates that behavior.

Shuffle ignores Mix frequency and never mutates stored playlist order. Mix uses relative weights of 0.5, 0.75, 1, 1.5, and 2, with Normal at 1. Recent tracks receive a soft penalty for the next five distinct selections; even an immediate repeat remains possible, but uncommon. Mix never learns from skips or silently changes a track's preference. It continues while eligible tracks remain, so playlist repeat settings do not apply while Mix is selected. Source queues use the same recent-repeat guard with equal track weights. Snoozed, disabled, missing, or unavailable items are skipped with an explainable reason.

## Resume state

Playback position, duration, status, queue context, and source generation persist with monotonic update ordering. A late save from an older source cannot overwrite newer state.

Native commands serialize through one bounded owner. Checkpoints, listening outcomes, and action receipts commit together before decoder effects are published. An uncertain command response retains its action identity on retry, so advancing or starting a queue does not execute twice. Position-only observations are checkpointed periodically; source transitions and listening outcomes are committed immediately.

WebViews receive small native channel notices and read retained, ordered frames through typed commands. Each window has at most one unacknowledged frame. Pending position projections coalesce, queue rows are sent when their canonical identity or revision changes, and browser effects have a hard pending-work bound. Reading a frame or acknowledging it again after a lost response cannot replay queue intent. An expired frame cannot start browser playback after suspension.

Vault handoff or a changed native context revokes retained frames and sends a terminal invalidation without waiting for acknowledgement. The frontend interrupts pending browser loads, releases managed visual sources, clears old queue presentation, and drops pending intent before subscribing to the next context. Recovery advances the source generation beyond both persisted and already live generations.

The configured primary application window alone hosts browser decoders and supplies their observations. Detached windows receive snapshots and issue native user commands without creating another browser player. Closing, hiding, or losing the primary host does not stop native audio. Browser playback pauses with the unavailable-host state; returning the host prepares the selected source paused.

Checkpoint records in the vault are keyed by the local device identity. They contain portable item and membership identifiers, bounded navigation history, selection state, and playback settings. They contain no resolved file paths, Android content URIs, or live decoder handles. A copied vault may contain another device's checkpoint record, but that record never becomes this device's live session. Each device resolves its own root bindings and restores its own checkpoint paused. Ad hoc sources supplied as paths or URLs remain transient and do not create a portable queue checkpoint.

Resume respects membership start and end boundaries and does not resume an ended item as if it were paused. Unsupported or changed media reports a recoverable state rather than seeking blindly.

## Desktop local audio

Desktop local audio uses the Rust-owned audio backend for supported MP3, FLAC, AAC or ALAC in MP4/M4A, OGG Vorbis, and WAV/PCM media. Unsupported formats fail explicitly.

The backend owns decoding, pause, seek, duration, and output lifecycle. Hardware controls and desktop media metadata reflect the same canonical player state.

The native session observes decoder position and completion independently of the WebView. Native tray and operating-system transport actions enter that same owner directly. Vault snapshots and handoff freeze both Music and Focus before database pools drain; reactivation rereads the currently authorized vault and never resumes playback automatically in a different ownership generation.

One decoder operation includes file inspection, preparation, settings, and accepted autoplay. It retains worker admission through actual completion, even when its eight-second acknowledgement deadline expires. Further operations fail explicitly while that work remains pending; they do not create waiting decoder workers. Cancellation, vault lifecycle, and committed Focus authority are checked again after blocking preparation and before playback. A late canceled result stops its prepared decoder. Application shutdown revokes admission without joining a blocked OS read indefinitely; that same worker stops and releases its decoder when the read returns.

Decoder or invalid-source errors can advance the queue. Worker, device, seek, expired-authority, and uncertain-delivery failures retain the selected queue and position as an interruption, with a Stop retry before later playback. Explicit Play reloads the retained selection rather than applying Play to an unknown decoder. Muting for completion and restoring gain while paused are drain effects; they do not require a still-running Focus phase or authorize playback.

## Local video

Desktop local video uses the platform WebView media stack with an app-owned token-gated loopback source that serves only registered files and supports byte ranges. Platform codec support therefore follows the installed WebView media capabilities.

Ganbaru AI does not ship a separate cross-platform native video framework without measured evidence that the WebView path is inadequate. Local media registrations are bounded and released when no current visual or playback state needs them.

## Android playback

Android local audio uses an ExoPlayer owned by a Media3 session service. It continues appropriately when the Activity is backgrounded and participates in audio focus, media notifications, headset disconnection, lock-screen controls, and trusted system controllers.

The service owns decoder observations and transport mechanics. Rust owns queue selection and membership boundaries. Initial attachment captures a native callback channel plus a JavaVM and a global bridge-class reference. Later outbound effects attach a worker to the JavaVM and call the process-owned service bridge without looking up an Activity. Media3 completion, position, and trusted controller actions use the retained native channel. Kotlin does not maintain a competing queue. Service termination is an interruption that retains the selected queue and position without recording a failed-track skip. Explicit Play can reattach through an available platform host and reload that selection paused in a new native generation before applying playback intent. Old observations cannot revive the lost decoder. These source-level lifetime boundaries still require physical acceptance after Activity destruction.

Service effect admission has a fixed pending bound and one main-thread drain. A full queue or rejected main-thread post reports failure before dispatch returns and does not synthesize a manual control. Startup has a monotonic deadline. Native observation detects an absent or stalled service without WebView execution; interruption revokes its old observation generation. Startup failure and service destruction discard only their obsolete pending work. Asynchronous document resolution checks both the playback generation and its load attempt. Later Pause and Seek intent survives loading, and Stop or service destruction invalidates outstanding resolution callbacks. The Media3 service retains its documented default task-removal lifecycle, with player/session release during destruction. See the [Media3 background playback contract](https://developer.android.com/media/media3/session/background-playback).

Native delivery success waits for the main-thread SDK effect to finish. A Load acknowledgement means the decoder was reset and source resolution was scheduled; readiness still comes from decoder observations. Stop acknowledges only after stopping and clearing the decoder and invalidating source callbacks. An absent service counts as stopped only after decoder release completes. Vault quiescence therefore cannot rely on queue admission alone.

Each delivery carries a process-local native identity checked before queue admission, immediately before SDK execution, and after document resolution. Its captured vault revision and, for Focus-owned playback, phase/mode and original monotonic lease must remain current. A newer freeze or resume cannot revive old queued work. A timed-out or canceled waiter revokes its delivery but retains its single pending slot until actual acknowledgement or confirmed removal from both queued and executing SDK work. JNI work also retains one worker permit through actual completion after a timeout. Failure remains visible to the native owner instead of creating replacement waiting workers or reporting successful handoff.

Android does not compile or initialize the desktop audio backend or desktop loopback media host.
Raw frontend decoder load, transport, settings, and snapshot commands are retired on both desktop and Android. Selected-file inspection remains available. Trusted Android controllers receive only transport commands routed as native semantic intent and decoder display reads; media-item replacement, preparation, shuffle/repeat changes, and decoder release are unavailable to those controllers.

Document resolution uses one process-owned worker and one latest queued request across service replacements. A blocked provider retains that worker, so destroying and recreating a service cannot accumulate replacement resolver threads. A 30-second elapsed-realtime deadline includes sleep; both the native service observer and late completion check it. Expiry retains the selected queue as an interruption with specific source-resolution context. It cannot become a failed-track skip or start playback when the provider eventually returns.

Canonical Pause and silent preparation also constrain decoder observations. A late Playing report produces another Pause instead of opening a listening record. Completion or source failure may prepare the next eligible selection, but automatic advancement retains the accepted paused intent. Explicit Play or navigation remains a separately accepted control.

## YouTube playback and redesign gap

YouTube playback uses an embedded IFrame player through a local host that supplies the required HTTP embedding context. Embedding failures and owner restrictions are surfaced explicitly.

When a queue reaches a browser-owned source while its host is unavailable, that item remains selected and playback pauses with an explicit unavailable-host state. Returning the host reloads the selected item paused. The user can resume it explicitly. The session does not silently skip the item or promise background YouTube playback without a functioning browser host.

The current implementation disables pointer input on the embedded frame and places a transparent Ganbaru AI hit target across the visible player area. Current [YouTube Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) rules forbid overlays over any embedded player area. This presentation is an unresolved redesign gap.

Documentation must not claim that the current hit target is policy-compliant. A future design must preserve usable Ganbaru controls without covering or blocking required embedded-player interaction. The redesign must be reviewed against the current authoritative YouTube policy before compliance is claimed.

This gap does not authorize scraping, proxying, downloading, or bypassing embedding restrictions.

## Errors and recovery

Errors distinguish invalid input, missing local permission, missing or ambiguous file, unsupported format, media decode failure, network failure, embedding restriction, and unavailable source. Retry never duplicates queue items or revives a stale source generation.

When part of a saved playlist is unavailable, the player continues with the eligible subset and quietly identifies offline omissions. If a non-empty playlist has no playable tracks, the player links to its review workspace without replacing the playlist chooser with an error card. Selecting an empty playlist does not interrupt or replace the current playback state.

## Accessibility

Transport controls have stable accessible names and keyboard operation. Media status is conveyed through text and state, not motion alone. Fullscreen and compact surfaces preserve an exit path and do not trap focus.

## Platform acceptance

Automated policy, transaction, projection and worker tests do not establish real audio or operating-system lifecycle behavior. Complete these desktop checks in the installed Tauri app:

- Suspend WebView JavaScript while local audio advances, a timed Calendar event starts or ends, and a committed Focus phase changes. Check queue position, independent background output, tray and media-key controls after returning.
- Overlap two timed Calendar events, including a moved recurrence override and an excluded original. Confirm the earliest-ending eligible occurrence wins. Start a Focus run and confirm Calendar cannot take over its soundtrack.
- Enter playlist review across an automatic activation, then return. Confirm review playback is preserved and native automation can reconcile afterward. Override an automatically selected track manually and confirm it remains selected until the next accepted activation.
- Select only a background sound for an event or phase. Confirm the main queue keeps its ownership and transport state. Remove a referenced sound and confirm the error is visible without interrupting unrelated music.
- Restart after automatic background playback. Confirm saved intent alone cannot start audio. Repeat with an explicit manual selection, then activate a fresh eligible event or Focus phase and confirm native output and displayed state agree.
- Delay source preparation during a phase change, vault switch and handoff. Confirm obsolete preparation cannot become audible, handoff waits for acknowledged shutdown or reports its timeout, and returning to the original vault does not replay canceled work.

Android background playback, Activity destruction, lock-screen controls, document-provider delays and acknowledged handoff are covered by the separate [Android acceptance matrix](../../testing/android.md#music). Background sounds remain a desktop capability.

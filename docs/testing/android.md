# Android testing

Android testing distinguishes source checks, emulator coverage, physical-device behavior, and signed release acceptance.

## Required targets

| Target | Coverage |
| --- | --- |
| Physical Android 10 ARM64 phone | Minimum-version behavior, real storage providers, notifications, audio, background execution, process death, reboot, and system navigation |
| API 29 compact emulator | Install, rotation, Activity recreation, insets, keyboard, Back, denied permissions, offline startup, and deterministic core flows |
| API 33 emulator or device | Notification runtime permission grant, denial, repeated denial, and Settings recovery |
| API 34 or newer emulator or device | Foreground-service policy, exact-alarm state, predictive Back, current WebView, and modern background restrictions |
| Wide or tablet configuration | Rail navigation, responsive overlays, multi-pane limits, rotation, and keyboard behavior |
| Supported ABI release artifacts | Installation, startup, native-library loading, and 16 KiB page-size compatibility where applicable |

## Core offline flows

- Fresh install and `Start from zero`.
- Import a complete vault through a document tree.
- Create a portable backup, uninstall, reinstall, and restore.
- Cold and warm startup while offline.
- During cold and warm startup, confirm the centered readiness indicator hands off to a usable Calendar before background preparation completes. Let preparation settle, then open every primary destination, every standard Project view, Settings, Quick notes, Music, Pomodoro, and linked-device controls without another top-level loading surface. Repeat while opening one destination immediately after Calendar appears and confirm only that destination shows loading until its existing preparation finishes.
- Calendar creation, editing, recurrence, reminders, and project linkage.
- Project task views, detail, settings, scheduling, and wide-view touch panning.
- Notes pages, blocks, databases, history, assets, Archive, and Trash.
- Provider-free Chat channels, messages, replies, search, drafts, and scheduling.
- Quick notes lifecycle and conflict-safe persistence.
- Themes, localization, profile assets, Settings, and vault identity.

## Navigation and layout

- Compact and wide primary navigation.
- Portrait and landscape safe areas.
- Three-button and gesture navigation.
- Cutout and system-bar contrast.
- Keyboard open, resize, rotate, dismiss, and focused-field recovery.
- Android Back through dialogs, sheets, builders, hierarchy navigation, editors, task detail, and destination roots.
- Predictive Back on a supported newer target.
- Split-screen and Activity recreation.

## Lifecycle and data

- Activity background and removal without corrupting drafts.
- Process death with and without final lifecycle callbacks.
- Vault switch, failed activation, and rollback.
- SQLite pool closure during restore.
- Low-storage and interrupted import or restore.
- Reboot, package replacement, clock change, and timezone change reconciliation.
- Missing or revoked document-tree permission.
- Managed asset selection with oversized, mislabeled, malformed, and missing files.

## Calendar and Pomodoro

- Notification permission grant, denial, revocation, and app-settings recovery.
- Exact-alarm granted and denied fallback.
- Calendar test notification and channel behavior.
- Event edits cancel and rebuild native deliveries.
- Due commitment while the Activity is absent or the PC is off produces a reminder and no run or focus history.
- A late explicit start records its actual start, not the Calendar boundary.
- Native phase deadline, missed break return, and repeated recovery create no additional focus phases.
- A committed phase close and its late alarm deliver one boundary reminder. Retry completion after the next phase starts; it must preserve that newer ongoing notification.
- Delay a Guardian phase update or completion behind another provider operation, then stop the run or change vault ownership before it is admitted. Confirm the queued publication is rejected and cannot restore that phase or clear a newer notification. Repeat after the Rust hosting process dies and with a release build to verify the private JNI authority callback survives shrinking.
- Change notification language during a run, pause, and process restart. Copy changes must not supply execution state, postpone commitment reminders, or recover a run from notification storage.
- Denied notification access, process death, reboot, and clock changes preserve reminder versus execution semantics.
- Foreground-service start, ongoing notification, pause, resume, stop, process recreation, and event deadline.
- Tap routing validates identifiers and opens the correct context.
- Manufacturer battery or autostart guidance never claims an unobservable enabled state.

## Music

- Suspend the WebView while native audio advances across several items. On return, confirm the UI receives the latest canonical queue and position without replaying intermediate browser effects or starting a second decoder.
- While a browser source is selected, hide the app long enough for its host lease to expire. Return after the subscription expires as well. Confirm the selected source is prepared paused, and only explicit play resumes it. Repeat while a native source transitions to a browser source in the background.
- During a slow browser load, seek, pause, change the selected item, and switch vaults. Confirm effects remain ordered, callbacks from the previous subscription are ignored, and the old decoder stops. Repeat disconnect and reconnect after an uncertain subscription response.

- Select, retain, revoke, and reselect a Music document tree.
- Scan supported audio outside the main thread and respect bounds.
- Media3 playback while backgrounded, with audio focus, notification, lock-screen, headset, and trusted controller actions.
- Queue, playlist, review, assignment, resume, missing item, and offline subset behavior.
- Delay selected-document resolution, then pause, seek, stop, replace the item, or destroy the service. A late callback must use the newest pause/seek intent and cannot reload a stopped or destroyed decoder. Force service loss while playing, confirm the selected track and position remain retained, then use explicit Play from the foreground. The reloaded generation must ignore old observations and must not skip to another track. Repeat service-start failure and effect backpressure; transport errors must not become manual controls.
- Confirm desktop audio, soundscape, path reveal, and loopback media capabilities are absent.
- Stall main-thread Music effect consumption during a vault handoff. Handoff must wait for actual Stop or report a timeout; resuming the old vault must not execute old canceled playback. Repeat a Focus phase change and pause during a slow document lookup. The old phase cannot start after lookup completes. Confirm a failed delivery can recover after its queue entry is removed, while an executing SDK call retains the pending slot.
- Keep a document provider blocked past the source-resolution deadline, including device sleep. Confirm the selection remains retained with an interruption and cannot start when the provider eventually responds. Destroy and recreate the service and submit replacement selections while the old lookup is still blocked; resolver work must remain bounded to one active worker and one latest queued source.
- Connect a trusted media controller and verify play, pause, seek, volume, rate, and next/previous still enter the native owner. Attempt media-item replacement, prepare, repeat/shuffle mutation, and release; these direct decoder commands must be unavailable.

## Doomscrolling

- Separate Usage Access and Accessibility disclosures.
- Grant, deny, revoke, and recover each access independently.
- Selected launchable-app filtering and protected package rejection.
- Fresh phase and exhausted-limit Home redirection.
- Paused phase, stale projection, vault switch, and rule removal stop enforcement.
- Activity removal, guardian process recreation, reboot, package replacement, and low-memory recovery.
- Daily and weekly rollover across local midnight and timezone changes.
- Journal import accepts only current-vault rows and does not duplicate acknowledgements.
- Notification deep links open the relevant settings.
- Store-policy declaration matches observed behavior.

## Vault handoff pairing

- Grant and deny camera access from the user-initiated QR pairing scanner.
- Confirm camera capture stops after a code is decoded, the scanner is canceled, or the pairing surface closes.
- Confirm malformed, expired, replayed, and wrong-vault invitations cannot enroll the phone.
- Confirm pairing and later authenticated reconnects work on a private LAN without internet access.
- Run the complete [local vault handoff acceptance](vault-handoff.md) for ownership in both directions, read-only refresh, preserved local backup, native schedule reconciliation, offline Doomscrolling accounting, unlink, and explicit lost-device recovery.

## Security and artifact checks

- No broad storage, package, overlay, capture, contact, microphone, or location permission. Camera access is limited to user-initiated QR pairing.
- Native components have intended exported state and internal broadcasts require signature authority.
- Production content policy and WebView bridge reject unapproved remote or generic commands.
- Minification preserves required command serialization without widening capabilities.
- Android artifact excludes desktop provider processes, PTYs, Git, Rodio, tray, benchmarks, native messaging, and desktop blocker code.
- Backup and device transfer exclude the unencrypted live vault.

## Release acceptance

Run the complete matrix on the signed minified candidate. Record artifact identity, package version, signing certificate identity, target, device or emulator image, WebView version where relevant, result, and known exceptions.

A debug success or source compile does not satisfy release acceptance.

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
- Denied notification access, process death, reboot, and clock changes preserve reminder versus execution semantics.
- Foreground-service start, ongoing notification, pause, resume, stop, process recreation, and event deadline.
- Tap routing validates identifiers and opens the correct context.
- Manufacturer battery or autostart guidance never claims an unobservable enabled state.

## Music

- Select, retain, revoke, and reselect a Music document tree.
- Scan supported audio outside the main thread and respect bounds.
- Media3 playback while backgrounded, with audio focus, notification, lock-screen, headset, and trusted controller actions.
- Queue, playlist, review, assignment, resume, missing item, and offline subset behavior.
- Confirm desktop audio, soundscape, path reveal, and loopback media capabilities are absent.

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

# Local vault handoff acceptance

**Status: Physical acceptance pending.** On 2026-09-13, the focused automated round-trip, ownership, transport, Calendar projection, Doomscrolling reconciliation, Android notification, and Android enforcement checks passed on the development branch. The full `pnpm -w run validate:full` security and code gate also passed. A physical desktop and Android run is the only pending external check. Record the device details and result below when a maintainer completes it.

## Required setup

- One supported Linux or Windows desktop and one Android 10 or newer phone on the same private LAN.
- Development builds from the same revision, with a fresh Android installation available for the first pass.
- A desktop vault containing one identifiable Calendar event with an alarm and Pomodoro configuration, Project task and managed project file, Note and attachment, Chat channel, Quick note, custom theme, Doomscrolling limit and history, Music item and playlist, and profile or project asset. Keep one music file and one project folder outside the vault.

## Acceptance script

1. After choosing a desktop vault, confirm the folder action remains busy while the vault-bound QR invitation is prepared. Confirm the app then transitions directly to the dedicated linking screen with the QR code and live renewal countdown already visible on its first frame, without reloading, showing an intermediate loading screen, or flashing the background. Let the countdown reach zero and confirm the app replaces the code automatically without blocking progress. Immediately choose **Not now** and confirm the screen either opens the preloading app directly or shows only a centered loading spinner until the app is ready. Close and reopen the app, then confirm the linking screen returns because deferral did not complete onboarding. Repeat after leaving the linking screen open briefly to confirm the app loads in the background. After the Android permission review, confirm its dedicated linking screen shows a centered square camera preview across the available content width, grant camera access, and scan once from a comfortable handheld distance without needing to move the phone unusually close to the desktop display. Confirm the camera stops, the success state names the desktop, and **Continue** opens the read-only desktop copy before showing the ordinary main-device choice. Confirm no replacement warning appears for this untouched starter vault. Separately confirm Data settings and the unlinked top-bar control reopen the same full-screen scanner without scan instructions, stop controls, or emergency recovery actions.
2. On a separate clean run, choose **Not now**, add an Android-only event or note, return to linking, and scan the desktop invitation. On Android, choose `Use on this device`. Confirm a replacement warning states that the independent data cannot be merged and that a backup will be saved to Downloads. Cancel once and confirm no transfer starts. Confirm again, then verify desktop becomes read-only before Android becomes writable, the previous Android vault backup appears in Downloads, and every prepared record, configuration value, managed file, and asset opens on Android. Restore or inspect the backup and confirm the Android-only item is recoverable. Confirm external music and project bytes were not copied and their missing local bindings are handled normally.
3. Restart both applications while Android owns the vault. With desktop closed or unreachable, edit the Android-owned vault, verify already scheduled Calendar alarms and Doomscrolling enforcement continue, then create inactive-device Doomscrolling usage on desktop while disconnected.
4. Reconnect on the LAN. Refresh the desktop read-only copy, then confirm Android and desktop show the reconciled combined Doomscrolling total exactly once. Change a desktop-owned Calendar alarm later, refresh Android, and confirm the native Android schedule changes only after that refresh.
5. On desktop, choose `Use on this device`. Confirm the Android edit arrives, desktop becomes writable, Android becomes read-only, and an application restart preserves both roles. Make Android the owner again, close it, wait at least five seconds, and press the desktop switch action. Confirm the progress indicator stops promptly, ownership does not change, and a brief main-device-unavailable message appears directly below the switch action. Reopen Android and confirm an explicit retry succeeds.
6. Verify active Chat work and an active Pomodoro session each block ownership movement with a clear message. Stop them and confirm retry succeeds. Start another transfer, interrupt connectivity before commit and after commit in separate passes, then verify retry preserves the last committed owner and neither device becomes a second writer.
7. Confirm unlink does not silently promote a read-only copy. While the coordinator owns the vault, take a read-only device offline and remove it from the coordinator. Confirm removal succeeds immediately. Reconnect the removed device, verify its next authenticated request clears the stale link and explains that its preserved copy remains read-only, and confirm it cannot refresh or transfer data. Re-link, make the owner unavailable, and confirm the coordinator refuses to remove that owning device. Choose the separately confirmed recovery action on the non-owner and verify it becomes an explicitly separate writable copy while the other copy remains preserved.
8. Attempt new pairing with builds that have different embedded migration sets. Confirm enrollment is rejected before membership changes and the UI asks to update both devices. Repeat with devices that were linked before one build changed, then request both refresh and ownership. Confirm each request fails before the source creates a new snapshot, neither active vault is replaced, and updating both devices restores transfer capability.
9. Link a desktop that already contains an independent event or note, then request first ownership there. Confirm the replacement warning appears, cancellation preserves the current vault, and confirmation preserves the old vault in a visible sibling folder before activating the linked vault.

## Automated ownership durability checks

The ownership tests cover failure before file replacement and injected directory-sync failure after replacement during initial registration, outgoing commit, and incoming activation. They verify that uncertain persistence cannot restore write authority, accept a retry, or grant database access in the same process, and that restart reloads the visible committed generation. These are filesystem-boundary failure tests, not proof of power-loss durability on every supported platform.

The native quiescence tests also cover concurrent operation rejection, a retained cleanup worker's reservation, release of database and managed-write fences before reactivation, cancellation cleanup, and exactly-once reporting of reactivation failure. A stalled-writer test verifies that timeout restores admission and a subsequent operation can acquire the fence. Whole-vault archive and round-trip tests remain required after selection or activation changes.

Outgoing preparation regressions cancel while waiting for the database drain and after acquiring its gate. They verify durable ownership rollback before reactivation, fence release, retained pre-commit state for stored transfers, and explicit rollback failure without repeating cleanup. These tests use the file-backed ownership manager and await retained cleanup rather than relying on sleeps.

## Additional selection and restore acceptance

- On desktop, switch between two vaults with different Focus history and Music selections. Repeat with an idle or break overlay visible. Confirm an old overlay, tray action, or delayed playback callback cannot control the new vault.
- Delay native delivery, then request selection. Confirm a failed drain preserves the active folder and reports the failure. Retry after delivery drains. Attempt another folder action during the first operation and confirm it reports that the operation is busy.
- On desktop, keep a local or mounted Music source blocked beyond the decoder deadline. Attempt repeated controls and vault selection. Confirm the selected track is retained as an interruption, pending work remains bounded, selection does not report successful drain, and an old load cannot play after the source becomes available. Retry after cleanup and verify explicit Play reloads the retained selection. Repeat while a Focus phase changes and while closing the application.
- On Android, select a portable backup, cancel the document picker, and retry. Confirm cancellation preserves the active vault and runtime operation. Restore a valid backup with playback and accepted notifications present; confirm the old surfaces revoke before replacement and the restored vault loads.
- Reject a corrupt or incomplete archive before changing the active vault. Confirm a failed preparation or stale ownership check preserves current files and a subsequent restore can proceed. Reboot and process-death recovery remain separate physical checks.

## Maintainer record

| Field | Result |
| --- | --- |
| Revision | `feat/vault-handoff`, H01 through H08 milestone series |
| Desktop OS and version | Not yet recorded |
| Android device, OS, and WebView | Not yet recorded |
| Result | Pending external physical run |
| Exceptions | None recorded |

Do not change the status to passed from an emulator-only or source-only run.

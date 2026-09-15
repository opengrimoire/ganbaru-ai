# Local vault handoff acceptance

**Status: Physical acceptance pending.** On 2026-09-13, the focused automated round-trip, ownership, transport, Calendar projection, Doomscrolling reconciliation, Android notification, and Android enforcement checks passed on the development branch. The full `pnpm -w run validate:full` security and code gate also passed. A physical desktop and Android run is the only pending external check. Record the device details and result below when a maintainer completes it.

## Required setup

- One supported Linux or Windows desktop and one Android 10 or newer phone on the same private LAN.
- Development builds from the same revision, with a fresh Android installation available for the first pass.
- A desktop vault containing one identifiable Calendar event with an alarm and Pomodoro configuration, Project task and managed project file, Note and attachment, Chat channel, Quick note, custom theme, Doomscrolling limit and history, Music item and playlist, and profile or project asset. Keep one music file and one project folder outside the vault.

## Acceptance script

1. After choosing a desktop vault, confirm the folder action remains busy while the vault-bound QR invitation is prepared. Confirm the app then transitions directly to the dedicated linking screen with the QR code and live renewal countdown already visible on its first frame, without reloading, showing an intermediate loading screen, or flashing the background. Let the countdown reach zero and confirm the app replaces the code automatically without blocking progress. Immediately choose **Not now** and confirm the screen either opens the preloading app directly or shows only a centered loading spinner until the app is ready. Close and reopen the app, then confirm the linking screen returns because deferral did not complete onboarding. Repeat after leaving the linking screen open briefly to confirm the app loads in the background. After the Android permission review, confirm its dedicated linking screen shows the square camera preview, grant camera access, and scan once. Confirm the camera stops and both devices show the linked relationship without entering an address. Separately confirm Data settings can reopen linking later and presents the desktop QR code in a modal above Settings.
2. On Android, choose `Use on this device`. Confirm desktop becomes read-only before Android becomes writable, the previous Android vault backup appears in Downloads, and every prepared record, configuration value, managed file, and asset opens on Android. Confirm external music and project bytes were not copied and their missing local bindings are handled normally.
3. Restart both applications while Android owns the vault. With desktop closed or unreachable, edit the Android-owned vault, verify already scheduled Calendar alarms and Doomscrolling enforcement continue, then create inactive-device Doomscrolling usage on desktop while disconnected.
4. Reconnect on the LAN. Refresh the desktop read-only copy, then confirm Android and desktop show the reconciled combined Doomscrolling total exactly once. Change a desktop-owned Calendar alarm later, refresh Android, and confirm the native Android schedule changes only after that refresh.
5. On desktop, choose `Use on this device`. Confirm the Android edit arrives, desktop becomes writable, Android becomes read-only, and an application restart preserves both roles.
6. Verify active Chat work and an active Pomodoro session each block ownership movement with a clear message. Stop them and confirm retry succeeds. Start another transfer, interrupt connectivity before commit and after commit in separate passes, then verify retry preserves the last committed owner and neither device becomes a second writer.
7. Confirm unlink does not silently promote a read-only copy. Re-link, make the owner unavailable, choose the separately confirmed recovery action on the non-owner, and verify it becomes an explicitly separate writable copy while the other copy remains preserved.

## Maintainer record

| Field | Result |
| --- | --- |
| Revision | `feat/vault-handoff`, H01 through H08 milestone series |
| Desktop OS and version | Not yet recorded |
| Android device, OS, and WebView | Not yet recorded |
| Result | Pending external physical run |
| Exceptions | None recorded |

Do not change the status to passed from an emulator-only or source-only run.

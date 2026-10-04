# Doomscrolling runtime acceptance

Status: automated desktop accounting and close-boundary coverage exists. The real platform cases below remain pending. Source inspection and passing unit tests do not establish operating-system or WebView lifecycle behavior.

## Desktop

Use the real Tauri application with a disposable selected application and a separate protected application. Record the operating system, display server or compositor, configured rule, and result for each case.

- Suspend main WebView JavaScript while a selected application remains observable. Daily and weekly usage must continue through the native owner, and an exhausted limit must still attempt an authorized close. Restore the UI and confirm that its displayed totals catch up from the native projection.
- Disable or remove a rule while its application is open. An observation captured under the earlier configuration must not close the application or republish an obsolete exhaustion snapshot.
- Switch vaults and complete or abort a vault handoff while a usage interval is pending. Evidence must remain attributed to its original vault and device; no old observation may close an application under the new context.
- Suspend the operating system longer than the supported evidence gap, then resume. The suspended interval must not become inferred usage. Subsequent fresh observations must restart accounting normally.
- Check foreground counting on supported X11, Windows, and compositor adapters. Where Wayland does not expose foreground identity, verify selected-process open-app counting and the corresponding settings label. Unsupported observation must remain unavailable without invented usage.
- Reopen or replace a selected process during a close attempt. A captured Linux process-start identity must not authorize its replacement. Protected aliases must prevent closing the entire observed identity.
- Exit and restart while evidence is pending. Captured batches must survive in the device-local spool; stale browser and phase snapshots must not authorize enforcement after exit.
- Start with no selected vault or with a deleted development vault, then complete onboarding. Background observation must wait for a valid selection, resume after selection, and retain explicit errors for malformed manifests. Without usage samples, idle observation must not create the device spool. An existing spool must still drain pending samples after restart.
- Run a linked read-only device offline, reconnect it, and repeat an exchange after an uncertain response. Accepted plus pending totals must remain consistent without duplicate usage or lost evidence.

Pomodoro-dependent blocking consumes committed native Focus phase authority. With WebView execution suspended, verify phase entry, pause, resume, completion and expiry. Delay a phase publication while changing the run or vault; its old lease must not authorize enforcement. Independent limit execution does not establish this physical cross-feature behavior.

## Android

Follow the Guardian, permissions, screen-state, and background-service cases in [Android acceptance](android.md). The shared Rust publisher and frontend snapshot reader are integrated, but desktop runtime results do not establish Android lifecycle acceptance.

- Suspend WebView JavaScript while leaving the application process and Guardian available. Shared usage must refresh and exhausted limits must enforce without the UI scheduler.
- Record local usage between native capture and rule application. The shared total must include that later delta exactly once.
- Disable or replace a rule, switch vaults, and complete or abort handoff during publication. An old capture must not reinstall the earlier rule snapshot.
- Delay Guardian IPC while requesting configuration changes, vault selection, or app exit. Busy context changes must return a retry error, and shutdown must not wait for the publisher's lock. A failed selection invalidation must reactivate the unchanged context.
- Restart with retained localized copy, including preferences written before the dedicated copy field existed. Native publication must resume without requiring an open settings panel.
- Remove the native application process while Guardian remains available. Local counting and retained enforcement must continue; fresh remote totals are required only after the publisher returns.
- Run linked read-only accounting offline, reconnect, and interrupt acknowledgement after the accepted cache commits. Totals must remain consistent across deletion retries and process restart.
- Cross local midnight during an in-flight capture and change the device timezone. Old-window accepted totals must not authorize a new-window block.

The Android plugin JVM suites cover local-delta arithmetic, delayed publication, large counters, compaction conservation, repeated-hour day totals, and capacity rejection. Rust tests cover complete-window projection, captured baselines, midnight invalidation, malformed evidence, integer overflow, and atomic accepted-snapshot/Guardian-acknowledgement replacement, including rollback, restart, identity scoping, retry, and acknowledgement bounds. Frontend tests cover copy-only publication and the shared desktop/Android projection reader. Neither suite executes Android's actual SQLite implementation or ContentProvider process lifecycle. Verify fresh journal creation, rejection of unsupported development journal schemas, full-journal checkpoint rollback, old-vault retention, read-only block-history retention, localized-copy recovery, and interrupted cross-process acknowledgement on a real Android runtime. Unsupported development journal schemas require an explicit application-data reset; the plugin does not migrate or silently discard them.

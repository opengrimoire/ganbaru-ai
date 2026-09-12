# Android validation and release

Android is release-ready only when a signed, minified release artifact passes the required build, device, lifecycle, permission, policy, upgrade, and data-recovery gates. Source implementation or a debug install alone is not release readiness.

## Build baseline

The current project baseline is:

- Tauri `~2.11.1`.
- Minimum Android API level 29.
- Compile and target API level 36.
- Gradle wrapper 8.14.3.
- NDK 30.0.15729638.
- ARM64, ARMv7, x86, and x86_64 release support.

Manifests and build files remain authoritative. Update this summary when the supported baseline changes rather than preserving obsolete version history.

## Artifact strategy

Pull requests can use a bounded ARM64 build for feedback. Release validation builds the supported universal APK and AAB outputs, confirms native-library packaging, and installs the actual release configuration.

Generated Android project changes are reviewed as source. Regeneration is deliberate and followed by a diff so native permissions, providers, services, signing, backup rules, and manifest changes cannot disappear unnoticed.

## Signing

Release signing uses protected credentials outside the repository. Debug keys never sign production artifacts. The release workflow confirms package identity, signing certificate continuity, minification, and installation or upgrade from the distribution artifact.

No workflow logs, Gradle properties committed to source, or vault files contain release secrets.

## Native library compatibility

Release artifacts validate required ABI coverage and 16 KiB page-size compatibility. A successful Rust target compile is insufficient if packaged native libraries fail device loading or alignment requirements.

## Release gates

The release candidate must pass:

- Clean install and supported upgrade paths.
- First use, app-private vault creation, folder import, backup, restore, and reinstall recovery.
- Offline launch and behavior for the promised local feature set.
- Process death, Activity recreation, reboot, package replacement, clock, and timezone recovery.
- Notification, alarm, foreground-service, Music, and Doomscrolling special-access grant, denial, revocation, and recovery.
- Compact, wide, portrait, landscape, keyboard, cutout, gesture navigation, and system Back behavior.
- Minified WebView bridge and capability operation.
- No desktop-only providers, binaries, capabilities, or assets in the Android artifact.
- Store-policy review for Accessibility and other declared special access.
- Privacy, backup, data-safety, open-source license, and distribution disclosures that match actual behavior.

## Current validation state

The source foundation, mobile composition, Android Rust target, shared command surface, app-private vault, core shell, native Pomodoro, Media3, Calendar notifications, backup/restore, and selected-app adapters exist.

Reference-device checks cover important Android 10 shell, lifecycle, layout, navigation, and core feature flows. Predictive Back, broader OEM background management, complete special-access revocation, all supported ABIs, signed minified artifacts, and the complete release matrix remain required before delivery.

## CI

CI checks the mobile command surface and bounded Android build without increasing repository-wide resource pressure. Release CI additionally validates signing inputs, manifest merging, minification, AAB structure, native libraries, and artifact provenance.

The detailed target and scenario matrix lives in [Android testing](../../testing/android.md).

## Distribution and updates

The distribution source owns installation and update delivery. Android does not package the desktop self-updater. In-app update information can open signed release history or the appropriate distribution surface.

Direct GitHub installations check the latest published release through the GitHub API. When a newer release contains the expected versioned universal APK, the update surface opens that exact repository-owned asset for download. Android performs installation with the system package installer and accepts an upgrade only when its package identifier and signing certificate match the installed production application. The release page remains the fallback when the expected APK is absent or the release response is unusable.

Release promotion follows the repository's documented operation and signing controls. This platform spec does not duplicate branch or publication procedures.

# Release process

Ganbaru AI releases are published through GitHub Releases. The release workflow builds Linux x64 packages and Windows x64 installers, uploads them to a draft release, and lets Tauri Action generate the `latest.json` file used by the updater.

## Release targets

- Linux x64: `.deb`, `.rpm`, and `.AppImage` bundles from the Tauri Linux build.
- Windows x64: Tauri Windows installers for Windows 10 and Windows 11 users.
- macOS is intentionally not part of the first release workflow.

The workflow runs on Ubuntu 22.04 for Linux artifacts to keep glibc compatibility broader than newer Ubuntu runners. Windows artifacts are built on GitHub's hosted Windows runner, but the installers target normal Windows desktop installs, not the runner OS specifically.

## Signing setup

Tauri updater artifacts must be signed. The signature check cannot be disabled, so a release build needs an updater key pair before the first public release.

Generate the key pair locally:

```sh
pnpm -C apps/client tauri signer generate -w ~/.tauri/ganbaru-ai.key
```

Store these GitHub Actions values before running the release workflow:

- Repository variable `TAURI_UPDATER_PUBLIC_KEY`: the public key from the signer output.
- Repository secret `TAURI_SIGNING_PRIVATE_KEY`: the private key file content.
- Repository secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password, if one was set.

Keep a backup of the private key in a password manager or another durable secret store. Losing it means existing users cannot receive future updates through the updater and must install a new release manually. Changing the public key is a key rotation and has the same user impact.

This signing is for Tauri updater verification only. It is not Windows Authenticode signing, so Windows may still warn that the installer is from an unknown publisher until a separate code-signing certificate is added.

## Publishing

1. Update the app version in `apps/client/package.json`, `apps/client/src-tauri/Cargo.toml`, and `apps/client/src-tauri/tauri.conf.json`.
2. Run `pnpm -w run validate:full`.
3. Create a tag like `app-v0.1.0` on the release commit.
4. Push the tag to GitHub.
5. Wait for the `release` workflow to finish.
6. Download and smoke test the draft release assets.
7. Publish the draft GitHub Release.

The workflow also supports manual dispatch. On manual dispatch, Tauri Action creates or updates `app-v__VERSION__` for the current app version at the selected commit. Prefer a pushed tag when publishing a public release because it is easier to audit.

## Update checks

Release builds inject a generated `src-tauri/tauri.release.conf.json` at CI time. The file enables updater artifacts, embeds the public updater key, and points the app at:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

The generated file is ignored by git and must not be committed.

The app does not check for updates in the background. Users can check manually in Settings, Updates. That button contacts the configured GitHub Releases feed, verifies the signed artifact, downloads it, installs it, and restarts the app.

# Release process

Ganbaru AI releases are published through GitHub Releases. The release workflow builds Linux x64 packages and Windows x64 installers, signs updater assets in a protected job, writes the `latest.json` updater feed, and uploads everything to a draft release for inspection before publishing.

The workflow is intentionally conservative:

- GitHub Actions permissions default to read-only.
- Only the publish job gets `contents: write`.
- The Tauri updater private key is used only in the signing job.
- The signing and publishing jobs use the protected `release` GitHub Environment.
- Dependency caches are disabled in release jobs.
- Third-party release upload actions are not used.
- GitHub Actions are pinned to full commit SHAs.
- Runner labels are fixed to `ubuntu-22.04` and `windows-2022`, not `latest` aliases.

## Release targets

- Linux x64: `.deb`, `.rpm`, and `.AppImage` bundles from the Tauri Linux build.
- Windows x64: Tauri Windows installers for Windows 10 and Windows 11 users.
- macOS is intentionally not part of the first release workflow.

The workflow runs on Ubuntu 22.04 for Linux artifacts to keep glibc compatibility broader than newer Ubuntu runners. Windows artifacts are built on GitHub's hosted Windows runner, but the installers target normal Windows desktop installs, not the runner OS specifically.

## GitHub setup

Create a GitHub Environment named `release` before running the workflow. Configure required reviewers for that environment. Store signing secrets in this environment, not as broad repository secrets:

- Environment secret `TAURI_SIGNING_PRIVATE_KEY`: the private key file content.
- Environment secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password, if one was set.

Store this repository variable:

- Repository variable `TAURI_UPDATER_PUBLIC_KEY`: the public key from the signer output.

Also configure repository protections:

- Protect `app-v*` tags so only trusted maintainers can create or update release tags.
- Require review for changes to `.github/workflows/release.yml` and release scripts.
- In GitHub Actions settings, allow only selected actions and prefer SHA-pinned actions where the repository settings support that policy.

## Signing setup

Tauri updater artifacts must be signed. The signature check cannot be disabled, so a release build needs an updater key pair before the first public release.

Generate the key pair locally:

```sh
pnpm -C apps/client tauri signer generate -w ~/.tauri/ganbaru-ai.key
```

Keep a backup of the private key in a password manager or another durable secret store. Losing it means existing users cannot receive future updates through the updater and must install a new release manually. Changing the public key is a key rotation and has the same user impact.

This signing is for Tauri updater verification only. It is not Windows Authenticode signing, so Windows may still warn that the installer is from an unknown publisher until a separate code-signing certificate is added.

## Publishing

1. Update the app version in `apps/client/package.json`, `apps/client/src-tauri/Cargo.toml`, and `apps/client/src-tauri/tauri.conf.json`.
2. Run `pnpm -w run validate:full`.
3. Create a tag like `app-v0.1.0` on the release commit.
4. Push the tag to GitHub.
5. Approve the `release` environment when GitHub asks.
6. Wait for the `release` workflow to finish.
7. Download and smoke test the draft release assets.
8. Inspect `latest.json` and `SHA256SUMS`.
9. Publish the draft GitHub Release.

The workflow also supports manual dispatch from the default branch. On manual dispatch, the workflow creates or updates `app-v<version>` for the current app version at the selected commit. Prefer a pushed tag when publishing a public release because it is easier to audit.

## Update checks

Release builds inject a generated `src-tauri/tauri.release.conf.json` at CI time. The file embeds the public updater key and points the app at:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

The generated file is ignored by git and must not be committed.

The build job creates unsigned installers with the public updater configuration embedded. The signing job signs only updater assets (`.AppImage`, `.exe`, and `.msi`) with the Tauri signer. The publish job writes `latest.json` from those signatures and points each platform to the tag-specific release asset URL.

The app does not check for updates in the background. Users can check manually in Settings, Updates. That button contacts the configured GitHub Releases feed, verifies the signed artifact, downloads it, installs it, and restarts the app.

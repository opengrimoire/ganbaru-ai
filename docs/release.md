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

- Protect `main` so only organization admins can merge release pull requests from `dev`. Require pull requests, required checks, conversation resolution, signed commits if enabled for the organization, and no force-push or deletion.
- Protect `dev` so normal changes reach it only through pull requests from topic branches. Require pull requests, required checks, conversation resolution, and no direct pushes, force-pushes, or deletion.
- Protect `app-v*` tags so only organization admins can create, update, or delete release tags.
- Require review for changes to `.github/workflows/release.yml` and release scripts.
- In GitHub Actions settings, allow only selected actions and prefer SHA-pinned actions where the repository settings support that policy.

The exact intended rulesets, including disabled fields and rationale, live in `docs/rulesets.md`.

## Signing setup

Tauri updater artifacts must be signed. The signature check cannot be disabled, so a release build needs an updater key pair before the first public release.

Generate the key pair locally:

```sh
pnpm -C apps/client tauri signer generate -w ~/.tauri/ganbaru-ai.key
```

Keep a backup of the private key in a password manager or another durable secret store. Losing it means existing users cannot receive future updates through the updater and must install a new release manually. Changing the public key is a key rotation and has the same user impact.

This signing is for Tauri updater verification only. It is not Windows Authenticode signing, so Windows may still warn that the installer is from an unknown publisher until a separate code-signing certificate is added.

## Branch flow

Ganbaru AI uses `dev` as the integration branch and `main` as the release source branch.

- Normal work starts from `dev` on a short-lived topic branch.
- Topic branches open pull requests into `dev`.
- Release preparation changes, such as version bumps and release documentation updates, go through normal pull requests into `dev`.
- Release promotion opens one pull request from `dev` into `main`.
- A merge to `main` does not publish by itself. The release workflow is intentionally tag-based so signed desktop assets can be inspected before publishing.

This keeps frequent development PRs visible for review and generated release notes while preserving an explicit release gate for installers, updater metadata, checksums, and signing.

Only organization admins may merge release PRs into `main`, create or update `app-v*` tags, approve the protected release environment, or publish GitHub Releases. Today that means the organization owner unless release authority is explicitly delegated.

Pull requests that target `main` and do not come from `dev` should be retargeted to `dev` or closed unless a maintainer deliberately chooses a separate stabilization branch for that release. Do not add a `pull_request_target` workflow for branch routing unless a separate security review explicitly accepts the added privileged automation surface.

This policy exists because CI and release infrastructure are part of the supply chain. The May 2026 TanStack npm compromise chained a `pull_request_target` trust-boundary issue, GitHub Actions cache poisoning, and token access into malicious package releases. Ganbaru AI keeps release authority, signing jobs, release tags, and updater metadata behind explicit maintainer controls for the same class of risk. See TanStack's postmortem: <https://tanstack.com/blog/npm-supply-chain-compromise-postmortem>.

## Release notes

Draft releases use GitHub's generated release notes to compile merged pull requests since the previous release. The workflow prepends `docs/release-notes-template.md`, then appends generated notes using `.github/release.yml` for categories and exclusions.

Use concise PR titles because they become release-note entries. Labels control categorization. Add `skip-changelog` or `ignore-for-release` when a PR should not appear in release notes.

## Publishing

1. Update the app version in `apps/client/package.json`, `apps/client/src-tauri/Cargo.toml`, and `apps/client/src-tauri/tauri.conf.json` through a normal pull request into `dev`.
2. Run `pnpm -w run validate:full`.
3. Open a release pull request from `dev` into `main`.
4. Merge the release PR after review and green checks.
5. Create a tag like `app-v0.1.0` on the release commit.
6. Push the tag to GitHub.
7. Approve the `release` environment when GitHub asks.
8. Wait for the `release` workflow to finish.
9. Download and smoke test the draft release assets.
10. Inspect generated release notes, `latest.json`, and `SHA256SUMS`.
11. Publish the draft GitHub Release.

The workflow also supports manual dispatch from the default branch. On manual dispatch, the workflow creates or updates `app-v<version>` for the current app version at the selected commit. Prefer a pushed tag when publishing a public release because it is easier to audit.

## Update checks

Release builds inject a generated `src-tauri/tauri.release.conf.json` at CI time. The file embeds the public updater key and points the app at:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

The generated file is ignored by git and must not be committed.

The build job creates unsigned installers with the public updater configuration embedded. The signing job signs only updater assets (`.AppImage`, `.exe`, and `.msi`) with the Tauri signer. The publish job writes `latest.json` from those signatures and points each platform to the tag-specific release asset URL.

Release builds check the configured GitHub Releases feed at most once per day by default to notify users when a new version is available. Users can turn this off in Settings, Updates. The automatic check never downloads or installs anything.

When an update is available, the main window shows a small prompt with Install update, Later, and Release notes actions. Install update downloads the signed artifact, verifies it through Tauri's updater, installs it, and restarts the app. Release notes opens the matching GitHub Release page in the default browser, using a Tauri opener permission scoped to `https://github.com/opengrimoire/ganbaru-ai/releases/tag/app-v*`. Users can also run the same check manually from Settings, Updates.

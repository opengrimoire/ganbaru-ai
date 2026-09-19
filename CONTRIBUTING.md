# Contributing

Ganbaru AI uses pull requests for review, CI history, and release notes. Keep changes focused and use the smallest branch that describes the work.

Participation in issues, pull requests, and other project spaces is governed by `.github/CODE_OF_CONDUCT.md`.

Branch and release restrictions are supply-chain controls, not a judgment about individual contributors. Signed desktop artifacts, updater metadata, release tags, workflow files, and CI state are privileged paths. The May 2026 TanStack npm compromise showed how a CI trust-boundary issue, including GitHub Actions cache poisoning through `pull_request_target`, can become a package release compromise. This repository keeps normal contribution review, integration, and release authority separate for that reason. See TanStack's postmortem: <https://tanstack.com/blog/npm-supply-chain-compromise-postmortem>.

## Rust toolchain

Install Rust through rustup. Repository commands use the exact compiler and the Clippy and rustfmt components in `rust-toolchain.toml`; CI and release jobs use that same file instead of following the floating stable channel.

Rust 1.98 is the supported minimum compiler version, with 1.98.0 pinned for reproducible validation. This is the tested project baseline, not a claim that earlier compilers cannot compile individual crates. All workspace packages inherit Rust edition 2024, the compiler requirement, authors, and license from `[workspace.package]`. Package versions stay local because the app, internal libraries, and mobile plugins have different version histories.

Cargo resolver 3 prefers dependencies compatible with the declared compiler requirement when resolving versions. Keep `Cargo.lock` committed and use locked builds in CI; the resolver is not a replacement for dependency review or security audits.

Toolchain upgrades are deliberate maintenance changes. Update the pin and supported compiler requirement together, run `pnpm -w run validate:full`, and verify Linux, Windows, and Android builds. Review platform-specific code as well as host compatibility diagnostics when changing editions. Rustfmt retains the 2021 style edition in `rustfmt.toml` so the language migration does not introduce unrelated repository-wide formatting changes.

## Branch flow

- `main` is the release source branch. It should move through release pull requests from `dev` by merge queue.
- `dev` is the integration branch for accepted work between releases.
- Normal work happens on short-lived topic branches created from `dev`.
- Topic branches open pull requests into `dev`.
- Topic pull requests merge into `dev` with merge commits so their signed commits, authorship, timestamps, and Git topology remain part of the repository history.
- Release preparation changes, such as version bumps, happen through normal pull requests into `dev` before `dev` is promoted to `main`.
- Releases are created from `app-v*` tags on the release commit, not from every merge to `main`.

Do not push directly to `main` or `dev`. Changes enter through pull requests. Any emergency exception would first require a deliberate, reviewed ruleset change because neither protected branch has a bypass actor.

Only organization admins may merge release pull requests into `main`, create or update `app-v*` tags, approve the protected release environment, or publish GitHub Releases. Today that means the organization owner unless release authority is explicitly delegated. The exact intended GitHub rulesets are documented in [repository policy](docs/operations/repository-policy.md).

## Pull requests

Use concise PR titles that would read well in release notes. Conventional prefixes are preferred, for example:

- `feat(vault): add setup language selector`
- `fix(calendar): preserve imported attendee status`
- `docs(release): clarify branch flow`

Before opening a PR:

1. Make sure the branch is based on current `dev`.
2. Keep unrelated edits out of the branch.
3. Update relevant specs when the change affects product behavior, data, architecture, commands, configuration, or user-visible workflow.
4. Run the relevant local gate from `AGENTS.md`. For normal code and UI changes, use `pnpm -w run validate`.
5. Include a short PR summary and note any checks that were not run.

When a PR should not appear in generated release notes, add the `skip-changelog` or `ignore-for-release` label.

## Release pull requests

Release PRs merge `dev` into `main` after accepted work and release preparation are ready. Use a direct `dev` to `main` pull request so the release source matches the integration branch. Do not update `dev` with `main` only to satisfy the release PR; `main` uses merge queue to validate the merge result without adding release merge commits to `dev`.

Before opening a release PR:

1. Verify `dev` is green.
2. If needed, update the app version in `apps/client/package.json`, `apps/client/src-tauri/Cargo.toml`, and `apps/client/src-tauri/tauri.conf.json` through a normal pull request into `dev`.
3. Run `pnpm -w run validate:full`.
4. Open a pull request from `dev` into `main`.
5. Summarize the user-facing changes since the previous release.
6. After review and green pull request checks, add the PR to the `main` merge queue.

After the merge queue lands the release PR in `main`, create and push the matching `app-v*` tag from the release commit. The release workflow builds signed assets and creates or updates a draft GitHub Release with generated notes. Inspect the draft release before publishing. Publishing the GitHub Release updates the apt, RPM, and AUR package paths.

Pull requests that target `main` and do not come from `dev` should be retargeted to `dev` or closed.

See the [release guide](docs/operations/release/README.md) for the full release process.

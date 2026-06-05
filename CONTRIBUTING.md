# Contributing

Ganbaru AI uses pull requests for review, CI history, and release notes. Keep changes focused and use the smallest branch that describes the work.

Participation in issues, pull requests, and other project spaces is governed by `.github/CODE_OF_CONDUCT.md`.

Branch and release restrictions are supply-chain controls, not a judgment about individual contributors. Signed desktop artifacts, updater metadata, release tags, workflow files, and CI state are privileged paths. The May 2026 TanStack npm compromise showed how a CI trust-boundary issue, including GitHub Actions cache poisoning through `pull_request_target`, can become a package release compromise. This repository keeps normal contribution review, integration, and release authority separate for that reason. See TanStack's postmortem: <https://tanstack.com/blog/npm-supply-chain-compromise-postmortem>.

## Branch flow

- `main` is the release source branch. It should move through release pull requests from release branches based on `dev`.
- `dev` is the integration branch for accepted work between releases.
- Normal work happens on short-lived topic branches created from `dev`.
- Topic branches open pull requests into `dev`.
- Release preparation uses a release branch based on `dev` and opens one pull request into `main`.
- Releases are created from `app-v*` tags on the release commit, not from every merge to `main`.

Do not push directly to `main` or `dev` for normal feature, fix, or docs work. All normal changes must enter through pull requests. Use direct pushes only for exceptional repository maintenance where a project maintainer explicitly approves it.

Only organization admins may merge release pull requests into `main`, create or update `app-v*` tags, approve the protected release environment, or publish GitHub Releases. Today that means the organization owner unless release authority is explicitly delegated. The exact intended GitHub rulesets are documented in `docs/rulesets.md`.

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

Release PRs merge a release branch based on `dev` into `main` and should include only release preparation changes, such as version bumps and release documentation updates.

Before opening a release PR:

1. Verify `dev` is green.
2. Update the app version in `apps/client/package.json`, `apps/client/src-tauri/Cargo.toml`, and `apps/client/src-tauri/tauri.conf.json`.
3. Run `pnpm -w run validate:full`.
4. Summarize the user-facing changes since the previous release.

After the release PR merges to `main`, create and push the matching `app-v*` tag from the release commit. The release workflow builds signed assets and creates or updates a draft GitHub Release with generated notes. Inspect the draft release before publishing.

Pull requests that target `main` directly and do not come from same-repository `release/*` branches should be retargeted to `dev` or closed. GitHub branch and tag rulesets are the enforcement mechanism.

See `docs/release.md` for the full release process.

# Repository rulesets

This document records the intended GitHub rulesets for `opengrimoire/ganbaru-ai`, including the decision for each available rule and the reasoning behind it. Rulesets for public repositories are visible to people who can read the repository, so these settings are not treated as secrets. The public view is:

```text
https://github.com/opengrimoire/ganbaru-ai/rules
```

If the live GitHub settings differ from this file, treat that as configuration drift. Either update the GitHub rulesets to match this document or update this document in the same pull request that changes the policy.

Rulesets are the enforcement layer for branch and tag movement. GitHub Actions workflows must not be used to enforce branch routing, especially through `pull_request_target`, unless a separate security review explicitly accepts the added privileged automation surface.

This document defines these three rulesets:

- `protect main`
- `protect dev`
- `protect release tags`

## Table of contents

- [Roles](#roles)
- [protect main](#protect-main)
- [protect dev](#protect-dev)
- [protect release tags](#protect-release-tags)
- [Required adjacent settings](#required-adjacent-settings)
- [Review cadence](#review-cadence)

## Roles

`Organization admin` is the current GitHub bypass actor for release tags and the protected release environment. It maps to the organization owner today. Do not use `Write`, `Maintain`, `Repository Admin`, or `Deploy keys` for release bypass unless this policy is deliberately changed.

`Project maintainer` means a trusted maintainer with write or maintain access for normal repository work. Today this is expected to be the same person as the organization admin unless access is deliberately delegated.

Do not grant write, maintain, or admin access casually. If more maintainers are added, revisit this file before granting access because GitHub can allow anyone with write access to merge a pull request once the target branch requirements are satisfied.

## protect main

Purpose: keep `main` as the audited release source branch. It should move through release pull requests from `dev`, and a merge to `main` must not publish by itself.

Ruleset basics:

- Ruleset type: branch.
- Enforcement: active.
- Bypass list: empty.
- Target branches: include `main`.

Branch rules:

- [ ] Restrict creations.
- [ ] Restrict updates.
- [x] Restrict deletions.
- [ ] Require linear history.
- [ ] Require merge queue.
- [ ] Require deployments to succeed.
- [x] Require signed commits.
- [x] Require a pull request before merging.
  - Required approvals: 0 while the repository has a single maintainer. Raise this before granting write access to more maintainers.
  - [ ] Dismiss stale pull request approvals when new commits are pushed.
  - [ ] Require review from specific teams.
  - [ ] Require review from Code Owners.
  - [ ] Require approval of the most recent reviewable push.
  - [x] Require conversation resolution before merging.
  - Allowed merge methods: merge only.
- [x] Require status checks to pass.
  - [x] Require branches to be up to date before merging.
  - [x] Do not require status checks on creation.
  - Required status checks: `linux validation` and `windows Rust check`.
  - Required status check source: GitHub Actions.
- [x] Block force pushes.
- [ ] Require code scanning results.
- [ ] Require code quality results.
- [ ] Automatically request Copilot code review.

Restrictions:

- [ ] Restrict commit metadata.
- [ ] Restrict branch names.

Rationale:

- `main` is a release staging boundary, not the daily integration branch.
- Release publication happens only from `app-v*` tags and a protected release environment.
- Merge commits on `main` are intentional because release pull requests are promotion events from `dev` to `main`.
- `Require linear history` is off because release pull requests should preserve useful pull request history for generated release notes.
- `Require merge queue` is off because release pull requests are low volume and the current required checks do not run on `merge_group`.
- `Require deployments to succeed` is off because the protected `release` environment belongs to the tag-based release workflow after `main` is updated, not to the branch merge gate.
- `Require signed commits` is enabled on `main` after SSH commit signing was configured locally and a test commit verified successfully on GitHub.
- Review requirements that need another reviewer stay off while the repository has one maintainer. Raise required approvals, stale approval dismissal, Code Owners, and most-recent-push approval before granting write access to more maintainers.
- The strongest practical control while the project has one maintainer is limited write access. If more write maintainers are added, the `main` policy must be revisited before access is granted.
- Code scanning and code quality gates should stay off until they are configured, stable, and documented.
- `Restrict branch names` is off because the ruleset target already narrows the branch namespace to `main`.

## protect dev

Purpose: keep `dev` as the normal integration branch where accepted work accumulates before a release.

Ruleset basics:

- Ruleset type: branch.
- Enforcement: active.
- Bypass list: empty.
- Target branches: include `dev`.

Branch rules:

- [ ] Restrict creations.
- [ ] Restrict updates.
- [x] Restrict deletions.
- [x] Require linear history.
- [ ] Require merge queue.
- [ ] Require deployments to succeed.
- [ ] Require signed commits.
- [x] Require a pull request before merging.
  - Required approvals: 0 while the repository has a single maintainer.
  - [ ] Dismiss stale pull request approvals when new commits are pushed.
  - [ ] Require review from specific teams.
  - [ ] Require review from Code Owners.
  - [ ] Require approval of the most recent reviewable push.
  - [x] Require conversation resolution before merging.
  - Allowed merge methods: squash only.
- [x] Require status checks to pass.
  - [x] Require branches to be up to date before merging.
  - [x] Do not require status checks on creation.
  - Required status checks: `linux validation` and `windows Rust check`.
  - Required status check source: GitHub Actions.
- [x] Block force pushes.
- [ ] Require code scanning results.
- [ ] Require code quality results.
- [ ] Automatically request Copilot code review.

Restrictions:

- [ ] Restrict commit metadata.
- [ ] Restrict branch names.

Rationale:

- All normal work should be visible in pull requests.
- Squash merges keep `dev` readable while preserving the original PR as review history.
- `dev` should not require release-specific controls such as signed release commits or deployment gates.
- `Require merge queue` is off because traffic is currently low and required checks do not run on `merge_group`.
- Review requirements that need another reviewer stay off while the repository has one maintainer. Raise them before granting write access to more maintainers.
- Code scanning and code quality gates should stay off until they are configured, stable, and documented.
- PR title conventions carry release note quality better than a branch-level commit metadata regex.
- `Restrict branch names` is off because the ruleset target already narrows the branch namespace to `dev`.

## protect release tags

Purpose: prevent untrusted users from creating, moving, or deleting release tags that trigger signed desktop release builds.

Ruleset basics:

- Ruleset type: tag.
- Enforcement: active.
- Bypass list: `Organization admin`, with `Always allow`.
- Target tags: include `app-v*`.

Tag rules:

- [x] Restrict creations.
- [x] Restrict updates.
- [x] Restrict deletions.
- [ ] Require linear history.
- [ ] Require deployments to succeed.
- [ ] Require signed commits.
- [ ] Require status checks to pass.
- [x] Block force pushes.

Restrictions:

- [ ] Restrict commit metadata.
- [ ] Restrict tag names.

Rationale:

- `app-v*` tags are the release trigger. Protecting only force pushes is not enough because an attacker with write access could still create a new matching tag.
- Release tags and the protected `release` environment are separate controls. Both should exist.
- Tags point at commits and do not need linear history.
- The release workflow runs after the tag is created and contains its own build, signing, draft publishing, and protected environment gates.
- Signed-commit enforcement should be enabled for tags only after it is operational for `main`.
- `Restrict tag names` is off because the ruleset target already narrows the tag namespace to `app-v*`.

## Required adjacent settings

Repository access:

- Keep write, maintain, and admin access limited.
- External contributors should use forks or topic branches and pull requests.
- Revisit this document before adding any new write or maintain user.

GitHub Actions:

- Set default workflow token permissions to read-only.
- Do not allow GitHub Actions to create or approve pull requests unless a specific reviewed workflow requires it.
- Prefer selected actions and full SHA pins for third-party actions.
- Keep release jobs cache-free.

Protected environment:

- Environment name: `release`.
- Required reviewers: the organization owner, or a dedicated release team if release authority is delegated later.
- Environment secrets: Tauri updater signing private key and password only.
- Do not expose signing secrets to build or test jobs.

Workflow policy:

- Do not add a `pull_request_target` workflow for branch routing or contributor messaging.
- If `pull_request_target` is ever needed, it must not checkout pull request code, install dependencies, restore or save caches, run build scripts, or read untrusted files.

## Review cadence

Review this document before adding maintainers, after any GitHub ruleset feature change that affects these options, and after any supply-chain incident that changes the threat model.

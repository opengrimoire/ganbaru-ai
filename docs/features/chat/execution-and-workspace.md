# Chat execution and workspace

## Execution targets

Every organizational run has exactly one execution target:

- An authorized project working folder.
- A private scratch generation owned by the initiating reply thread.
- No target for conversation-only work.

External folder bindings are device-local and must resolve through the active project's authorization. Provider-native working-directory state does not authorize a folder.

## Runs and provider threads

A run links one organizational request to one provider session and its canonical events. A conversation can contain several runs, and a run can hand off to a new provider session when continuation is unavailable or inappropriate. Hidden session handoffs preserve the human conversation without pretending different providers share native thread state.

Cancellation targets the active run and its owned process tree. It does not delete prior events or silently cancel unrelated parallel work.

## Interactive requests and approvals

Questions, permission requests, plan confirmations, and provider-native choices appear as validated interactive requests in the timeline. Each request has a stable identity and one terminal resolution.

The UI states the requested operation and effective authority. Responding to a provider request does not bypass Ganbaru AI's own access checks. Stale or duplicate responses are rejected safely.

## Files and editor

The Files surface exposes a bounded view of the authorized execution target. Reads, searches, edits, and saves validate normalized relative paths and reject escapes, unsupported files, oversized content, and stale revisions.

The editor preserves revision safety. Saving against a changed file requires reconciliation rather than silently overwriting newer content. Syntax highlighting and previews are presentation features and do not expand the supported write boundary.

## Review and source control

Review presents file changes, diffs, checkpoints, and source-control status without making Git the organizational source of truth. A run can create checkpoints before and after risky work. Restore remains an explicit authorized action and reports uncommitted or conflicting state before mutation.

Generated diffs and repository status are derived views. The filesystem and Git repository remain canonical for workspace content; the vault stores the run, checkpoint metadata, and review links.

When a checkpoint pair is unavailable, review can fall back to the provider-reported turn and then to the working tree. Native `not_found` errors identify these cases with `details.reason` values `checkpoint_pair` or `provider_turn`. Permission, storage, and unrelated missing-resource errors remain errors; diagnostic wording never selects another review source.

## Terminal

Terminals are bound to one authorized execution target and thread context. The frontend receives a narrow terminal stream and input boundary, not a generic process API. Closing a visible terminal does not necessarily terminate its process; lifecycle and explicit stop controls remain truthful.

Terminal output is bounded and treated as untrusted text. Escape sequences cannot become application commands or links without validation.

## Browser preview

Browser previews use isolated app-owned webviews and narrowly scoped capture controls. A preview cannot browse local files, inherit unrestricted app capabilities, or become general desktop capture. Screenshots and recordings become managed artifacts only after an authorized capture action.

## Workspace observation

Filesystem observation keeps Files, Review, and source-control projections fresh. Events are debounced, bounded, and reconciled with authoritative reads. Observation does not replace revision checks or assume every filesystem event is reliable.

## Internal host tools

Native runs may receive an ephemeral loopback MCP endpoint for narrowly scoped application-owned tools. The endpoint exists only for the authorized run, exposes typed operations, and does not become a permanent external service, participant, or teammate.

See [AI provider runtimes](../ai/provider-runtimes.md) and [data access control](../../data/access-control.md).

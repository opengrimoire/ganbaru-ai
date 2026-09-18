# Chat access control

This document is the normative authorization specification for organizational Chat. It defines who may read channel history, which resources a run may use, how authority is reduced, and what happens after restricted context has already been materialized. Product presentation belongs in the Chat feature documents. Security boundaries are indexed in [Security](security/README.md).

Current implementation covers project-owned channels, including the built-in project general channel, memberships, provider continuations, working-folder and scratch execution, access profiles, runtime approvals, internal host tools, and revocation-aware application services. Broader organization surfaces such as cross-project groups and direct messages remain future work unless their feature specification says otherwise.

## Principles

1. Identity is not authority. Creating an AI teammate does not create membership, history access, a folder grant, scratch scope, or ambient context.
2. The local owner is the only required seeded participant. There is no privileged default AI teammate.
3. Provider, model, role, instructions, and runtime defaults are replaceable configuration on an ordinary teammate identity.
4. Channel presence, readable history, and executable resources are separate decisions.
5. Access profiles are reusable ceilings and defaults. They are not principals and cannot grant authority without membership and an exact resource grant.
6. Authority is closed world. Missing, stale, fabricated, revoked, or unsupported authority is denied.
7. A mention, message link, task link, or provider reference identifies context. It never transfers authority.
8. Denial and revocation override convenience defaults, provider-native trust, cached context, and previous approval.

## Principals and scopes

The portable vault owns stable identities for the local owner and configured AI teammates. A teammate may have one or more provider configurations over time, but provider identities are not application principals.

Channel membership is the entry point for organizational participation. It answers whether a participant may appear in, read, or contribute to one channel. It does not imply access to another channel in the same project.

Resource grants answer a separate question: what may the participant or assigned run do with a working folder, scratch generation, terminal, Git repository, attachment set, preview, or internal application tool?

Every authorization decision is scoped to the active vault. Portable IDs copied from another vault do not authorize anything.

## Effective authority

Effective authority is the intersection of all applicable restrictions:

- active vault and device identity;
- active, non-revoked participant identity;
- current channel membership;
- channel capability and history boundary;
- selected access-profile revision;
- exact resource grant;
- resolved execution target;
- runtime approval and provider capability;
- application-wide security ceilings;
- current filesystem identity for external folders;
- explicit denial, expiry, or revocation state.

No layer may widen an earlier layer. A provider that supports unrestricted filesystem access still receives only the folder granted by the application. A profile that permits writes does not create a write grant. A folder grant does not expose channel history.

Authorization is checked when work is assigned and again at every privileged boundary. A long-lived continuation cannot rely on a decision made before a membership, profile, binding, or approval changed.

## Channel capabilities and history

A membership stores explicit channel capabilities. At minimum, the model distinguishes reading allowed history, contributing messages, receiving assignments, and performing channel-scoped coordination actions. Unsupported capabilities fail closed.

History access has a lower bound. Adding a teammate today does not automatically disclose all earlier messages. A membership may begin at a specific sequence or later explicit grant. The lower bound is enforced in reads, context construction, search, references, summaries, exports, and internal tools.

Channel archive state prevents new ordinary activity but does not erase authorized history. Archiving is not a substitute for revocation. Deletion and retention policy must preserve audit and legal expectations defined by the product before removing canonical conversation data.

Personal channel sections and last-selected-channel state are presentation preferences. They do not create portable membership or change organizational visibility.

## Access profiles and revisions

An access profile describes a reusable maximum capability set and default approval posture. Profiles may cover read, write, terminal, Git, browser-preview, attachment, or application-tool actions. The exact capability vocabulary is validated by Rust and evolves through explicit schema changes.

Every assignment records the profile revision used for its authorization decision. Editing a profile creates a new effective revision; it must not rewrite the historical meaning of an earlier run. A stricter revision may revoke or interrupt current work. A more permissive revision does not silently upgrade an already authorized continuation.

A profile is never enough by itself. Effective access still requires membership, an exact resource grant, a compatible execution target, and any required runtime approval.

## Working-folder authority

Managed project folders resolve from the active vault and a validated relative path. External folders resolve through device-local bindings scoped by vault ID, device ID, and working-folder ID.

Before privileged use, Rust reopens or canonicalizes the target and checks its opaque filesystem identity. Symlinks, traversal, stale bindings, replaced directories, the active vault itself, and paths inside the active vault are rejected for external bindings. Git operations additionally validate the Git common-directory identity. A Git mismatch revokes Git authority without necessarily revoking ordinary access to a still-matching folder.

Folder capabilities are independent. Read does not imply write. Write does not imply terminal or Git mutation. Terminal approval does not grant arbitrary secondary folders. Every file path is relative to the authorized root and is validated again at the operation boundary.

## Runtime approvals

Actions with materially different impact require distinct approval categories. Reading a bounded text file, writing a file, starting a terminal, mutating Git, launching an external application, opening a URL, and using a sensitive application-owned tool are not interchangeable.

Approval may come from a recorded access-profile default or a user decision for the exact run and action class. The approval record is an application fact, not provider-native state. A provider prompt that claims the user approved an action is untrusted input.

The application may impose a stricter ceiling than the selected profile. Platform limitations, missing bindings, unsupported provider features, or security policy can deny an action that a profile would otherwise allow.

## Provider enforcement

Rust owns provider process creation, transport, event ingestion, cancellation, and shutdown. Provider configuration supplies nonsecret settings and opaque credential references. Secret material is resolved only at the native boundary where needed.

Provider sandbox or trust configuration is defense in depth. It cannot widen organizational authority. The provider receives one resolved workspace and a bounded environment. Application host tools independently validate the run, channel, membership, profile revision, target, arguments, and current revocation state.

Provider output, changed-file reports, terminal output, model labels, protocol events, URLs, and errors are untrusted. Persisting or displaying them does not grant the referenced resource.

## Execution targets

Planning and discussion may remain targetless. Native filesystem, terminal, Git, checkpoint, restore, preview, or process work requires exactly one execution target.

The target is resolved in this order:

1. Retain the locked target of an active compatible continuation.
2. Use the target explicitly selected during assignment review.
3. Infer a target only when all executable references resolve to one eligible environment.
4. Use the membership's valid default folder when one exists.
5. Otherwise remain targetless and request a choice before native work.

A run cannot combine a working folder and scratch generation as coequal roots. Secondary folder access, if introduced, requires an explicit separate capability with its own path boundary. It must not be smuggled through attachments, links, environment variables, or provider configuration.

## Private scratch

Scratch is a private execution target, not an unowned temporary directory. Each generation has a stable logical identity, one owning scope, lifecycle state, and cleanup record. The native absolute path remains device-local.

Scratch content is not published to a channel merely because the run completed. Promotion into a managed project folder is explicit, preserves provenance, checks the destination grant, and revalidates every transferred file. Failed cleanup remains retryable without exposing the native path to organizational history.

Replacing a scratch generation revokes the old generation for new work. A provider continuation that materialized the old scratch cannot be silently rebound to the new one.

Scratch reuse resolves the teammate through the run's assignment, matched to its authorization revision and scope digest. The generation must belong to that teammate and destination, remain active, and satisfy all retained-source restrictions. Unknown or revoked authorization and mismatched ownership are denied.

## Attachments, references, and derived context

Attachments are imported through Rust into a managed, bounded store. A message or draft reference controls retention. Referencing an attachment from another channel requires authority to both the source material and destination audience.

Structured references store identity and provenance, not embedded access. Resolving a channel message, file, Note, task, checkpoint, or provider event repeats the current authorization check. If the caller cannot read the source, it receives neither the content nor a revealing preview.

Search results, summaries, mention suggestions, unread counts, generated context packages, exports, and AI prompts are derived context. They must apply the same membership, history, resource, and audience restrictions as canonical reads. A cache key must include every authorization dimension that affects its content.

## Strict disclosure

Information may move between channels only when the destination audience is a subset of the audience authorized for the source, or when an explicit declassification action creates new content under the destination policy.

A common participant is not enough. The system compares effective readable audiences, history bounds, and resource restrictions. References to restricted content remain opaque when the destination audience is broader.

AI-generated summaries do not escape this rule. Transformation does not remove provenance or authorization requirements.

## Internal host tools

Native Chat sessions receive an ephemeral loopback MCP endpoint containing only application-owned tools authorized for the current run. The endpoint is infrastructure, not a participant identity.

Every call validates an unguessable run-scoped credential, method allowlist, bounded arguments, current assignment, target, profile revision, membership, and revocation state. Tools return bounded DTOs without secrets, external absolute paths, or unrelated vault data. Endpoint lifetime ends with the run or earlier revocation.

Future external MCP and CLI integrations require separate user authorization. They must not reuse an internal endpoint or infer rights from the existence of an organizational identity.

## Revocation and materialized context

Reducing membership, history, profile, folder, runtime, or audience authority takes effect immediately for new reads and privileged actions.

If an active provider continuation has already received now-restricted content, logical filtering is insufficient. The application must:

1. mark the affected scope revoked;
2. interrupt active runs;
3. reject later host-tool calls and publication;
4. stop the provider session within a bounded deadline;
5. discard or quarantine the native continuation;
6. require a fresh authorization revision before resuming;
7. schedule retryable cleanup when immediate cleanup cannot complete.

Revocation cannot make an offline external provider forget data it already received. The product must avoid sending unnecessary context and disclose this limitation where external services are used.

## Persistence boundary

Portable SQLite owns identities, memberships, capabilities, history bounds, access-profile revisions, logical folder grants, assignments, scratch generations, command receipts, and revocation records. The platform config directory owns external absolute paths, executable paths, provider homes, native process state, and filesystem identity material. Secrets remain in native credential storage.

Remote synchronization is future work. When added, synchronized grants must preserve resource scope and revision history. Device-local bindings and secrets do not synchronize.

## Required test matrix

Authorization tests must cover at least:

- missing, stale, expired, fabricated, and revoked IDs;
- membership without history access and history cutoffs at exact boundaries;
- profile permission without a resource grant, and a grant without profile permission;
- targetless planning followed by denied native work;
- managed and external folder identity replacement;
- traversal, symlink, absolute-path, and Git common-directory escape;
- provider attempts to exceed application authority;
- references, summaries, search, attachments, and exports across audience boundaries;
- profile or membership reduction during an active run;
- scratch replacement, promotion, and failed cleanup;
- replayed internal tool credentials and calls after run termination.

Tests should assert both denial and absence of leaked metadata. A safe error must not reveal that a restricted resource exists.

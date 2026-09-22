# Chat

Chat is Ganbaru AI's project communication and coding-work surface. It combines durable human-readable conversations with bounded provider runs, review, files, terminals, and checkpoints without making provider threads the organizational source of truth.

## Current scope

| Capability | Status |
| --- | --- |
| Project `#general`, custom channels, navigation, archive, and search | Implemented |
| Messages, replies, mentions, drafts, attachments, scheduling, and combined timeline | Implemented |
| Codex, Claude, Cursor, Grok, and OpenCode execution | Implemented |
| Interactive questions, approvals, cancellation, inspector, bounded files, terminals, and Git checkpoints | Implemented |
| Persistent AI teammate identities and access foundations | Partial |
| Direct-message and task-discussion product surfaces | Partial |
| Human multi-device collaboration and encrypted sync | Planned |

## Product boundary

Chat owns communication:

- Groups, projects, channels, direct messages, and reply threads.
- Participants, memberships, messages, mentions, drafts, and scheduled sends.
- Work assignments, attention, review, and organizational history.

Provider runtimes own execution details:

- Provider sessions and continuation constraints.
- Tool calls, reasoning events, interactive requests, and process lifecycle.
- Workspace edits, terminal processes, browser previews, and checkpoints.

A channel can link multiple sequential or parallel provider runs. It never becomes dependent on one provider's continuation model. See [Conversations](conversations.md), [Teammates and coordination](teammates-and-coordination.md), and [Execution and workspace](execution-and-workspace.md).

## First use

Opening Chat for the first time creates or resolves the selected project's durable `#general` channel. The interface remains useful without a configured provider for reading, writing, organizing, searching, and scheduling messages.

Provider setup is explicit. Ganbaru AI discovers supported provider families, explains missing or invalid installations, stores only approved device-local configuration, and never claims a provider is ready before its probe succeeds.

Automatic provider discovery starts during workspace preparation but does not delay restoring local channels or reading saved history. Discovery results update provider settings without resetting the user's current conversation or draft. A failed probe leaves local history usable; provider execution still requires its normal readiness and authorization checks. Late discovery and fallback settings responses cannot replace settings from another vault or a newer load.

## Data ownership

The active vault owns organizational communication, canonical provider events, projections, drafts, attachment metadata, checkpoints, and authorization records. Managed attachment bytes live under the vault. Device-local state owns external paths, executable discovery, provider homes, native credentials, process state, and presentation preferences that should not travel.

Archive is reversible. Permanent deletion first records cleanup work for provider sessions, workspaces, terminals, previews, attachments, and credentials that cannot be removed in the same transaction.

## Safety and accessibility

Chat never grants a generic shell or arbitrary filesystem access to the frontend. Untrusted provider events and file content are validated and bounded before display. Approval prompts state the requested action and effective authority.

Conversation, navigation, composer, interactive requests, file browsing, review, and terminal controls remain keyboard reachable. Responsive layouts preserve the same canonical conversation and do not maintain a divergent mobile copy.

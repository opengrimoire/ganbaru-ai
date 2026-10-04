# AI provider runtimes

The coding-agent runtime supports Codex, Claude, Cursor, Grok, and OpenCode provider families. Each adapter normalizes provider-native events into stable Ganbaru AI contracts while retaining enough native detail for inspection and recovery.

## Shared contract

Every provider adapter must support the subset its metadata advertises. Unsupported capabilities remain absent or disabled. Ganbaru AI does not simulate approval, continuation, cancellation, interactive input, model selection, or reasoning controls that the provider cannot truthfully perform.

All transports apply bounded parsing, payload limits, timeouts, cancellation, process-tree cleanup, redaction, and stable error categories. Provider output is untrusted input. Unknown events may be preserved for diagnostics but cannot become typed application state without validation.

Desktop startup preloads cached Chat history and settings without launching provider discovery processes. Opening Chat or Chat settings starts automatic discovery once for the active vault, independently of local history loading. Explicit provider refresh remains available. Workspace prewarming after a vault reset also leaves provider discovery dormant.

## Codex

Codex uses its native app-server protocol. Ganbaru AI owns the process, thread association, event ingestion, interaction requests, cancellation, and workspace authority. App-server thread identity is an execution detail and does not replace the Chat conversation or teammate identity.

The runtime may expose provider-supported model, reasoning, approval, and sandbox choices. The effective choice and authority are recorded with the run.

## Claude

Claude uses its native bidirectional streaming protocol. Ganbaru AI owns the process and translates streamed messages, tool activity, permission requests, questions, and completion into canonical events.

Claude session identity remains provider-local. Resuming a session must preserve its authorized project and execution target; it cannot silently resume in a different folder.

## Cursor and Grok

Cursor and Grok use the official Agent Client Protocol types with ACP v1 negotiation. They share bounded ACP transport machinery but retain provider-specific executable discovery, credentials, model handling, interactions, continuation behavior, and diagnostics.

Grok is a first-class implemented provider family. It is not merely a future entry in the provider list. Its model catalog and interactive questions are validated through the same provider-neutral boundary as other runtimes.

## OpenCode

OpenCode uses its HTTP and event-stream interfaces. Ganbaru AI reconciles streamed and fetched history, deduplicates events, reconnects within bounds, and keeps cancellation and session ownership explicit.

## Compatibility and upgrades

Exact executable version floors and dependency versions are implementation facts, not durable product behavior. Compatibility fixtures and focused integration tests establish the supported protocol surface. When a provider changes an incompatible protocol, update its adapter and compatibility evidence without weakening the shared authorization boundary.

Dependency choices and rejected alternatives are recorded in [Chat dependency decisions](../../architecture/decisions/chat-dependencies.md).

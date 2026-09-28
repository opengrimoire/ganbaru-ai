# Chat conversations

## Organizational vocabulary

- **Group:** the top-level local organizational container.
- **Project:** a durable work area with channels and optional authorized working folders.
- **Channel:** a durable project conversation, beginning with `#general`.
- **Direct message:** a durable conversation with stable participants.
- **Reply thread:** focused discussion attached to one message or work item.
- **Provider run:** one bounded execution session linked into a conversation.

Provider thread IDs and model names are not conversation or participant identities.

## Navigation and lifecycle

The sidebar exposes project channels, personal sections, and search. Custom section names are edited in place in their heading, using the same row height and text size. Visible Save and Cancel buttons work on desktop and touch layouts; Enter or leaving the field saves a valid name, and Escape cancels. The project Chat settings popover in the workspace header opens the channel archive. Its Save control remains disabled until project Chat settings are available. Direct-message navigation is withheld until it has a working destination. The sidebar's visual and interaction conventions follow the [shared Notes and Chat sidebar design](../notes/pages-and-navigation.md#shared-notes-and-chat-sidebar-design). Channel ordering and membership are durable. Personal organization and the last selected channel may remain device-local presentation state.

Archive hides a conversation from normal navigation without destroying its messages, links, drafts, or review history. Restoring returns it to the appropriate project. Permanent deletion is explicit and includes a cleanup plan for owned execution resources.

Search uses bounded, paginated reads and includes active and archived conversations according to the selected filter. Opening a result restores the relevant conversation and position without loading its complete history.

## Messages and replies

Messages are durable participant-authored records. They can include text, validated attachments, task or project links, replies, mentions, and provenance for generated or transformed content.

Reply threads keep detailed work from overwhelming the main channel. A provider run may be initiated from a reply without forcing every provider event into the shared conversation. The main timeline receives concise state and result events; detailed execution remains inspectable in the linked run.

Channel feeds and reply threads keep their content width stable as messages begin or stop overflowing, so incoming messages do not shift the conversation horizontally. The execution timeline uses an overlaid scrollbar and also keeps its content width stable.

## Composer

The composer supports drafts, attachments, replies, explicit teammate mentions, provider interactions, and scheduled sends. A message can be sent without invoking AI. Plain conversation never silently becomes an execution request.

Slash commands are discoverable actions, not an alternate security model. They may change presentation, select a documented interaction mode, or start a typed application action. They cannot bypass project, folder, provider, or confirmation boundaries.

When a message appears actionable but does not identify an authorized target or sufficient objective, Chat keeps it as conversation or requests clarification. It does not guess a working folder or broaden authority.

## Timeline

The timeline combines organizational messages with normalized run events. It preserves canonical order, stable anchors, and enough provenance to understand who requested work, which provider executed it, what authority applied, and what result was produced.

Routine low-level provider events can fold after settlement. Errors, interactive requests, decisions, file changes, checkpoints, and final results remain easy to find. Folding changes presentation only; it never deletes canonical history.

## Attachments

Images and bounded text context can be copied into managed vault storage. The attachment record preserves original display metadata and the owning conversation or message. External absolute paths are never treated as portable attachment identity.

Unsupported, oversized, missing, or unsafe files fail explicitly. Previewing an attachment does not grant the provider access. A run receives an attachment only when its typed request and authorization include it.

## Responsive behavior

Desktop and mobile use the same conversation model. On narrow screens, channel navigation replaces the conversation temporarily rather than covering it with an ambiguous overlay. Android Back unwinds navigation, reply, request, and composer layers before leaving the Chat destination.

# Chat teammates and coordination

Status: Partial. AI teammates, channel access profiles, mention-triggered assignments, frozen context packages, and assignment review states are implemented. Structured delegation, budgets, quiet periods, task-linked assignments, and human collaborators are planned.

Ganbaru AI coordinates work through durable conversations, explicit assignments, and review. AI providers are execution mechanisms beneath that model, not organizational identities. There is no privileged manager agent or general vault agent, and no planning teammate is seeded by default.

## Participants and teammates

A participant is the local person, a persistent AI teammate, or (planned) a human collaborator. A teammate has a stable identity, role, and instructions independent of provider and model. Changing its provider or model creates a new policy revision, not a new participant, and its history stays intact.

A teammate's policy selects the provider instance, model and options, effort, and approval mode. Its configuration state reports when it needs setup, its provider is unavailable, or it lacks folder access.

Profiles never grant authority by themselves. A teammate acts in a channel only through a channel membership that carries:

- An access profile, either a built-in recipe (Conversation only, Read only, Edit files, Build and test, Publish changes) or a custom one.
- Separate capabilities to read channel history and to participate.
- A history boundary: the entire channel or only messages from the grant onward.
- Working-folder grants, each ordered as none, read, edit, execute, or publish.

Effective authority is the intersection of these ceilings, resolved by [Chat access control](../../data/access-control.md).

## Invocation

Ordinary messages never invoke every visible teammate. Work starts through an explicit mention or, in the future, a typed assignment, a documented workflow, or a user-approved scheduled action. Mentions distinguish reference from invocation: naming a teammate in prose is not enough, and an actionable invocation is visible before execution begins.

An invocation creates a work assignment in a reply thread, linked to its triggering message and any previous assignment. Assignments move through queued, working, waiting for an answer, waiting for approval, ready for review, completed, failed, or cancelled.

## Resolution before work starts

Rust resolves, and records with the assignment:

- Requesting conversation, participant, and project.
- The teammate and its current policy revision.
- Authorized working folder or private scratch generation.
- A bounded context package.
- Effective access and approval policy.
- Provider, model, interaction mode, and capability.
- Planned: task link, time, token, cost, and delegation budgets.

Provider-native trust, a previous run, shell availability, a teammate profile, or membership in a broad channel cannot widen any resolved value.

## Context packages

A context package is a bounded selection of information frozen for one assignment, with each source's revision and content hash recorded. It includes the triggering message, its reply thread, permitted channel messages, attachments, and referenced resources. Planned sources include approved Notes, task state, and Calendar context.

Context assembly follows participant access and the execution target. It never scans the complete vault or attaches unrelated history because it might be useful. The recorded package makes later review possible without treating provider memory as canonical.

## Results and review

Teammates report material outcomes as typed updates (plan, replan, question, approval, failure, result, review) rather than narrating every tool call into a shared channel. Detailed execution stays in the run timeline.

Review focuses on decisions and risk: what changed or was proposed, what could not be completed and why, which assumptions or approvals affected the outcome, what needs human judgment, and which checkpoint or files hold the result. Approval of one result does not grant standing approval for later work, and rejected or superseded proposals remain understandable in history.

Proposals that would change Projects or Calendar remain drafts until accepted through the owning feature's typed command. See [Guided planning and review](../projects/guided-planning.md).

## Delegation (planned)

Delegation creates explicit child assignments with their own parent, objective, target, authority subset, budget, expected result, and review path. A teammate cannot delegate authority it does not hold. Parallel work stays visible as separate, independently cancellable assignments rather than hidden provider-native subagents, and a failed child never broadens another assignment to compensate.

## Anti-burnout constraints

Coordination should reduce work fragmentation, not create pressure to supervise agents continuously. Defaults favor bounded work, quiet progress, batch review, explicit deadlines, and visible budgets. The system must not manufacture urgency, shame inactivity, optimize for message volume, or treat teammate activity as proof of human productivity. Planned: scheduled work respects quiet periods and defers non-urgent notifications.

## Authority and safety

Destructive, externally visible, credential-related, security-sensitive, or broad-scope actions require typed boundaries and appropriate confirmation. Revocation stops future reads and context assembly without rewriting legitimate historical messages.

## Human collaboration (planned)

Collaboration roles may include owner, administrator, member, and restricted guest. Encryption, key distribution, revocation, historical visibility, offline copies, and conflict resolution belong to the [sync](../../data/sync.md) and permission design. Controls stay absent or clearly unavailable until the behavior is real.

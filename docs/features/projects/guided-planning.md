# Guided project planning

Guided planning helps a user turn an unclear intention into a bounded project without pretending that AI-generated plans are commitments.

## Product objective

The workflow separates exploration, evaluation, commitment, execution, and review. Users can stop after any stage with useful notes and no hidden tasks.

The durable reasoning frame is:

- **Want:** the desired outcome and personal reason.
- **Can:** available skills, time, resources, constraints, and risks.
- **Need:** requirements, dependencies, acceptance criteria, and non-negotiable obligations.

The intersection becomes a proposal. It becomes a project plan only after explicit user acceptance.

## Boundaries

Conversation and generated drafts are not canonical tasks. Accepted plans use typed Project commands to create or update sections, tasks, checklists, dates, dependencies, decisions, and settings.

An AI provider never receives the complete vault by default. Context packages include only selected project material and authority. The workflow remains usable without AI through structured prompts and templates.

## Exploration

The user captures the idea, intended audience, motivation, possible outcomes, constraints, unknowns, and alternatives. The interface favors quick capture before demanding a detailed hierarchy.

The fantasy terms Genesis, Forging, Journey, and guide characters can remain an optional presentation theme. They are not canonical data states and must not obscure ordinary planning language or accessibility.

## Evaluation

Evaluation compares value, effort, feasibility, uncertainty, opportunity cost, and current capacity. It can recommend proceeding, narrowing, postponing, researching, or declining.

Recommendations explain assumptions and uncertainty. They do not use a score as objective truth or pressure the user to accept more work.

## Commitment

Accepting a proposal defines:

- Outcome and acceptance criteria.
- Scope and explicit exclusions.
- Milestones and task structure.
- Owners and reviewers where available.
- Dependencies, estimates, dates, and budgets.
- Required working-folder, Calendar, Notes, and Chat context.
- Review cadence and stop or replan conditions.

The user previews canonical changes before applying them. Partial acceptance is allowed.

## Tasks and checklists

Tasks represent independently trackable work with state, dates, ownership, dependencies, and review. Checklists represent lightweight completion detail inside one task.

Generated plans should prefer a small set of meaningful tasks over exhaustive decomposition. Later refinement remains possible without losing the original accepted rationale.

## Assignment and review

Human and AI assignments use the same objective, project, authority, budget, expected output, and review destination. A teammate can propose task changes but does not silently commit them unless the assignment explicitly grants that typed action.

Review records decisions, accepted results, rejected proposals, exceptions, and follow-up work without flooding the project with low-level execution events.

## Sustainable capacity

Planning considers working hours, existing commitments, estimates, uncertainty, focus capacity, and recovery time. It can warn when a plan exceeds available capacity and suggest scope or deadline changes.

Capacity is a planning constraint, not a productivity judgment. The workflow does not manufacture urgency, shame rest, or optimize for task count.

## Requirement and decision history

Important requirements and decisions retain rationale, author, time, alternatives, and affected tasks. Later changes add new history rather than overwriting why the prior decision existed.

Accepted plan snapshots can support comparison and review, while current Project rows remain canonical.

## Replanning

Date or dependency changes can produce a proposal for affected tasks and milestones. The implemented Gantt workflow reviews the complete canonical cascade and protects completed work, archived work, and scheduled Calendar commitments. Explicit date locks and user-selected protection overrides remain planned for guided replanning; the current cascade cannot override these protections. See [Dependency date proposals](settings-and-scheduling.md#dependency-date-proposals).

## Reports and attention

Future reports can summarize progress, blockers, risks, schedule changes, review needs, and decisions from canonical project data. They should direct attention to exceptions rather than generate status prose for its own sake.

## Repository integration

Software projects can link an authorized working folder, Chat runs, checkpoints, commits, and review artifacts. Git remains canonical for repository content. Project tasks and decisions remain canonical organizational records.

## Collaboration

Future collaboration applies project, task, Notes, conversation, and working-folder permissions separately. Assigning a task never implies access to every project Note or filesystem path.

See [Chat teammates and coordination](../chat/teammates-and-coordination.md), [access control](../../data/access-control.md), and [Projects](README.md).

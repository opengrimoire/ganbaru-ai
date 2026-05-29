# Project management

The project management feature is a guided lifecycle framework: brainstorming, evaluation, planning, execution, post-execution. Each phase is a structured template with actionable forms. Together they form a "quest chain" that walks the user through a project from idea to launch.

This doc is a placeholder. Deeper design comes in a later pass; the structure here mirrors `docs/PRODUCT_SPEC.md` for now.

## Quest chain structure

The project lifecycle is presented as a sequential set of phases. NPCs (in the eventual visual layer; see `features/gamification.md`) guide first-time users through each phase. Returning users see the full structure and can jump or skip as needed.

### Phase 1: Genesis (brainstorming)

Free-form ideation with structured prompts: write ideas, choose the best ones or combine them, iterate until a sufficiently attractive idea emerges. Discarded ideas are classified (e.g., "outside current capabilities," "too expensive," "already exists") for later reference.

### Phase 2: Forging the idea (evaluation)

Evaluate each candidate against three criteria:

1. **Want:** does the user genuinely want to do it?
2. **Can:** is it realistically achievable given resources and knowledge?
3. **Need:** does it address a real problem or desire? Revenue potential makes the idea self-sustaining.

A candidate that scores well on all three is a strong project. Weak scores on any axis are red flags worth examining.

### Phase 3: The journey ahead (planning and execution)

The most substantial phase. Subdivided into planning (3.1), MVP (3.2), execution (3.3), and post-execution (3.4).

**3.1 Planning** covers deep brainstorming, market analysis, competitor research, specification, resource estimation, and a final viability review. Each of these has its own structured template.

**3.2 MVP** covers recruiting collaborators, proof of concept, MVP development, updates from MVP feedback, and (optional) funding presentation.

**3.3 Execution** covers detailed execution planning, alpha and beta versions, launch marketing, polish, and the final launch announcement.

**3.4 Post-execution** covers contingency handling, investor updates, horizon expansion (new platforms, regions, languages), and product expansion.

The framework's order and granularity are not set in stone. Different projects need different sequences. The point is to start working, not to follow the template rigidly.

## Methodology templates

Beyond the lifecycle, the system includes guided forms for established methodologies: reverse brainstorming, value proposition canvas, business model canvas, SWOT analysis, market research frameworks. Each is structured and actionable, not a static template the user has to interpret.

## Requirement version control

Every change to a task's description, acceptance criteria, scope, or assignment within the project's task layer creates a timestamped diff. The diff records: what changed, when it changed, who requested it, why (mandatory brief explanation), and which downstream tasks or dates are affected. The history is permanently attached to the task and cannot be deleted. It can be searched, filtered, and exported.

This solves the specific problem of shifting requirements: when a stakeholder adds a new task mid-sprint, when a client changes specifications, when scope creep happens incrementally. Every change is visible and traceable.

## Date cascade

When a task's estimated effort changes, or when a new task is inserted, downstream tasks shift accordingly. If dependencies exist, the cascade propagates through the dependency graph and highlights conflicts. This applies both to the project's internal task graph and to the calendar (see `features/calendar.md`).

## Automatic report generation

Project status reports can be generated from project task state, calendar data, pomodoro history, requirement change history, and milestone completion. Output is markdown or PDF. Reports are read-only views of the database (see `data/architecture.md`); editing the report does not change the underlying data.

## Software repository integration

When a project is a software repository, the `ganbaruai` CLI exports repo-facing markdown views such as `KANBAN.md` and generated reports. This makes context available to collaborators who do not run Ganbaru AI and to AI agents that read the repo natively. The export is a view; the source of truth remains in SQLite. Changes to exported markdown can be imported back when the export type supports imports.

## Linkage to other systems

- **Calendar:** project phases generate calendar blocks.
- **Projects:** the project's tasks live in a project-scoped task layer with version control.
- **Notes:** project notes are working documents for each phase.
- **Work environments:** each project gets a dedicated environment.
- **AI panel:** workflow phase prompts adapt the AI's behavior per phase (see `features/ai-integration.md`).
- **Gamification:** NPC characters guide phase transitions in the eventual visual layer (see `features/gamification.md`).

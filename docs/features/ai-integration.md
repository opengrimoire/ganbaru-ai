# AI integration

GanbaruAI's AI features are entirely opt-in. The app is fully functional with no AI configured. When users do opt in, three paths cover different audiences: an integrated terminal for developers, a BYOK chat widget for non-developer users, and MCP for external clients only.

This doc is a placeholder. Deeper design comes in a later pass.

## Three paths

### 1. Integrated terminal (developer path)

An xterm.js terminal embedded in the app, running Codex or another CLI coding agent with full capabilities (file editing, bash, subagents). The user installs the agent separately and signs in with their own account or API key. GanbaruAI provides:

- **Context injection** through the launch prompt or standard input, populated from the active project, current kanban tasks, recent progress, calendar events, and related notes.
- **Per-project conversation threads** persisted in SQLite. When a calendar event starts, the terminal saves the current conversation and resumes the conversation for the new event's project.
- **Background agents** for delegated or parallel work, run through the selected agent's documented non-interactive mode. Codex uses `codex exec`.
- **Workflow phase prompts** that adapt the agent's behavior to the current project phase (brainstorming, evaluation, planning, execution).

`AGENTS.md` remains as project-level conventions. Per-task context comes from GanbaruAI dynamically, not from the markdown file.

### 2. BYOK chat widget (general-user path)

A chat interface that connects to the user's chosen LLM provider. Three provider categories cover most users:

- **OpenAI API**.
- **OpenAI-compatible API** (Groq, Together, Mistral, and any provider using a compatible chat format).
- **Ollama** for local models (Llama, Mistral, Gemma) running on the user's machine, no API key needed.
- Other provider APIs when users supply their own credentials and the integration is implemented explicitly.

The chat widget can read and write GanbaruAI data (calendar events, kanban tasks, notes) via the same CLI bridge the terminal uses. It cannot edit arbitrary files or run arbitrary bash commands; the developer path is the surface for those capabilities.

### 3. MCP (external clients only)

GanbaruAI exposes calendar, kanban, and notes data via an MCP server for use by external AI clients (ChatGPT, teammate agents, and other MCP-compatible clients on a different machine). MCP is also consumed for integrations with external systems (email, external calendars).

MCP is **not** the path for internal agent interaction. Internal agents (the embedded terminal, background agents) use the CLI directly, which is faster, simpler, and avoids the JSON-RPC overhead.

## The CLI as the data bridge

The `ganbaruai` CLI is a Rust binary that reads the same SQLite database the app uses. Agents call it via Bash:

```
ganbaruai task list --project foo --status in_progress
ganbaruai event create --start 2026-04-20T14:00 --duration 90m --project foo
ganbaruai progress export --to PROGRESS.md
```

This is the bridge between AI agents and GanbaruAI's data. It works with any agent that can run a shell command (Codex, Cursor, custom scripts), with no plugin or MCP server required for the local case.

## Workflow phase prompts

Each project lifecycle phase (see `features/project-management.md`) has a structured system prompt:

- **Brainstorming:** guides structured ideation.
- **Evaluation:** helps assess ideas against Want/Can/Need criteria.
- **Planning:** assists with specifications and resource estimation.
- **Execution:** helps with implementation and blockers.

These prompts work with both the terminal and the chat widget. One general agent per project carries context across all phases.

## Prompt buttons

The UI shows contextual action buttons alongside the AI panel: "Plan this sprint," "Research competitors," "Create calendar events for these tasks." Each button inserts a structured prompt into the terminal input or chat widget. The user can review, edit, and execute.

## Privacy and data flow

- The terminal path: data flows through the selected CLI agent. With Codex's hosted models, prompts and tool output are sent to OpenAI under the user's account or API key. With local open models, data can stay on-device if the agent and model support that setup.
- The BYOK path: data flows to whatever provider the user configured. Local providers (Ollama) keep all data on-device.
- The MCP path: external clients receive only the data the user authorizes them to see.

No AI features are required to use GanbaruAI. All data is processed locally by default. AI is an enhancement, not an infrastructure dependency.

## Team features and the AI as data fiduciary (deferred)

When team features arrive, the AI takes a specific privacy role: it sees individual tracking data (focus hours, idle patterns, break habits) but exposes only privacy-safe aggregate signals to managers and team leads. The AI is conceptually a fiduciary, similar to how a doctor sees a patient's full medical records but only tells an employer "fit for work."

What the team-facing AI outputs:

- "Assign task X to person A, estimated 3 days."
- "This reassignment would delay project B by approximately 2 days."
- "The suggested timeline accounts for existing workload."

What it never outputs:

- Individual focus hours, break patterns, idle time, or pause frequency.
- Comparative statements between people.
- Rankings or leaderboards.
- Explanations that reveal individual habits.

Mitigations against extraction attempts: hard architectural boundaries (the team-facing AI receives pre-computed signals only, not raw segments), output filtering for individual identifiers, refusal of comparison and per-person queries, response granularity capped at days and weeks, and a transparency log so each user can see every AI response that involved their data.

This design exists because accurate task estimates need individual-level data, but exposing that data to managers is surveillance, which contradicts the app's philosophy. The AI mediates: the data stays personal, the team gets useful estimates.

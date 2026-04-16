# Work environments

A work environment is a saved configuration that the calendar activates automatically when a session block starts. It covers what apps to open, what browser tabs to load, what playlist to play, what blocker rules to enforce, and what kanban context to show. The user defines environments once during planning; the app enforces them throughout the week.

This doc is a placeholder. Deeper design comes in a later pass.

## What an environment contains

| Setting | Examples |
|---------|----------|
| Apps to open | VSCode, Figma, terminal, Slack |
| Apps to close or minimize | Discord, browser windows from a different env |
| Browser tabs | A list of URLs opened in a designated browser window or group |
| Music playlist | Local file, YouTube playlist, or environment-default playlist |
| Blocker rules | Which sites and apps are off-limits (see `features/procrastination-stopper.md`) |
| Edge panel context | Which kanban board / project to display |

## How activation works

When a calendar session block reaches its start time:

1. The calendar reads the block's environment assignment.
2. The work environment manager closes apps not in the new environment (or minimizes them, configurable).
3. Opens apps specified in the new environment.
4. Opens the correct browser tabs via the browser extension.
5. Starts the assigned playlist.
6. Updates the blocker rules.
7. Updates the edge panel context.

This eliminates the daily friction of arranging the workspace manually. The user decides once during weekly planning; the app enforces it throughout the week.

## Manual activation

Environments can also be activated manually from the edge panel or settings, independent of any calendar event. This is useful for ad-hoc work where the user has not planned a calendar block.

## Templates and inheritance

Environments are templates: "Deep Work: Project X," "Admin," "Creative Writing." A session block references a template; if the template changes, all blocks using it pick up the change on next activation.

Per-block overrides are possible (e.g., the same template but a different playlist for one specific block). Overrides are stored on the block, not the template.

## Why desktop-only

Environment management requires controlling other applications (opening, closing, focusing windows). Mobile sandboxing prohibits this. On mobile, the procrastination stopper's app-level blocking is the closest equivalent, but it does not orchestrate apps the way a desktop environment does.

## Linkage to other systems

- **Calendar:** the source of activation triggers.
- **Music:** plays the assigned playlist.
- **Procrastination stopper:** enforces the assigned rules.
- **Edge panel:** displays the environment name and the relevant kanban context.
- **Pomodoro:** runs alongside; the timer is independent of the environment but typically pairs with one.

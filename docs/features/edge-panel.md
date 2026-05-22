# Edge panel

A narrow, auto-hiding panel anchored to the right edge of the screen on desktop. Shows live, glanceable context: the current pomodoro timer, quick-add for tasks, music controls, and the active environment name. Designed to minimize clicks to common actions.

This doc is a placeholder. Deeper design comes in a later pass.

## Why an edge panel

A user in deep focus does not want to switch windows to check their timer or change a track. The edge panel sits in peripheral vision, hidden until the user moves the mouse to the screen edge, then slides into view.

Conceptually similar to Ubuntu's dock but vertical and on the right. The right edge is preferred over the left because most users have window controls and main app navigation on the left.

## Trigger

The panel appears on hover (the mouse reaches the right screen edge). It auto-hides when the mouse leaves. Optional pinning keeps it visible.

Detection uses global mouse position via Rust (`rdev` or platform-specific APIs).

## Contents

| Section | Purpose |
|---------|---------|
| Quick-access icons | Calendar, Projects, Notes, Music, Settings. One click switches to that module. |
| Pomodoro timer | Current focus countdown as a small circular progress indicator (matches the title bar ring; see `features/pomodoro-progress-displays.md`). |
| Active environment name | Shows which work environment is currently active. |
| Quick-add task | Single text field; types a title and presses Enter to create a project task in the current project. |
| Current session tasks | Checkboxes for tasks linked to the active session block. Click to mark done. |
| Music controls | Play/pause, skip, volume. |

The principle: every action reachable from the edge panel is a single click or a single keystroke. The panel does not try to replicate any module's full UI; it provides the minimum needed to act without context-switching.

## Why desktop-only

Mobile does not have the screen real estate, the always-on-top window concept, or the mouse-edge interaction model. On mobile, the equivalent functions live in OS notifications and quick-action widgets.

## Linkage to other systems

- **Pomodoro:** mirrors the focus countdown.
- **Calendar:** the active session block determines what is shown.
- **Projects:** the linked tasks populate the checkbox list.
- **Music:** controls the active player.
- **Work environments:** the active environment name is displayed.

# Project settings and scheduling

## Project defaults

Project settings can define:

- Name and managed icon or emoji.
- Default event color and optional event name.
- Default timed duration or all-day behavior.
- Default Pomodoro mode and custom rhythm where applicable.
- Global or project-specific idle behavior.
- Focus and break phase soundtrack assignments.
- Project-local statuses, priorities, tags, and custom fields.
- Project templates and working-folder settings where the platform supports them.

New projects default to no event name, an adaptive Pomodoro choice, global focus-idle behavior, and no explicit soundtrack assignment unless a template says otherwise.

Playlist selectors load real Music playlists. They are not placeholder `None` controls. A missing or deleted playlist remains an explicit unavailable assignment with a repair path.

The implemented settings panel uses the same compact headings, label and control rows, and control sizes as general settings. Event defaults do not repeat "default" in every field label. They contain three direct playlist rows: Focus playlist, Short break playlist, and Long break playlist. Each uses a standard settings dropdown button and the Music panel's playlist picker menu. The None choice has a silence icon in both the menu and the selected button. Selecting playlists records automatic playback for selected phases and silence for empty phases. Each boundary selects a fresh track, avoiding the previous track when another eligible track exists, even when consecutive phases use the same playlist. There are no separate soundtrack headings, phase tabs, playback-action controls, or background-sound controls. Editing playlist defaults replaces legacy phase actions and independent background assignments with these playlist-only choices.

Work-environment and Doomscrolling defaults remain planned and must not appear as functional selectors until their storage and runtime behavior exist.

## Default application

Defaults initialize a new event or task-originated schedule. They do not continuously inherit after creation.

Selecting a project in an event draft can fill an empty title, color, Pomodoro mode, idle behavior, and soundtrack intent. It never replaces authored title text. Duration defaults do not resize an active event or an existing draft that already has deliberate timing.

Event music uses phase assignment snapshots and overrides, not direct track settings. Per-track start, end, skip, rate, and volume remain Music playlist-membership data.

## Statuses and priorities

Statuses and priorities are project-local, ordered, named, and colored with stable event-palette slots. Statuses also have semantic categories such as not started, active, blocked, and done.

Deleting an in-use value requires reassignment or is rejected. Reordering changes presentation, not task identity or history.

## Tags

Tags are project-local labeled colors with stable identity and order. Deleting a tag removes its task associations while preserving tasks and task history.

## Custom fields

Projects support text, number, select, multi-select, status, date, person, files, checkbox, URL, phone, and email custom fields. Select-like fields own stable options.

Schema changes validate existing values and define migration or removal behavior. Deleting a field requires confirmation and removes obsolete values through an explicit cleanup path.

## Project templates

Project templates can initialize sections, settings, statuses, priorities, tags, custom fields, and compatible planning defaults. Applying a template to a new project produces independent canonical rows.

Templates do not create hidden ongoing inheritance. Later template edits do not rewrite existing projects.

## Scheduling tasks

Scheduling creates a Calendar event using the task title, project, color, duration, Pomodoro, idle, and soundtrack defaults. An all-day project default creates an all-day task event.

The task and event are connected through an explicit link. Bulk quick scheduling creates separate events so every selected task remains independently visible and linked.

Existing project events can also be linked from task detail. A link is valid only when task and event belong to the same project.

Unlinking preserves both records. Archiving a task or event preserves the relationship as historical context according to each feature's lifecycle rules.

## Dependency date proposals

When a scheduled or dated task conflicts with finish-to-start dependencies, Ganbaru AI can propose downstream shifts. The preview lists every affected task, old and new dates, dependency reason, locks, and conflicts.

Applying is explicit and transactional. Tasks outside the project, archived tasks, protected dates, and ambiguous constraints are never moved silently.

## Working folders

A project can own a managed working folder and a device-local binding to an external folder where supported. Organizational Chat runs resolve their execution target through the authorized binding.

Working-folder files remain filesystem-canonical. Project settings store identity and policy, not file contents. Mobile omits local coding execution and desktop path selection.

The implemented desktop panel uses the same label and control rows as the surrounding settings. Each row shows a folder name on the left and its AI provider dropdown on the right. The dropdown uses the shared Chat provider icons and includes every configured instance and unconfigured provider family from Chat settings. Unconfigured families remain visible with their setup status and cannot be saved as a folder preference. A removed provider remains visibly unavailable until the user chooses a replacement or Automatic.

Add folder sits beside the section heading. Options beside each folder name contain the full device path when locally bound, Git branch when applicable, Open, primary selection, and maintenance actions. Managed and external folders share the same action rows. Actions protected by the managed folder's lifecycle stay visible with muted styling and a not-allowed cursor. A missing managed folder offers Recreate in the location action row. Selecting the primary folder keeps the menu open and updates the same button without changing its height. Missing bindings and repository mismatches remain visible on the folder row. Healthy availability and verification do not add status badges.

Folder configuration belongs to the settings draft. Adding, renaming, rebinding, recreating, archiving, restoring, removing, provider preferences, and primary selection require Save settings. Native path selection previews the full route without creating an association, changing a device binding, or stopping terminals. Save applies the native selection only to its authorized project, target, and active vault, and checks that the selected folder has not been replaced. Removing an external folder requires confirmation before staging the removal and preserves its files when saved. Open remains an immediate action for an already saved, available binding.

## Settings lifecycle

The implemented settings panel tracks all configuration changes until Save settings, including playlists, folder configuration, collection additions and deletions, and ordering of statuses, priorities, tags, fields, and options. Discard restores the last saved state. Confirming a deletion stages it for Save rather than persisting it immediately. The surrounding surface handles closing, outside-click, and Escape consistently with its unsaved-changes prompt.

Save validates editable settings before issuing mutations and locks editing while those mutations run. Persistence remains sequential across Projects, Chat, and device settings. A failed Save reports the error and keeps remaining changes available for retry or Discard. Successfully completed mutations remain saved, and completed draft creations are acknowledged so a retry does not create duplicates.

Settings remain accessible on narrow layouts and do not require hover or drag as the only operation.

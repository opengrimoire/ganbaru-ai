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

Implemented bulk scheduling uses one native Calendar and Focus owner transaction for the complete selected batch. Rust reads current task titles, revisions, project defaults, and phase soundtrack assignments; creates independent events; adds scheduled links; patches task dates; records history; and stores a durable retry receipt. An archived, missing, foreign, or changed task rejects the entire batch. A changed project scheduling default or soundtrack between review and acceptance requires a new review. A failed write rolls back the complete batch, and an uncertain response retains the original request for Retry.

The duration selected in the scheduling form takes precedence over the project duration default. Timed events run consecutively for that many elapsed minutes, including across daylight-saving transitions. The first authored civil start uses Calendar's native timezone rules. All-day project defaults put every selected task on the chosen day, with equal inclusive start and end dates and no Focus configuration. Task start and target end dates follow the scheduled start day. An existing due date, completion timestamp, status, and unrelated task fields remain intact. Project defaults are copied at creation, including phase soundtrack snapshots; later default changes do not alter the created events.

Existing project events can also be linked from task detail. A link is valid only when task and event belong to the same project.

Unlinking preserves both records. Archiving a task or event preserves the relationship as historical context according to each feature's lifecycle rules.

## Dependency date proposals

When dated tasks conflict with finish-to-start dependencies, the native service reads the complete canonical project graph and proposes downstream shifts. Gantt filters, collapsed sections, and paged rows do not limit the proposal. The preview lists every affected task, its original and proposed dates, and the dependencies requiring each change. Durations and the set of populated date fields are preserved; a milestone remains a single date.

Archived tasks, completed tasks, and tasks with scheduled Calendar links are protected. Cycles, missing or foreign endpoints, undated dependencies, invalid dates, and unsupported date ranges produce explicit conflicts. A proposal with a conflict cannot be partially applied. Reference-only Calendar links do not reserve task dates. Explicit date locks and override selection remain planned because the current task schema has no date-lock field.

Applying is explicit and transactional. The command checks the complete reviewed input digest after acquiring the SQLite writer. A changed task, dependency, completion state, or scheduling commitment requires a new preview and review; it cannot silently expand the accepted cascade. Only the task date fields change. Their history and durable retry receipt commit together, and retrying the same operation returns the original result after an uncertain response or restart. Native limits reject excessive graphs or payloads before mutation.

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

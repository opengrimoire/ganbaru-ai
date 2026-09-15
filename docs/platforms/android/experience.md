# Android experience

## Adaptive shell

Phones use a compact global top bar for primary destinations and utility surfaces. Larger windows can use a navigation rail. Calendar, Projects, Notes, and Chat are primary destinations. Pomodoro, Quick notes, Music, and Settings open as contextual surfaces without adding another permanent bar.

The shell uses touch-sized controls, visible selection, localized accessible names, system safe areas, and the current theme. It does not repeat the active destination label when that would consume essential phone width.

Inactive complex destinations load lazily, but the shell and current destination remain stable while a feature module is loading or recovering.

## Hierarchical navigation

Projects, Notes, and Chat share one compact identity row. On phones, selecting a breadcrumb level opens a full-height touch selector for that hierarchy level rather than reproducing adjacent desktop sidebars.

Only one hierarchy level is visible at a time. Back moves toward the group root before dismissing the selector. Opening navigation or switching a channel does not summon the keyboard until the user selects Search or the composer.

## Calendar

Calendar starts in day view and retains direct touch navigation and editing. Day, work-cycle, week, month, zoom, visibility, and settings remain available through compact controls.

Native two-axis gestures do not conflict with event drag or resize. Active-event protections remain identical to desktop.

## Projects

Projects starts in List and reuses the same canonical List, Dashboard, Kanban, Calendar, and Gantt views. Wide views use native horizontal and vertical touch panning with momentum. Selection and task-detail controls remain visible on coarse pointers instead of depending on hover.

Filters, sorting, columns, grouping, view selection, and project settings open in touch-sized overlays or sheets.

## Notes

Notes reuses the page, block, database, history, and navigation contracts. On phones, the hierarchy selector moves one group, project, folder, or page level at a time. The page action bar remains available below the stable identity row.

Desktop working-folder Markdown controls are absent. Managed images and files use bounded document-input flows.

## Chat

Chat reuses the responsive canonical workspace. Channel navigation replaces the conversation while open rather than covering it with a dimmed desktop overlay. Search and close actions remain reachable in the navigation surface.

Provider process setup, terminal, files, Git, local review workspace, and execution diagnostics are absent. Communication and existing durable review activity remain available.

## Pomodoro, Quick notes, Music, and Settings

Pomodoro, Quick notes, and the compact Music player float above the active destination within the visible safe viewport. The Music library builder expands to a full-screen workspace. Android Back closes the topmost consumable surface first.

Settings preserves the desktop category structure when a real shared preference or Android equivalent exists. Unsupported individual controls are omitted. Shortcuts are omitted because hardware keyboard shortcuts are not a core mobile contract.

Doomscrolling settings include shared usage limits, Android selected-app rules and access status, plus read-only browser and desktop configuration where it helps users understand portable vault settings. The Android surface is not status-only.

## Linked desktop workflow

First use creates or restores the private vault, completes the Android access review, then shows a dedicated desktop-linking screen. The rear-camera preview appears on that screen and requests camera access in context. The desktop QR invitation supplies the private-LAN endpoint and pinned coordinator identity, so the user never copies an address or configures a server. **Not now** continues into the app for the current session, but closing or reloading the app returns to linking until the user completes it explicitly. Data settings remains the fallback for linking later.

A linked-device control immediately after Pomodoro shows the current writable or read-only role and opens transfer, retry, explicit refresh, unlink, and recovery actions without adding a permanent warning row to the shell. Its tooltip remains the control name instead of duplicating transient status, and queued work does not create indefinite progress animation. Data settings remains a fallback management surface. When the phone opens with a read-only copy, or a completed handoff makes the open phone read-only, a focused ownership prompt identifies the current main device and offers `Use on this device` or `Continue in read-only`. `Use on this device` is the only normal action that requests write ownership. Before the first desktop vault replaces existing Android data, the app saves a portable recovery backup to Downloads. A read-only vault remains browsable through the ordinary shell.

Already scheduled Calendar alarms and the last accepted Doomscrolling rules continue while the phone is offline or backgrounded. Desktop Calendar changes reach Android notification scheduling only after a successful read-only refresh. If the owning device is permanently unavailable, recovery requires a separate destructive-choice confirmation, preserves both copies, and explains that later changes will not merge.

## Insets and cutouts

A native bridge publishes system-bar and display-cutout insets. CSS safe-area values remain a fallback. Layout reacts to portrait, landscape, gesture or button navigation, cutouts, and window changes without hardcoded device dimensions.

Controls remain inside the visible viewport and content is not hidden beneath system UI.

## Keyboard and input method

Visual viewport tracking keeps focused inputs and editor actions visible while the keyboard opens, resizes, or changes orientation. Sheets and full-screen editors can scroll their focused content into view without shifting unrelated shell state.

Opening navigation does not focus Search automatically. Dismissing the keyboard does not accidentally leave the current feature.

## Android Back

A serialized frontend Back controller intercepts only when the UI has consumable state. It covers dialogs, menus, pickers, full-screen builders, navigation levels, editor layers, task details, Notes contextual pages, and global utility sheets.

At a destination root, the listener unregisters or yields so the next Back action follows native Android behavior. Two layers cannot consume the same press, and a stale closed layer cannot keep the app trapped.

Predictive Back requires validation on supported newer devices. The state model should be compatible without inventing a separate navigation history.

## Accessibility

All touch controls expose localized names, selected and expanded state, and sufficient target size. Keyboard and switch-access users can reach primary navigation, overlays, hierarchy selectors, editing, Save, Cancel, and recovery actions.

Motion is restrained and respects user preferences. Status is never communicated by color or animation alone.

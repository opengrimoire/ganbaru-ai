# Android experience

## Adaptive shell

Phones use a compact global top bar for primary destinations and utility surfaces. Larger windows can use a navigation rail. Calendar, Projects, Notes, and Chat are primary destinations. Pomodoro, Quick notes, Music, and Settings open as contextual surfaces without adding another permanent bar.

The shell uses touch-sized controls, visible selection, localized accessible names, system safe areas, and the current theme. It does not repeat the active destination label when that would consume essential phone width.

Startup keeps the shell behind a centered loading indicator until the database, Calendar data, Pomodoro recovery, and the standard Pomodoro and linked-device controls are ready. After the usable Calendar paints, Android automatically prepares Projects, Settings, Quick notes, Notes, Chat, and Music in prioritized background batches, yielding a frame between batches. This work is not deferred until interaction. If a destination is opened before its automatic preparation finishes, only that destination shows the loading indicator while it reuses the existing in-flight request. Heavy detail workflows remain lazy only where the desktop composition also defers them, including advanced editors, imports, diagnostics, builders, and optional detail panels.

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

First use begins with a localized welcome screen that presents the free and open-source license summary, a source-code link, the full bundled AGPL 3.0 license in a dialog, and acknowledgments in another dialog. If a configured vault is missing or invalid, Continue leads to vault recovery. Otherwise, continuing creates or restores the private vault, completes the Android access review, then shows a dedicated desktop-linking screen. The rear-camera preview fills the available content width and requests camera access in context. The scanner analyzes the centered visible region at a bounded high resolution, prefers continuous camera focus when the device exposes it, and decodes a compact QR representation of the desktop invitation. The invitation supplies the private-LAN endpoint and pinned coordinator identity, so the user never copies an address or configures a server. An untouched first-run vault is replaced directly by an initial read-only desktop snapshot, after which a concise success state continues into the ordinary main-device choice. **Not now** completes onboarding for the current vault, enters the app, and marks the independent vault for preservation. Closing or reloading the app then opens the main app. Closing the linking screen before choosing either action leaves onboarding unfinished and shows it again at the next launch. Data settings and the unlinked top-bar control reuse the same full-screen scanner later.

A linked-device control immediately after Pomodoro shows the current writable or read-only role and opens transfer, retry, explicit refresh, unlink, and recovery actions without adding a permanent warning row to the shell. Its tooltip remains the control name instead of duplicating transient status, and queued work does not create indefinite progress animation. When no relationship exists, this control opens the same full-screen linking flow used during onboarding instead of placing enrollment controls in the compact management panel. Data settings remains a fallback management surface. When the phone opens with a read-only copy, or a completed handoff makes the open phone read-only, a focused ownership prompt identifies the current main device by its enrolled system label and offers `Use on this device` or `Continue in read-only`. `Use on this device` is the only normal action that requests write ownership. Before the first linked vault replaces an independent Android vault that the user has entered, the app states that the copies cannot be merged, requires explicit confirmation, and saves a portable recovery backup to Downloads. Incompatible app data formats stop linking or transfer with guidance to update both devices. A read-only vault remains browsable through the ordinary shell. Emergency local-copy recovery appears only in Data settings after membership is lost while the local copy remains read-only.

Already scheduled Calendar alarms and the last accepted Doomscrolling rules continue while the phone is offline or backgrounded. Desktop Calendar changes reach Android notification scheduling only after a successful read-only refresh. If the computer removes an offline read-only phone, the next authenticated reconnect clears the stale link on the phone and explains that its preserved local copy remains read-only. If the owning device is permanently unavailable, recovery requires a separate destructive-choice confirmation, preserves both copies, and explains that later changes will not merge.

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

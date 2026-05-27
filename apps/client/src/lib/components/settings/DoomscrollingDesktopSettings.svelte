<script lang="ts">
  import {
    isProtectedDoomscrollingDesktopAppName,
    type DoomscrollingAppRule,
  } from "$lib/doomscrolling";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import { cn } from "$lib/utils";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import DoomscrollingAppSelector from "./DoomscrollingAppSelector.svelte";
  import DoomscrollingConfigurationSection from "./DoomscrollingConfigurationSection.svelte";
  import DoomscrollingRuleList from "./DoomscrollingRuleList.svelte";

  const doomscrolling = getDoomscrolling();

  type DesktopListKind = "blocked";
  type DesktopConfigurationToggle = "focus" | "shortBreaks" | "longBreaks";

  interface DoomscrollingAppSelection {
    name: string;
    matchNames: readonly string[];
  }

  interface DesktopListSection {
    kind: DesktopListKind;
    id: string;
    heading: string;
    description: string;
    placeholder: string;
    emptyText: string;
    errorText: string;
    apps: () => readonly DoomscrollingAppRule[];
    add: (text: string) => boolean;
    remove: (name: string) => void;
    setEnabled: (name: string, enabled: boolean) => void;
  }

  interface RuleListItem {
    id: string;
    label: string;
    enabled: boolean;
    locked?: boolean;
    stateLabel?: string;
  }

  interface PendingDesktopAppAction {
    type: "disable" | "delete";
    kind: DesktopListKind;
    name: string;
  }

  interface PendingDesktopConfigurationAction {
    toggle: DesktopConfigurationToggle;
  }

  type PendingAction =
    | { target: "app"; action: PendingDesktopAppAction }
    | { target: "desktopConfiguration"; action: PendingDesktopConfigurationAction };

  const appSections = {
    blocked: {
      kind: "blocked",
      id: "doomscrolling-blocked-apps",
      heading: "Blocked apps",
    description: "Block selected apps when desktop blocking is active. Example: Steam",
      placeholder: "Enter an app...",
      emptyText: "No blocked apps yet",
      errorText: "Enter an app name. Example: Steam",
      apps: () => doomscrolling.blockedApps,
      add: (text: string) => doomscrolling.addBlockedAppsText(text),
      remove: (name: string) => doomscrolling.removeBlockedApp(name),
      setEnabled: (name: string, enabled: boolean) => doomscrolling.setBlockedAppEnabled(name, enabled),
    },
  } satisfies Record<DesktopListKind, DesktopListSection>;

  let pendingAction = $state<PendingAction | null>(null);
  let appPickerSection = $state<DesktopListKind | null>(null);
  const activePickerSection = $derived(appPickerSection ? appSections[appPickerSection] : null);

  function appItems(section: DesktopListSection): RuleListItem[] {
    const apps = section.apps()
      .filter((rule) => !isProtectedDoomscrollingDesktopAppName(rule.name))
      .map((rule) => ({
        id: rule.name.toLowerCase(),
        label: rule.name,
        enabled: rule.enabled,
      }));
    return apps;
  }

  function existingAppNames(section: DesktopListSection): string[] {
    return appItems(section).map((app) => app.label);
  }

  function pickerSection(): DesktopListSection | null {
    return activePickerSection;
  }

  function openAppPicker(kind: DesktopListKind): void {
    appPickerSection = kind;
  }

  function closeAppPicker(): void {
    appPickerSection = null;
  }

  function addPickedApp(app: DoomscrollingAppSelection): boolean {
    const section = pickerSection();
    return section ? doomscrolling.addBlockedApp(app.name, app.matchNames) : false;
  }

  function requestAppEnabledChange(section: DesktopListSection, name: string, enabled: boolean): void {
    if (enabled) {
      section.setEnabled(name, true);
      return;
    }
    pendingAction = {
      target: "app",
      action: {
        type: "disable",
        kind: section.kind,
        name,
      },
    };
  }

  function requestAppDelete(section: DesktopListSection, name: string): void {
    pendingAction = {
      target: "app",
      action: {
        type: "delete",
        kind: section.kind,
        name,
      },
    };
  }

  function setDesktopConfigurationToggle(
    toggle: DesktopConfigurationToggle,
    checked: boolean,
  ): void {
    if (toggle === "focus") {
      doomscrolling.setDesktopEnabled(checked);
    } else if (toggle === "shortBreaks") {
      doomscrolling.setDesktopBlockDuringShortBreaks(checked);
    } else {
      doomscrolling.setDesktopBlockDuringLongBreaks(checked);
    }
  }

  function requestDesktopConfigurationToggleChange(
    toggle: DesktopConfigurationToggle,
    checked: boolean,
  ): void {
    if (checked) {
      setDesktopConfigurationToggle(toggle, true);
      return;
    }
    pendingAction = { target: "desktopConfiguration", action: { toggle } };
  }

  function confirmPendingAction(): void {
    if (!pendingAction) return;
    if (pendingAction.target === "desktopConfiguration") {
      setDesktopConfigurationToggle(pendingAction.action.toggle, false);
    } else {
      const { type, kind, name } = pendingAction.action;
      const section = appSections[kind];
      if (type === "disable") {
        section.setEnabled(name, false);
      } else {
        section.remove(name);
      }
    }
    pendingAction = null;
  }

  function cancelPendingAction(): void {
    pendingAction = null;
  }

  function pendingActionTitle(action: PendingAction): string {
    if (action.target === "desktopConfiguration") {
      if (action.action.toggle === "focus") return "Turn off desktop blocking during focus?";
      if (action.action.toggle === "shortBreaks") return "Allow apps during short breaks?";
      return "Allow apps during long breaks?";
    }
    return action.action.type === "disable"
      ? `Allow ${action.action.name}?`
      : `Remove ${action.action.name} from blocked apps?`;
  }

  function pendingActionMessage(action: PendingAction): string {
    if (action.target === "desktopConfiguration") {
      if (action.action.toggle === "focus") {
        return "App rules will not apply during focus sessions until you enable this again";
      }
      if (action.action.toggle === "shortBreaks") {
        return "App rules will not apply during short breaks until you enable this again";
      }
      return "App rules will not apply during long breaks until you enable this again";
    }
    return action.action.type === "disable"
      ? "It will stay in the list but will not affect desktop blocking until you enable it again"
      : "It will no longer be blocked by desktop rules";
  }

  function pendingActionConfirmLabel(action: PendingAction): string {
    if (action.target === "desktopConfiguration") {
      return action.action.toggle === "focus" ? "Turn off (Enter)" : "Allow (Enter)";
    }
    return action.action.type === "disable" ? "Allow (Enter)" : "Remove (Enter)";
  }
</script>

<div class="flex flex-col gap-6">
  <DoomscrollingConfigurationSection
    title="Desktop configuration"
    enabled={doomscrolling.desktopEnabled}
    blockDuringShortBreaks={doomscrolling.desktopBlockDuringShortBreaks}
    blockDuringLongBreaks={doomscrolling.desktopBlockDuringLongBreaks}
    showMode={false}
    enabledLabel="Enable during focus"
    enabledDescription="Apply app rules while a focus session is running"
    shortBreakDescription="Apply app rules during short breaks"
    longBreakDescription="Apply app rules during long breaks"
    onScheduleChange={requestDesktopConfigurationToggleChange}
  />

  <fieldset
    disabled={!doomscrolling.desktopEnabled}
    aria-disabled={!doomscrolling.desktopEnabled}
    class={cn(
      "m-0 flex min-w-0 flex-col gap-6 border-0 p-0 transition-opacity",
      !doomscrolling.desktopEnabled && "opacity-50",
    )}
  >
    <div class="h-px bg-border/70" aria-hidden="true"></div>

    <section class="flex flex-col gap-4">
      <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Blocklist</h2>
      <DoomscrollingRuleList
        id={appSections.blocked.id}
        heading={appSections.blocked.heading}
        description={appSections.blocked.description}
        placeholder={appSections.blocked.placeholder}
        emptyText={appSections.blocked.emptyText}
        errorText={appSections.blocked.errorText}
        items={appItems(appSections.blocked)}
        onAdd={appSections.blocked.add}
        onOpenSelector={() => openAppPicker("blocked")}
        selectorLabel="Add app"
        onEnabledChange={(name, enabled) => requestAppEnabledChange(appSections.blocked, name, enabled)}
        onDelete={(name) => requestAppDelete(appSections.blocked, name)}
      />
    </section>
  </fieldset>
</div>

{#if activePickerSection}
  <DoomscrollingAppSelector
    title="Choose an app to block"
    existingNames={existingAppNames(activePickerSection)}
    protectAppSelf
    onAdd={addPickedApp}
    onRemove={appSections.blocked.remove}
    onCancel={closeAppPicker}
  />
{/if}

{#if pendingAction}
  <ConfirmDialog
    title={pendingActionTitle(pendingAction)}
    message={pendingActionMessage(pendingAction)}
    confirmLabel={pendingActionConfirmLabel(pendingAction)}
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmPendingAction}
    onCancel={cancelPendingAction}
  />
{/if}

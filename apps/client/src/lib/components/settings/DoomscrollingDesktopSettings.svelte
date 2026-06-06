<script lang="ts">
  import {
    isProtectedDoomscrollingDesktopAppName,
    type DoomscrollingAppRule,
  } from "$lib/doomscrolling";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import { cn } from "$lib/utils";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import DoomscrollingAppSelector from "./DoomscrollingAppSelector.svelte";
  import DoomscrollingConfigurationSection from "./DoomscrollingConfigurationSection.svelte";
  import DoomscrollingRuleList from "./DoomscrollingRuleList.svelte";

  const doomscrolling = getDoomscrolling();
  const { t } = getLocalization();

  type DesktopListKind = "blocked";
  type DesktopConfigurationToggle = "enabled" | "focus" | "shortBreaks" | "longBreaks" | "pause";

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
      heading: t("settings.doomscrolling.desktop.blockedApps"),
      description: t("settings.doomscrolling.desktop.blockedAppsDescription"),
      placeholder: t("settings.doomscrolling.desktop.enterApp"),
      emptyText: t("settings.doomscrolling.desktop.noBlockedApps"),
      errorText: t("settings.doomscrolling.desktop.invalidApp"),
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
    if (toggle === "enabled") {
      doomscrolling.setDesktopEnabled(checked);
    } else if (toggle === "focus") {
      doomscrolling.setDesktopBlockDuringFocus(checked);
    } else if (toggle === "shortBreaks") {
      doomscrolling.setDesktopBlockDuringShortBreaks(checked);
    } else if (toggle === "longBreaks") {
      doomscrolling.setDesktopBlockDuringLongBreaks(checked);
    } else {
      doomscrolling.setDesktopPauseDuringFocusPause(checked);
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
      if (action.action.toggle === "enabled") return t("settings.doomscrolling.desktop.turnOffTitle");
      if (action.action.toggle === "focus") return t("settings.doomscrolling.desktop.allowAppsFocusTitle");
      if (action.action.toggle === "shortBreaks") return t("settings.doomscrolling.desktop.allowAppsShortBreaksTitle");
      if (action.action.toggle === "longBreaks") return t("settings.doomscrolling.desktop.allowAppsLongBreaksTitle");
      return t("settings.doomscrolling.desktop.keepBlockingPausedTitle");
    }
    return action.action.type === "disable"
      ? t("settings.doomscrolling.desktop.allowAppTitle", action.action.name)
      : t("settings.doomscrolling.desktop.removeAppTitle", action.action.name);
  }

  function pendingActionMessage(action: PendingAction): string {
    if (action.target === "desktopConfiguration") {
      if (action.action.toggle === "enabled") {
        return t("settings.doomscrolling.desktop.appOffMessage");
      }
      if (action.action.toggle === "focus") {
        return t("settings.doomscrolling.desktop.focusOffMessage");
      }
      if (action.action.toggle === "shortBreaks") {
        return t("settings.doomscrolling.desktop.shortBreaksOffMessage");
      }
      if (action.action.toggle === "longBreaks") {
        return t("settings.doomscrolling.desktop.longBreaksOffMessage");
      }
      return t("settings.doomscrolling.desktop.pauseActiveMessage");
    }
    return action.action.type === "disable"
      ? t("settings.doomscrolling.desktop.appDisableMessage")
      : t("settings.doomscrolling.desktop.removeMessage");
  }

  function pendingActionConfirmLabel(action: PendingAction): string {
    if (action.target === "desktopConfiguration") {
      return action.action.toggle === "enabled"
        ? t("settings.doomscrolling.shared.turnOffShortcut")
        : t("settings.doomscrolling.shared.allowShortcut");
    }
    return action.action.type === "disable"
      ? t("settings.doomscrolling.shared.allowShortcut")
      : t("settings.doomscrolling.shared.removeShortcut");
  }
</script>

<div class="flex flex-col gap-6">
  <DoomscrollingConfigurationSection
    title={t("settings.doomscrolling.desktop.desktopConfiguration")}
    enabled={doomscrolling.desktopEnabled}
    blockDuringFocus={doomscrolling.desktopBlockDuringFocus}
    blockDuringShortBreaks={doomscrolling.desktopBlockDuringShortBreaks}
    blockDuringLongBreaks={doomscrolling.desktopBlockDuringLongBreaks}
    pauseDuringFocusPause={doomscrolling.desktopPauseDuringFocusPause}
    showMode={false}
    enabledLabel={t("settings.doomscrolling.desktop.enableDesktopBlocking")}
    enabledDescription={t("settings.doomscrolling.desktop.enableDesktopBlockingDescription")}
    focusDescription={t("settings.doomscrolling.desktop.focusDescription")}
    shortBreakDescription={t("settings.doomscrolling.desktop.shortBreakDescription")}
    longBreakDescription={t("settings.doomscrolling.desktop.longBreakDescription")}
    pauseDescription={t("settings.doomscrolling.desktop.pauseDescription")}
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
      <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("settings.doomscrolling.desktop.blocklist")}</h2>
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
        selectorLabel={t("settings.doomscrolling.desktop.addApp")}
        onEnabledChange={(name, enabled) => requestAppEnabledChange(appSections.blocked, name, enabled)}
        onDelete={(name) => requestAppDelete(appSections.blocked, name)}
      />
    </section>
  </fieldset>
</div>

{#if activePickerSection}
  <DoomscrollingAppSelector
    title={t("settings.doomscrolling.desktop.chooseAppToBlock")}
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
    cancelLabel={t("settings.doomscrolling.shared.cancelShortcut")}
    onConfirm={confirmPendingAction}
    onCancel={cancelPendingAction}
  />
{/if}

<script lang="ts">
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Save from "@lucide/svelte/icons/save";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { cn } from "$lib/utils";
  import {
    DOOMSCROLLING_CATEGORY_DEFINITIONS,
    getDoomscrollingCategoryDefinition,
    parseDoomscrollingHosts,
    type DoomscrollingCategoryId,
    type DoomscrollingCustomCategoryStack,
    type DoomscrollingMode,
    type DoomscrollingHostRule,
  } from "$lib/doomscrolling";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import DoomscrollingBrowserConnectionStatus from "./DoomscrollingBrowserConnectionStatus.svelte";
  import DoomscrollingConfigurationSection from "./DoomscrollingConfigurationSection.svelte";
  import DoomscrollingRuleList from "./DoomscrollingRuleList.svelte";

  const doomscrolling = getDoomscrolling();
  const { t } = getLocalization();

  type WebsiteListKind = "blocked" | "exception" | "allowed";

  interface WebsiteListSection {
    kind: WebsiteListKind;
    id: string;
    heading: string;
    description: string;
    placeholder: string;
    emptyText: string;
    errorText: string;
    websites: () => readonly DoomscrollingHostRule[];
    add: (text: string) => boolean;
    remove: (website: string) => void;
    setEnabled: (website: string, enabled: boolean) => void;
  }

  interface RuleListItem {
    id: string;
    label: string;
    enabled: boolean;
  }

  interface PendingWebsiteAction {
    type: "disable" | "delete";
    kind: WebsiteListKind;
    host: string;
  }

  type BrowserConfigurationToggle = "enabled" | "focus" | "shortBreaks" | "longBreaks" | "pause";

  interface PendingBrowserConfigurationAction {
    toggle: BrowserConfigurationToggle;
  }

  interface PendingModeAction {
    mode: DoomscrollingMode;
  }

  interface PendingCategoryAction {
    type: "disable";
    categoryId: DoomscrollingCategoryId;
  }

  interface PendingCustomStackAction {
    type: "disable" | "delete";
    stackId: string;
  }

  interface PendingCustomStackDraftHostAction {
    host: string;
  }

  type PendingAction =
    | { target: "website"; action: PendingWebsiteAction }
    | { target: "browserConfiguration"; action: PendingBrowserConfigurationAction }
    | { target: "mode"; action: PendingModeAction }
    | { target: "category"; action: PendingCategoryAction }
    | { target: "customStack"; action: PendingCustomStackAction }
    | { target: "customStackDraftHost"; action: PendingCustomStackDraftHostAction };

  type CustomStackDraftField = "name" | "hosts";

  interface CustomCategoryDraft {
    name: string;
    hostInput: string;
    hosts: string[];
  }

  const websiteSections = {
    blocked: {
      kind: "blocked",
      id: "doomscrolling-blocked-websites",
      heading: t("settings.doomscrolling.browser.blockedWebsites"),
      description: t("settings.doomscrolling.browser.blockedWebsitesDescription"),
      placeholder: t("settings.doomscrolling.browser.enterDomain"),
      emptyText: t("settings.doomscrolling.browser.noBlockedWebsites"),
      errorText: t("settings.doomscrolling.browser.invalidDomain"),
      websites: () => doomscrolling.blockedHosts,
      add: (text: string) => doomscrolling.addBlockedHostsText(text),
      remove: (website: string) => doomscrolling.removeBlockedHost(website),
      setEnabled: (website: string, enabled: boolean) => doomscrolling.setBlockedHostEnabled(website, enabled),
    },
    exception: {
      kind: "exception",
      id: "doomscrolling-exception-websites",
      heading: t("settings.doomscrolling.browser.exceptions"),
      description: t("settings.doomscrolling.browser.exceptionsDescription"),
      placeholder: t("settings.doomscrolling.browser.enterDomain"),
      emptyText: t("settings.doomscrolling.browser.noExceptions"),
      errorText: t("settings.doomscrolling.browser.invalidDomain"),
      websites: () => doomscrolling.exceptionHosts,
      add: (text: string) => doomscrolling.addExceptionHostsText(text),
      remove: (website: string) => doomscrolling.removeExceptionHost(website),
      setEnabled: (website: string, enabled: boolean) => doomscrolling.setExceptionHostEnabled(website, enabled),
    },
    allowed: {
      kind: "allowed",
      id: "doomscrolling-allowed-websites",
      heading: t("settings.doomscrolling.browser.allowedWebsites"),
      description: t("settings.doomscrolling.browser.allowedWebsitesDescription"),
      placeholder: t("settings.doomscrolling.browser.enterDomain"),
      emptyText: t("settings.doomscrolling.browser.noAllowedWebsites"),
      errorText: t("settings.doomscrolling.browser.invalidDomain"),
      websites: () => doomscrolling.allowedHosts,
      add: (text: string) => doomscrolling.addAllowedHostsText(text),
      remove: (website: string) => doomscrolling.removeAllowedHost(website),
      setEnabled: (website: string, enabled: boolean) => doomscrolling.setAllowedHostEnabled(website, enabled),
    },
  } satisfies Record<WebsiteListKind, WebsiteListSection>;
  const blacklistWebsiteSections: readonly WebsiteListSection[] = [
    websiteSections.blocked,
    websiteSections.exception,
  ];
  const whitelistWebsiteSections: readonly WebsiteListSection[] = [
    websiteSections.allowed,
  ];

  let customStackDraft = $state<CustomCategoryDraft>({
    name: "",
    hostInput: "",
    hosts: [],
  });
  let customStackErrors = $state<Record<CustomStackDraftField, string>>({
    name: "",
    hosts: "",
  });
  let pendingAction = $state<PendingAction | null>(null);
  let customCategoryFormOpen = $state(false);
  let customCategoryEditingId = $state<string | null>(null);

  function websiteItems(section: WebsiteListSection): RuleListItem[] {
    return section.websites().map((rule) => ({
      id: rule.host,
      label: rule.host,
      enabled: rule.enabled,
    }));
  }

  function requestHostEnabledChange(section: WebsiteListSection, host: string, enabled: boolean): void {
    if (enabled) {
      section.setEnabled(host, true);
      return;
    }
    pendingAction = {
      target: "website",
      action: {
        type: "disable",
        kind: section.kind,
        host,
      },
    };
  }

  function requestHostDelete(section: WebsiteListSection, host: string): void {
    pendingAction = {
      target: "website",
      action: {
        type: "delete",
        kind: section.kind,
        host,
      },
    };
  }

  function categoryEnabled(categoryId: DoomscrollingCategoryId): boolean {
    return doomscrolling.blockedCategories.find((rule) => rule.id === categoryId)?.enabled ?? false;
  }

  function requestCategoryEnabledChange(categoryId: DoomscrollingCategoryId, enabled: boolean): void {
    if (enabled) {
      doomscrolling.setBlockedCategoryEnabled(categoryId, true);
      return;
    }
    pendingAction = {
      target: "category",
      action: {
        type: "disable",
        categoryId,
      },
    };
  }

  function requestCustomStackEnabledChange(stack: DoomscrollingCustomCategoryStack, enabled: boolean): void {
    if (enabled) {
      doomscrolling.setCustomCategoryStackEnabled(stack.id, true);
      return;
    }
    pendingAction = {
      target: "customStack",
      action: {
        type: "disable",
        stackId: stack.id,
      },
    };
  }

  function requestCustomStackDelete(stack: DoomscrollingCustomCategoryStack): void {
    pendingAction = {
      target: "customStack",
      action: {
        type: "delete",
        stackId: stack.id,
      },
    };
  }

  function requestEditingCustomStackDelete(): void {
    if (!customCategoryEditingId) return;
    const stack = findCustomStack(customCategoryEditingId);
    if (!stack) return;
    requestCustomStackDelete(stack);
  }

  function findCustomStack(stackId: string): DoomscrollingCustomCategoryStack | null {
    return doomscrolling.customCategoryStacks.find((stack) => stack.id === stackId) ?? null;
  }

  function clearCustomStackError(field: CustomStackDraftField): void {
    customStackErrors[field] = "";
  }

  function clearCustomCategoryForm(): void {
    customStackDraft.name = "";
    customStackDraft.hostInput = "";
    customStackDraft.hosts = [];
    customStackErrors.name = "";
    customStackErrors.hosts = "";
    customCategoryEditingId = null;
  }

  function closeCustomCategoryForm(): void {
    clearCustomCategoryForm();
    customCategoryFormOpen = false;
  }

  function openNewCustomCategoryForm(): void {
    clearCustomCategoryForm();
    customCategoryFormOpen = true;
  }

  function openEditCustomCategoryForm(stack: DoomscrollingCustomCategoryStack): void {
    customStackDraft.name = stack.name;
    customStackDraft.hostInput = "";
    customStackDraft.hosts = stack.hosts.map((rule) => rule.host);
    customStackErrors.name = "";
    customStackErrors.hosts = "";
    customCategoryEditingId = stack.id;
    customCategoryFormOpen = true;
  }

  function addCustomCategoryDraftHost(): boolean {
    const hosts = parseDoomscrollingHosts(customStackDraft.hostInput);
    if (hosts.length === 0) {
      customStackErrors.hosts = t("settings.doomscrolling.browser.invalidDomain");
      return false;
    }
    const newHosts = hosts.filter((host) => !customStackDraft.hosts.includes(host));
    if (newHosts.length === 0) {
      customStackErrors.hosts = t("settings.doomscrolling.browser.duplicateDomain");
      customStackDraft.hostInput = "";
      return false;
    }
    customStackDraft.hosts = [...customStackDraft.hosts, ...newHosts];
    customStackDraft.hostInput = "";
    customStackErrors.hosts = "";
    return true;
  }

  function submitCustomCategoryDraftHost(event: SubmitEvent): void {
    event.preventDefault();
    addCustomCategoryDraftHost();
  }

  function handleCustomCategoryNameKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) saveCustomCategoryWithPendingHost();
  }

  function saveCustomCategoryWithPendingHost(): void {
    if (customStackDraft.hostInput.trim() && !addCustomCategoryDraftHost()) return;
    saveCustomCategory();
  }

  function removeCustomCategoryDraftHost(host: string): void {
    customStackDraft.hosts = customStackDraft.hosts.filter((draftHost) => draftHost !== host);
    customStackErrors.hosts = "";
  }

  function requestCustomCategoryDraftHostDelete(host: string): void {
    pendingAction = {
      target: "customStackDraftHost",
      action: { host },
    };
  }

  function saveCustomCategory(): void {
    customStackErrors.name = "";
    customStackErrors.hosts = "";
    const hostsText = customStackDraft.hosts.join(" ");
    const result = customCategoryEditingId
      ? doomscrolling.updateCustomCategoryStack(
        customCategoryEditingId,
        customStackDraft.name,
        hostsText,
      )
      : doomscrolling.addCustomCategoryStack(customStackDraft.name, hostsText);
    if (result === "added" || result === "updated") {
      clearCustomCategoryForm();
      customCategoryFormOpen = false;
      return;
    }
    if (result === "invalid-name") {
      customStackErrors.name = t("settings.doomscrolling.browser.categoryNameRequired");
    } else if (result === "duplicate-name") {
      customStackErrors.name = t("settings.doomscrolling.browser.differentCategoryName");
    } else if (result === "missing") {
      customStackErrors.name = t("settings.doomscrolling.browser.categoryMissing");
    } else {
      customStackErrors.hosts = t("settings.doomscrolling.browser.invalidDomain");
    }
  }

  function setBrowserConfigurationToggle(
    toggle: BrowserConfigurationToggle,
    checked: boolean,
  ): void {
    if (toggle === "enabled") {
      doomscrolling.setEnabled(checked);
    } else if (toggle === "focus") {
      doomscrolling.setBlockDuringFocus(checked);
    } else if (toggle === "shortBreaks") {
      doomscrolling.setBlockDuringShortBreaks(checked);
    } else if (toggle === "longBreaks") {
      doomscrolling.setBlockDuringLongBreaks(checked);
    } else {
      doomscrolling.setPauseDuringFocusPause(checked);
    }
  }

  function requestBrowserConfigurationToggleChange(
    toggle: BrowserConfigurationToggle,
    checked: boolean,
  ): void {
    if (checked) {
      setBrowserConfigurationToggle(toggle, true);
      return;
    }
    pendingAction = { target: "browserConfiguration", action: { toggle } };
  }

  function requestModeChange(mode: DoomscrollingMode): void {
    if (mode === doomscrolling.mode) return;
    if (mode === "whitelist") {
      pendingAction = { target: "mode", action: { mode } };
      return;
    }
    doomscrolling.setMode(mode);
  }

  function categoryLabel(categoryId: DoomscrollingCategoryId): string {
    switch (categoryId) {
      case "social-media":
        return t("settings.doomscrolling.browser.categoryLabel.socialMedia");
      case "streaming":
        return t("settings.doomscrolling.browser.categoryLabel.streaming");
      case "news":
        return t("settings.doomscrolling.browser.categoryLabel.news");
      case "sports":
        return t("settings.doomscrolling.browser.categoryLabel.sports");
      case "porn":
        return t("settings.doomscrolling.browser.categoryLabel.porn");
      case "gambling":
        return t("settings.doomscrolling.browser.categoryLabel.gambling");
      case "gaming":
        return t("settings.doomscrolling.browser.categoryLabel.gaming");
      case "shopping":
        return t("settings.doomscrolling.browser.categoryLabel.shopping");
      case "dating":
        return t("settings.doomscrolling.browser.categoryLabel.dating");
      case "trading":
        return t("settings.doomscrolling.browser.categoryLabel.trading");
    }
  }

  function confirmPendingAction(): void {
    if (!pendingAction) return;
    if (pendingAction.target === "website") {
      const { type, kind, host } = pendingAction.action;
      const section = websiteSections[kind];
      if (type === "disable") {
        section.setEnabled(host, false);
      } else {
        section.remove(host);
      }
    } else if (pendingAction.target === "browserConfiguration") {
      setBrowserConfigurationToggle(pendingAction.action.toggle, false);
    } else if (pendingAction.target === "mode") {
      doomscrolling.setMode(pendingAction.action.mode);
    } else if (pendingAction.target === "category") {
      doomscrolling.setBlockedCategoryEnabled(pendingAction.action.categoryId, false);
    } else if (pendingAction.target === "customStackDraftHost") {
      removeCustomCategoryDraftHost(pendingAction.action.host);
    } else {
      const { type, stackId } = pendingAction.action;
      if (type === "disable") {
        doomscrolling.setCustomCategoryStackEnabled(stackId, false);
      } else {
        doomscrolling.removeCustomCategoryStack(stackId);
        if (customCategoryEditingId === stackId) {
          closeCustomCategoryForm();
        }
      }
    }
    pendingAction = null;
  }

  function cancelPendingAction(): void {
    pendingAction = null;
  }

  function pendingActionTitle(action: PendingAction): string {
    if (action.target === "website") {
      return action.action.type === "disable"
        ? t("settings.doomscrolling.browser.websiteDisableTitle", action.action.host)
        : t("settings.doomscrolling.browser.websiteDeleteTitle", action.action.host);
    }
    if (action.target === "browserConfiguration") {
      if (action.action.toggle === "enabled") return t("settings.doomscrolling.browser.turnOffBrowserTitle");
      if (action.action.toggle === "focus") return t("settings.doomscrolling.browser.allowWebsitesFocusTitle");
      if (action.action.toggle === "shortBreaks") return t("settings.doomscrolling.browser.allowWebsitesShortBreaksTitle");
      if (action.action.toggle === "longBreaks") return t("settings.doomscrolling.browser.allowWebsitesLongBreaksTitle");
      return t("settings.doomscrolling.browser.keepBrowserBlockingPausedTitle");
    }
    if (action.target === "mode") return t("settings.doomscrolling.browser.switchWhitelistTitle");
    if (action.target === "category") {
      const category = getDoomscrollingCategoryDefinition(action.action.categoryId);
      return t(
        "settings.doomscrolling.browser.allowCategoryTitle",
        category ? categoryLabel(category.id) : "category",
      );
    }
    if (action.target === "customStackDraftHost") {
      return t("settings.doomscrolling.browser.websiteDeleteTitle", action.action.host);
    }
    const stack = findCustomStack(action.action.stackId);
    const name = stack?.name ?? t("settings.doomscrolling.browser.customCategoryFallback");
    return action.action.type === "disable"
      ? t("settings.doomscrolling.browser.allowCategoryTitle", name)
      : t("settings.doomscrolling.browser.deleteCategoryTitle", name);
  }

  function pendingActionMessage(action: PendingAction): string {
    if (action.target === "website") {
      return action.action.type === "disable"
        ? t("settings.doomscrolling.browser.websiteDisableMessage")
        : t("settings.doomscrolling.shared.cannotBeUndone");
    }
    if (action.target === "browserConfiguration") {
      if (action.action.toggle === "enabled") {
        return t("settings.doomscrolling.browser.browserOffMessage");
      }
      if (action.action.toggle === "focus") {
        return t("settings.doomscrolling.browser.focusOffMessage");
      }
      if (action.action.toggle === "shortBreaks") {
        return t("settings.doomscrolling.browser.shortBreaksOffMessage");
      }
      if (action.action.toggle === "longBreaks") {
        return t("settings.doomscrolling.browser.longBreaksOffMessage");
      }
      return t("settings.doomscrolling.browser.pauseActiveMessage");
    }
    if (action.target === "mode") {
      return t("settings.doomscrolling.browser.whitelistWarning");
    }
    if (action.target === "category") {
      return t("settings.doomscrolling.browser.categoryDisableMessage");
    }
    if (action.target === "customStackDraftHost") {
      return t("settings.doomscrolling.shared.cannotBeUndone");
    }
    return action.action.type === "disable"
      ? t("settings.doomscrolling.browser.categoryDisableMessage")
      : t("settings.doomscrolling.shared.cannotBeUndone");
  }

  function pendingActionConfirmLabel(action: PendingAction): string {
    if (action.target === "website") {
      return action.action.type === "disable"
        ? t("settings.doomscrolling.shared.disableShortcut")
        : t("settings.doomscrolling.shared.deleteShortcut");
    }
    if (action.target === "browserConfiguration") {
      return action.action.toggle === "enabled"
        ? t("settings.doomscrolling.shared.turnOffShortcut")
        : t("settings.doomscrolling.shared.allowShortcut");
    }
    if (action.target === "mode") return t("settings.doomscrolling.shared.switchShortcut");
    if (action.target === "category") return t("settings.doomscrolling.shared.disableShortcut");
    if (action.target === "customStackDraftHost") return t("settings.doomscrolling.shared.deleteShortcut");
    return action.action.type === "disable"
      ? t("settings.doomscrolling.shared.disableShortcut")
      : t("settings.doomscrolling.shared.deleteShortcut");
  }

</script>

{#snippet modeWebsiteSection(title: string, sections: readonly WebsiteListSection[])}
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{title}</h2>
    <div class="flex flex-col gap-4">
      {#each sections as section (section.kind)}
        <DoomscrollingRuleList
          id={section.id}
          heading={section.heading}
          description={section.description}
          placeholder={section.placeholder}
          emptyText={section.emptyText}
          errorText={section.errorText}
          items={websiteItems(section)}
          onAdd={section.add}
          onEnabledChange={(host, enabled) => requestHostEnabledChange(section, host, enabled)}
          onDelete={(host) => requestHostDelete(section, host)}
        />
      {/each}
    </div>
  </section>
{/snippet}

{#snippet blacklistModeSection()}
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("settings.doomscrolling.browser.blacklistMode")}</h2>
    <div class="flex flex-col gap-4">
      {@render blockedCategoriesSubsection()}
      {#each blacklistWebsiteSections as section (section.kind)}
        <DoomscrollingRuleList
          id={section.id}
          heading={section.heading}
          description={section.description}
          placeholder={section.placeholder}
          emptyText={section.emptyText}
          errorText={section.errorText}
          items={websiteItems(section)}
          onAdd={section.add}
          onEnabledChange={(host, enabled) => requestHostEnabledChange(section, host, enabled)}
          onDelete={(host) => requestHostDelete(section, host)}
        />
      {/each}
    </div>
  </section>
{/snippet}

{#snippet blockedCategoriesSubsection()}
  <div class="flex flex-col gap-2 px-1 py-1">
    <div class="min-w-0">
      <h3 class="text-[0.866667rem] text-foreground">{t("settings.doomscrolling.browser.blockedCategories")}</h3>
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
        {t("settings.doomscrolling.browser.blockedCategoriesDescription")}
      </div>
    </div>

    <div class="flex flex-wrap gap-2 py-1.5">
      {#each DOOMSCROLLING_CATEGORY_DEFINITIONS as category (category.id)}
        {@const enabled = categoryEnabled(category.id)}
        <button
          type="button"
          onclick={() => requestCategoryEnabledChange(category.id, !enabled)}
          aria-label={enabled
            ? t("settings.doomscrolling.browser.categoryEnabled", categoryLabel(category.id))
            : t("settings.doomscrolling.browser.categoryDisabled", categoryLabel(category.id))}
          aria-pressed={enabled}
          class={cn(
            "inline-flex min-h-8 max-w-full items-center justify-center rounded-full border px-3 py-1.5 text-[0.8rem] font-medium leading-5",
            enabled
              ? "border-foreground/25 bg-foreground/5 text-foreground"
              : "border-border bg-transparent text-muted-foreground",
          )}
        >
          <span class="truncate">{categoryLabel(category.id)}</span>
        </button>
      {/each}

      {#each doomscrolling.customCategoryStacks as stack (stack.id)}
        <span
          class={cn(
            "inline-flex max-w-full overflow-hidden rounded-full border",
            stack.enabled
              ? "border-foreground/25 bg-foreground/5 text-foreground"
              : "border-border bg-transparent text-muted-foreground",
          )}
          role="group"
          aria-label={t(
            "settings.doomscrolling.browser.customCategoryState",
            stack.name,
            stack.enabled
              ? t("settings.doomscrolling.shared.enabled")
              : t("settings.doomscrolling.shared.disabled"),
          )}
        >
          <button
            type="button"
            onclick={() => requestCustomStackEnabledChange(stack, !stack.enabled)}
            aria-pressed={stack.enabled}
            class="inline-flex min-h-8 min-w-0 max-w-full items-center justify-center py-1.5 pl-3 pr-1 text-[0.8rem] font-medium leading-5"
          >
            <span class="truncate">{stack.name}</span>
          </button>
          <button
            type="button"
            onclick={() => openEditCustomCategoryForm(stack)}
            aria-label={t("settings.doomscrolling.shared.edit", stack.name)}
            data-app-tooltip-disabled="true"
            class="flex min-h-8 w-7 shrink-0 items-center justify-center pr-2 text-muted-foreground"
          >
            <Pencil size={12} strokeWidth={2} />
          </button>
        </span>
      {/each}

      <button
        type="button"
        onclick={openNewCustomCategoryForm}
        aria-expanded={customCategoryFormOpen}
        class={cn(
          "inline-flex min-h-8 max-w-full items-center justify-center rounded-full border border-dashed px-3 py-1.5 text-[0.8rem] font-medium leading-5",
          customCategoryFormOpen && !customCategoryEditingId
            ? "border-foreground/25 bg-foreground/5 text-foreground"
            : "border-border bg-transparent text-muted-foreground",
        )}
      >
        <Plus size={13} strokeWidth={2.25} class="shrink-0" />
        <span class="ml-1.5 truncate">{t("settings.doomscrolling.browser.newCategory")}</span>
      </button>
    </div>

    {#if customCategoryFormOpen}
      <div
        class="flex min-w-0 flex-col gap-1 py-1"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <label for="doomscrolling-custom-stack-name" class="sr-only">{t("settings.doomscrolling.browser.categoryName")}</label>
          <input
            id="doomscrolling-custom-stack-name"
            bind:value={customStackDraft.name}
            oninput={() => clearCustomStackError("name")}
            onkeydown={handleCustomCategoryNameKeydown}
            type="text"
            spellcheck="false"
            placeholder={t("settings.doomscrolling.browser.categoryName")}
            class="flex h-7 min-w-32 flex-1 rounded-md border border-border bg-transparent px-2 text-[0.8rem] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onclick={saveCustomCategoryWithPendingHost}
            disabled={!customStackDraft.name.trim() || customStackDraft.hosts.length === 0}
            class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card dark:bg-transparent dark:disabled:hover:bg-transparent"
          >
            {#if customCategoryEditingId}
              <Save size={13} strokeWidth={2.25} />
              <span>{t("settings.doomscrolling.browser.save")}</span>
            {:else}
              <Plus size={13} strokeWidth={2.25} />
              <span>{t("settings.doomscrolling.browser.add")}</span>
            {/if}
          </button>
          {#if customCategoryEditingId}
            <button
              type="button"
              onclick={requestEditingCustomStackDelete}
              class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
            >
              <Trash2 size={13} strokeWidth={2} />
              <span>{t("settings.doomscrolling.browser.delete")}</span>
            </button>
          {/if}
          <button
            type="button"
            onclick={closeCustomCategoryForm}
            class="flex h-7 shrink-0 items-center justify-center rounded-md border border-border bg-card px-2.5 text-[0.8rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            {t("settings.doomscrolling.browser.cancel")}
          </button>
        </div>

        <div class="grid min-w-0">
          <div class="min-w-0">
            <form
              class="flex min-w-0 items-center gap-2 border-b border-border/70 py-1.5 focus-within:border-ring"
              onsubmit={submitCustomCategoryDraftHost}
            >
              <input
                id="doomscrolling-custom-stack-hosts"
                bind:value={customStackDraft.hostInput}
                oninput={() => clearCustomStackError("hosts")}
                type="text"
                spellcheck="false"
                placeholder={t("settings.doomscrolling.browser.enterDomain")}
                class="flex h-7 min-w-0 flex-1 bg-transparent px-1 text-[0.8rem] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={!customStackDraft.hostInput.trim()}
                class="flex h-7 shrink-0 items-center justify-center gap-1.5 px-1 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={13} strokeWidth={2.25} />
                <span>{t("settings.doomscrolling.browser.add")}</span>
              </button>
            </form>
            <div class="flex flex-col">
              {#each customStackDraft.hosts as host (host)}
                <div class="flex min-w-0 items-center gap-2 border-b border-border/70 py-1.5">
                  <span class="flex h-7 min-w-0 flex-1 items-center truncate px-1 text-[0.8rem] leading-snug text-foreground">
                    {host}
                  </span>
                  <button
                    type="button"
                    onclick={() => requestCustomCategoryDraftHostDelete(host)}
                    aria-label={t("settings.doomscrolling.shared.remove", host)}
                    data-app-tooltip-disabled="true"
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent dark:bg-transparent"
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
              {:else}
                <div class="flex h-10 items-center border-b border-border/70 px-1 text-[0.8rem] text-muted-foreground">
                  {t("settings.doomscrolling.browser.noWebsitesAdded")}
                </div>
              {/each}
            </div>
          </div>
        </div>
        {#if customStackErrors.name}
          <div class="text-[0.8rem] text-destructive">{customStackErrors.name}</div>
        {/if}
        {#if customStackErrors.hosts}
          <div class="text-[0.8rem] text-destructive">{customStackErrors.hosts}</div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col gap-6">
  <DoomscrollingBrowserConnectionStatus />

  <DoomscrollingConfigurationSection
    title={t("settings.doomscrolling.browser.browserConfiguration")}
    enabled={doomscrolling.enabled}
    blockDuringFocus={doomscrolling.blockDuringFocus}
    blockDuringShortBreaks={doomscrolling.blockDuringShortBreaks}
    blockDuringLongBreaks={doomscrolling.blockDuringLongBreaks}
    pauseDuringFocusPause={doomscrolling.pauseDuringFocusPause}
    mode={doomscrolling.mode}
    enabledLabel={t("settings.doomscrolling.browser.enableBrowserBlocking")}
    enabledDescription={t("settings.doomscrolling.browser.enableBrowserBlockingDescription")}
    focusDescription={t("settings.doomscrolling.browser.focusDescription")}
    shortBreakDescription={t("settings.doomscrolling.browser.shortBreakDescription")}
    longBreakDescription={t("settings.doomscrolling.browser.longBreakDescription")}
    pauseDescription={t("settings.doomscrolling.browser.pauseDescription")}
    modeHeading={t("settings.doomscrolling.shared.websiteMode")}
    modeDescription={t("settings.doomscrolling.browser.modeDescription")}
    blacklistDescription={t("settings.doomscrolling.shared.blacklistDescription")}
    whitelistDescription={t("settings.doomscrolling.shared.whitelistDescription")}
    onScheduleChange={requestBrowserConfigurationToggleChange}
    onModeChange={requestModeChange}
  />

  <fieldset
    disabled={!doomscrolling.enabled}
    aria-disabled={!doomscrolling.enabled}
    class={cn(
      "m-0 flex min-w-0 flex-col gap-6 border-0 p-0 transition-opacity",
      !doomscrolling.enabled && "opacity-50",
    )}
  >
    <div class="h-px bg-border/70" aria-hidden="true"></div>

    {#if doomscrolling.mode === "blacklist"}
      {@render blacklistModeSection()}
    {:else}
      {@render modeWebsiteSection(t("settings.doomscrolling.browser.whitelistMode"), whitelistWebsiteSections)}
    {/if}
  </fieldset>
</div>

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

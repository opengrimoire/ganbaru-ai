<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Save from "@lucide/svelte/icons/save";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import {
    getDoomscrollingExtensionStatus,
    type DoomscrollingExtensionStatus,
  } from "$lib/api/doomscrolling";
  import { appSessionStartedAt } from "$lib/stores/app-session";
  import { cn } from "$lib/utils";
  import {
    DOOMSCROLLING_CATEGORY_DEFINITIONS,
    getDoomscrollingCategoryDefinition,
    parseDoomscrollingHosts,
    type DoomscrollingCategoryId,
    type DoomscrollingCustomCategoryStack,
    type DoomscrollingHostRule,
  } from "$lib/doomscrolling";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import DoomscrollingConfigurationSection from "./DoomscrollingConfigurationSection.svelte";
  import DoomscrollingRuleList from "./DoomscrollingRuleList.svelte";

  const doomscrolling = getDoomscrolling();
  const EXTENSION_STATUS_POLL_MS = 15_000;
  const EXTENSION_STARTUP_GRACE_MS = 45_000;
  const EXTENSION_STARTUP_PENDING_REASONS = new Set([
    "connection is from an older app session",
    "no extension connection has been recorded",
  ]);

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

  type BrowserConfigurationToggle = "focus" | "shortBreaks" | "longBreaks";

  interface PendingBrowserConfigurationAction {
    toggle: BrowserConfigurationToggle;
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
      heading: "Blocked websites",
      description: "Block selected domains when browser blocking is active. Example: youtube.com",
      placeholder: "Enter a domain...",
      emptyText: "No blocked websites yet",
      errorText: "Enter a valid domain. Example: domain.com",
      websites: () => doomscrolling.blockedHosts,
      add: (text: string) => doomscrolling.addBlockedHostsText(text),
      remove: (website: string) => doomscrolling.removeBlockedHost(website),
      setEnabled: (website: string, enabled: boolean) => doomscrolling.setBlockedHostEnabled(website, enabled),
    },
    exception: {
      kind: "exception",
      id: "doomscrolling-exception-websites",
      heading: "Exceptions",
      description: "Allow specific subdomains inside blocked domains. Example: music.youtube.com",
      placeholder: "Enter a domain...",
      emptyText: "No exceptions yet",
      errorText: "Enter a valid domain. Example: domain.com",
      websites: () => doomscrolling.exceptionHosts,
      add: (text: string) => doomscrolling.addExceptionHostsText(text),
      remove: (website: string) => doomscrolling.removeExceptionHost(website),
      setEnabled: (website: string, enabled: boolean) => doomscrolling.setExceptionHostEnabled(website, enabled),
    },
    allowed: {
      kind: "allowed",
      id: "doomscrolling-allowed-websites",
      heading: "Allowed websites",
      description: "Only these domains stay available in whitelist mode. Example: github.com",
      placeholder: "Enter a domain...",
      emptyText: "No allowed websites yet",
      errorText: "Enter a valid domain. Example: domain.com",
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
  let extensionStatus = $state<DoomscrollingExtensionStatus | null>(null);
  let extensionStatusLoading = $state(true);
  let extensionStatusError = $state<string | null>(null);
  let pendingAction = $state<PendingAction | null>(null);
  let customCategoryFormOpen = $state(false);
  let customCategoryEditingId = $state<string | null>(null);
  const extensionStatusConnected = $derived(extensionStatus?.connected === true);
  const extensionStatusWaitingForFirstConnection = $derived.by(() => {
    if (!extensionStatus || extensionStatus.connected) return false;
    if (!extensionStatus.reason || !EXTENSION_STARTUP_PENDING_REASONS.has(extensionStatus.reason)) {
      return false;
    }
    const sessionStartedAtMs = Date.parse(appSessionStartedAt);
    const checkedAtMs = Date.parse(extensionStatus.checkedAt);
    if (!Number.isFinite(sessionStartedAtMs) || !Number.isFinite(checkedAtMs)) return false;
    return checkedAtMs - sessionStartedAtMs <= EXTENSION_STARTUP_GRACE_MS;
  });
  const extensionStatusShowInstallAction = $derived(
    extensionStatus !== null
      && !extensionStatus.connected
      && !extensionStatusWaitingForFirstConnection,
  );

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
      customStackErrors.hosts = "Enter a valid domain. Example: domain.com";
      return false;
    }
    const newHosts = hosts.filter((host) => !customStackDraft.hosts.includes(host));
    if (newHosts.length === 0) {
      customStackErrors.hosts = "Website is already in this category";
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
      customStackErrors.name = "Enter a category name";
    } else if (result === "duplicate-name") {
      customStackErrors.name = "Use a different category name";
    } else if (result === "missing") {
      customStackErrors.name = "Category no longer exists";
    } else {
      customStackErrors.hosts = "Enter a valid domain. Example: domain.com";
    }
  }

  function setBrowserConfigurationToggle(
    toggle: BrowserConfigurationToggle,
    checked: boolean,
  ): void {
    if (toggle === "focus") {
      doomscrolling.setEnabled(checked);
    } else if (toggle === "shortBreaks") {
      doomscrolling.setBlockDuringShortBreaks(checked);
    } else {
      doomscrolling.setBlockDuringLongBreaks(checked);
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
        ? `Disable ${action.action.host}?`
        : `Delete ${action.action.host}?`;
    }
    if (action.target === "browserConfiguration") {
      if (action.action.toggle === "focus") return "Turn off browser blocking during focus?";
      if (action.action.toggle === "shortBreaks") return "Allow websites during short breaks?";
      return "Allow websites during long breaks?";
    }
    if (action.target === "category") {
      const category = getDoomscrollingCategoryDefinition(action.action.categoryId);
      return `Allow the ${category?.label ?? "category"} category?`;
    }
    if (action.target === "customStackDraftHost") {
      return `Delete ${action.action.host}?`;
    }
    const stack = findCustomStack(action.action.stackId);
    const name = stack?.name ?? "custom category";
    return action.action.type === "disable"
      ? `Allow the ${name} category?`
      : `Delete the ${name} category?`;
  }

  function pendingActionMessage(action: PendingAction): string {
    if (action.target === "website") {
      return action.action.type === "disable"
        ? "It will stay in the list but will not affect browser blocking until you enable it again"
        : "This cannot be undone";
    }
    if (action.target === "browserConfiguration") {
      if (action.action.toggle === "focus") {
        return "Website rules will not apply during focus sessions until you enable this again";
      }
      if (action.action.toggle === "shortBreaks") {
        return "Website rules will not apply during short breaks until you enable this again";
      }
      return "Website rules will not apply during long breaks until you enable this again";
    }
    if (action.target === "category") {
      return "This category will stop blocking its websites until you enable it again";
    }
    if (action.target === "customStackDraftHost") {
      return "This cannot be undone";
    }
    return action.action.type === "disable"
      ? "This category will stop blocking its websites until you enable it again"
      : "This cannot be undone";
  }

  function pendingActionConfirmLabel(action: PendingAction): string {
    if (action.target === "website") {
      return action.action.type === "disable" ? "Disable (Enter)" : "Delete (Enter)";
    }
    if (action.target === "browserConfiguration") {
      return action.action.toggle === "focus" ? "Turn off (Enter)" : "Allow (Enter)";
    }
    if (action.target === "category") return "Disable (Enter)";
    if (action.target === "customStackDraftHost") return "Delete (Enter)";
    return action.action.type === "disable" ? "Disable (Enter)" : "Delete (Enter)";
  }

  function extensionStatusTitle(): string {
    if (extensionStatusError && !extensionStatus) return "Browser extension status unavailable";
    if (extensionStatusLoading && !extensionStatus) return "Checking browser extension";
    if (extensionStatusWaitingForFirstConnection) return "Waiting for browser extension";
    return extensionStatusConnected
      ? "Browser extension connected"
      : "Browser extension not connected";
  }

  async function openExtensionInstallDocs(): Promise<void> {
    try {
      await invoke("doomscrolling_open_extension_install_docs");
    } catch (err) {
      console.warn("Failed to open extension install docs:", err);
    }
  }

  async function refreshExtensionStatus(): Promise<void> {
    if (!extensionStatus) extensionStatusLoading = true;
    try {
      extensionStatus = await getDoomscrollingExtensionStatus(appSessionStartedAt);
      extensionStatusError = null;
    } catch (err) {
      console.warn("Failed to read browser extension connection status:", err);
      extensionStatusError = err instanceof Error ? err.message : String(err);
    } finally {
      extensionStatusLoading = false;
    }
  }

  onMount(() => {
    void refreshExtensionStatus();
    const intervalId = setInterval(() => {
      void refreshExtensionStatus();
    }, EXTENSION_STATUS_POLL_MS);
    return () => clearInterval(intervalId);
  });
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
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Blacklist mode</h2>
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
      <h3 class="text-[0.866667rem] text-foreground">Blocked categories</h3>
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
        Turn preset and custom website groups on or off
      </div>
    </div>

    <div class="flex flex-wrap gap-2 py-1.5">
      {#each DOOMSCROLLING_CATEGORY_DEFINITIONS as category (category.id)}
        {@const enabled = categoryEnabled(category.id)}
        <button
          type="button"
          onclick={() => requestCategoryEnabledChange(category.id, !enabled)}
          aria-label={enabled ? `${category.label} category enabled` : `${category.label} category disabled`}
          aria-pressed={enabled}
          class={cn(
            "inline-flex min-h-8 max-w-full items-center justify-center rounded-full border px-3 py-1.5 text-[0.8rem] font-medium leading-5",
            enabled
              ? "border-foreground/25 bg-foreground/5 text-foreground"
              : "border-border bg-transparent text-muted-foreground",
          )}
        >
          <span class="truncate">{category.label}</span>
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
          aria-label={`${stack.name} custom category, ${stack.enabled ? "enabled" : "disabled"}`}
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
            aria-label={`Edit ${stack.name}`}
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
        <span class="ml-1.5 truncate">New category</span>
      </button>
    </div>

    {#if customCategoryFormOpen}
      <div
        class="flex min-w-0 flex-col gap-1 py-1"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <label for="doomscrolling-custom-stack-name" class="sr-only">Category name</label>
          <input
            id="doomscrolling-custom-stack-name"
            bind:value={customStackDraft.name}
            oninput={() => clearCustomStackError("name")}
            onkeydown={handleCustomCategoryNameKeydown}
            type="text"
            spellcheck="false"
            placeholder="Category name"
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
              <span>Save</span>
            {:else}
              <Plus size={13} strokeWidth={2.25} />
              <span>Add</span>
            {/if}
          </button>
          {#if customCategoryEditingId}
            <button
              type="button"
              onclick={requestEditingCustomStackDelete}
              class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
            >
              <Trash2 size={13} strokeWidth={2} />
              <span>Delete</span>
            </button>
          {/if}
          <button
            type="button"
            onclick={closeCustomCategoryForm}
            class="flex h-7 shrink-0 items-center justify-center rounded-md border border-border bg-card px-2.5 text-[0.8rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            Cancel
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
                placeholder="Enter a domain..."
                class="flex h-7 min-w-0 flex-1 bg-transparent px-1 text-[0.8rem] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={!customStackDraft.hostInput.trim()}
                class="flex h-7 shrink-0 items-center justify-center gap-1.5 px-1 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={13} strokeWidth={2.25} />
                <span>Add</span>
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
                    aria-label={`Remove ${host}`}
                    data-app-tooltip-disabled="true"
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent dark:bg-transparent"
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
              {:else}
                <div class="flex h-10 items-center border-b border-border/70 px-1 text-[0.8rem] text-muted-foreground">
                  No websites added yet
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
  <div
    class={cn(
      "flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 px-3 py-1.5 transition-colors dark:bg-transparent",
      (extensionStatusLoading && !extensionStatus) || extensionStatusWaitingForFirstConnection
        ? "border-border text-muted-foreground"
        : extensionStatusConnected
          ? "border-border text-foreground"
          : "border-destructive/35 bg-destructive/5 text-destructive",
    )}
    aria-live="polite"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span
        class="flex h-5 w-5 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {#if (extensionStatusLoading && !extensionStatus) || extensionStatusWaitingForFirstConnection}
          <LoaderCircle size={14} strokeWidth={2.25} class="animate-spin" />
        {:else if extensionStatusConnected}
          <CircleCheck size={14} strokeWidth={2.25} />
        {:else}
          <CircleAlert size={14} strokeWidth={2.25} />
        {/if}
      </span>
      <div class="min-w-0 truncate text-[0.866667rem] font-medium">
        {extensionStatusTitle()}
      </div>
    </div>
    {#if extensionStatusShowInstallAction}
      <button
        type="button"
        onclick={openExtensionInstallDocs}
        class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
      >
        <span>Install extension</span>
        <ExternalLink size={12} strokeWidth={2.25} />
      </button>
    {/if}
  </div>

  <DoomscrollingConfigurationSection
    title="Browser configuration"
    enabled={doomscrolling.enabled}
    blockDuringShortBreaks={doomscrolling.blockDuringShortBreaks}
    blockDuringLongBreaks={doomscrolling.blockDuringLongBreaks}
    mode={doomscrolling.mode}
    enabledLabel="Enable during focus"
    enabledDescription="Apply website rules while a focus session is running"
    shortBreakDescription="Apply website rules during short breaks"
    longBreakDescription="Apply website rules during long breaks"
    modeHeading="Website mode"
    modeDescription="Choose whether listed websites are blocked or allowed"
    blacklistDescription="Blocks listed websites"
    whitelistDescription="Only allows listed websites"
    onScheduleChange={requestBrowserConfigurationToggleChange}
    onModeChange={(mode) => doomscrolling.setMode(mode)}
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
      {@render modeWebsiteSection("Whitelist mode", whitelistWebsiteSections)}
    {/if}
  </fieldset>
</div>

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

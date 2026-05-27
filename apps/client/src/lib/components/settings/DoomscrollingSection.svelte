<script lang="ts">
  import { onMount, type Component } from "svelte";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Power from "@lucide/svelte/icons/power";
  import PowerOff from "@lucide/svelte/icons/power-off";
  import Save from "@lucide/svelte/icons/save";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ShieldX from "@lucide/svelte/icons/shield-x";
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
    type DoomscrollingMode,
  } from "$lib/doomscrolling";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";

  const doomscrolling = getDoomscrolling();
  const EXTENSION_STATUS_POLL_MS = 15_000;

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

  interface PendingWebsiteAction {
    type: "disable" | "delete";
    kind: WebsiteListKind;
    host: string;
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
    | { target: "category"; action: PendingCategoryAction }
    | { target: "customStack"; action: PendingCustomStackAction }
    | { target: "customStackDraftHost"; action: PendingCustomStackDraftHostAction };

  type CustomStackDraftField = "name" | "hosts";

  interface CustomCategoryDraft {
    name: string;
    hostInput: string;
    hosts: string[];
  }

  const modeOptions: ReadonlyArray<{
    mode: DoomscrollingMode;
    label: string;
    description: string;
    icon: Component;
  }> = [
    {
      mode: "blacklist",
      label: "Blacklist mode",
      description: "Blocks listed websites",
      icon: ShieldX,
    },
    {
      mode: "whitelist",
      label: "Whitelist mode",
      description: "Only allows listed websites",
      icon: ShieldCheck,
    },
  ];

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

  let websiteDrafts = $state<Record<WebsiteListKind, string>>({
    blocked: "",
    exception: "",
    allowed: "",
  });
  let websiteErrors = $state<Record<WebsiteListKind, string>>({
    blocked: "",
    exception: "",
    allowed: "",
  });
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

  function addWebsite(section: WebsiteListSection): void {
    if (section.add(websiteDrafts[section.kind])) {
      websiteDrafts[section.kind] = "";
      websiteErrors[section.kind] = "";
      return;
    }
    websiteErrors[section.kind] = section.errorText;
  }

  function clearWebsiteError(kind: WebsiteListKind): void {
    websiteErrors[kind] = "";
  }

  function submitAdd(event: SubmitEvent, section: WebsiteListSection): void {
    event.preventDefault();
    addWebsite(section);
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
    if (action.target === "category") return "Disable (Enter)";
    if (action.target === "customStackDraftHost") return "Delete (Enter)";
    return action.action.type === "disable" ? "Disable (Enter)" : "Delete (Enter)";
  }

  function extensionStatusTitle(): string {
    if (extensionStatusError && !extensionStatus) return "Browser extension status unavailable";
    if (extensionStatusLoading && !extensionStatus) return "Checking browser extension";
    return extensionStatusConnected
      ? "Browser extension connected"
      : "Browser extension not connected";
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
        {@render websiteSubsection(section)}
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
        {@render websiteSubsection(section)}
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

{#snippet websiteSubsection(section: WebsiteListSection)}
  <div class="flex flex-col gap-2 px-1 py-1">
    <div class="min-w-0">
      <label for={section.id} class="text-[0.866667rem] text-foreground">{section.heading}</label>
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
        {section.description}
      </div>
    </div>
    <div class="flex flex-col">
      <form
        class="flex min-w-0 items-center gap-2 border-b border-border/70 py-1.5 focus-within:border-ring"
        onsubmit={(event) => submitAdd(event, section)}
      >
        <input
          id={section.id}
          bind:value={websiteDrafts[section.kind]}
          oninput={() => clearWebsiteError(section.kind)}
          type="text"
          spellcheck="false"
          placeholder={section.placeholder}
          class="flex h-7 min-w-0 flex-1 items-center bg-transparent px-1 text-[0.8rem] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!websiteDrafts[section.kind].trim()}
          class="flex h-7 shrink-0 items-center justify-center gap-1.5 px-1 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={13} strokeWidth={2.25} />
          <span>Add</span>
        </button>
      </form>
      {#if websiteErrors[section.kind]}
        <div class="px-1 pt-1.5 text-[0.8rem] text-destructive">{websiteErrors[section.kind]}</div>
      {/if}
      {@render websiteRows(section)}
    </div>
  </div>
{/snippet}

{#snippet websiteRows(section: WebsiteListSection)}
  <div class="flex flex-col">
    {#each section.websites() as website (website.host)}
      <div
        class="flex min-w-0 items-center gap-2 border-b border-border/70 py-1.5"
        role="group"
        aria-label={website.enabled ? website.host : `${website.host} disabled`}
      >
        <span
          class={cn(
            "flex h-7 min-w-0 flex-1 items-center truncate px-1 text-[0.8rem] leading-snug text-foreground",
            !website.enabled && "opacity-50 line-through",
          )}
        >
          {website.host}
        </span>
        <button
          type="button"
          onclick={() => requestHostEnabledChange(section, website.host, !website.enabled)}
          aria-label={website.enabled ? `Disable ${website.host}` : `Enable ${website.host}`}
          data-app-tooltip-disabled="true"
          class="flex h-7 w-24 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 text-[0.8rem] text-foreground hover:bg-accent dark:bg-transparent"
        >
          {#if website.enabled}
            <PowerOff size={13} strokeWidth={2} class="shrink-0" />
            <span>Enabled</span>
          {:else}
            <Power size={13} strokeWidth={2} class="shrink-0" />
            <span>Disabled</span>
          {/if}
        </button>
        <button
          type="button"
          onclick={() => requestHostDelete(section, website.host)}
          aria-label={`Remove ${website.host}`}
          data-app-tooltip-disabled="true"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent dark:bg-transparent"
        >
          <Trash2 size={13} strokeWidth={2} />
        </button>
      </div>
    {:else}
      <div class="flex h-10 items-center border-b border-border/70 px-1 text-[0.8rem] text-muted-foreground">
        {section.emptyText}
      </div>
    {/each}
  </div>
{/snippet}

<div class="flex flex-col gap-6">
  <div
    class={cn(
      "flex min-h-9 items-center rounded-md border bg-background/60 px-3 py-1.5 transition-colors dark:bg-transparent",
      extensionStatusLoading && !extensionStatus
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
        {#if extensionStatusLoading && !extensionStatus}
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
  </div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Browser configuration</h2>
    <div class="flex flex-col gap-3">
      <ToggleSetting
        label="Enable during focus"
        description="Apply website rules while a focus session is running"
        checked={doomscrolling.enabled}
        onChange={(checked) => doomscrolling.setEnabled(checked)}
      />

      <fieldset
        disabled={!doomscrolling.enabled}
        aria-disabled={!doomscrolling.enabled}
        class={cn(
          "m-0 flex min-w-0 flex-col gap-4 border-0 p-0 transition-opacity",
          !doomscrolling.enabled && "opacity-50",
        )}
      >
        <div class="flex flex-col gap-3" aria-label="Blocking schedule">
          <ToggleSetting
            label="Block during short breaks"
            description="Apply website rules during short breaks"
            checked={doomscrolling.blockDuringShortBreaks}
            onChange={(checked) => doomscrolling.setBlockDuringShortBreaks(checked)}
          />
          <ToggleSetting
            label="Block during long breaks"
            description="Apply website rules during long breaks"
            checked={doomscrolling.blockDuringLongBreaks}
            onChange={(checked) => doomscrolling.setBlockDuringLongBreaks(checked)}
          />
        </div>

        <div class="flex flex-col gap-2 px-1">
          <div class="min-w-0">
            <h3 class="text-[0.866667rem] text-foreground">Website mode</h3>
            <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
              Choose whether listed websites are blocked or allowed
            </div>
          </div>
          <div class="grid grid-cols-2 items-start gap-2 max-[560px]:grid-cols-1">
            {#each modeOptions as option}
              {@const Icon = option.icon}
              {@const active = doomscrolling.mode === option.mode}
              <button
                type="button"
                onclick={() => doomscrolling.setMode(option.mode)}
                class={cn(
                  "flex min-h-0 w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left leading-normal disabled:cursor-not-allowed max-[360px]:gap-2 max-[360px]:px-2.5",
                  active
                    ? "border-foreground/25 bg-foreground/5 text-foreground"
                    : "border-border/60 bg-transparent text-muted-foreground opacity-70",
                )}
                aria-pressed={active}
              >
                <Icon size={16} strokeWidth={2} class="mt-0.5 shrink-0" />
                <span class="min-w-0 flex-1">
                  <span class="block text-[0.866667rem] font-medium leading-snug">{option.label}</span>
                  <span class="mt-0.5 block text-[0.8rem] leading-snug text-muted-foreground">{option.description}</span>
                </span>
              </button>
            {/each}
          </div>
        </div>
      </fieldset>
    </div>
  </section>

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

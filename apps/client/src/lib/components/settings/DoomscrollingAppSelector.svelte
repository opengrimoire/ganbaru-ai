<script lang="ts" module>
  export interface DoomscrollingAppSelection {
    name: string;
    matchNames: readonly string[];
  }

  export type DoomscrollingAppSelectorMode = "multi" | "single";
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import {
    listDoomscrollingDesktopApps,
    type DoomscrollingDesktopAppCandidate,
  } from "$lib/api/doomscrolling";
  import { isProtectedDoomscrollingDesktopAppName } from "$lib/doomscrolling";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  let {
    title,
    mode = "multi",
    existingNames,
    protectAppSelf = false,
    onAdd,
    onRemove,
    onSelect,
    onCancel,
  }: {
    title: string;
    mode?: DoomscrollingAppSelectorMode;
    existingNames: readonly string[];
    protectAppSelf?: boolean;
    onAdd?: (app: DoomscrollingAppSelection) => boolean;
    onRemove?: (name: string) => void;
    onSelect?: (app: DoomscrollingAppSelection) => void;
    onCancel: () => void;
  } = $props();

  const { t } = getLocalization();

  let searchInputEl: HTMLInputElement | undefined = $state();
  let query = $state("");
  let apps = $state<DoomscrollingDesktopAppCandidate[]>([]);
  let loading = $state(true);
  let showLoadingState = $state(false);
  let error = $state<string | null>(null);
  let pendingAddApp = $state<DoomscrollingAppSelection | null>(null);
  let pendingRemoveName = $state<string | null>(null);
  const confirmationOpen = $derived(Boolean(pendingAddApp || pendingRemoveName));

  const existingKeys = $derived(new Set(existingNames.map((name) => name.toLowerCase())));
  const existingNameByKey = $derived(
    new Map(existingNames.map((name) => [name.toLowerCase(), name])),
  );
  const filteredApps = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const selectableApps = protectAppSelf
      ? apps.filter((app) => !isProtectedAppCandidate(app))
      : apps;
    const matches = normalizedQuery
      ? selectableApps.filter((app) => app.name.toLowerCase().includes(normalizedQuery))
      : selectableApps;
    return matches.slice(0, 80);
  });

  function isProtectedAppCandidate(app: DoomscrollingDesktopAppCandidate): boolean {
    return (
      isProtectedDoomscrollingDesktopAppName(app.name)
      || app.processNames.some((name) => isProtectedDoomscrollingDesktopAppName(name))
    );
  }

  async function loadApps(): Promise<void> {
    loading = true;
    showLoadingState = false;
    error = null;
    const loadingTimer = setTimeout(() => {
      showLoadingState = true;
    }, 1000);
    try {
      apps = await listDoomscrollingDesktopApps();
    } catch (err) {
      console.warn("Failed to list desktop apps:", err);
      error = t("settings.doomscrolling.appSelector.loadError");
    } finally {
      clearTimeout(loadingTimer);
      loading = false;
      showLoadingState = false;
    }
  }

  function selectionFor(name: string, matchNames: readonly string[] = [name]): DoomscrollingAppSelection | null {
    const trimmed = name.trim();
    if (!trimmed || existingKeys.has(trimmed.toLowerCase())) return null;
    if (protectAppSelf && isProtectedDoomscrollingDesktopAppName(trimmed)) return null;
    return { name: trimmed, matchNames };
  }

  function requestAdd(name: string, matchNames: readonly string[] = [name]): void {
    const selection = selectionFor(name, matchNames);
    if (!selection) return;
    if (mode === "single") {
      onSelect?.(selection);
      return;
    }
    pendingAddApp = selection;
  }

  function confirmAdd(): void {
    if (!pendingAddApp) return;
    onAdd?.(pendingAddApp);
    pendingAddApp = null;
  }

  function cancelAdd(): void {
    pendingAddApp = null;
  }

  function requestRemove(name: string): void {
    const existingName = existingNameByKey.get(name.toLowerCase());
    if (!existingName) return;
    if (mode === "single") return;
    pendingRemoveName = existingName;
  }

  function confirmRemove(): void {
    if (!pendingRemoveName) return;
    onRemove?.(pendingRemoveName);
    pendingRemoveName = null;
  }

  function cancelRemove(): void {
    pendingRemoveName = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (pendingAddApp || pendingRemoveName) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    event.stopPropagation();
  }

  onMount(() => {
    void loadApps();
    void tick().then(() => {
      searchInputEl?.focus();
    });
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-90 flex items-center justify-center px-3 py-4"
  onclick={(event) => {
    event.stopPropagation();
    onCancel();
  }}
>
  <div class="absolute inset-0 bg-black/50"></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative z-10 flex h-[min(36rem,calc(100vh-2rem))] w-full max-w-lg flex-col rounded-md border border-black/20 bg-card text-card-foreground outline-none dark:border-white/10 dark:bg-sidebar dark:text-sidebar-foreground"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <div class="flex min-w-0 items-start justify-between gap-3 px-4 pt-3">
      <div class="min-w-0">
        <h2 class="text-[1rem] font-semibold text-foreground">{title}</h2>
        <p class="mt-0.5 text-[0.8rem] text-muted-foreground">
          {t("settings.doomscrolling.appSelector.systemHidden")}
        </p>
      </div>
      <button
        type="button"
        onclick={onCancel}
        aria-label={t("settings.doomscrolling.appSelector.close")}
        data-app-tooltip-disabled="true"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X size={15} strokeWidth={2} />
      </button>
    </div>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 pt-3">
      <div class="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5 dark:bg-transparent">
        <Search size={14} strokeWidth={2.25} class="shrink-0 text-muted-foreground" />
        <input
          bind:this={searchInputEl}
          bind:value={query}
          type="text"
          spellcheck="false"
          placeholder={t("settings.doomscrolling.appSelector.search")}
          class="h-7 min-w-0 flex-1 bg-transparent text-[0.866667rem] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onclick={loadApps}
          disabled={loading}
          aria-label={t("settings.doomscrolling.appSelector.refresh")}
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {#if loading}
            <LoaderCircle size={14} strokeWidth={2.25} class="animate-spin" />
          {:else}
            <RefreshCw size={14} strokeWidth={2.25} />
          {/if}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
        {#if loading && showLoadingState}
          <div class="flex h-full min-h-36 items-center justify-center gap-2 text-[0.866667rem] text-muted-foreground">
            <LoaderCircle size={15} strokeWidth={2.25} class="animate-spin" />
            <span>{t("settings.doomscrolling.appSelector.loading")}</span>
          </div>
        {:else if loading}
          <div class="h-full min-h-36" aria-busy="true"></div>
        {:else if error}
          <div class="flex h-full min-h-36 items-center justify-center px-4 text-center text-[0.866667rem] text-muted-foreground">
            {error}
          </div>
        {:else if filteredApps.length === 0}
          <div class="flex h-full min-h-36 items-center justify-center px-4 text-center text-[0.866667rem] text-muted-foreground">
            {t("settings.doomscrolling.appSelector.empty")}
          </div>
        {:else}
          <div class="flex flex-col">
            {#each filteredApps as app (app.name.toLowerCase())}
              {@const alreadyAdded = mode === "single"
                ? existingKeys.has(app.name.toLowerCase()) || app.processNames.some((name) => existingKeys.has(name.toLowerCase()))
                : existingKeys.has(app.name.toLowerCase())}
              <button
                type="button"
                onclick={() => alreadyAdded ? requestRemove(app.name) : requestAdd(app.name, app.processNames)}
                class={[
                  "flex min-w-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-2 text-left last:border-b-0",
                  !confirmationOpen && (!alreadyAdded || mode === "multi") && "hover:bg-accent",
                  alreadyAdded && mode === "single" && "cursor-not-allowed opacity-60",
                ]}
                disabled={alreadyAdded && mode === "single"}
              >
                <span class="min-w-0 truncate text-[0.866667rem] text-foreground">{app.name}</span>
                <span class="shrink-0 text-[0.8rem] text-muted-foreground">
                  {#if alreadyAdded}
                    {mode === "single"
                      ? t("settings.doomscrolling.appSelector.used")
                      : t("settings.doomscrolling.appSelector.remove")}
                  {:else}
                    {mode === "single"
                      ? t("settings.doomscrolling.appSelector.choose")
                      : t("settings.doomscrolling.appSelector.add")}
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

{#if pendingAddApp}
  <ConfirmDialog
    title={t("settings.doomscrolling.appSelector.blockTitle", pendingAddApp.name)}
    message={t("settings.doomscrolling.appSelector.blockMessage")}
    confirmLabel={t("settings.doomscrolling.appSelector.blockShortcut")}
    cancelLabel={t("settings.doomscrolling.shared.cancelShortcut")}
    onConfirm={confirmAdd}
    onCancel={cancelAdd}
  />
{/if}

{#if pendingRemoveName}
  <ConfirmDialog
    title={t("settings.doomscrolling.desktop.removeAppTitle", pendingRemoveName)}
    message={t("settings.doomscrolling.desktop.removeMessage")}
    confirmLabel={t("settings.doomscrolling.shared.removeShortcut")}
    cancelLabel={t("settings.doomscrolling.shared.cancelShortcut")}
    onConfirm={confirmRemove}
    onCancel={cancelRemove}
  />
{/if}

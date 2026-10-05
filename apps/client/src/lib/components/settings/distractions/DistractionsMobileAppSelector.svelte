<script lang="ts" module>
  export interface DistractionsMobileAppSelection {
    name: string;
    packageName: string;
  }
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    listMobileDistractionsApps,
    type MobileDistractionsAppCandidate,
  } from "$lib/scheduling/mobile-distractions";

  let {
    title,
    existingPackages,
    single = false,
    onAdd,
    onRemove,
    onSelect,
    onCancel,
  }: {
    title: string;
    existingPackages: readonly string[];
    single?: boolean;
    onAdd?: (app: DistractionsMobileAppSelection) => boolean;
    onRemove?: (packageName: string) => void;
    onSelect?: (app: DistractionsMobileAppSelection) => void;
    onCancel: () => void;
  } = $props();

  const { t } = getLocalization();
  let searchInputEl: HTMLInputElement | undefined = $state();
  let query = $state("");
  let apps = $state<MobileDistractionsAppCandidate[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let pending = $state<DistractionsMobileAppSelection | null>(null);
  const existingKeys = $derived(new Set(existingPackages.map((value) => value.toLowerCase())));
  const filteredApps = $derived.by(() => {
    const normalized = query.trim().toLowerCase();
    return apps.filter((app) => (
      !normalized
      || app.name.toLowerCase().includes(normalized)
      || app.packageName.toLowerCase().includes(normalized)
    )).slice(0, 100);
  });

  async function loadApps(): Promise<void> {
    loading = true;
    error = false;
    try {
      apps = await listMobileDistractionsApps();
    } catch (loadError) {
      console.warn("Failed to list Android apps", loadError);
      error = true;
    } finally {
      loading = false;
    }
  }

  function choose(app: MobileDistractionsAppCandidate): void {
    if (existingKeys.has(app.packageName.toLowerCase())) {
      if (!single) onRemove?.(app.packageName);
      return;
    }
    const selection = { name: app.name, packageName: app.packageName };
    if (single) {
      onSelect?.(selection);
    } else {
      pending = selection;
    }
  }

  function confirmAdd(): void {
    if (!pending) return;
    onAdd?.(pending);
    pending = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || pending) return;
    event.preventDefault();
    onCancel();
  }

  onMount(() => {
    void loadApps();
    void tick().then(() => searchInputEl?.focus());
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-90 flex items-center justify-center px-3 py-4" onclick={onCancel}>
  <div class="absolute inset-0 bg-black/50"></div>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative z-10 flex h-[min(36rem,calc(100vh-2rem))] w-full max-w-lg flex-col rounded-md border border-black/20 bg-card text-card-foreground outline-none dark:border-white/10 dark:bg-sidebar dark:text-sidebar-foreground"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
  >
    <div class="flex min-w-0 items-start justify-between gap-3 px-4 pt-3">
      <div class="min-w-0">
        <h2 class="text-[1rem] font-semibold text-foreground">{title}</h2>
        <p class="mt-0.5 text-[0.8rem] text-muted-foreground">
          {t("settings.distractions.appSelector.systemHidden")}
        </p>
      </div>
      <button type="button" onclick={onCancel} aria-label={t("settings.distractions.appSelector.close")} class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
        <X size={15} strokeWidth={2} />
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 pt-3">
      <div class="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5 dark:bg-transparent">
        <Search size={14} class="shrink-0 text-muted-foreground" />
        <input bind:this={searchInputEl} bind:value={query} placeholder={t("settings.distractions.appSelector.search")} class="h-7 min-w-0 flex-1 bg-transparent text-[0.866667rem] text-foreground outline-none placeholder:text-muted-foreground" />
        <button type="button" onclick={loadApps} disabled={loading} aria-label={t("settings.distractions.appSelector.refresh")} class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
          {#if loading}<LoaderCircle size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
        {#if loading}
          <div class="flex min-h-36 items-center justify-center gap-2 text-[0.866667rem] text-muted-foreground"><LoaderCircle size={15} class="animate-spin" />{t("settings.distractions.appSelector.loading")}</div>
        {:else if error}
          <div class="flex min-h-36 items-center justify-center px-4 text-center text-[0.866667rem] text-muted-foreground">{t("settings.distractions.appSelector.loadError")}</div>
        {:else if filteredApps.length === 0}
          <div class="flex min-h-36 items-center justify-center px-4 text-center text-[0.866667rem] text-muted-foreground">{t("settings.distractions.appSelector.empty")}</div>
        {:else}
          {#each filteredApps as app (app.packageName)}
            {@const added = existingKeys.has(app.packageName.toLowerCase())}
            <button type="button" onclick={() => choose(app)} disabled={single && added} class="flex w-full min-w-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-2 text-left last:border-b-0 hover:bg-accent disabled:opacity-60">
              <span class="min-w-0">
                <span class="block truncate text-[0.866667rem] text-foreground">{app.name}</span>
                <span class="block truncate text-[0.7rem] text-muted-foreground">{app.packageName}</span>
              </span>
              <span class="shrink-0 text-[0.8rem] text-muted-foreground">{added ? t("settings.distractions.appSelector.used") : single ? t("settings.distractions.appSelector.choose") : t("settings.distractions.appSelector.add")}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

{#if pending}
  <ConfirmDialog
    title={t("settings.distractions.appSelector.blockTitle", pending.name)}
    message={t("settings.distractions.appSelector.blockMessage")}
    confirmLabel={t("settings.distractions.appSelector.blockAction")}
    cancelLabel={t("settings.distractions.shared.cancelAction")}
    onConfirm={confirmAdd}
    onCancel={() => { pending = null; }}
  />
{/if}

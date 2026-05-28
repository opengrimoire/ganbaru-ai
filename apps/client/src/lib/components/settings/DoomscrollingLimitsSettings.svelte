<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Power from "@lucide/svelte/icons/power";
  import PowerOff from "@lucide/svelte/icons/power-off";
  import Save from "@lucide/svelte/icons/save";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    DOOMSCROLLING_CATEGORY_DEFINITIONS,
    doomscrollingLimitSourceKey,
    getDoomscrollingCategoryDefinition,
    isProtectedDoomscrollingDesktopAppName,
    normalizeDoomscrollingAppName,
    normalizeDoomscrollingHost,
    type DoomscrollingCategoryId,
    type DoomscrollingLimitSource,
    type DoomscrollingUsageLimit,
    type DoomscrollingUsageLimitKind,
  } from "$lib/doomscrolling";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import { getDoomscrollingUsage } from "$lib/stores/doomscrolling-usage.svelte";
  import { cn } from "$lib/utils";

  type SourceType = "website" | "desktop-app" | "category" | "custom-stack";

  interface PendingLimitAction {
    type: "disable" | "delete" | "global-disable";
    limitId: string | null;
  }

  const doomscrolling = getDoomscrolling();
  const usage = getDoomscrollingUsage();

  let editorOpen = $state(false);
  let editingId = $state<string | null>(null);
  let draftName = $state("");
  let draftKind = $state<DoomscrollingUsageLimitKind>("individual");
  let draftMinutes = $state(30);
  let draftSources = $state<DoomscrollingLimitSource[]>([]);
  let sourceType = $state<SourceType>("website");
  let sourceText = $state("");
  let sourceCategoryId = $state<DoomscrollingCategoryId>(
    DOOMSCROLLING_CATEGORY_DEFINITIONS[0]?.id ?? "social-media",
  );
  let sourceCustomStackId = $state("");
  let formError = $state("");
  let sourceError = $state("");
  let pendingAction = $state<PendingLimitAction | null>(null);

  const desktopAvailabilityMessage = $derived(
    usage.foregroundStatus.available
      ? null
      : usage.foregroundStatus.reason
        ?? "Desktop foreground tracking is unavailable. Desktop app limits will not count or close apps on this system.",
  );

  function limitsByKind(kind: DoomscrollingUsageLimitKind): readonly DoomscrollingUsageLimit[] {
    return doomscrolling.usageLimits.filter((limit) => limit.kind === kind);
  }

  function formatMinutes(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function totalUsedSeconds(limitId: string): number {
    return usage.totalFor(limitId)?.usedSeconds ?? 0;
  }

  function progressPercent(limit: DoomscrollingUsageLimit): number {
    const used = totalUsedSeconds(limit.id);
    const total = limit.minutesPerDay * 60;
    return Math.min(100, Math.round((used / total) * 100));
  }

  function sourceLabel(source: DoomscrollingLimitSource): string {
    if (source.type === "website") return source.host;
    if (source.type === "desktop-app") return source.name;
    if (source.type === "category") {
      return getDoomscrollingCategoryDefinition(source.id)?.label ?? source.id;
    }
    if (source.type === "custom-stack") {
      return doomscrolling.customCategoryStacks.find((stack) => stack.id === source.id)?.name
        ?? source.id;
    }
    return source.name;
  }

  function sourceTypeLabel(source: DoomscrollingLimitSource): string {
    if (source.type === "website") return "Website";
    if (source.type === "desktop-app") return "Desktop";
    if (source.type === "category") return "Category";
    if (source.type === "custom-stack") return "Custom";
    return "Mobile";
  }

  function resetEditor(): void {
    editingId = null;
    draftName = "";
    draftKind = "individual";
    draftMinutes = 30;
    draftSources = [];
    sourceType = "website";
    sourceText = "";
    sourceCustomStackId = doomscrolling.customCategoryStacks[0]?.id ?? "";
    sourceCategoryId = DOOMSCROLLING_CATEGORY_DEFINITIONS[0]?.id ?? "social-media";
    formError = "";
    sourceError = "";
  }

  function openNewEditor(kind: DoomscrollingUsageLimitKind): void {
    resetEditor();
    draftKind = kind;
    editorOpen = true;
  }

  function openEditEditor(limit: DoomscrollingUsageLimit): void {
    editingId = limit.id;
    draftName = limit.name;
    draftKind = limit.kind;
    draftMinutes = limit.minutesPerDay;
    draftSources = limit.sources.map((source) => ({ ...source }));
    sourceType = "website";
    sourceText = "";
    sourceCustomStackId = doomscrolling.customCategoryStacks[0]?.id ?? "";
    sourceCategoryId = DOOMSCROLLING_CATEGORY_DEFINITIONS[0]?.id ?? "social-media";
    formError = "";
    sourceError = "";
    editorOpen = true;
  }

  function closeEditor(): void {
    resetEditor();
    editorOpen = false;
  }

  function addSource(source: DoomscrollingLimitSource): boolean {
    const key = doomscrollingLimitSourceKey(source);
    if (draftSources.some((existing) => doomscrollingLimitSourceKey(existing) === key)) {
      sourceError = "Source is already linked";
      return false;
    }
    draftSources = [...draftSources, source];
    sourceError = "";
    sourceText = "";
    return true;
  }

  function addDraftSource(): void {
    if (sourceType === "website") {
      const host = normalizeDoomscrollingHost(sourceText);
      if (!host) {
        sourceError = "Enter a valid domain. Example: youtube.com";
        return;
      }
      addSource({ type: "website", host });
      return;
    }
    if (sourceType === "desktop-app") {
      const name = normalizeDoomscrollingAppName(sourceText);
      if (!name) {
        sourceError = "Enter an app name. Example: Steam";
        return;
      }
      if (isProtectedDoomscrollingDesktopAppName(name)) {
        sourceError = "Protected apps cannot be tracked";
        return;
      }
      addSource({ type: "desktop-app", name, matchNames: [name] });
      return;
    }
    if (sourceType === "category") {
      addSource({ type: "category", id: sourceCategoryId });
      return;
    }
    if (!sourceCustomStackId) {
      sourceError = "Create a custom browser category first";
      return;
    }
    addSource({ type: "custom-stack", id: sourceCustomStackId });
  }

  function removeDraftSource(source: DoomscrollingLimitSource): void {
    const key = doomscrollingLimitSourceKey(source);
    draftSources = draftSources.filter((item) => doomscrollingLimitSourceKey(item) !== key);
  }

  function saveLimit(): void {
    formError = "";
    const draft = {
      name: draftName,
      kind: draftKind,
      minutesPerDay: draftMinutes,
      sources: draftSources,
    };
    const result = editingId
      ? doomscrolling.updateUsageLimit(editingId, draft)
      : doomscrolling.addUsageLimit(draft);
    if (result === "saved") {
      closeEditor();
      void usage.refresh();
      return;
    }
    const messages = {
      "invalid-name": "Enter a limit name",
      "invalid-minutes": "Enter a daily limit from 1 to 1440 minutes",
      "invalid-sources": "Add at least one source",
      "duplicate-source": "Remove duplicate sources",
      "protected-source": "Protected apps cannot be tracked",
      missing: "Limit no longer exists",
    } satisfies Record<Exclude<typeof result, "saved">, string>;
    formError = messages[result];
  }

  function requestLimitEnabledChange(limit: DoomscrollingUsageLimit, enabled: boolean): void {
    if (enabled) {
      doomscrolling.setUsageLimitEnabled(limit.id, true);
      void usage.refresh();
      return;
    }
    pendingAction = { type: "disable", limitId: limit.id };
  }

  function requestLimitDelete(limit: DoomscrollingUsageLimit): void {
    pendingAction = { type: "delete", limitId: limit.id };
  }

  function requestGlobalEnabledChange(enabled: boolean): void {
    if (enabled) {
      doomscrolling.setLimitsEnabled(true);
      void usage.refresh();
      return;
    }
    pendingAction = { type: "global-disable", limitId: null };
  }

  function confirmPendingAction(): void {
    if (!pendingAction) return;
    if (pendingAction.type === "global-disable") {
      doomscrolling.setLimitsEnabled(false);
    } else if (pendingAction.limitId) {
      if (pendingAction.type === "disable") {
        doomscrolling.setUsageLimitEnabled(pendingAction.limitId, false);
      } else {
        doomscrolling.removeUsageLimit(pendingAction.limitId);
        if (editingId === pendingAction.limitId) closeEditor();
      }
    }
    pendingAction = null;
    void usage.refresh();
  }

  function cancelPendingAction(): void {
    pendingAction = null;
  }

  function pendingTitle(action: PendingLimitAction): string {
    if (action.type === "global-disable") return "Turn off usage limits?";
    const limit = doomscrolling.usageLimits.find((item) => item.id === action.limitId);
    const name = limit?.name ?? "this limit";
    return action.type === "disable" ? `Disable ${name}?` : `Delete ${name}?`;
  }

  function pendingMessage(action: PendingLimitAction): string {
    if (action.type === "global-disable") {
      return "Daily usage limits will stop blocking websites and closing apps until you enable them again";
    }
    return action.type === "disable"
      ? "It will stay in the list but will not block when exhausted until you enable it again"
      : "This cannot be undone";
  }

  function pendingConfirmLabel(action: PendingLimitAction): string {
    if (action.type === "global-disable") return "Turn off (Enter)";
    return action.type === "disable" ? "Disable (Enter)" : "Delete (Enter)";
  }
</script>

{#snippet limitList(title: string, kind: DoomscrollingUsageLimitKind)}
  {@const limits = limitsByKind(kind)}
  <section class="flex flex-col gap-3">
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
      <h2 class="text-[0.866667rem] font-semibold text-foreground">{title}</h2>
      <button
        type="button"
        onclick={() => openNewEditor(kind)}
        class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
      >
        <Plus size={13} strokeWidth={2.25} />
        <span>Add</span>
      </button>
    </div>

    <div class="flex flex-col gap-2">
      {#each limits as limit (limit.id)}
        {@const used = totalUsedSeconds(limit.id)}
        <article
          class={cn(
            "flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3 dark:bg-transparent",
            !limit.enabled && "opacity-55",
          )}
        >
          <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class={cn("truncate text-[0.866667rem] font-semibold text-foreground", !limit.enabled && "line-through")}>
                {limit.name}
              </h3>
              <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
                {formatMinutes(used)} used of {limit.minutesPerDay}m today
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onclick={() => requestLimitEnabledChange(limit, !limit.enabled)}
                aria-label={limit.enabled ? `Disable ${limit.name}` : `Enable ${limit.name}`}
                class="flex h-7 w-24 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground hover:bg-accent"
              >
                {#if limit.enabled}
                  <PowerOff size={13} strokeWidth={2} />
                  <span>Enabled</span>
                {:else}
                  <Power size={13} strokeWidth={2} />
                  <span>Disabled</span>
                {/if}
              </button>
              <button
                type="button"
                onclick={() => openEditEditor(limit)}
                disabled={!limit.enabled}
                aria-label={`Edit ${limit.name}`}
                class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pencil size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onclick={() => requestLimitDelete(limit)}
                aria-label={`Delete ${limit.name}`}
                class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-accent"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          </div>

          <div class="h-2 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary"
              style={`width: ${progressPercent(limit)}%`}
            ></div>
          </div>

          <div class="flex min-w-0 flex-wrap gap-1.5">
            {#each limit.sources as source (doomscrollingLimitSourceKey(source))}
              <span class="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[0.733333rem] text-muted-foreground">
                <span class="shrink-0 text-muted-foreground/70">{sourceTypeLabel(source)}</span>
                <span class="truncate text-foreground">{sourceLabel(source)}</span>
              </span>
            {/each}
          </div>
        </article>
      {:else}
        <div class="flex h-10 items-center rounded-md border border-border px-3 text-[0.8rem] text-muted-foreground">
          No {kind} limits yet
        </div>
      {/each}
    </div>
  </section>
{/snippet}

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-3">
    <button
      type="button"
      onclick={() => requestGlobalEnabledChange(!doomscrolling.limitsEnabled)}
      aria-pressed={doomscrolling.limitsEnabled}
      class="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left text-foreground dark:bg-transparent"
    >
      <span class="min-w-0">
        <span class="block truncate text-[0.866667rem] font-semibold">Daily usage limits</span>
        <span class="mt-0.5 block text-[0.8rem] text-muted-foreground">
          Applies whenever GanbaruAI is running
        </span>
      </span>
      <span class="flex h-7 w-24 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 text-[0.8rem]">
        {doomscrolling.limitsEnabled ? "Enabled" : "Disabled"}
      </span>
    </button>

    {#if desktopAvailabilityMessage}
      <div class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-muted-foreground dark:bg-transparent">
        <CircleAlert size={14} strokeWidth={2.25} class="shrink-0" />
        <div class="min-w-0 text-[0.8rem]">{desktopAvailabilityMessage}</div>
      </div>
    {/if}

    <div class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-muted-foreground dark:bg-transparent">
      <CircleAlert size={14} strokeWidth={2.25} class="shrink-0" />
      <div class="min-w-0 text-[0.8rem]">Mobile app limits are visible as pending and are not configurable yet.</div>
    </div>
  </section>

  <fieldset
    disabled={!doomscrolling.limitsEnabled}
    aria-disabled={!doomscrolling.limitsEnabled}
    class={cn(
      "m-0 flex min-w-0 flex-col gap-6 border-0 p-0 transition-opacity",
      !doomscrolling.limitsEnabled && "opacity-50",
    )}
  >
    {@render limitList("Individual limits", "individual")}
    {@render limitList("Group limits", "group")}
  </fieldset>
</div>

{#if editorOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-3 backdrop-blur-sm">
    <section
      class="flex max-h-[min(34rem,calc(100vh-1.5rem))] w-full max-w-xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl dark:bg-background"
      aria-label={editingId ? "Edit usage limit" : "Add usage limit"}
    >
      <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 class="truncate text-[0.933333rem] font-semibold text-foreground">
          {editingId ? "Edit limit" : "Add limit"}
        </h2>
        <button
          type="button"
          onclick={closeEditor}
          aria-label="Close editor"
          class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4">
        <div class="grid gap-3 min-[520px]:grid-cols-[minmax(0,1fr)_7rem_8rem]">
          <label class="grid min-w-0 gap-1 text-[0.8rem] text-muted-foreground">
            <span>Name</span>
            <input
              bind:value={draftName}
              oninput={() => {
                formError = "";
              }}
              class="h-8 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus:border-ring"
            />
          </label>
          <label class="grid min-w-0 gap-1 text-[0.8rem] text-muted-foreground">
            <span>Minutes</span>
            <input
              bind:value={draftMinutes}
              type="number"
              min="1"
              max="1440"
              class="h-8 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus:border-ring"
            />
          </label>
          <label class="grid min-w-0 gap-1 text-[0.8rem] text-muted-foreground">
            <span>Type</span>
            <select
              bind:value={draftKind}
              class="h-8 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus:border-ring"
            >
              <option value="individual">Individual</option>
              <option value="group">Group</option>
            </select>
          </label>
        </div>

        <div class="grid gap-2">
          <div class="text-[0.8rem] font-medium text-foreground">Sources</div>
          <div class="flex min-w-0 flex-wrap items-end gap-2">
            <label class="grid min-w-32 gap-1 text-[0.8rem] text-muted-foreground">
              <span>Source</span>
              <select
                bind:value={sourceType}
                class="h-8 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus:border-ring"
              >
                <option value="website">Website</option>
                <option value="desktop-app">Desktop app</option>
                <option value="category">Built-in category</option>
                <option value="custom-stack">Custom category</option>
                <option disabled>Mobile app (pending)</option>
              </select>
            </label>

            {#if sourceType === "website" || sourceType === "desktop-app"}
              <label class="grid min-w-40 flex-1 gap-1 text-[0.8rem] text-muted-foreground">
                <span>{sourceType === "website" ? "Domain" : "App name"}</span>
                <input
                  bind:value={sourceText}
                  oninput={() => {
                    sourceError = "";
                  }}
                  class="h-8 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus:border-ring"
                  placeholder={sourceType === "website" ? "youtube.com" : "Steam"}
                />
              </label>
            {:else if sourceType === "category"}
              <label class="grid min-w-40 flex-1 gap-1 text-[0.8rem] text-muted-foreground">
                <span>Category</span>
                <select
                  bind:value={sourceCategoryId}
                  class="h-8 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus:border-ring"
                >
                  {#each DOOMSCROLLING_CATEGORY_DEFINITIONS as category (category.id)}
                    <option value={category.id}>{category.label}</option>
                  {/each}
                </select>
              </label>
            {:else}
              <label class="grid min-w-40 flex-1 gap-1 text-[0.8rem] text-muted-foreground">
                <span>Custom category</span>
                <select
                  bind:value={sourceCustomStackId}
                  class="h-8 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus:border-ring"
                >
                  {#each doomscrolling.customCategoryStacks as stack (stack.id)}
                    <option value={stack.id}>{stack.name}</option>
                  {/each}
                </select>
              </label>
            {/if}

            <button
              type="button"
              onclick={addDraftSource}
              class="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-accent"
            >
              <Plus size={13} strokeWidth={2.25} />
              <span>Add source</span>
            </button>
          </div>
          {#if sourceError}
            <div class="text-[0.8rem] text-destructive">{sourceError}</div>
          {/if}

          <div class="flex min-w-0 flex-wrap gap-1.5">
            {#each draftSources as source (doomscrollingLimitSourceKey(source))}
              <button
                type="button"
                onclick={() => removeDraftSource(source)}
                class="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[0.733333rem] text-foreground hover:bg-accent"
              >
                <span class="shrink-0 text-muted-foreground">{sourceTypeLabel(source)}</span>
                <span class="truncate">{sourceLabel(source)}</span>
                <X size={11} strokeWidth={2} class="shrink-0" />
              </button>
            {:else}
              <div class="flex h-9 items-center text-[0.8rem] text-muted-foreground">No sources linked yet</div>
            {/each}
          </div>
        </div>

        {#if formError}
          <div class="text-[0.8rem] text-destructive">{formError}</div>
        {/if}
      </div>

      <div class="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onclick={closeEditor}
          class="flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-[0.8rem] text-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={saveLimit}
          class="flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Save size={13} strokeWidth={2.25} />
          <span>Save</span>
        </button>
      </div>
    </section>
  </div>
{/if}

{#if pendingAction}
  <ConfirmDialog
    title={pendingTitle(pendingAction)}
    message={pendingMessage(pendingAction)}
    confirmLabel={pendingConfirmLabel(pendingAction)}
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmPendingAction}
    onCancel={cancelPendingAction}
  />
{/if}

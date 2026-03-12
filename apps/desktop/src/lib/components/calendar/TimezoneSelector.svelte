<script lang="ts">
  import {
    getTimezoneAbbr,
    getTimezoneOffset,
    formatTimezoneName,
    searchTimezones,
  } from "./utils";
  import X from "@lucide/svelte/icons/x";

  let {
    timezones,
    tzCount = 1,
    onAdd,
    onRemove,
  }: {
    timezones: string[];
    tzCount?: number;
    onAdd: (tz: string) => void;
    onRemove: (index: number) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let inputEl: HTMLInputElement | undefined = $state();

  const filtered = $derived.by(() => {
    if (!query.trim()) return [];
    return searchTimezones(query, timezones);
  });

  function handleAdd(tz: string) {
    onAdd(tz);
    query = "";
    if (timezones.length >= 2) {
      open = false;
    }
  }

  function handleToggle() {
    open = !open;
    if (open) {
      query = "";
      requestAnimationFrame(() => inputEl?.focus());
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      open = false;
    }
  }
</script>

<!-- Uses subgrid from parent so each tz label sits in the same column as its hour ticks -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative grid cursor-pointer self-stretch rounded text-[11px] font-bold leading-tight transition-colors hover:bg-accent"
  style="color: var(--cal-time-label); grid-column: span {tzCount}; grid-template-columns: subgrid;"
  onclick={handleToggle}
  role="button"
  tabindex="0"
  title="Manage timezones"
>
  {#each timezones as tz, i}
    <span
      class="flex items-center justify-center"
      style=""
    >
      {getTimezoneAbbr(tz)}
    </span>
  {/each}

  <!-- Popover -->
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-40" onclick={(e: MouseEvent) => { e.stopPropagation(); open = false; }}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card p-3 shadow-xl"
      style="font-weight: normal;"
      onkeydown={handleKeydown}
    >
      <p class="mb-2 text-xs font-semibold text-foreground">Timezones</p>

      <!-- Current timezones -->
      <div class="mb-2 flex flex-col gap-1">
        {#each timezones as tz, i}
          <div class="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs">
            <div class="min-w-0">
              <span class="font-medium text-foreground">{getTimezoneAbbr(tz)}</span>
              <span class="ml-1 text-muted-foreground">{getTimezoneOffset(tz)}</span>
              {#if i === 0}
                <span class="ml-1 text-muted-foreground">(device)</span>
              {/if}
            </div>
            {#if i > 0}
              <button
                onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove(i); }}
                class="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Add timezone -->
      {#if timezones.length < 3}
        <input
          bind:this={inputEl}
          type="text"
          bind:value={query}
          placeholder="Search city, country, or timezone..."
          class="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          onclick={(e: MouseEvent) => e.stopPropagation()}
          onkeydown={handleKeydown}
        />

        {#if filtered.length > 0}
          <div class="mt-1 max-h-40 overflow-y-auto rounded border border-border">
            {#each filtered as tz}
              <button
                class="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                onclick={(e: MouseEvent) => { e.stopPropagation(); handleAdd(tz); }}
              >
                <span class="truncate text-foreground">
                  {formatTimezoneName(tz)}
                </span>
                <span class="ml-2 shrink-0 text-muted-foreground">
                  {getTimezoneAbbr(tz)}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="text-[10px] text-muted-foreground">Maximum 3 timezones</p>
      {/if}
    </div>
  {/if}
</div>

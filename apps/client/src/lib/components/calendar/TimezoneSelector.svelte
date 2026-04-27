<script lang="ts">
  import {
    getTimezoneAbbr,
    getTimezoneOffset,
    getTimezoneLongName,
    getTimezoneCity,
    getTimezoneRegion,
    formatColumnHeaderAbbr,
    searchTimezones,
  } from "./utils";
  import { portal } from "$lib/utils/portal";
  import X from "@lucide/svelte/icons/x";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";

  let {
    timezones,
    tzCount = 1,
    onAdd,
    onRemove,
    onReorder,
  }: {
    timezones: string[];
    tzCount?: number;
    onAdd: (tz: string) => void;
    onRemove: (index: number) => void;
    onReorder?: (from: number, to: number) => void;
  } = $props();

  // Width is fixed; height caps the scrollable result list. Both feed into
  // the viewport-aware position math so the popover never spills off-screen.
  const POPOVER_WIDTH = 360;
  const POPOVER_HEIGHT = 480;
  const VIEWPORT_MARGIN = 8;

  let open = $state(false);
  let triggerEl: HTMLDivElement | undefined = $state();
  let popoverEl: HTMLDivElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let popoverPos = $state({ top: 0, left: 0 });
  let query = $state("");
  let highlightIndex = $state(0);

  const filtered = $derived(searchTimezones(query, timezones));

  // Reset highlight whenever the query changes so the first row is selected.
  $effect(() => {
    void query;
    highlightIndex = 0;
  });

  function computePosition() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = rect.left;
    if (left + POPOVER_WIDTH + VIEWPORT_MARGIN > viewportWidth) {
      left = Math.max(
        VIEWPORT_MARGIN,
        viewportWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
      );
    }
    let top = rect.bottom + 6;
    if (top + POPOVER_HEIGHT + VIEWPORT_MARGIN > viewportHeight) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_HEIGHT - 6);
    }
    popoverPos = { top, left };
  }

  function toggleOpen() {
    if (open) {
      open = false;
      return;
    }
    query = "";
    highlightIndex = 0;
    computePosition();
    open = true;
    requestAnimationFrame(() => inputEl?.focus());
  }

  function close() {
    open = false;
  }

  function handleAdd(tz: string) {
    const willHitMax = timezones.length + 1 >= 3;
    onAdd(tz);
    query = "";
    highlightIndex = 0;
    if (willHitMax) {
      close();
    } else {
      requestAnimationFrame(() => inputEl?.focus());
    }
  }

  function scrollHighlightIntoView() {
    if (!listEl) return;
    const item = listEl.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }

  // Capture-phase keydown so we intercept arrow keys before CalendarView's
  // window-level navigation handler runs them through `navigate(...)`.
  $effect(() => {
    if (!open) return;
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length > 0) {
          highlightIndex = Math.min(filtered.length - 1, highlightIndex + 1);
          scrollHighlightIntoView();
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length > 0) {
          highlightIndex = Math.max(0, highlightIndex - 1);
          scrollHighlightIntoView();
        }
        return;
      }
      if (e.key === "Enter") {
        const candidate = filtered[highlightIndex];
        if (candidate) {
          e.preventDefault();
          e.stopPropagation();
          handleAdd(candidate);
        }
      }
    }
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  });

  $effect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerEl?.contains(target)) return;
      if (popoverEl?.contains(target)) return;
      close();
    }
    function handleScroll(e: Event) {
      // Don't close on scrolls inside the popover's own result list.
      const target = e.target as Node | null;
      if (target && popoverEl?.contains(target)) return;
      close();
    }
    function handleResize() {
      computePosition();
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  });
</script>

<!-- Trigger: subgrid keeps each label aligned under its column's hour ticks. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={triggerEl}
  class="relative grid cursor-pointer self-stretch rounded text-[13px] transition-colors hover:bg-accent"
  style="color: var(--foreground); grid-column: span {tzCount}; grid-template-columns: subgrid;"
  onclick={toggleOpen}
  role="button"
  tabindex="0"
>
  {#each timezones as tz}
    <span class="flex items-center justify-center">
      {formatColumnHeaderAbbr(tz)}
    </span>
  {/each}
</div>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={popoverEl}
    use:portal
    class="tz-popover fixed z-[80] flex flex-col rounded-lg border border-border bg-card text-card-foreground shadow-xl"
    style="top: {popoverPos.top}px; left: {popoverPos.left}px; width: {POPOVER_WIDTH}px; max-height: {POPOVER_HEIGHT}px; --foreground: var(--card-foreground);"
    onwheel={(e) => e.stopPropagation()}
  >
    <div class="px-3 pt-3 pb-1">
      <p class="text-xs font-semibold text-foreground">Timezones</p>
    </div>

    <!-- Active timezones -->
    <div class="flex flex-col gap-0.5 px-3">
      {#each timezones as tz, i}
        <div class="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs">
          <div class="min-w-0 flex-1 truncate">
            <span class="font-medium text-foreground">{getTimezoneAbbr(tz)}</span>
            <span class="ml-1 text-muted-foreground">{getTimezoneOffset(tz)}</span>
            {#if i === 0}
              <span class="ml-1 text-muted-foreground">(device)</span>
            {/if}
          </div>
          {#if i > 0}
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onclick={(e: MouseEvent) => { e.stopPropagation(); onReorder?.(i, i - 1); }}
                disabled={i === 1}
                class="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                title="Move up"
                aria-label="Move up"
              >
                <ChevronUp size={12} />
              </button>
              <button
                type="button"
                onclick={(e: MouseEvent) => { e.stopPropagation(); onReorder?.(i, i + 1); }}
                disabled={i === timezones.length - 1}
                class="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                title="Move down"
                aria-label="Move down"
              >
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove(i); }}
                class="text-muted-foreground hover:text-foreground"
                title="Remove"
                aria-label="Remove"
              >
                <X size={12} />
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Add timezone -->
    {#if timezones.length < 3}
      <div class="px-3 pt-2">
        <input
          bind:this={inputEl}
          type="text"
          bind:value={query}
          placeholder="Search timezones, cities, or regions..."
          class="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          onclick={(e: MouseEvent) => e.stopPropagation()}
        />
      </div>

      <div
        bind:this={listEl}
        class="tz-results mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {#if filtered.length === 0}
          <p class="px-2 py-3 text-center text-[11px] text-muted-foreground">
            No matches.
          </p>
        {:else}
          {#each filtered as tz, idx}
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors {idx === highlightIndex ? 'bg-accent' : 'hover:bg-accent'}"
              onmouseenter={() => { highlightIndex = idx; }}
              onclick={(e: MouseEvent) => { e.stopPropagation(); handleAdd(tz); }}
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-foreground">
                  <span class="text-muted-foreground">({getTimezoneOffset(tz) || "GMT"})</span>
                  <span class="ml-1">{getTimezoneLongName(tz)}</span>
                </div>
                <div class="truncate text-[10.5px] text-muted-foreground">
                  {getTimezoneCity(tz)}{#if getTimezoneRegion(tz)}, {getTimezoneRegion(tz)}{/if}
                </div>
              </div>
              <span class="ml-2 shrink-0 text-[11px] font-medium text-muted-foreground">
                {formatColumnHeaderAbbr(tz)}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    {:else}
      <p class="px-3 pt-1 pb-3 text-[10px] text-muted-foreground">Maximum 3 timezones</p>
    {/if}
  </div>
{/if}

<style>
  .tz-results {
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .tz-results::-webkit-scrollbar {
    width: 8px;
  }
  .tz-results::-webkit-scrollbar-track {
    background: transparent;
  }
  .tz-results::-webkit-scrollbar-thumb {
    background-color: var(--border);
    border-radius: 4px;
  }
  .tz-results::-webkit-scrollbar-thumb:hover {
    background-color: var(--accent);
  }
</style>

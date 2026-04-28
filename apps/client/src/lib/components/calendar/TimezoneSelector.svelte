<script lang="ts">
  import { onMount } from "svelte";
  import {
    getLocalTimezone,
    getTimezoneInfo,
    prewarmTimezoneSearch,
    searchTimezones,
  } from "./utils";
  import type { TimezoneAbbrMode } from "./utils";
  import { portal } from "$lib/utils/portal";
  import X from "@lucide/svelte/icons/x";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";

  /**
   * Maximum number of timezones (including the device tz) the calendar can
   * show side by side. Beyond this the trigger gets crowded and the
   * popover hides the search.
   */
  const MAX_TIMEZONES = 5;

  const ABBR_MODE_OPTIONS: { mode: TimezoneAbbrMode; label: string }[] = [
    { mode: "acronym", label: "Acronym" },
    { mode: "utc", label: "UTC only" },
    { mode: "utc-fallback", label: "UTC fallback" },
  ];

  function triggerLabel(info: ReturnType<typeof getTimezoneInfo>): string {
    if (abbrMode === "acronym") return info.acronym;
    if (abbrMode === "utc") return info.numericOffset;
    return info.columnAbbr;
  }

  let {
    timezones,
    tzCount = 1,
    abbrMode = "acronym" as TimezoneAbbrMode,
    onAdd,
    onRemove,
    onReorder,
    onAbbrModeChange,
  }: {
    timezones: string[];
    tzCount?: number;
    abbrMode?: TimezoneAbbrMode;
    onAdd: (tz: string) => void;
    onRemove: (index: number) => void;
    onReorder?: (from: number, to: number) => void;
    onAbbrModeChange?: (mode: TimezoneAbbrMode) => void;
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

  // Custom scrollbar metrics. We hide the native scrollbar on `.tz-results`
  // and render a thumb sibling that overlays the right edge of the list.
  let scrollTop = $state(0);
  let scrollHeight = $state(0);
  let clientHeight = $state(0);
  let trackEl: HTMLDivElement | undefined = $state();
  let isDraggingThumb = $state(false);
  const MIN_THUMB_HEIGHT = 24;
  const thumbHeight = $derived(
    scrollHeight > clientHeight && clientHeight > 0
      ? Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * clientHeight)
      : 0,
  );
  const maxScrollTop = $derived(Math.max(0, scrollHeight - clientHeight));
  const thumbTop = $derived(
    maxScrollTop > 0
      ? (scrollTop / maxScrollTop) * (clientHeight - thumbHeight)
      : 0,
  );
  const showScrollbar = $derived(thumbHeight > 0);

  // Drag-and-drop reorder state. `dragFromIndex` is the row that started the
  // drag; `dragOverIndex` is the row currently under the pointer for the
  // insertion-line indicator. Both reset on dragend / drop.
  let dragFromIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  const localTz = getLocalTimezone();

  const filtered = $derived(searchTimezones(query, timezones));

  // Reset highlight whenever the query changes so the first row is selected.
  $effect(() => {
    void query;
    highlightIndex = 0;
  });

  // Pre-bake metadata for every filtered IANA zone shortly after mount so
  // the first popover open is instant. Without this, the first search
  // walks ~400 zones through Intl.DateTimeFormat synchronously.
  onMount(() => {
    type IdleScheduler = (cb: () => void) => void;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
    };
    const schedule: IdleScheduler = w.requestIdleCallback
      ? (cb) => {
          w.requestIdleCallback?.(cb);
        }
      : (cb) => {
          setTimeout(cb, 0);
        };
    schedule(() => prewarmTimezoneSearch());
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
    // Defensive: search excludes active tzs so this should be unreachable,
    // but a stale highlight or rapid-fire Enter could re-add otherwise.
    if (timezones.includes(tz)) return;
    const willHitMax = timezones.length + 1 >= MAX_TIMEZONES;
    onAdd(tz);
    query = "";
    highlightIndex = 0;
    if (willHitMax) {
      close();
    } else {
      requestAnimationFrame(() => inputEl?.focus());
    }
  }

  function syncScrollMetrics() {
    if (!listEl) return;
    scrollTop = listEl.scrollTop;
    scrollHeight = listEl.scrollHeight;
    clientHeight = listEl.clientHeight;
  }

  function handleScrollbarPointerDown(e: PointerEvent) {
    if (!listEl || !trackEl) return;
    e.preventDefault();
    e.stopPropagation();
    const trackRect = trackEl.getBoundingClientRect();
    const localMaxScroll = maxScrollTop;
    const trackAvail = trackRect.height - thumbHeight;
    if (trackAvail <= 0 || localMaxScroll <= 0) return;

    // Click on the thumb: drag from current scroll position. Click on
    // empty track: jump the thumb's center to the click point and drag
    // from there. Both paths share the same move handler below.
    const clickY = e.clientY - trackRect.top;
    const onThumb = clickY >= thumbTop && clickY <= thumbTop + thumbHeight;
    if (!onThumb) {
      const desiredThumbTop = Math.max(
        0,
        Math.min(trackAvail, clickY - thumbHeight / 2),
      );
      listEl.scrollTop = (desiredThumbTop / trackAvail) * localMaxScroll;
    }
    const anchorScrollTop = listEl.scrollTop;
    const anchorClientY = e.clientY;
    isDraggingThumb = true;
    // Lock body selection while dragging so accidental pointer movement
    // over text in the result list doesn't initiate a selection.
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    function onMove(ev: PointerEvent) {
      if (!listEl) return;
      const dy = ev.clientY - anchorClientY;
      listEl.scrollTop = anchorScrollTop + (dy / trackAvail) * localMaxScroll;
    }
    function onUp() {
      isDraggingThumb = false;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleRowDragStart(e: DragEvent, i: number) {
    if (!e.dataTransfer) return;
    dragFromIndex = i;
    e.dataTransfer.effectAllowed = "move";
    // Firefox needs setData or the drag never starts.
    e.dataTransfer.setData("text/plain", String(i));
  }

  function handleRowDragOver(e: DragEvent, i: number) {
    if (dragFromIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverIndex = i;
  }

  function handleRowDrop(e: DragEvent, i: number) {
    if (dragFromIndex === null) return;
    e.preventDefault();
    if (dragFromIndex !== i) onReorder?.(dragFromIndex, i);
    dragFromIndex = null;
    dragOverIndex = null;
  }

  function handleRowDragEnd() {
    dragFromIndex = null;
    dragOverIndex = null;
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

  // Track the result list's scroll metrics for the custom scrollbar thumb.
  // We refresh on scroll, on the list resizing, and whenever the filtered
  // set changes (rows added/removed alter scrollHeight).
  $effect(() => {
    if (!open || !listEl) return;
    syncScrollMetrics();
    const el = listEl;
    const onScroll = () => {
      scrollTop = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(syncScrollMetrics);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  });

  $effect(() => {
    void filtered;
    if (open && listEl) requestAnimationFrame(syncScrollMetrics);
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
    {@const info = getTimezoneInfo(tz)}
    <span class="flex items-center justify-center">
      {triggerLabel(info)}
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
    <div class="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
      <p class="text-xs font-semibold text-foreground">Timezones</p>
      <div
        class="flex items-center gap-0.5 rounded border border-border bg-background p-0.5 text-[10px]"
        role="group"
        aria-label="Timezone label format"
      >
        {#each ABBR_MODE_OPTIONS as opt (opt.mode)}
          {@const isActive = abbrMode === opt.mode}
          <button
            type="button"
            class="rounded px-1.5 py-0.5 transition-colors {isActive
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            aria-pressed={isActive}
            onclick={(e: MouseEvent) => {
              e.stopPropagation();
              onAbbrModeChange?.(opt.mode);
            }}
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Active timezones -->
    <div class="flex flex-col gap-0.5 px-3">
      {#each timezones as tz, i (tz)}
        {@const info = getTimezoneInfo(tz)}
        {@const isDevice = tz === localTz}
        {@const isDragging = dragFromIndex === i}
        {@const isDragTarget = dragOverIndex === i && dragFromIndex !== null && dragFromIndex !== i}
        <!-- Whole row is the drag source. Chevrons and X are draggable=false
             so mousedown on them doesn't start a drag. -->
        <div
          class="group flex cursor-grab items-center justify-between gap-2 rounded px-1 py-1 text-xs transition-colors active:cursor-grabbing {isDragTarget ? 'bg-accent' : ''} {isDragging ? 'opacity-40' : ''}"
          draggable="true"
          ondragstart={(e: DragEvent) => handleRowDragStart(e, i)}
          ondragover={(e: DragEvent) => handleRowDragOver(e, i)}
          ondragleave={() => { if (dragOverIndex === i) dragOverIndex = null; }}
          ondrop={(e: DragEvent) => handleRowDrop(e, i)}
          ondragend={handleRowDragEnd}
          role="listitem"
        >
          <span
            class="flex shrink-0 items-center text-muted-foreground"
            aria-hidden="true"
          >
            <GripVertical size={12} />
          </span>
          <div class="min-w-0 flex-1 truncate">
            <span class="inline-block w-[72px] font-medium tabular-nums text-foreground">{info.offsetUtc}</span>
            <span class="ml-1 text-foreground">{info.longName}</span>
            {#if isDevice}
              <span class="ml-1 text-muted-foreground">(device)</span>
            {/if}
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              draggable="false"
              onclick={(e: MouseEvent) => { e.stopPropagation(); onReorder?.(i, i - 1); }}
              disabled={i === 0}
              class="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              title="Move up"
              aria-label="Move up"
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              draggable="false"
              onclick={(e: MouseEvent) => { e.stopPropagation(); onReorder?.(i, i + 1); }}
              disabled={i === timezones.length - 1}
              class="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              title="Move down"
              aria-label="Move down"
            >
              <ChevronDown size={12} />
            </button>
            {#if !isDevice}
              <button
                type="button"
                draggable="false"
                onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove(i); }}
                class="text-muted-foreground hover:text-foreground"
                title="Remove"
                aria-label="Remove"
              >
                <X size={12} />
              </button>
            {:else}
              <span class="w-3"></span>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- Add timezone -->
    {#if timezones.length < MAX_TIMEZONES}
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

      <div class="relative mt-2 flex min-h-0 flex-1 flex-col">
        <div
          bind:this={listEl}
          class="tz-results min-h-0 flex-1 overflow-y-auto px-2 pb-3 pr-3"
        >
          {#if filtered.length === 0}
            <p class="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No matches.
            </p>
          {:else}
            {#each filtered as tz, idx}
              {@const info = getTimezoneInfo(tz)}
              <button
                type="button"
                class="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors {idx === highlightIndex ? 'bg-accent' : 'hover:bg-accent'}"
                onmouseenter={() => { highlightIndex = idx; }}
                onclick={(e: MouseEvent) => { e.stopPropagation(); handleAdd(tz); }}
              >
                <div class="truncate text-foreground">
                  <span class="inline-block w-[72px] font-medium tabular-nums">{info.offsetUtc}</span>
                  <span class="ml-1">{info.longName}</span>
                </div>
                <div class="truncate text-[10.5px] text-muted-foreground">
                  {info.city}{#if info.region}, {info.region}{/if}
                </div>
              </button>
            {/each}
          {/if}
        </div>
        <div
          bind:this={trackEl}
          class="tz-scrollbar-track absolute right-0.5 top-0 bottom-0 w-1.5 select-none"
          onpointerdown={handleScrollbarPointerDown}
          aria-hidden="true"
        >
          {#if showScrollbar}
            <div
              class="tz-scrollbar-thumb pointer-events-none absolute left-0 right-0 rounded-full {isDraggingThumb ? 'is-dragging' : ''}"
              style="top: {thumbTop}px; height: {thumbHeight}px;"
            ></div>
          {/if}
        </div>
      </div>
    {:else}
      <p class="px-3 pt-1 pb-3 text-[10px] text-muted-foreground">Maximum {MAX_TIMEZONES} timezones</p>
    {/if}
  </div>
{/if}

<style>
  /* Native scrollbar hidden in favor of `.tz-scrollbar-thumb` overlay. */
  .tz-results {
    scrollbar-width: none;
  }
  .tz-results::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
  .tz-scrollbar-thumb {
    background-color: var(--border);
    transition: background-color 120ms ease-out;
  }
  .tz-scrollbar-thumb:hover,
  .tz-scrollbar-thumb.is-dragging {
    background-color: var(--accent);
  }
</style>

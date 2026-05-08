<script lang="ts">
  import { onMount } from "svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import ThemeEditor from "./ThemeEditor.svelte";

  let { onBackToList }: { onBackToList: () => void } = $props();

  const themeStore = getTheme();
  const themeEditor = getThemeEditor();

  const editing = $derived(
    themeEditor.editingId
      ? themeStore.registry[themeEditor.editingId]
      : undefined,
  );

  const isBuiltin = $derived(
    themeEditor.editingId
      ? themeStore.isBuiltin(themeEditor.editingId)
      : false,
  );

  const canResetToSeed = $derived(
    editing?.kind === "user"
      ? themeStore.canResetThemeToSeed(editing.id)
      : false,
  );

  // Width matches the old in-modal content area plus a small bump so rows
  // breathe the same on both layouts; height is capped well below the
  // viewport so the app underneath stays scannable.
  const PANEL_WIDTH = 700;
  const PANEL_MAX_HEIGHT_PX = 640;
  const PANEL_MAX_HEIGHT_VH = 80;
  const PANEL_MARGIN = 16;

  function initialLeft(): number {
    if (typeof window === "undefined") return 100;
    return Math.max(PANEL_MARGIN, (window.innerWidth - PANEL_WIDTH) / 2);
  }

  function initialTop(): number {
    if (typeof window === "undefined") return 80;
    const viewportCap = (window.innerHeight * PANEL_MAX_HEIGHT_VH) / 100;
    const panelHeight = Math.min(PANEL_MAX_HEIGHT_PX, viewportCap);
    return Math.max(PANEL_MARGIN, (window.innerHeight - panelHeight) / 2);
  }

  let posX = $state(initialLeft());
  let posY = $state(initialTop());
  let dragging = $state(false);
  let collapsed = $state(false);
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function clampX(x: number): number {
    if (typeof window === "undefined") return x;
    const maxX = window.innerWidth - PANEL_WIDTH - PANEL_MARGIN;
    return Math.min(Math.max(PANEL_MARGIN, x), Math.max(PANEL_MARGIN, maxX));
  }

  function clampY(y: number): number {
    if (typeof window === "undefined") return y;
    // Keep at least the draggable header row visible so the panel can always be
    // grabbed and moved back on screen.
    const minVisible = 48;
    const maxY = window.innerHeight - minVisible;
    return Math.min(Math.max(PANEL_MARGIN, y), Math.max(PANEL_MARGIN, maxY));
  }

  function onHeaderPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // Do not steal drags from buttons inside the header row.
    const target = e.target as HTMLElement | null;
    if (target && target.closest("button")) return;
    dragging = true;
    dragOffsetX = e.clientX - posX;
    dragOffsetY = e.clientY - posY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onHeaderPointerMove(e: PointerEvent) {
    if (!dragging) return;
    posX = clampX(e.clientX - dragOffsetX);
    posY = clampY(e.clientY - dragOffsetY);
  }

  function onHeaderPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  // Keep the panel on-screen if the user resizes the window mid-edit.
  onMount(() => {
    function onResize() {
      posX = clampX(posX);
      posY = clampY(posY);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  function toggleCollapsed() {
    collapsed = !collapsed;
  }

  // Cancel rolls the session back to its pre-edit state and returns to the
  // Settings list. Save keeps the edits as the committed state. Both close
  // the panel through the same callback into TitleBar.
  async function onCancel() {
    await themeEditor.cancel();
    onBackToList();
  }

  async function onCommit() {
    await themeEditor.commit();
    onBackToList();
  }

  function onResetAllToSeed() {
    if (editing?.kind !== "user") return;
    if (!canResetToSeed) return;
    themeStore.resetThemeToSeed(editing.id);
  }
</script>

{#if editing}
  <div
    class="fixed z-[75] flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl dark:bg-background"
    style="left: {posX}px; top: {posY}px; width: {PANEL_WIDTH}px; height: {collapsed
      ? 'auto'
      : `min(${PANEL_MAX_HEIGHT_VH}vh, ${PANEL_MAX_HEIGHT_PX}px)`}; max-height: min({PANEL_MAX_HEIGHT_VH}vh, {PANEL_MAX_HEIGHT_PX}px);"
    role="dialog"
    aria-label="Theme editor"
  >
    <!-- Draggable header -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class={cn(
        "flex shrink-0 items-center gap-2 border-b border-border bg-sidebar px-5 py-2",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      onpointerdown={onHeaderPointerDown}
      onpointermove={onHeaderPointerMove}
      onpointerup={onHeaderPointerUp}
      onpointercancel={onHeaderPointerUp}
    >
      <div class="min-w-0 flex-1" aria-hidden="true"></div>
      <button
        type="button"
        onclick={toggleCollapsed}
        aria-label={collapsed ? "Expand editor" : "Collapse editor"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse"}
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {#if collapsed}
          <ChevronDown size={13} strokeWidth={2} />
        {:else}
          <ChevronUp size={13} strokeWidth={2} />
        {/if}
      </button>
    </header>

    <!-- Scrollable body (hidden while collapsed) -->
    {#if !collapsed}
      <div class="min-h-0 flex-1 bg-background/40 dark:bg-black/20">
        <ThemeEditor theme={editing} />
      </div>
    {/if}

    <!-- Sticky footer -->
    <footer
      class="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-sidebar px-5 py-2"
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={onCancel}
          class="flex items-center gap-1.5 rounded-md border border-destructive bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
        >
          <ArrowLeft size={11} strokeWidth={2.25} />
          <span>Cancel</span>
        </button>
        {#if editing.kind === "user"}
          <button
            type="button"
            onclick={onResetAllToSeed}
            aria-disabled={!canResetToSeed}
            aria-label="Reset every source, override, palette slot, and icon tag to its clone-time value"
            title={canResetToSeed
              ? "Restore every value to the clone-time snapshot"
              : "Nothing has changed since this theme was cloned"}
            class={cn(
              "flex items-center gap-1.5 rounded-md border border-destructive bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground transition-colors",
              canResetToSeed
                ? "hover:bg-destructive/90"
                : "cursor-not-allowed",
            )}
          >
            <RotateCcw size={11} strokeWidth={2.25} />
            <span>Reset all to seed</span>
          </button>
        {/if}
      </div>
      <button
        type="button"
        onclick={onCommit}
        class="flex items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Check size={11} strokeWidth={2.25} />
        <span>{isBuiltin ? "Apply and return" : "Save and apply"}</span>
      </button>
    </footer>
  </div>
{/if}

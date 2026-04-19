<script lang="ts">
  import { onMount } from "svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Check from "@lucide/svelte/icons/check";
  import GripHorizontal from "@lucide/svelte/icons/grip-horizontal";
  import X from "@lucide/svelte/icons/x";
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

  const isActive = $derived(
    themeEditor.editingId !== undefined &&
      themeStore.id === themeEditor.editingId,
  );

  const PANEL_WIDTH = 620;
  const PANEL_MARGIN = 16;

  // Seed the initial position so the panel opens near the top-right of the
  // viewport instead of covering the center. Users can drag it anywhere
  // from there.
  function initialLeft(): number {
    if (typeof window === "undefined") return 100;
    return Math.max(
      PANEL_MARGIN,
      window.innerWidth - PANEL_WIDTH - PANEL_MARGIN,
    );
  }

  function initialTop(): number {
    if (typeof window === "undefined") return 80;
    return 80;
  }

  let posX = $state(initialLeft());
  let posY = $state(initialTop());
  let dragging = $state(false);
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function clampX(x: number): number {
    if (typeof window === "undefined") return x;
    const maxX = window.innerWidth - PANEL_WIDTH - PANEL_MARGIN;
    return Math.min(Math.max(PANEL_MARGIN, x), Math.max(PANEL_MARGIN, maxX));
  }

  function clampY(y: number): number {
    if (typeof window === "undefined") return y;
    // Keep at least the drag handle row visible so the panel can always be
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

  function close() {
    themeEditor.close();
  }

  function applyTheme() {
    if (!themeEditor.editingId) return;
    themeStore.setTheme(themeEditor.editingId);
  }
</script>

{#if editing}
  <div
    class="fixed z-[75] flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl dark:bg-background"
    style="left: {posX}px; top: {posY}px; width: {PANEL_WIDTH}px; max-height: calc(100vh - 32px);"
    role="dialog"
    aria-label="Theme editor"
  >
    <!-- Drag handle -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class={cn(
        "flex shrink-0 items-center gap-2 border-b border-border bg-background/60 px-3 py-2 dark:bg-black/30",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      onpointerdown={onHeaderPointerDown}
      onpointermove={onHeaderPointerMove}
      onpointerup={onHeaderPointerUp}
      onpointercancel={onHeaderPointerUp}
    >
      <GripHorizontal
        size={14}
        strokeWidth={2}
        class="shrink-0 text-muted-foreground"
      />
      <span class="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
        Editing: {editing.displayName}
      </span>
      <button
        type="button"
        onclick={close}
        aria-label="Close theme editor"
        title="Close (edits stay saved)"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X size={13} strokeWidth={2} />
      </button>
    </header>

    <!-- Scrollable body -->
    <div class="flex-1 overflow-y-auto bg-background/40 px-5 py-4 dark:bg-black/20">
      <ThemeEditor theme={editing} />
    </div>

    <!-- Sticky footer -->
    <footer
      class="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background/60 px-3 py-2 dark:bg-black/30"
    >
      <button
        type="button"
        onclick={onBackToList}
        class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
      >
        <ArrowLeft size={11} strokeWidth={2.25} />
        <span>Back to themes</span>
      </button>
      <button
        type="button"
        onclick={applyTheme}
        disabled={isActive}
        class={cn(
          "flex items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] font-medium transition-colors",
          isActive
            ? "cursor-not-allowed border-border bg-card text-muted-foreground opacity-60 dark:bg-transparent"
            : "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        <Check size={11} strokeWidth={2.25} />
        <span>{isActive ? "Applied" : "Apply theme"}</span>
      </button>
    </footer>
  </div>
{/if}

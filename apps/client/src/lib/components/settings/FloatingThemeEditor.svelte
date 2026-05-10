<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import {
    THEME_EDITOR_EDGE_MARGIN,
    clampPanelRect,
    pickThemeEditorGeometry,
  } from "$lib/utils/responsive";
  import ThemeEditor from "./ThemeEditor.svelte";

  let { onBackToList }: { onBackToList: () => void } = $props();

  const themeStore = getTheme();
  const themeEditor = getThemeEditor();
  const viewport = getViewport();

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

  const editorGeometry = $derived(
    pickThemeEditorGeometry({
      viewport: { width: viewport.width, height: viewport.height },
    }),
  );

  let posX = $state(0);
  let posY = $state(0);
  let positionInitialized = $state(false);
  let dragging = $state(false);
  let collapsed = $state(false);
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function clampFloatingPosition(x: number, y: number): { x: number; y: number } {
    const clamped = clampPanelRect(
      {
        x,
        y,
        width: editorGeometry.rect.width,
        height: editorGeometry.rect.height,
      },
      { width: viewport.width, height: viewport.height },
      THEME_EDITOR_EDGE_MARGIN,
    );
    return { x: clamped.x, y: clamped.y };
  }

  function onHeaderPointerDown(e: PointerEvent) {
    if (!editorGeometry.canDrag) return;
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
    const next = clampFloatingPosition(
      e.clientX - dragOffsetX,
      e.clientY - dragOffsetY,
    );
    posX = next.x;
    posY = next.y;
  }

  function onHeaderPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  $effect(() => {
    const geometry = editorGeometry;
    if (!geometry.canDrag) {
      dragging = false;
      posX = geometry.rect.x;
      posY = geometry.rect.y;
      positionInitialized = true;
      return;
    }
    if (!positionInitialized) {
      posX = geometry.rect.x;
      posY = geometry.rect.y;
      positionInitialized = true;
      return;
    }
    const next = clampFloatingPosition(posX, posY);
    posX = next.x;
    posY = next.y;
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

  const panelStyle = $derived.by(() => {
    const geometry = editorGeometry;
    const height = collapsed ? "auto" : `${geometry.rect.height}px`;
    const maxHeight = `${geometry.rect.height}px`;
    const x = geometry.canDrag ? posX : geometry.rect.x;

    if (!geometry.canDrag && collapsed) {
      const bottom = geometry.layout === "fullscreen" ? 0 : THEME_EDITOR_EDGE_MARGIN;
      return [
        `left: ${x}px`,
        `bottom: ${bottom}px`,
        `width: ${geometry.rect.width}px`,
        "height: auto",
        `max-height: ${maxHeight}`,
      ].join("; ");
    }

    const y = geometry.canDrag ? posY : geometry.rect.y;
    return [
      `left: ${x}px`,
      `top: ${y}px`,
      `width: ${geometry.rect.width}px`,
      `height: ${height}`,
      `max-height: ${maxHeight}`,
    ].join("; ");
  });
</script>

{#if editing}
  <div
    class={cn(
      "fixed z-[75] flex flex-col overflow-hidden border border-border bg-card shadow-2xl dark:bg-background",
      editorGeometry.layout === "fullscreen"
        ? "rounded-none border-x-0 border-b-0"
        : "rounded-lg",
    )}
    style={panelStyle}
    data-theme-editor-layout={editorGeometry.layout}
    data-theme-editor-density={editorGeometry.density}
    data-app-shortcuts="ignore"
    role="dialog"
    aria-label="Theme editor"
  >
    <!-- Draggable header -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class={cn(
        "flex shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 py-2",
        editorGeometry.canDrag
          ? dragging
            ? "cursor-grabbing"
            : "cursor-grab"
          : "cursor-not-allowed",
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
        class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
      class="theme-editor-footer flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-sidebar px-3 py-2"
    >
      <div class="flex min-w-0 items-center gap-2">
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
              "theme-editor-reset-all flex items-center gap-1.5 rounded-md border border-destructive bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground transition-colors",
              canResetToSeed
                ? "hover:bg-destructive/90"
                : "cursor-not-allowed",
            )}
          >
            <RotateCcw size={11} strokeWidth={2.25} />
            <span class="theme-editor-optional-label">Reset all to seed</span>
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

<style>
  [data-theme-editor-density="micro"] .theme-editor-footer {
    gap: 0.375rem;
    padding-inline: 0.5rem;
  }

  [data-theme-editor-density="micro"] .theme-editor-footer button {
    min-height: 2rem;
  }

  [data-theme-editor-density="micro"] .theme-editor-reset-all {
    min-width: 2rem;
    width: 2rem;
    justify-content: center;
    padding-inline: 0;
  }

  [data-theme-editor-density="micro"] .theme-editor-optional-label {
    display: none;
  }
</style>

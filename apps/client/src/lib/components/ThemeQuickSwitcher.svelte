<script lang="ts">
  import { onMount, tick } from "svelte";
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import X from "@lucide/svelte/icons/x";
  import { getTheme } from "$lib/stores/theme.svelte";
  import type { ThemeId } from "$lib/stores/themes";
  import ThemeMiniPreview from "$lib/components/settings/ThemeMiniPreview.svelte";
  import { cn } from "$lib/utils";

  let { onClose }: { onClose: () => void } = $props();

  const themeStore = getTheme();
  const originalId = themeStore.id;

  let selectedId = $state<ThemeId>(themeStore.id);
  let committed = false;
  let optionEls: HTMLButtonElement[] = $state([]);

  const orderedThemes = $derived.by(() => {
    const all = Object.values(themeStore.registry);
    return [
      ...all.filter((t) => themeStore.isBuiltin(t.id)),
      ...all.filter((t) => !themeStore.isBuiltin(t.id)),
    ];
  });
  const selectedIndex = $derived(
    orderedThemes.findIndex((theme) => theme.id === selectedId),
  );

  async function focusIndex(index: number): Promise<void> {
    await tick();
    optionEls[index]?.focus();
    optionEls[index]?.scrollIntoView({ block: "nearest" });
  }

  function previewTheme(id: ThemeId): void {
    selectedId = id;
    themeStore.setTheme(id);
  }

  function moveSelection(delta: number): void {
    if (orderedThemes.length === 0) return;
    const current = selectedIndex >= 0 ? selectedIndex : 0;
    const next = (current + delta + orderedThemes.length) % orderedThemes.length;
    previewTheme(orderedThemes[next].id);
    void focusIndex(next);
  }

  function jumpSelection(index: number): void {
    const theme = orderedThemes[index];
    if (!theme) return;
    previewTheme(theme.id);
    void focusIndex(index);
  }

  function commitSelection(id: ThemeId = selectedId): void {
    committed = true;
    themeStore.setTheme(id);
    onClose();
  }

  function cancelSelection(): void {
    if (!committed) themeStore.setTheme(originalId);
    onClose();
  }

  function handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      jumpSelection(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      jumpSelection(orderedThemes.length - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commitSelection();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelSelection();
    }
  }

  onMount(() => {
    void focusIndex(Math.max(0, selectedIndex));
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-70 flex items-start justify-center px-2 pt-[calc(var(--titlebar-h)+1.25rem)]"
  onclick={(e) => {
    e.stopPropagation();
    cancelSelection();
  }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Theme picker"
    tabindex="-1"
    class="flex max-h-[min(26rem,calc(100dvh-var(--titlebar-h)-2.5rem))] w-[min(26rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl"
    onclick={(e) => e.stopPropagation()}
  >
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
      <h2 class="truncate text-[0.866667rem] font-medium text-foreground">Theme</h2>
      <button
        type="button"
        onclick={cancelSelection}
        aria-label="Close theme picker"
        data-app-tooltip-disabled="true"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </header>

    <div role="listbox" aria-label="Themes" class="min-h-0 flex-1 overflow-y-auto p-1">
      {#each orderedThemes as item, index (item.id)}
        {@const BaseIcon = item.iconLabel === "dark" ? Moon : Sun}
        {@const selected = item.id === selectedId}
        <button
          bind:this={optionEls[index]}
          type="button"
          role="option"
          aria-selected={selected}
          onclick={() => commitSelection(item.id)}
          onpointerenter={() => previewTheme(item.id)}
          class={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left focus:outline-none focus:ring-1 focus:ring-ring",
            selected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
          )}
        >
          <BaseIcon
            size={14}
            strokeWidth={1.75}
            class="shrink-0 text-muted-foreground"
          />
          <span class="min-w-0 flex-1 truncate text-[0.866667rem]">
            {item.displayName}
          </span>
          <ThemeMiniPreview theme={item} />
        </button>
      {/each}
    </div>
  </div>
</div>

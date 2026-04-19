<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Eye from "@lucide/svelte/icons/eye";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import { cn } from "$lib/utils";
  import type { Theme } from "$lib/stores/themes";

  let {
    theme,
    isActive,
    isBuiltin,
    onApply,
    onOpen,
    onDuplicate,
    onDelete,
  }: {
    theme: Theme;
    isActive: boolean;
    isBuiltin: boolean;
    onApply: () => void;
    onOpen: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
  } = $props();

  // Indices into the eventPalette array for the row's preview swatches.
  // Picked across the spectrum so the strip reads as a quick visual summary.
  const PREVIEW_INDICES: readonly number[] = [2, 4, 7, 12, 14, 16, 20, 22];

  const BaseIcon = $derived(theme.base === "dark" ? Moon : Sun);
</script>

<div
  class={cn(
    "flex items-center justify-between gap-4 px-4 py-3 transition-colors",
    isActive ? "bg-accent/50" : "hover:bg-accent/30",
  )}
>
  <button
    type="button"
    onclick={onApply}
    class="flex min-w-0 flex-1 items-center gap-3 text-left"
    disabled={isActive}
    aria-label={isActive ? `${theme.displayName} is active` : `Apply ${theme.displayName}`}
  >
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2 text-[13px] text-foreground">
        <BaseIcon
          size={13}
          strokeWidth={1.75}
          class="shrink-0 text-muted-foreground"
        />
        <span class="truncate">{theme.displayName}</span>
        {#if isActive}
          <Check size={13} strokeWidth={2.5} class="shrink-0 text-foreground" />
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-1">
      {#each PREVIEW_INDICES as index}
        <span
          class="h-3.5 w-3.5 rounded-full"
          style="background-color: {theme.eventPalette[index]};"
        ></span>
      {/each}
    </div>
  </button>

  <div class="flex shrink-0 items-center gap-1">
    <button
      type="button"
      onclick={onDuplicate}
      title="Duplicate"
      aria-label="Duplicate theme"
      class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent dark:bg-transparent"
    >
      <Copy size={13} strokeWidth={2} />
    </button>
    <button
      type="button"
      onclick={onOpen}
      title={isBuiltin ? "View" : "Edit"}
      aria-label={isBuiltin ? "View theme" : "Edit theme"}
      class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent dark:bg-transparent"
    >
      {#if isBuiltin}
        <Eye size={13} strokeWidth={2} />
      {:else}
        <Pencil size={13} strokeWidth={2} />
      {/if}
    </button>
    {#if !isBuiltin}
      <button
        type="button"
        onclick={onDelete}
        title="Delete"
        aria-label="Delete theme"
        class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-destructive transition-colors hover:bg-destructive/10 dark:bg-transparent"
      >
        <Trash2 size={13} strokeWidth={2} />
      </button>
    {/if}
  </div>
</div>

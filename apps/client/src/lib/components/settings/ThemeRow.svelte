<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Eye from "@lucide/svelte/icons/eye";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import { cn } from "$lib/utils";
  import {
    resolveAppTokens,
    resolveCalendarTokens,
    type Theme,
  } from "$lib/stores/themes";

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

  // Sampled palette indices for the gradient strip inside the preview.
  // Picked across the spectrum so the strip reads as a quick visual summary
  // of the palette without needing all 24 swatches.
  const PREVIEW_INDICES: readonly number[] = [2, 5, 8, 11, 14, 17, 20, 23];

  const BaseIcon = $derived(theme.iconLabel === "dark" ? Moon : Sun);
  const appTokens = $derived(resolveAppTokens(theme));
  const calTokens = $derived(resolveCalendarTokens(theme));

  const previewGradient = $derived(
    `linear-gradient(to right, ${PREVIEW_INDICES.map(
      (i) => theme.eventPalette[i],
    ).join(", ")})`,
  );
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
    <div
      class="flex shrink-0 flex-col gap-0.5 rounded-md p-1 ring-1 ring-black/10 dark:ring-white/10"
      style="background: {appTokens['--background']}; width: 96px;"
      aria-hidden="true"
      title="App, card, text, primary, calendar, palette"
    >
      <div
        class="flex h-3 items-center gap-1 rounded-sm px-1"
        style="background: {appTokens['--card']};"
      >
        <span
          class="flex-1 truncate text-[8px] font-bold leading-none"
          style="color: {appTokens['--foreground']};"
        >
          Aa
        </span>
        <span
          class="h-1.5 w-1.5 shrink-0 rounded-full"
          style="background: {appTokens['--primary']};"
        ></span>
      </div>
      <div
        class="h-2 w-full rounded-sm"
        style="background-color: {calTokens['--cal-bg']}; background-image: {previewGradient};"
      ></div>
    </div>
  </button>

  <div class="flex shrink-0 items-center gap-1">
    <button
      type="button"
      onclick={onDuplicate}
      title="Duplicate and edit"
      aria-label="Duplicate and edit theme"
      class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
    >
      <Copy size={13} strokeWidth={2} />
      <span>Duplicate and edit</span>
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
    <button
      type="button"
      onclick={onDelete}
      title={isBuiltin ? "Built-in themes can't be deleted" : "Delete"}
      aria-label="Delete theme"
      disabled={isBuiltin}
      class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card dark:bg-transparent dark:disabled:hover:bg-transparent"
    >
      <Trash2 size={13} strokeWidth={2} />
    </button>
  </div>
</div>

<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Shapes from "@lucide/svelte/icons/shapes";
  import type {
    ProjectLucideCategory,
    ProjectLucideIconEntry,
  } from "$lib/projects/icons/lucide-catalog.generated";
  import { cn } from "$lib/utils";
  import { portal } from "$lib/utils/portal";
  import LucideNodeIcon from "./LucideNodeIcon.svelte";

  let {
    rootElement = $bindable<HTMLElement | undefined>(),
    style,
    options,
    selectedCategory,
    ariaLabel,
    onSelect,
  }: {
    rootElement?: HTMLElement;
    style: string;
    options: readonly { category: ProjectLucideCategory; icon: ProjectLucideIconEntry | undefined }[];
    selectedCategory: ProjectLucideCategory | "all";
    ariaLabel: string;
    onSelect: (category: ProjectLucideCategory) => void;
  } = $props();
</script>

<div
  bind:this={rootElement}
  use:portal
  class="fixed z-100 min-h-0 overflow-y-auto rounded-xl border border-border p-1.5 shadow-xl"
  {style}
  role="dialog"
  data-app-floating-surface
  aria-label={ariaLabel}
>
  {#each options as option (option.category)}
    <button
      type="button"
      class={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[0.8rem]",
        selectedCategory === option.category
          ? "bg-accent/70 text-foreground"
          : "text-foreground hover:bg-accent/40",
      )}
      aria-checked={selectedCategory === option.category}
      role="menuitemradio"
      onclick={() => onSelect(option.category)}
    >
      <span class="flex h-5 w-5 shrink-0 items-center justify-center">
        {#if option.icon}
          <LucideNodeIcon iconNode={option.icon.iconNode} size={15} strokeWidth={1.75} class="block" />
        {:else}
          <Shapes size={15} strokeWidth={1.75} class="block" />
        {/if}
      </span>
      <span class="min-w-0 flex-1 truncate">{option.category}</span>
      <span class="flex h-4 w-4 shrink-0 items-center justify-center">
        {#if selectedCategory === option.category}
          <Check size={14} strokeWidth={1.75} />
        {/if}
      </span>
    </button>
  {/each}
</div>

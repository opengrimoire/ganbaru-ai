<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  let { label, element = $bindable<HTMLDivElement | null>(null), class: className, children, ...attributes }: HTMLAttributes<HTMLDivElement> & {
    label: string;
    element?: HTMLDivElement | null;
    children: Snippet;
  } = $props();
</script>

<div {...attributes} bind:this={element} role="dialog" aria-label={label} tabindex="-1" data-floating-root data-app-floating-surface data-app-shortcuts="ignore" class={cn("collection-panel flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-popover text-[0.8125rem] text-popover-foreground shadow-lg", className)}>
  {@render children()}
</div>

<style>
  .collection-panel :global(:disabled) { opacity: 1; }
  .collection-panel :global(input:not([type="checkbox"]):not([type="radio"]):focus),
  .collection-panel :global(textarea:focus) {
    outline: none;
    box-shadow: none;
    background-color: color-mix(in srgb, var(--accent) 35%, var(--background));
  }
  @media (pointer: coarse) {
    .collection-panel :global(button) { min-height: 2.75rem; min-width: 2.75rem; }
    .collection-panel :global(input:not([type="checkbox"]):not([type="radio"])),
    .collection-panel :global(select),
    .collection-panel :global(textarea) { min-height: 2.75rem; }
  }
</style>

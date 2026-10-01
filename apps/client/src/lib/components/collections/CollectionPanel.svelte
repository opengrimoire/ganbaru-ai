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

<div {...attributes} bind:this={element} role="dialog" aria-label={label} tabindex="-1" data-floating-root data-app-floating-surface data-app-shortcuts="ignore" class={cn("collection-panel flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-popover text-xs text-popover-foreground shadow-sm", className)}>
  {@render children()}
</div>

<style>
  .collection-panel {
    --collection-row-height: 1.75rem;
  }
  .collection-panel :global(:disabled) { opacity: 1; }
  .collection-panel :global([data-collection-menu-body] .grid) {
    align-content: start;
    grid-auto-rows: max-content;
  }
  .collection-panel :global(:is([data-collection-menu-body] button, [data-collection-menu-body] label.flex, [data-collection-settings-page] button, [data-collection-settings-page] label.flex, .collection-menu-trigger, [role="option"])) {
    box-sizing: border-box;
    height: var(--collection-row-height);
    min-height: var(--collection-row-height);
    flex-shrink: 0;
    padding: 0.25rem 0.5rem;
    gap: 0.375rem;
    font-size: 0.75rem;
    line-height: 1.25rem;
    white-space: nowrap;
  }
  .collection-panel :global(.collection-menu-row) {
    height: var(--collection-row-height);
    min-height: var(--collection-row-height);
    align-items: center;
  }
  .collection-panel :global(:is(.collection-menu-control, .collection-settings-control)) {
    height: var(--collection-row-height);
    min-height: var(--collection-row-height);
    min-width: var(--collection-row-height);
  }
  .collection-panel :global([data-collection-menu-body] button > svg),
  .collection-panel :global([data-collection-settings-page] button > svg),
  .collection-panel :global(.collection-menu-trigger > svg) {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
  }
  .collection-panel :global([role="listbox"][data-app-floating-surface]) {
    padding-inline: 0.375rem;
    box-shadow: var(--shadow-sm);
  }
  .collection-panel :global([role="option"]) {
    border-radius: var(--radius-sm);
  }
  .collection-panel :global(input:not([type="checkbox"]):not([type="radio"]):focus),
  .collection-panel :global(textarea:focus) {
    outline: none;
    box-shadow: none;
    background-color: color-mix(in srgb, var(--accent) 35%, var(--background));
  }
  :global(html[data-shell="mobile"]) .collection-panel {
    --collection-row-height: 2.75rem;
  }
  @media (any-pointer: coarse) and (any-hover: none) {
    .collection-panel {
      --collection-row-height: 2.75rem;
    }
    .collection-panel :global(input:not([type="checkbox"]):not([type="radio"])),
    .collection-panel :global(select),
    .collection-panel :global(textarea) { min-height: var(--collection-row-height); }
  }
</style>

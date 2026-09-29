<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let { class: className, children, ...attributes }: HTMLAttributes<HTMLDivElement> & { children: Snippet } = $props();
</script>

<div {...attributes} class={cn("collection-cell relative flex min-h-11 min-w-0 items-center self-stretch rounded-md px-2 py-1", className)}>
  {@render children()}
</div>

<style>
  .collection-cell :global(:disabled) { opacity: 1; }
  .collection-cell :global(input:disabled) { -webkit-text-fill-color: currentColor; }
  .collection-cell::before {
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    content: "";
    pointer-events: none;
  }
  .collection-cell:hover::before {
    border-color: color-mix(in srgb, var(--foreground) 25%, transparent);
  }
  .collection-cell:focus-within { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  .collection-cell :global(input:not([type="checkbox"]):not([type="radio"]):focus) {
    outline: none;
    box-shadow: none;
    border-color: transparent;
  }
  .collection-cell :global(button:focus-visible) { outline: none; box-shadow: none; background: color-mix(in srgb, var(--accent) 40%, transparent); }
</style>

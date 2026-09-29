<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let { template, compactTemplate, minWidth, header = false, selected = false, divider = true, class: className, children, ...attributes }: HTMLAttributes<HTMLDivElement> & {
    template: string;
    compactTemplate?: string;
    minWidth?: string;
    header?: boolean;
    selected?: boolean;
    divider?: boolean;
    children: Snippet;
  } = $props();
</script>

<div
  {...attributes}
  class={cn("collection-row group/row grid min-h-11 items-center px-1 text-[0.866667rem]", header ? "font-semibold text-foreground" : "hover:bg-accent/20", selected && "bg-accent/40", divider && "border-b border-border/50", className)}
  data-compact={compactTemplate ? "true" : undefined}
  style={`--collection-columns: ${template}; --collection-compact-columns: ${compactTemplate ?? template}; ${minWidth ? `min-width: ${minWidth};` : ""}`}
>
  {@render children()}
</div>

<style>
  .collection-row { grid-template-columns: var(--collection-columns); }
  @container (max-width: 32rem) {
    .collection-row[data-compact="true"] { grid-template-columns: var(--collection-compact-columns); }
    .collection-row[data-compact="true"] > :global([data-collection-secondary]) { display: none; }
  }
</style>

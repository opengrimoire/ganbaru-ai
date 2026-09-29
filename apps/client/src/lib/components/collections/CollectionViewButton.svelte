<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  let { label, title = label, active, compact = false, children, onclick }: {
    label: string;
    title?: string;
    active: boolean;
    compact?: boolean;
    children?: Snippet;
    onclick: () => void;
  } = $props();
</script>

<button type="button" class={cn("inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[0.866667rem] font-medium transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none", active ? "bg-accent text-foreground" : "text-muted-foreground", compact && "w-8 px-0")} aria-label={label} aria-pressed={active} {title} {onclick}>
  {@render children?.()}
  {#if !compact}<span class="max-w-36 truncate">{label}</span>{/if}
</button>

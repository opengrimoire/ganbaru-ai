<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import { cn } from "$lib/utils";

  type ProjectListSelectionButtonMode = "section" | "group";

  let {
    mode,
    allSelected,
    partiallySelected,
    disabled,
    ariaLabel,
    onToggle,
  }: {
    mode: ProjectListSelectionButtonMode;
    allSelected: boolean;
    partiallySelected: boolean;
    disabled: boolean;
    ariaLabel: string;
    onToggle: () => void;
  } = $props();
</script>

<div class="flex h-7 items-center justify-center">
  <button
    type="button"
    class={cn(
      "project-list-selection-control flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-opacity",
      allSelected
        ? "border-primary bg-primary text-primary-foreground opacity-100"
        : cn(
          "border-border bg-background opacity-0 hover:bg-accent",
          mode === "section"
            ? "group-hover/section-header:opacity-100 group-focus-within/section-header:opacity-100"
            : "group-hover/list-group-header:opacity-100 group-focus-within/list-group-header:opacity-100",
        ),
      partiallySelected && "border-primary/70 bg-primary/10 text-primary opacity-100",
    )}
    aria-label={ariaLabel}
    {disabled}
    onclick={onToggle}
  >
    {#if allSelected}
      <Check size={13} strokeWidth={2} />
    {:else if partiallySelected}
      <span class="h-0.5 w-2.5 rounded-full bg-current"></span>
    {/if}
  </button>
</div>

<style>
  @media (hover: none) and (pointer: coarse) {
    .project-list-selection-control { opacity: 1; }
  }
</style>

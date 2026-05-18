<script lang="ts">
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";

  let {
    label,
    description,
    displayValue,
    canIncrement = true,
    canDecrement = true,
    canReset = false,
    onIncrement,
    onDecrement,
    onReset,
  }: {
    label: string;
    description?: string;
    displayValue: string;
    canIncrement?: boolean;
    canDecrement?: boolean;
    canReset?: boolean;
    onIncrement: () => void;
    onDecrement: () => void;
    onReset?: () => void;
  } = $props();
</script>

<div class="flex items-center justify-between gap-4 px-4 py-3 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2 max-[480px]:px-3">
  <div class="min-w-0 flex-1">
    <div class="text-[13px] text-foreground">{label}</div>
    {#if description}
      <div class="mt-0.5 text-[12px] text-muted-foreground">{description}</div>
    {/if}
  </div>
  <div class="flex items-center justify-end gap-1.5 max-[480px]:justify-between">
    <div
      class="flex min-w-0 items-center overflow-hidden rounded-md border border-border"
    >
      <button
        onclick={onDecrement}
        disabled={!canDecrement}
        class={cn(
          "flex h-7 w-7 items-center justify-center bg-secondary text-secondary-foreground transition-colors",
          canDecrement
            ? "hover:bg-accent hover:text-accent-foreground"
            : "cursor-not-allowed opacity-40",
        )}
        aria-label="Decrease"
        data-app-tooltip-disabled="true"
      >
        <Minus size={13} strokeWidth={2.5} />
      </button>
      <div
        class="flex h-7 w-28 max-w-[42vw] items-center justify-center border-x border-border bg-card px-2 text-[12px] font-medium tabular-nums text-foreground dark:bg-transparent"
      >
        {displayValue}
      </div>
      <button
        onclick={onIncrement}
        disabled={!canIncrement}
        class={cn(
          "flex h-7 w-7 items-center justify-center bg-secondary text-secondary-foreground transition-colors",
          canIncrement
            ? "hover:bg-accent hover:text-accent-foreground"
            : "cursor-not-allowed opacity-40",
        )}
        aria-label="Increase"
        data-app-tooltip-disabled="true"
      >
        <Plus size={13} strokeWidth={2.5} />
      </button>
    </div>
    {#if onReset}
      <button
        onclick={onReset}
        disabled={!canReset}
        aria-label="Reset"
        data-app-tooltip-disabled="true"
        class={cn(
          "flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors",
          canReset
            ? "hover:bg-accent hover:text-accent-foreground"
            : "cursor-not-allowed opacity-40",
        )}
      >
        <RotateCcw size={12} strokeWidth={2.25} />
      </button>
    {/if}
  </div>
</div>

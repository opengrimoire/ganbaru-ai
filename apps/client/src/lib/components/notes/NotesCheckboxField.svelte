<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import { cn } from "$lib/utils";

  let {
    checked = $bindable(false),
    label,
    showLabel = false,
    disabled = false,
    onChange,
  }: {
    checked?: boolean;
    label: string;
    showLabel?: boolean;
    disabled?: boolean;
    /** Receives the next checked state instead of toggling the bound value, for parent-owned state. */
    onChange?: (checked: boolean) => void;
  } = $props();
</script>

<button
  type="button"
  role="checkbox"
  aria-checked={checked}
  aria-label={label}
  data-app-tooltip-disabled="true"
  {disabled}
  class={cn(
    "group inline-flex shrink-0 items-center gap-1.5 rounded outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    showLabel
      ? "cursor-pointer text-[0.733333rem] text-muted-foreground hover:text-foreground"
      : "size-5 justify-center",
  )}
  onclick={() => {
    if (disabled) return;
    if (onChange) onChange(!checked);
    else checked = !checked;
  }}
>
  <span
    class={cn(
      "flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
      checked
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-background text-transparent group-hover:bg-accent",
    )}
  >
    {#if checked}
      <Check size={12} strokeWidth={2.5} />
    {/if}
  </span>
  {#if showLabel}
    <span>{label}</span>
  {/if}
</button>

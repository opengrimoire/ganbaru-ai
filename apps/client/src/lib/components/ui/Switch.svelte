<script lang="ts">
  import { cn } from "$lib/utils";

  let {
    checked,
    onChange,
    ariaLabel,
    disabled = false,
  }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    ariaLabel: string;
    disabled?: boolean;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  data-app-tooltip-disabled="true"
  {disabled}
  onclick={() => {
    if (!disabled) onChange(!checked);
  }}
  class={cn(
    "inline-flex h-6 w-10 shrink-0 items-center rounded-full border p-0.5 transition-colors disabled:cursor-not-allowed",
    checked
      ? "border-primary bg-primary"
      : "border-border bg-secondary",
  )}
>
  <span
    class={cn(
      "block h-4.5 w-4.5 rounded-full bg-background transition-transform",
      checked ? "translate-x-4.5" : "translate-x-0",
    )}
  ></span>
</button>

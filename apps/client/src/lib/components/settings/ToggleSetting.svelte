<script lang="ts">
  import { cn } from "$lib/utils";

  let {
    label,
    description,
    checked,
    onChange,
  }: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  } = $props();
</script>

<div class="flex items-center justify-between gap-4 px-1 py-1 max-[480px]:items-start">
  <div class="min-w-0 flex-1">
    <div class="text-[0.866667rem] text-foreground">{label}</div>
    {#if description}
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">{description}</div>
    {/if}
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    data-app-tooltip-disabled="true"
    onclick={() => onChange(!checked)}
    class={cn(
      "inline-flex h-6 w-10 shrink-0 items-center rounded-full border p-0.5 transition-colors disabled:cursor-not-allowed",
      checked
        ? "border-primary bg-primary"
        : "border-border bg-secondary",
    )}
  >
    <span
      class={cn(
        "block h-4.5 w-4.5 rounded-full bg-background shadow-sm transition-transform",
        checked ? "translate-x-4.5" : "translate-x-0",
      )}
    ></span>
  </button>
</div>

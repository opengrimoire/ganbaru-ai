<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Check from "@lucide/svelte/icons/check";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";

  interface Option {
    value: string;
    label: string;
    /** Optional inline style applied to the option label (e.g. for font previews). */
    style?: string;
  }

  let {
    value,
    options,
    onChange,
    label,
    description,
    canReset = false,
    onReset,
    class: className = "",
  }: {
    value: string;
    options: readonly Option[];
    onChange: (value: string) => void;
    label?: string;
    description?: string;
    canReset?: boolean;
    onReset?: () => void;
    class?: string;
  } = $props();

  let open = $state(false);
  let rootEl: HTMLDivElement | undefined = $state();

  const current = $derived(options.find((o) => o.value === value));

  function toggle() {
    open = !open;
  }

  function select(next: string) {
    onChange(next);
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      open = false;
    }
  }

  $effect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (!rootEl) return;
      if (rootEl.contains(e.target as Node)) return;
      open = false;
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    return () => window.removeEventListener("mousedown", handleClickOutside, true);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex items-center justify-between gap-4 px-4 py-3">
  {#if label}
    <div class="min-w-0 flex-1">
      <div class="text-[13px] text-foreground">{label}</div>
      {#if description}
        <div class="mt-0.5 text-[12px] text-muted-foreground">{description}</div>
      {/if}
    </div>
  {/if}
  <div class="flex items-center gap-1.5">
    <div bind:this={rootEl} class={cn("relative", className)}>
      <button
        type="button"
        onclick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        class="flex h-7 w-[168px] items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
      >
        <span class="truncate" style={current?.style}>{current?.label ?? value}</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          class={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {#if open}
        <div
          role="listbox"
          class="absolute right-0 top-[calc(100%+4px)] z-[80] min-w-full overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {#each options as option}
            {@const isActive = option.value === value}
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              onclick={() => select(option.value)}
              class={cn(
                "flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[12px] transition-colors",
                isActive
                  ? "bg-accent/60 text-foreground"
                  : "text-foreground hover:bg-accent/40",
              )}
            >
              <span class="truncate" style={option.style}>{option.label}</span>
              {#if isActive}
                <Check size={12} strokeWidth={2.5} class="shrink-0" />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    {#if onReset}
      <button
        onclick={onReset}
        disabled={!canReset}
        aria-label="Reset"
        title="Reset to default"
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

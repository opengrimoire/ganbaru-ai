<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Check from "@lucide/svelte/icons/check";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";
  import { portal } from "$lib/utils/portal";

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

  const VIEWPORT_MARGIN = 8;
  const ESTIMATED_DROPDOWN_HEIGHT = 240;

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let popoverEl: HTMLDivElement | undefined = $state();
  let popoverPos = $state({ top: 0, right: 0, minWidth: 0 });

  const current = $derived(options.find((o) => o.value === value));

  function computePosition() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    let top = rect.bottom + 4;
    if (
      top + ESTIMATED_DROPDOWN_HEIGHT + VIEWPORT_MARGIN > viewportHeight
    ) {
      top = Math.max(
        VIEWPORT_MARGIN,
        rect.top - ESTIMATED_DROPDOWN_HEIGHT - 4,
      );
    }
    popoverPos = {
      top,
      right: Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right),
      minWidth: rect.width,
    };
  }

  function toggle() {
    if (open) {
      open = false;
      return;
    }
    computePosition();
    open = true;
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
      const target = e.target as Node;
      if (triggerEl?.contains(target)) return;
      if (popoverEl?.contains(target)) return;
      open = false;
    }
    function handleScroll() {
      open = false;
    }
    function handleResize() {
      computePosition();
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
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
    <div class={cn("relative", className)}>
      <button
        bind:this={triggerEl}
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
          bind:this={popoverEl}
          use:portal
          role="listbox"
          class="fixed z-[80] max-h-[60vh] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
          style="top: {popoverPos.top}px; right: {popoverPos.right}px; min-width: {popoverPos.minWidth}px;"
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

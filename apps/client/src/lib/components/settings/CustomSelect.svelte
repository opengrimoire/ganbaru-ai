<script lang="ts">
  import { tick } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Check from "@lucide/svelte/icons/check";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { portal } from "$lib/utils/portal";
  import ShortcutDescription from "./ShortcutDescription.svelte";
  import {
    pickSelectPopoverGeometry,
    type SelectPopoverGeometry,
    type SelectPopoverRect,
  } from "./customSelectPosition";

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
    descriptionShortcuts = [],
    ariaLabel,
    canReset = false,
    onReset,
    class: className = "",
  }: {
    value: string;
    options: readonly Option[];
    onChange: (value: string) => void;
    label?: string;
    description?: string;
    descriptionShortcuts?: readonly string[];
    ariaLabel?: string;
    canReset?: boolean;
    onReset?: () => void;
    class?: string;
  } = $props();

  const { t } = getLocalization();

  const ESTIMATED_DROPDOWN_HEIGHT = 240;
  const DEFAULT_POPOVER_GEOMETRY: SelectPopoverGeometry = {
    top: 0,
    left: 0,
    minWidth: 0,
    maxWidth: 0,
    maxHeight: 0,
    placement: "below",
  };

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let popoverEl: HTMLDivElement | undefined = $state();
  let popoverGeometry = $state<SelectPopoverGeometry>(DEFAULT_POPOVER_GEOMETRY);
  let popoverReady = $state(false);

  const current = $derived(options.find((o) => o.value === value));

  function toRect(rect: DOMRect): SelectPopoverRect {
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  function getBoundaryRect(): SelectPopoverRect {
    if (!triggerEl) {
      return {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }
    const boundaryEl =
      triggerEl.closest<HTMLElement>("[data-settings-content]")
      ?? triggerEl.closest<HTMLElement>("[data-settings-modal-panel]");
    const viewportRect: SelectPopoverRect = {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    if (!boundaryEl) return viewportRect;
    const boundary = boundaryEl.getBoundingClientRect();
    const top = Math.max(viewportRect.top, boundary.top);
    const right = Math.min(viewportRect.right, boundary.right);
    const bottom = Math.min(viewportRect.bottom, boundary.bottom);
    const left = Math.max(viewportRect.left, boundary.left);
    return {
      top,
      right,
      bottom,
      left,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function computePosition() {
    if (!triggerEl) return;
    popoverGeometry = pickSelectPopoverGeometry({
      triggerRect: toRect(triggerEl.getBoundingClientRect()),
      boundaryRect: getBoundaryRect(),
      contentHeight: popoverEl?.scrollHeight ?? ESTIMATED_DROPDOWN_HEIGHT,
    });
    popoverReady = true;
  }

  async function toggle() {
    if (open) {
      open = false;
      return;
    }
    popoverReady = false;
    open = true;
    await tick();
    computePosition();
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
    function handleScroll(e: Event) {
      if (e.target instanceof Node && popoverEl?.contains(e.target)) return;
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

<div class="flex items-center justify-between gap-4 px-1 py-1 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
  {#if label}
    <div class="min-w-0 flex-1">
      <div class="text-[0.866667rem] text-foreground">{label}</div>
      {#if descriptionShortcuts.length > 0}
        <ShortcutDescription shortcuts={descriptionShortcuts} />
      {:else if description}
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">{description}</div>
      {/if}
    </div>
  {/if}
  <div class="flex items-center justify-end gap-1.5 max-[480px]:justify-between">
    <div class={cn("relative min-w-0 w-44 max-[480px]:flex-1", className)}>
      <button
        bind:this={triggerEl}
        type="button"
        onclick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        class="flex h-7 w-full max-w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent max-[480px]:w-full dark:bg-transparent"
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
          class="fixed z-80 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
          style="top: {popoverGeometry.top}px; left: {popoverGeometry.left}px; min-width: {popoverGeometry.minWidth}px; max-width: {popoverGeometry.maxWidth}px; max-height: {popoverGeometry.maxHeight}px; visibility: {popoverReady ? 'visible' : 'hidden'};"
        >
          {#each options as option}
            {@const isActive = option.value === value}
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              onclick={() => select(option.value)}
              class={cn(
                "flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[0.8rem] transition-colors",
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
        aria-label={t("common.reset")}
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

<script lang="ts">
  import { flushSync, tick, type Snippet } from "svelte";
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
    type SelectPopoverHorizontalAlign,
    type SelectPopoverRect,
  } from "./customSelectPosition";

  interface Option {
    value: string;
    label: string;
    summary?: string;
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
    inline = false,
    showSelectedSummary = true,
    showActiveCheck = true,
    alignOptionSummaryEnd = false,
    popoverAlign = "start",
    popoverBoundaryElement = null,
    disabled = false,
    appearance = "default",
    class: className = "",
    triggerLabel,
    leading,
    searchPlaceholder,
    searchValue = "",
    onSearchChange,
    emptyLabel,
    contentAlign = "end",
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
    inline?: boolean;
    showSelectedSummary?: boolean;
    showActiveCheck?: boolean;
    alignOptionSummaryEnd?: boolean;
    popoverAlign?: SelectPopoverHorizontalAlign;
    popoverBoundaryElement?: HTMLElement | null;
    disabled?: boolean;
    appearance?: "default" | "quiet";
    class?: string;
    /** Label for an action picker that does not retain a selected value. */
    triggerLabel?: string;
    /** Optional visual shared by the selected value and each menu option. */
    leading?: Snippet<[string]>;
    /** Enables a search field inside the floating menu. */
    searchPlaceholder?: string;
    searchValue?: string;
    /** Supply this for bounded or asynchronous searches owned by the caller. */
    onSearchChange?: (query: string) => void;
    emptyLabel?: string;
    contentAlign?: "start" | "end";
  } = $props();

  const { t } = getLocalization();

  const ESTIMATED_DROPDOWN_HEIGHT = 240;
  const DEFAULT_POPOVER_GEOMETRY: SelectPopoverGeometry = {
    top: 0,
    left: 0,
    width: null,
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

  const menuId = $props.id();
  let localSearch = $state("");
  const query = $derived(onSearchChange ? searchValue : localSearch);
  const visibleOptions = $derived(onSearchChange || !searchPlaceholder
    ? options
    : options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
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
    const boundaryEl = popoverBoundaryElement
      ?? triggerEl.closest<HTMLElement>("[data-settings-content]")
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
      contentWidth: popoverEl?.scrollWidth,
      horizontalAlign: popoverAlign,
    });
    popoverReady = true;
  }

  function popoverStyle(): string {
    if (!popoverReady) {
      return "top: 0px; left: 0px; min-width: max-content; max-width: max-content; max-height: none; visibility: hidden;";
    }
    const width = popoverGeometry.width === null ? "" : ` width: ${popoverGeometry.width}px;`;
    return `top: ${popoverGeometry.top}px; left: ${popoverGeometry.left}px;${width} min-width: ${popoverGeometry.minWidth}px; max-width: ${popoverGeometry.maxWidth}px; max-height: ${popoverGeometry.maxHeight}px; visibility: visible;`;
  }

  /** Open the menu without moving the surrounding scroll position. */
  async function toggle(): Promise<void> {
    if (disabled) return;
    if (open) {
      open = false;
      return;
    }
    popoverReady = false;
    open = true;
    await tick();
    computePosition();
    await tick();
    if (!open) return;
    const focusTarget = searchPlaceholder
      ? popoverEl?.querySelector<HTMLInputElement>("input")
      : popoverEl?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?? popoverEl?.querySelector<HTMLButtonElement>('[role="option"]');
    focusTarget?.focus({ preventScroll: true });
  }

  /** Select a value and return keyboard focus to its trigger. */
  function select(next: string): void {
    onChange(next);
    open = false;
    triggerEl?.focus({ preventScroll: true });
  }

  /** Keep menu navigation and dismissal local to the open control. */
  function handleKeydown(e: KeyboardEvent): void {
    if (!open || !(e.target instanceof Node)) return;
    if (!popoverEl?.contains(e.target) && !triggerEl?.contains(e.target)) return;
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      flushSync(() => { open = false; });
      triggerEl?.focus({ preventScroll: true });
      return;
    }
    const buttons = [...(popoverEl?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    const inSearch = e.target instanceof HTMLInputElement;
    if (inSearch && (e.key === "Home" || e.key === "End")) return;
    if (e.key === "Enter" && inSearch) {
      e.preventDefault();
      e.stopPropagation();
      buttons[0]?.click();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (buttons.length === 0) return;
    const next = e.key === "Home" ? 0
      : e.key === "End" ? buttons.length - 1
      : e.key === "ArrowDown" ? (index + 1) % buttons.length
      : (index <= 0 ? buttons.length : index) - 1;
    buttons[next]?.focus({ preventScroll: true });
    const button = buttons[next];
    if (button && popoverEl) {
      const top = button.offsetTop;
      const bottom = top + button.offsetHeight;
      const searchHeight = popoverEl.querySelector("input")?.offsetHeight ?? 0;
      if (top < popoverEl.scrollTop + searchHeight) popoverEl.scrollTop = Math.max(0, top - searchHeight);
      else if (bottom > popoverEl.scrollTop + popoverEl.clientHeight) {
        popoverEl.scrollTop = bottom - popoverEl.clientHeight;
      }
    }
  }

  $effect(() => {
    if (!open) return;
    visibleOptions;
    void tick().then(() => { if (open) computePosition(); });
  });

  $effect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
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
    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  });
</script>


{#snippet selectControl()}
  <div class={cn("relative min-w-0 w-44 max-[480px]:flex-1", className)}>
    <button
      bind:this={triggerEl}
      type="button"
      {disabled}
      onclick={toggle}
      onkeydown={(event) => {
        if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          void toggle();
        }
      }}
      aria-haspopup={searchPlaceholder ? "dialog" : "listbox"}
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={ariaLabel ?? label}
      class={cn(
        "flex h-7 w-full max-w-full items-center gap-2 rounded-md text-[0.8rem] font-medium text-foreground transition-colors disabled:cursor-not-allowed max-[480px]:w-full",
        appearance === "quiet"
          ? "justify-end px-1.5 hover:bg-accent/60 disabled:opacity-45 disabled:hover:bg-transparent"
          : "justify-between border border-border bg-card px-2.5 hover:bg-accent disabled:hover:bg-card dark:bg-transparent dark:disabled:hover:bg-transparent",
      )}
    >
      <span class={cn("flex min-w-0 flex-1 items-center gap-1.5", appearance === "quiet" && contentAlign === "end" && "justify-end text-right")}>
        {#if leading && current}{@render leading(current.value)}{/if}
        <span class="truncate" style={current?.style}>{triggerLabel ?? current?.label ?? value}</span>
        {#if showSelectedSummary && current?.summary}
          <span class="shrink-0 text-[0.733333rem] text-muted-foreground">{current.summary}</span>
        {/if}
      </span>
      <ChevronDown
        size={13}
        strokeWidth={2}
        class={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
      />
    </button>
    {#if open}
      <div
        bind:this={popoverEl}
        use:portal={triggerEl?.closest<HTMLElement>("[data-floating-root]") ?? "body"}
        id={menuId}
        role={searchPlaceholder ? "dialog" : "listbox"}
        aria-label={ariaLabel ?? label}
        data-app-floating-surface
        class="fixed z-80 overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
        style={popoverStyle()}
      >
        {#if searchPlaceholder}
          <input
            value={query}
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            class="sticky top-0 mb-1 min-h-9 w-full border-b border-border bg-popover px-3 text-[0.8rem] outline-none"
            oninput={(event) => {
              localSearch = event.currentTarget.value;
              onSearchChange?.(event.currentTarget.value);
            }}
          />
        {/if}
        <div role={searchPlaceholder ? "listbox" : undefined} aria-label={ariaLabel ?? label}>
        {#each visibleOptions as option (option.value)}
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
            <span
              class={cn(
                "min-w-0 flex-1",
                alignOptionSummaryEnd
                  ? "grid grid-cols-[minmax(max-content,1fr)_max-content] items-center gap-4"
                  : "flex items-center gap-1.5",
              )}
            >
              {#if leading}{@render leading(option.value)}{/if}
              <span class="truncate" style={option.style}>{option.label}</span>
              {#if option.summary}
                <span class="max-w-72 truncate justify-self-end text-[0.733333rem] text-muted-foreground" title={option.summary}>{option.summary}</span>
              {/if}
            </span>
            {#if showActiveCheck && isActive}
              <Check size={12} strokeWidth={2.5} class="shrink-0" />
            {/if}
          </button>
        {:else}
          {#if emptyLabel}<p class="px-3 py-2 text-[0.8rem] text-muted-foreground">{emptyLabel}</p>{/if}
        {/each}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#if inline}
  {@render selectControl()}
{:else}
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
      {@render selectControl()}
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
{/if}

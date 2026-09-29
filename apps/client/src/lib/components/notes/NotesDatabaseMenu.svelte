<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { portal } from "$lib/utils/portal";
  import { notesBlockInsertMenuStyle } from "$lib/notes/block-insertion";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import ListFilter from "@lucide/svelte/icons/list-filter";
  import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Plus from "@lucide/svelte/icons/plus";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import X from "@lucide/svelte/icons/x";
  import { formatNumber } from "$lib/i18n/formatters";
  import { getLocalization } from "$lib/i18n/translator.svelte";

  let { label, kind = "layout", iconOnly = false, fullWidth = false, primary = false, showHeader = true, activeCount = 0, dismissOnAction = false, children }: {
    label: string;
    kind?: "layout" | "filter" | "sort" | "properties" | "actions" | "new" | "new-options";
    iconOnly?: boolean;
    fullWidth?: boolean;
    primary?: boolean;
    showHeader?: boolean;
    activeCount?: number;
    dismissOnAction?: boolean;
    children: Snippet;
  } = $props();

  const localization = getLocalization();
  const { t } = localization;
  const countLabel = $derived(activeCount > 0 ? formatNumber(localization.locale, activeCount) : "");
  const id = $props.id();
  const PANEL_WIDTH = 384;
  const ACTION_PANEL_WIDTH = 256;
  const VIEWPORT_HEIGHT_FRACTION = 0.7;
  const icons = { layout: SlidersHorizontal, filter: ListFilter, sort: ArrowDownUp, properties: Columns3, actions: Ellipsis, new: Plus, "new-options": ChevronDown };
  const Icon = $derived(icons[kind]);
  let open = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();

  /** Close the panel and return keyboard focus to the invoking control. */
  function close(): void {
    open = false;
    trigger?.focus({ preventScroll: true });
  }

  /** Keep settings outside clipped rows, with nested dropdowns inside the owning dialog. */
  function floatPanel(node: HTMLDivElement) {
    const moved = portal(node, trigger?.closest<HTMLElement>("[data-floating-root]") ?? "body");
    const content = node.querySelector<HTMLElement>("[data-database-menu-content]");
    let disposed = false;
    const place = () => {
      if (disposed || !trigger) return;
      node.style.cssText = notesBlockInsertMenuStyle({
        triggerRect: trigger.getBoundingClientRect(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        preferredWidth: kind === "actions" || kind === "new-options" ? ACTION_PANEL_WIDTH : PANEL_WIDTH,
        preferredMaxHeight: Math.min(content?.scrollHeight ?? node.scrollHeight, window.innerHeight * VIEWPORT_HEIGHT_FRACTION),
      });
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && !node.contains(event.target) && !trigger?.contains(event.target)) open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Element)) return;
      // Nested dropdowns own their first Escape press.
      if (event.target.closest("[data-app-floating-surface]") !== node) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const action = (event: MouseEvent) => {
      if ((kind !== "actions" && !dismissOnAction) || !(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (!button || button.disabled || button.hasAttribute("aria-haspopup") || button.hasAttribute("data-database-menu-keep-open")) return;
      // Let delegated action handlers run before their panel is removed.
      queueMicrotask(() => {
        if (disposed) return;
        if (node.contains(document.activeElement)) close();
        else open = false;
      });
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !node.contains(event.target)) place();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (content) observer?.observe(content);
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("focusin", outside);
    node.addEventListener("click", action);
    void tick().then(() => {
      if (disposed) return;
      place();
      const target = node.querySelector<HTMLElement>("[data-database-menu-body] input:not(:disabled), [data-database-menu-body] button:not(:disabled)");
      (target ?? node).focus({ preventScroll: true });
    });
    return {
      destroy() {
        disposed = true;
        observer?.disconnect();
        window.removeEventListener("mousedown", outside, true);
        window.removeEventListener("keydown", escape, true);
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", scroll, true);
        document.removeEventListener("focusin", outside);
        node.removeEventListener("click", action);
        moved.destroy();
      },
    };
  }
</script>

<div class="inline-flex min-w-0" class:w-full={fullWidth}>
  <button
    bind:this={trigger}
    type="button"
    class={`inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[0.8rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
    class:w-full={fullWidth}
    class:bg-accent={open && !primary}
    class:text-foreground={!primary && (open || activeCount > 0)}
    aria-label={countLabel ? `${label} (${countLabel})` : label}
    aria-expanded={open}
    aria-controls={open ? id : undefined}
    aria-haspopup="dialog"
    onclick={() => { open = !open; }}
  >
    <Icon class="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
    {#if !iconOnly}<span class="truncate">{label}</span>{/if}
    {#if countLabel}<span class="rounded bg-accent px-1 text-[0.733333rem] tabular-nums">{countLabel}</span>{/if}
  </button>
  {#if open}
    <div use:floatPanel id={id} role="dialog" aria-label={label} tabindex="-1" data-app-floating-surface data-floating-root class="z-50 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover text-sm text-popover-foreground shadow-lg">
      <div class="max-h-[inherit] overflow-auto rounded-xl">
        <div data-database-menu-content class="@container p-3">
          {#if showHeader}
            <div class="mb-3 flex items-center justify-between gap-2">
              <span class="font-medium">{label}</span>
              <button type="button" class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t("common.close")} onclick={close}>
                <X class="size-4" aria-hidden="true" />
              </button>
            </div>
          {/if}
          <div data-database-menu-body>{@render children()}</div>
        </div>
      </div>
    </div>
  {/if}
</div>

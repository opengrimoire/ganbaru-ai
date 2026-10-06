<script lang="ts">
  import { tick, type Component, type Snippet } from "svelte";
  import { portal } from "$lib/utils/portal";
  import { anchoredPanelContentHeight, anchoredPanelStyle, anchoredPanelWidth } from "$lib/utils/anchored-panel";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import ListFilter from "@lucide/svelte/icons/list-filter";
  import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Plus from "@lucide/svelte/icons/plus";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Group from "@lucide/svelte/icons/group";
  import X from "@lucide/svelte/icons/x";
  import { formatNumber } from "$lib/i18n/formatters";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { cn } from "$lib/utils";
  import CollectionPanel from "./CollectionPanel.svelte";
  import { getCollectionSettingsNavigation } from "./collection-settings-context";

  let { label, ariaLabel, kind = "layout", iconOnly = false, fullWidth = false, primary = false, showHeader, activeCount = 0, dismissOnAction = false, summary, leading, icon, triggerClass, triggerAttributes, disabled = false, children }: {
    label: string;
    ariaLabel?: string;
    kind?: "layout" | "filter" | "sort" | "properties" | "property" | "group" | "actions" | "new" | "new-options";
    iconOnly?: boolean;
    fullWidth?: boolean;
    primary?: boolean;
    showHeader?: boolean;
    activeCount?: number;
    dismissOnAction?: boolean;
    summary?: string;
    leading?: Snippet;
    icon?: Component;
    triggerClass?: string;
    /** Data attributes for the trigger, such as the markers that let collection tables own its highlight. */
    triggerAttributes?: Partial<Record<`data-${string}`, string>>;
    disabled?: boolean;
    children: Snippet;
  } = $props();

  const localization = getLocalization();
  const { t } = localization;
  const navigation = getCollectionSettingsNavigation();
  const settingsRow = $derived(fullWidth && navigation !== undefined);
  const rowTrigger = $derived(settingsRow || (fullWidth && !leading));
  const headerVisible = $derived(showHeader ?? (kind !== "actions" && kind !== "property"));
  const countLabel = $derived(activeCount > 0 ? formatNumber(localization.locale, activeCount) : "");
  const id = $props.id();
  const PANEL_WIDTH = 320;
  const ACTION_PANEL_WIDTH = 240;
  const VIEWPORT_HEIGHT_FRACTION = 0.7;
  const icons = { layout: SlidersHorizontal, filter: ListFilter, sort: ArrowDownUp, properties: Columns3, property: Columns3, group: Group, actions: Ellipsis, new: Plus, "new-options": ChevronDown };
  const Icon = $derived(icon ?? icons[kind]);
  const dismisses = $derived(kind === "actions" || dismissOnAction);
  let open = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();
  let panel: HTMLDivElement | null = $state(null);
  const expanded = $derived(settingsRow ? navigation?.isActive(trigger) ?? false : open);

  $effect(() => {
    if (!panel) return;
    const floating = floatPanel(panel);
    return () => floating.destroy();
  });

  /** Open a detail page within settings or a separate toolbar popover. */
  function toggle(): void {
    if (disabled) return;
    if (settingsRow && navigation && trigger) {
      navigation.navigate({ label, children, trigger });
      return;
    }
    open = !open;
  }

  /** Close the panel and return keyboard focus to the invoking control. */
  function close(): void {
    open = false;
    trigger?.focus({ preventScroll: true });
  }

  /** Whether an action closes this panel: it is in the panel itself, or in nested menus that all close after their own actions. */
  function actionReachesPanel(target: Element, node: HTMLElement): boolean {
    let surface = target.closest("[data-app-floating-surface]");
    while (surface && surface !== node) {
      if (!surface.hasAttribute("data-collection-menu-dismiss")) return false;
      surface = surface.parentElement?.closest("[data-app-floating-surface]") ?? null;
    }
    return surface === node;
  }

  /** Keep settings outside clipped rows, with nested dropdowns inside the owning dialog. */
  function floatPanel(node: HTMLDivElement) {
    const moved = portal(node, trigger?.closest<HTMLElement>("[data-floating-root]") ?? "body");
    const content = node.querySelector<HTMLElement>("[data-collection-menu-content]");
    let disposed = false;
    let dismissed = false;
    let restoreFocus = true;
    let lastOwnedFocus: HTMLElement | null = null;
    let previousStyle = "";
    const place = () => {
      if (disposed || !trigger) return;
      const input = {
        triggerRect: trigger.getBoundingClientRect(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        preferredWidth: kind === "actions" || kind === "property" || kind === "new-options" ? ACTION_PANEL_WIDTH : PANEL_WIDTH,
        preferredMaxHeight: window.innerHeight * VIEWPORT_HEIGHT_FRACTION,
      };
      const width = `${Math.round(anchoredPanelWidth(input))}px`;
      if (node.style.width !== width) node.style.width = width;
      const style = anchoredPanelStyle({ ...input, contentHeight: anchoredPanelContentHeight(node, content ? [content] : []) });
      if (style !== previousStyle) {
        node.style.cssText = style;
        previousStyle = style;
      }
    };
    const outside = (event: Event) => {
      if (!dismissed && event.target instanceof Node && !node.contains(event.target) && !trigger?.contains(event.target)) {
        dismissed = true;
        restoreFocus = false;
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && node.contains(focused)) focused.blur();
        open = false;
      }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("[data-app-floating-surface]") === node) lastOwnedFocus = event.target;
      outside(event);
    };
    const keydown = (event: KeyboardEvent) => {
      if (dismissed || !(event.target instanceof Element)) return;
      // Nested dropdowns own their first Escape press.
      const lostDisabledFocus = event.key === "Escape"
        && (event.target === document.body || event.target === document.documentElement)
        && (document.activeElement === document.body || document.activeElement === document.documentElement)
        && lastOwnedFocus?.isConnected && node.contains(lastOwnedFocus) && lastOwnedFocus.matches(":disabled")
        && !node.querySelector("[data-app-floating-surface]");
      if (event.target.closest("[data-app-floating-surface]") !== node && !lostDisabledFocus) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLButtonElement)) return;
      if (event.target.hasAttribute("aria-haspopup")) return;
      const buttons = [...node.querySelectorAll<HTMLButtonElement>("[data-collection-menu-body] button:not(:disabled)")];
      const index = buttons.indexOf(event.target);
      if (index < 0 || !buttons.length) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowDown" ? (index + 1) % buttons.length : (index + buttons.length - 1) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    };
    const closeAfterAction = (event: MouseEvent) => {
      if (!dismisses || !(event.target instanceof Element) || !actionReachesPanel(event.target, node)) return;
      const button = event.target.closest("button");
      if (!button || button.disabled || button.hasAttribute("aria-haspopup") || button.hasAttribute("data-collection-menu-keep-open")) return;
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
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("focusin", focusin);
    node.addEventListener("click", closeAfterAction);
    void tick().then(() => {
      if (disposed) return;
      place();
      const target = node.querySelector<HTMLElement>("[data-collection-menu-body] input:not(:disabled), [data-collection-menu-body] button:not(:disabled)");
      (target ?? node).focus({ preventScroll: true });
    });
    return {
      destroy() {
        disposed = true;
        observer?.disconnect();
        window.removeEventListener("pointerdown", outside, true);
        window.removeEventListener("keydown", keydown, true);
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", scroll, true);
        document.removeEventListener("focusin", focusin);
        node.removeEventListener("click", closeAfterAction);
        if (restoreFocus && node.contains(document.activeElement) && trigger?.isConnected) trigger.focus({ preventScroll: true });
        moved.destroy();
      },
    };
  }
</script>

<div class={cn(fullWidth ? "flex w-full" : "inline-flex", "min-w-0")} class:collection-menu-row={rowTrigger}>
  <button
    bind:this={trigger}
    type="button"
    {...triggerAttributes}
    {disabled}
    class={cn("collection-menu-trigger inline-flex h-8 min-w-0 items-center gap-1.5 rounded px-2 text-[0.8125rem] font-normal transition-colors focus-visible:outline-none focus-visible:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground", primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground", rowTrigger && "justify-start text-foreground", triggerClass)}
    class:w-full={fullWidth}
    class:bg-accent={expanded && !primary}
    class:text-foreground={!primary && (expanded || activeCount > 0)}
    data-collection-settings-row={settingsRow ? "" : undefined}
    aria-label={ariaLabel ?? (countLabel ? `${label} (${countLabel})` : label)}
    aria-expanded={expanded}
    aria-controls={open && !settingsRow ? id : undefined}
    aria-haspopup="dialog"
    onclick={toggle}
    onkeydown={(event) => {
      if (!expanded && (event.key === "ArrowDown" || event.key === "ArrowUp") && !settingsRow) {
        event.preventDefault();
        toggle();
      }
    }}
  >
    {#if leading}{@render leading()}{:else}<Icon class="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />{/if}
    {#if !iconOnly}<span class="truncate">{label}</span>{/if}
    {#if rowTrigger}
      <span class="min-w-0 flex-1 truncate text-right text-[0.75rem] text-muted-foreground">{summary ?? countLabel}</span>
      <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
    {:else if countLabel}<span class="rounded bg-accent px-1 text-[0.733333rem] tabular-nums">{countLabel}</span>{/if}
  </button>
  {#if open && !settingsRow}
    <CollectionPanel bind:element={panel} {label} id={id} data-collection-menu-dismiss={dismisses ? "" : undefined} class="fixed z-80 max-w-[calc(100vw-1rem)]">
      <div class="min-h-0 overflow-x-hidden overflow-y-auto">
        <div data-collection-menu-content class="@container flow-root h-max p-1.5">
          {#if headerVisible}
            <div class="mb-1.5 flex items-center justify-between gap-2 px-1">
              <span class="font-medium">{label}</span>
              <button type="button" class="collection-menu-control inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t("common.close")} onclick={close}>
                <X class="size-3.5" aria-hidden="true" />
              </button>
            </div>
          {/if}
          <div data-collection-menu-body>{@render children()}</div>
        </div>
      </div>
    </CollectionPanel>
  {/if}
</div>

<style>
  @media (any-pointer: coarse) and (any-hover: none) {
    .collection-menu-trigger {
      min-height: var(--collection-row-height, 2.75rem);
      min-width: 2.75rem;
    }
  }
</style>

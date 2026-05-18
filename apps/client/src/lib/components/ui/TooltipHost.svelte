<script lang="ts">
  import { onMount, tick } from "svelte";
  import { calculateTooltipPosition, type TooltipPlacement } from "./tooltip";

  const tooltipId = "app-global-tooltip";
  const hoverDelayMs = 350;
  const targetSelector = [
    "[data-app-tooltip]",
    "[data-tooltip]",
    "button[aria-label]",
    "a[aria-label]",
    "[role='button'][aria-label]",
    "[role='menuitem'][aria-label]",
  ].join(",");

  let tooltipEl = $state<HTMLDivElement | null>(null);
  let anchor: HTMLElement | null = null;
  let text = $state("");
  let visible = $state(false);
  let ready = $state(false);
  let placement = $state<TooltipPlacement>("top");
  let tooltipStyle = $state("left: -9999px; top: -9999px;");
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  const migratingTitleElements = new WeakSet<HTMLElement>();

  function isInteractiveElement(element: HTMLElement): boolean {
    return element.matches("button, a, [role='button'], [role='menuitem']");
  }

  function syncGeneratedAriaLabel(element: HTMLElement, value: string): void {
    if (!isInteractiveElement(element)) return;
    if (element.dataset.appTooltipAria === "true") {
      element.setAttribute("aria-label", value);
      return;
    }
    if (element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")) return;
    if (element.textContent?.trim()) return;

    element.dataset.appTooltipAria = "true";
    element.setAttribute("aria-label", value);
  }

  function clearGeneratedAriaLabel(element: HTMLElement): void {
    if (element.dataset.appTooltipAria !== "true") return;
    delete element.dataset.appTooltipAria;
    element.removeAttribute("aria-label");
  }

  function migrateTitleAttribute(element: Element): void {
    if (!(element instanceof HTMLElement)) return;
    const rawTitle = element.getAttribute("title");
    if (rawTitle === null) return;

    const tooltip = rawTitle.trim();
    migratingTitleElements.add(element);
    element.removeAttribute("title");

    if (tooltip.length > 0) {
      element.dataset.appTooltip = tooltip;
      element.dataset.appTooltipSource = "title";
      syncGeneratedAriaLabel(element, tooltip);
    } else if (element.dataset.appTooltipSource === "title") {
      delete element.dataset.appTooltip;
      delete element.dataset.appTooltipSource;
      clearGeneratedAriaLabel(element);
    }

    if (anchor === element) {
      text = tooltip;
      if (tooltip.length === 0) hideTooltip();
      else void positionTooltip();
    }
  }

  function migrateTitleAttributes(root: ParentNode): void {
    if (root instanceof Element) migrateTitleAttribute(root);
    for (const element of root.querySelectorAll("[title]")) {
      migrateTitleAttribute(element);
    }
  }

  function removeMigratedTitle(element: HTMLElement): void {
    if (migratingTitleElements.delete(element)) return;
    if (element.dataset.appTooltipSource !== "title") return;

    delete element.dataset.appTooltip;
    delete element.dataset.appTooltipSource;
    clearGeneratedAriaLabel(element);
    if (anchor === element) hideTooltip();
  }

  function tooltipTextFor(element: HTMLElement): string {
    const explicitTooltip = element.dataset.appTooltip?.trim()
      || element.dataset.tooltip?.trim()
      || "";
    if (explicitTooltip.length > 0) return explicitTooltip;
    if (!isInteractiveElement(element) || element.textContent?.trim()) return "";
    return element.getAttribute("aria-label")?.trim() || "";
  }

  function findTooltipTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>(targetSelector);
    if (!(element instanceof HTMLElement)) return null;
    if (!document.documentElement.contains(element)) return null;
    return tooltipTextFor(element).length > 0 ? element : null;
  }

  async function positionTooltip(): Promise<void> {
    if (!anchor || !tooltipEl || !visible) return;
    if (!document.documentElement.contains(anchor)) {
      hideTooltip();
      return;
    }

    const position = calculateTooltipPosition(
      anchor.getBoundingClientRect(),
      tooltipEl.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    );
    placement = position.placement;
    tooltipStyle = [
      `left: ${position.left}px`,
      `top: ${position.top}px`,
      `--app-tooltip-arrow-left: ${position.arrowLeft}px`,
    ].join("; ");
    ready = true;
  }

  function clearShowTimer(): void {
    if (showTimer === undefined) return;
    clearTimeout(showTimer);
    showTimer = undefined;
  }

  function showTooltipFor(element: HTMLElement, delayMs: number): void {
    const nextText = tooltipTextFor(element);
    if (nextText.length === 0) return;
    if (anchor === element && (visible || showTimer !== undefined)) return;

    clearShowTimer();
    anchor = element;
    text = nextText;
    ready = false;
    tooltipStyle = "left: -9999px; top: -9999px;";

    showTimer = setTimeout(() => {
      showTimer = undefined;
      if (!anchor) return;
      text = tooltipTextFor(anchor);
      if (text.length === 0) {
        hideTooltip();
        return;
      }
      visible = true;
      void tick().then(positionTooltip);
    }, delayMs);
  }

  function hideTooltip(): void {
    clearShowTimer();
    anchor = null;
    visible = false;
    ready = false;
    text = "";
    tooltipStyle = "left: -9999px; top: -9999px;";
  }

  function isStillInsideAnchor(event: PointerEvent | FocusEvent): boolean {
    if (!anchor || !(event.target instanceof Node)) return false;
    if (!anchor.contains(event.target)) return false;
    const relatedTarget = event.relatedTarget;
    return relatedTarget instanceof Node && anchor.contains(relatedTarget);
  }

  onMount(() => {
    migrateTitleAttributes(document);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === "title") {
          if (!(record.target instanceof HTMLElement)) continue;
          if (record.target.hasAttribute("title")) migrateTitleAttribute(record.target);
          else removeMigratedTitle(record.target);
          continue;
        }

        for (const node of record.addedNodes) {
          if (node instanceof Element) migrateTitleAttributes(node);
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["title"],
      childList: true,
      subtree: true,
    });

    const handlePointerOver = (event: PointerEvent) => {
      const target = findTooltipTarget(event.target);
      if (!target) return;
      showTooltipFor(target, hoverDelayMs);
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (isStillInsideAnchor(event)) return;
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = findTooltipTarget(event.target);
      if (!target) return;
      showTooltipFor(target, 0);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (isStillInsideAnchor(event)) return;
      hideTooltip();
    };

    const handlePointerDown = () => {
      hideTooltip();
    };

    const refreshPosition = () => {
      void positionTooltip();
    };

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", refreshPosition);
    window.addEventListener("scroll", refreshPosition, true);

    return () => {
      clearShowTimer();
      observer.disconnect();
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", refreshPosition);
      window.removeEventListener("scroll", refreshPosition, true);
    };
  });
</script>

{#if visible && text}
  <div
    id={tooltipId}
    bind:this={tooltipEl}
    class:ready
    class="app-tooltip"
    data-placement={placement}
    role="tooltip"
    style={tooltipStyle}
  >
    {text}
  </div>
{/if}

<style>
  .app-tooltip {
    position: fixed;
    z-index: 2147483000;
    max-width: min(18rem, calc(100vw - 16px));
    padding: 0.42rem 0.65rem;
    border-radius: 0.5rem;
    background: #202020;
    color: #ffffff;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1.3;
    overflow-wrap: anywhere;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 100ms ease,
      transform 100ms ease;
  }

  .app-tooltip[data-placement="top"] {
    transform: translateY(2px) scale(0.98);
  }

  .app-tooltip[data-placement="bottom"] {
    transform: translateY(-2px) scale(0.98);
  }

  .app-tooltip.ready {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .app-tooltip::after {
    position: absolute;
    left: var(--app-tooltip-arrow-left, 50%);
    width: 10px;
    height: 10px;
    border-radius: 1px;
    background: inherit;
    content: "";
    transform: translateX(-50%) rotate(45deg);
  }

  .app-tooltip[data-placement="top"]::after {
    bottom: -4px;
  }

  .app-tooltip[data-placement="bottom"]::after {
    top: -4px;
  }
</style>

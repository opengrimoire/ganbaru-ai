<script lang="ts">
  import { untrack } from "svelte";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";
  import { portal } from "$lib/utils/portal";
  import {
    type HsvColor,
    clampChannel,
    clampHue,
    clampPercent,
    contrastRatio,
    hexToRgba,
    hsvToHex,
    hsvToRgb,
    normalizeHex,
    rgbToHsv,
    rgbaToHex,
  } from "./colorMath";

  let {
    value,
    onChange,
    onReset,
    canReset = false,
    readOnly = false,
    label,
    swatchSize = 26,
    fluid = false,
    class: className = "",
  }: {
    value: string;
    onChange: (hex: string) => void;
    onReset?: () => void;
    canReset?: boolean;
    readOnly?: boolean;
    label?: string;
    swatchSize?: number;
    fluid?: boolean;
    class?: string;
  } = $props();

  // Width of the popover; kept in sync with the rendered class so position
  // math can keep the panel inside the viewport without a measurement pass.
  const POPOVER_WIDTH = 228;
  // Rough height estimate; used only for off-bottom flipping. Slightly
  // overestimating is safe: it just biases towards opening upward sooner.
  const POPOVER_HEIGHT = 360;
  const VIEWPORT_MARGIN = 8;
  const THUMB_OUTLINE_LIGHT = "#ffffff";
  const THUMB_OUTLINE_DARK = "#000000";
  const CHECKER_TILE_SIZE = 12;

  // Checkerboard background rendered from chrome tokens so the pattern stays
  // visible against any editor-chrome background and adapts to light/dark.
  // The conic-gradient quadrants lay out a 2x2 checker inside each tile.
  // The alpha rail is 12px tall, so this renders exactly two cells high.
  const CHECKER_BG =
    "conic-gradient(" +
    "var(--editor-chrome-checker-b) 25%, " +
    "var(--editor-chrome-checker-a) 25% 50%, " +
    "var(--editor-chrome-checker-b) 50% 75%, " +
    "var(--editor-chrome-checker-a) 75%" +
    `) 0 0/${CHECKER_TILE_SIZE}px ${CHECKER_TILE_SIZE}px`;

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let popoverEl: HTMLDivElement | undefined = $state();
  let popoverPos = $state({ top: 0, left: 0 });
  let svEl: HTMLDivElement | undefined = $state();
  let hueEl: HTMLDivElement | undefined = $state();
  let alphaEl: HTMLDivElement | undefined = $state();
  let thumbContour = $state(THUMB_OUTLINE_DARK);
  let hexDraft = $state(untrack(() => normalizeHex(value) ?? "#000000"));
  let hsv = $state<HsvColor>(
    untrack(() => {
      const rgba = hexToRgba(value);
      return rgba ? rgbToHsv(rgba.r, rgba.g, rgba.b) : { h: 0, s: 0, v: 0 };
    }),
  );
  // Alpha stored as 0..255 so it round-trips losslessly through hex.
  let alpha = $state(untrack(() => hexToRgba(value)?.a ?? 255));

  function computePosition() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = rect.left;
    if (left + POPOVER_WIDTH + VIEWPORT_MARGIN > viewportWidth) {
      left = Math.max(
        VIEWPORT_MARGIN,
        viewportWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
      );
    }
    let top = rect.bottom + 6;
    if (top + POPOVER_HEIGHT + VIEWPORT_MARGIN > viewportHeight) {
      // Flip above the trigger if there isn't room below.
      top = Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_HEIGHT - 6);
    }
    popoverPos = { top, left };
  }

  function toggleOpen() {
    if (readOnly) return;
    if (open) {
      open = false;
      return;
    }
    computePosition();
    open = true;
  }

  // External value can change (theme switch, reset). Sync local state when
  // the popover is closed, or when the incoming value differs from the hex
  // we currently emit, so the picker stays in lockstep with the model.
  $effect(() => {
    const normalized = normalizeHex(value);
    if (!normalized) return;
    const rgba = hexToRgba(normalized);
    if (!rgba) return;
    const incomingHsv = rgbToHsv(rgba.r, rgba.g, rgba.b);
    if (!open) {
      hexDraft = normalized;
      hsv = incomingHsv;
      alpha = rgba.a;
      return;
    }
    const currentHex = currentEmittedHex();
    if (currentHex !== normalized) {
      hexDraft = normalized;
      hsv = incomingHsv;
      alpha = rgba.a;
    }
  });

  const rgb = $derived(hsvToRgb(hsv.h, hsv.s, hsv.v));
  const hueColor = $derived(hsvToHex(hsv.h, 100, 100));
  const solidHex = $derived(hsvToHex(hsv.h, hsv.s, hsv.v));
  const transparentHex = $derived(rgbaToHex(rgb.r, rgb.g, rgb.b, 0));
  const alphaPercentDisplay = $derived(Math.round((alpha / 255) * 100));

  function currentEmittedHex(): string {
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return rgbaToHex(r, g, b, alpha);
  }

  function clampPickerHue(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const wrapped = clampHue(value);
    return wrapped === 0 && value > 0 && value % 360 === 0 ? 360 : wrapped;
  }

  function pointerRatio(e: PointerEvent, el: HTMLElement | undefined): number | null {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    return x / rect.width;
  }

  function updateThumbContour() {
    if (typeof document === "undefined") return;
    const styles = getComputedStyle(popoverEl ?? document.documentElement);
    const popover = normalizeHex(styles.getPropertyValue("--popover"));
    if (!popover) {
      thumbContour = document.documentElement.classList.contains("dark")
        ? THUMB_OUTLINE_LIGHT
        : THUMB_OUTLINE_DARK;
      return;
    }
    const lightContrast = contrastRatio(THUMB_OUTLINE_LIGHT, popover);
    const darkContrast = contrastRatio(THUMB_OUTLINE_DARK, popover);
    thumbContour =
      lightContrast >= darkContrast ? THUMB_OUTLINE_LIGHT : THUMB_OUTLINE_DARK;
  }

  function emit(next: HsvColor, nextAlpha: number = alpha) {
    hsv = {
      h: clampPickerHue(next.h),
      s: clampPercent(next.s),
      v: clampPercent(next.v),
    };
    alpha = clampChannel(nextAlpha);
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const hex = rgbaToHex(r, g, b, alpha);
    hexDraft = hex;
    onChange(hex);
  }

  function pointerToSv(e: PointerEvent) {
    if (!svEl) return;
    const rect = svEl.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
    const s = (x / rect.width) * 100;
    const v = 100 - (y / rect.height) * 100;
    emit({ h: hsv.h, s, v });
  }

  function startSvDrag(e: PointerEvent) {
    e.preventDefault();
    pointerToSv(e);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    function onMove(ev: PointerEvent) {
      pointerToSv(ev);
    }
    function onUp(ev: PointerEvent) {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  function pointerToHue(e: PointerEvent) {
    const ratio = pointerRatio(e, hueEl);
    if (ratio === null) return;
    const h = ratio * 360;
    emit({ h, s: hsv.s, v: hsv.v });
  }

  function startHueDrag(e: PointerEvent) {
    e.preventDefault();
    pointerToHue(e);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    function onMove(ev: PointerEvent) {
      pointerToHue(ev);
    }
    function onUp(ev: PointerEvent) {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  function pointerToAlpha(e: PointerEvent) {
    const ratio = pointerRatio(e, alphaEl);
    if (ratio === null) return;
    const a = Math.round(ratio * 255);
    emit(hsv, a);
  }

  function startAlphaDrag(e: PointerEvent) {
    e.preventDefault();
    pointerToAlpha(e);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    function onMove(ev: PointerEvent) {
      pointerToAlpha(ev);
    }
    function onUp(ev: PointerEvent) {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  function commitHexDraft() {
    const normalized = normalizeHex(hexDraft);
    if (!normalized) {
      hexDraft = currentEmittedHex();
      return;
    }
    const rgba = hexToRgba(normalized);
    if (!rgba) return;
    emit(rgbToHsv(rgba.r, rgba.g, rgba.b), rgba.a);
  }

  function selectHexInput(e: FocusEvent | MouseEvent | PointerEvent) {
    const target = e.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    target.select();
  }

  function handleHexPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    e.preventDefault();
    target.focus({ preventScroll: true });
    target.select();
  }

  function setRgb(r: number, g: number, b: number) {
    const next = rgbToHsv(clampChannel(r), clampChannel(g), clampChannel(b));
    emit(next);
  }

  function setHsv(field: "h" | "s" | "v", value: number) {
    if (!Number.isFinite(value)) return;
    if (field === "h") emit({ h: value, s: hsv.s, v: hsv.v });
    if (field === "s") emit({ h: hsv.h, s: value, v: hsv.v });
    if (field === "v") emit({ h: hsv.h, s: hsv.s, v: value });
  }

  function setAlphaPercent(value: number) {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(Math.max(value, 0), 100);
    emit(hsv, Math.round((clamped / 100) * 255));
  }

  function close() {
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  $effect(() => {
    if (!open) return;
    updateThumbContour();
    const root = document.documentElement;
    const chromeObserver = new MutationObserver(updateThumbContour);
    chromeObserver.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerEl?.contains(target)) return;
      if (popoverEl?.contains(target)) return;
      close();
    }
    // Close on scroll instead of repositioning: cheaper, and the popover is
    // tied to a specific anchor, so letting it drift with the layout looks
    // broken. Resize gets a reposition since users expect the panel to track
    // the trigger across window resizes.
    function handleScroll() {
      close();
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
      chromeObserver.disconnect();
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class={cn(
    fluid ? "flex w-full items-center gap-1.5" : "inline-flex items-center gap-1.5",
    className,
  )}
>
  <button
    bind:this={triggerEl}
    type="button"
    disabled={readOnly}
    aria-label={label ? `Edit ${label}` : "Edit color"}
    onclick={toggleOpen}
    class={cn(
      "relative shrink-0 overflow-hidden rounded-md border border-border shadow-sm transition-shadow",
      readOnly ? "cursor-not-allowed" : "hover:shadow-md",
    )}
    style="width: {swatchSize}px; height: {swatchSize}px;{alpha < 255 ? ` background: ${CHECKER_BG};` : ''}"
  >
    <span
      class="absolute inset-0 block"
      style="background: {normalizeHex(value) ?? '#000000'};"
    ></span>
  </button>
  <input
    type="text"
    spellcheck={false}
    bind:value={hexDraft}
    disabled={readOnly}
    onpointerdown={handleHexPointerDown}
    onfocus={selectHexInput}
    onclick={selectHexInput}
    onblur={commitHexDraft}
    onkeydown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitHexDraft();
        (e.currentTarget as HTMLInputElement).blur();
      }
    }}
    class={cn(
      "h-7 rounded-md border border-border bg-card px-2 text-[12px] leading-[26px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
      fluid ? "min-w-0 flex-1" : "w-[76px]",
      readOnly && "cursor-not-allowed opacity-60",
    )}
  />
  {#if onReset}
    <button
      type="button"
      onclick={onReset}
      disabled={!canReset}
      aria-label="Reset color"
      title="Reset to default"
      class={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors",
        canReset
          ? "hover:bg-accent hover:text-accent-foreground"
          : "cursor-not-allowed opacity-40",
      )}
    >
      <RotateCcw size={12} strokeWidth={2.25} />
    </button>
  {/if}

  {#if open}
    <div
      bind:this={popoverEl}
      use:portal
      role="dialog"
      aria-label={label ? `${label} color picker` : "Color picker"}
      class="fixed z-[80] w-[228px] rounded-lg border border-border bg-popover p-3 shadow-xl"
      style="top: {popoverPos.top}px; left: {popoverPos.left}px;"
    >
      <div
        bind:this={svEl}
        onpointerdown={startSvDrag}
        role="slider"
        aria-label="Saturation and value"
        aria-valuenow={Math.round(hsv.s)}
        tabindex="0"
        class="relative h-[150px] w-full touch-none rounded-md"
        style="background:
          linear-gradient(to top, #000, transparent),
          linear-gradient(to right, #fff, transparent),
          {hueColor};"
      >
        <div
          class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow"
          style="left: {hsv.s}%; top: {100 - hsv.v}%; border-color: {thumbContour};"
        ></div>
      </div>

      <div
        bind:this={hueEl}
        onpointerdown={startHueDrag}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        tabindex="0"
        class="relative mt-3 h-3 w-full touch-none rounded-full"
        style="background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);"
      >
        <div
          class="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border bg-transparent shadow"
          style="left: {(hsv.h / 360) * 100}%; border-color: {thumbContour};"
        ></div>
      </div>

      <div
        bind:this={alphaEl}
        onpointerdown={startAlphaDrag}
        role="slider"
        aria-label="Alpha"
        aria-valuenow={alphaPercentDisplay}
        tabindex="0"
        class="relative mt-2 h-3 w-full touch-none rounded-full"
        style="background: {CHECKER_BG};"
      >
        <div
          class="pointer-events-none absolute inset-0 rounded-full"
          style="background: linear-gradient(to right, {transparentHex} 0%, {solidHex} 100%);"
        ></div>
        <div
          class="pointer-events-none absolute top-1/2 z-10 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border bg-transparent shadow"
          style="left: {(alpha / 255) * 100}%; border-color: {thumbContour};"
        ></div>
      </div>

      <div class="mt-3 grid grid-cols-4 gap-2 text-[11px]">
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">H</span>
          <input
            type="number"
            min="0"
            max="360"
            value={Math.round(hsv.h)}
            onchange={(e) =>
              setHsv("h", Number((e.currentTarget as HTMLInputElement).value))}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">S</span>
          <input
            type="number"
            min="0"
            max="100"
            value={Math.round(hsv.s)}
            onchange={(e) =>
              setHsv("s", Number((e.currentTarget as HTMLInputElement).value))}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">V</span>
          <input
            type="number"
            min="0"
            max="100"
            value={Math.round(hsv.v)}
            onchange={(e) =>
              setHsv("v", Number((e.currentTarget as HTMLInputElement).value))}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">A%</span>
          <input
            type="number"
            min="0"
            max="100"
            value={alphaPercentDisplay}
            onchange={(e) =>
              setAlphaPercent(
                Number((e.currentTarget as HTMLInputElement).value),
              )}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>

      <div class="mt-2 flex flex-col gap-0.5 text-[11px]">
        <span class="text-muted-foreground">HEX</span>
        <input
          type="text"
          spellcheck={false}
          bind:value={hexDraft}
          onpointerdown={handleHexPointerDown}
          onfocus={selectHexInput}
          onclick={selectHexInput}
          onblur={commitHexDraft}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitHexDraft();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          class="h-7 w-full rounded-md border border-border bg-card px-2 text-[12px] leading-[26px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div class="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">R</span>
          <input
            type="number"
            min="0"
            max="255"
            value={rgb.r}
            onchange={(e) =>
              setRgb(
                Number((e.currentTarget as HTMLInputElement).value),
                rgb.g,
                rgb.b,
              )}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">G</span>
          <input
            type="number"
            min="0"
            max="255"
            value={rgb.g}
            onchange={(e) =>
              setRgb(
                rgb.r,
                Number((e.currentTarget as HTMLInputElement).value),
                rgb.b,
              )}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">B</span>
          <input
            type="number"
            min="0"
            max="255"
            value={rgb.b}
            onchange={(e) =>
              setRgb(
                rgb.r,
                rgb.g,
                Number((e.currentTarget as HTMLInputElement).value),
              )}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>
    </div>
  {/if}
</div>

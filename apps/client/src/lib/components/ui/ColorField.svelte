<script lang="ts">
  import { untrack } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";
  import { portal } from "$lib/utils/portal";
  import {
    COLOR_PICKER_EDGE_MARGIN,
    COLOR_PICKER_HEIGHT,
    COLOR_PICKER_WIDTH,
    pickColorPickerGeometry,
  } from "$lib/utils/responsive";
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

  type ColorFormat = "hex" | "rgb" | "hsv";

  const COLOR_FORMAT_OPTIONS: ReadonlyArray<{
    value: ColorFormat;
    label: string;
  }> = [
    { value: "hex", label: "HEX" },
    { value: "rgb", label: "RGB" },
    { value: "hsv", label: "HSV" },
  ];

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
  let pickerGeometry = $state(
    pickColorPickerGeometry({
      viewport: { width: 1200, height: 800 },
      trigger: { x: 0, y: 0, width: 0, height: 0 },
    }),
  );
  let svEl: HTMLDivElement | undefined = $state();
  let hueEl: HTMLDivElement | undefined = $state();
  let alphaEl: HTMLDivElement | undefined = $state();
  let formatMenuEl: HTMLDivElement | undefined = $state();
  let activeFormat = $state<ColorFormat>("hex");
  let formatMenuOpen = $state(false);
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
    pickerGeometry = pickColorPickerGeometry({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      trigger: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      popoverWidth: COLOR_PICKER_WIDTH,
      popoverHeight: COLOR_PICKER_HEIGHT,
      edgeMargin: COLOR_PICKER_EDGE_MARGIN,
    });
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
  const activeFormatLabel = $derived(
    COLOR_FORMAT_OPTIONS.find((option) => option.value === activeFormat)?.label ??
      "HEX",
  );

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

  function selectFormat(format: ColorFormat) {
    activeFormat = format;
    formatMenuOpen = false;
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

  function close() {
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (formatMenuOpen) {
        formatMenuOpen = false;
        return;
      }
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
      if (formatMenuOpen && !formatMenuEl?.contains(target)) {
        formatMenuOpen = false;
      }
      if (triggerEl?.contains(target)) return;
      if (popoverEl?.contains(target)) return;
      close();
    }
    // Close on scroll instead of repositioning: cheaper, and the popover is
    // tied to a specific anchor, so letting it drift with the layout looks
    // broken. Resize gets a reposition since users expect the panel to track
    // the trigger across window resizes.
    function handleScroll(e: Event) {
      const target = e.target;
      if (target instanceof Node && popoverEl?.contains(target)) return;
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

  const pickerStyle = $derived.by(() => {
    const { rect, layout } = pickerGeometry;
    const sizeRule =
      layout === "fullscreen"
        ? `height: ${rect.height}px`
        : `max-height: ${rect.height}px`;
    return [
      `top: ${rect.y}px`,
      `left: ${rect.x}px`,
      `width: ${rect.width}px`,
      sizeRule,
    ].join("; ");
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
      class={cn(
        "fixed z-[80] overflow-y-auto border border-border bg-popover p-3 shadow-xl",
        pickerGeometry.layout === "popover" && "rounded-lg",
        pickerGeometry.layout === "sheet" && "rounded-lg",
        pickerGeometry.layout === "fullscreen" && "rounded-none border-x-0 border-b-0",
      )}
      style={pickerStyle}
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

      <div class="relative mt-3 flex items-center gap-2 text-[11px]">
        <div bind:this={formatMenuEl} class="relative shrink-0">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={formatMenuOpen}
            onclick={() => (formatMenuOpen = !formatMenuOpen)}
            class="flex h-7 w-[62px] items-center justify-between rounded-md border border-border bg-card px-2 font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <span>{activeFormatLabel}</span>
            <ChevronDown size={12} strokeWidth={2.25} />
          </button>
          {#if formatMenuOpen}
            <div
              role="listbox"
              aria-label="Color value format"
              class="absolute bottom-full left-0 z-10 mb-1 w-[72px] overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg"
            >
              {#each COLOR_FORMAT_OPTIONS as option}
                <button
                  type="button"
                  role="option"
                  aria-selected={activeFormat === option.value}
                  onclick={() => selectFormat(option.value)}
                  class={cn(
                    "flex h-7 w-full items-center rounded px-2 text-left font-medium transition-colors",
                    activeFormat === option.value
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if activeFormat === "hex"}
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
            aria-label="Hex color value"
            class="h-7 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-[12px] leading-[26px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        {:else if activeFormat === "rgb"}
          <div class="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
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
              aria-label="Red channel"
              class="h-7 min-w-0 rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
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
              aria-label="Green channel"
              class="h-7 min-w-0 rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
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
              aria-label="Blue channel"
              class="h-7 min-w-0 rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        {:else}
          <div class="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
            <input
              type="number"
              min="0"
              max="360"
              value={Math.round(hsv.h)}
              onchange={(e) =>
                setHsv("h", Number((e.currentTarget as HTMLInputElement).value))}
              aria-label="Hue channel"
              class="h-7 min-w-0 rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={Math.round(hsv.s)}
              onchange={(e) =>
                setHsv("s", Number((e.currentTarget as HTMLInputElement).value))}
              aria-label="Saturation channel"
              class="h-7 min-w-0 rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={Math.round(hsv.v)}
              onchange={(e) =>
                setHsv("v", Number((e.currentTarget as HTMLInputElement).value))}
              aria-label="Value channel"
              class="h-7 min-w-0 rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  input[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
  }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    margin: 0;
    -webkit-appearance: none;
  }
</style>

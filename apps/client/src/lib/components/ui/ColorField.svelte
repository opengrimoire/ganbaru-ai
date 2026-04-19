<script lang="ts">
  import { untrack } from "svelte";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";
  import {
    type HsvColor,
    clampChannel,
    clampHue,
    clampPercent,
    hexToHsv,
    hsvToHex,
    hsvToRgb,
    normalizeHex,
    rgbToHsv,
  } from "./colorMath";

  let {
    value,
    onChange,
    onReset,
    canReset = false,
    label,
    swatchSize = 26,
    class: className = "",
  }: {
    value: string;
    onChange: (hex: string) => void;
    onReset?: () => void;
    canReset?: boolean;
    label?: string;
    swatchSize?: number;
    class?: string;
  } = $props();

  let open = $state(false);
  let rootEl: HTMLDivElement | undefined = $state();
  let svEl: HTMLDivElement | undefined = $state();
  let hueEl: HTMLDivElement | undefined = $state();
  let hexDraft = $state(untrack(() => normalizeHex(value) ?? "#000000"));
  let hsv = $state<HsvColor>(
    untrack(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 }),
  );

  // External value can change (theme switch, reset). Sync local state when
  // the popover is closed, or when the incoming value differs from the hex
  // we currently emit, so the picker stays in lockstep with the model.
  $effect(() => {
    const normalized = normalizeHex(value);
    if (!normalized) return;
    if (!open) {
      hexDraft = normalized;
      hsv = hexToHsv(normalized) ?? hsv;
      return;
    }
    const currentHex = normalizeHex(hsvToHex(hsv.h, hsv.s, hsv.v));
    if (currentHex !== normalized) {
      hexDraft = normalized;
      hsv = hexToHsv(normalized) ?? hsv;
    }
  });

  const rgb = $derived(hsvToRgb(hsv.h, hsv.s, hsv.v));
  const hueColor = $derived(hsvToHex(hsv.h, 100, 100));

  function emit(next: HsvColor) {
    hsv = {
      h: clampHue(next.h),
      s: clampPercent(next.s),
      v: clampPercent(next.v),
    };
    const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
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
    if (!hueEl) return;
    const rect = hueEl.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    const h = (x / rect.width) * 360;
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

  function commitHexDraft() {
    const normalized = normalizeHex(hexDraft);
    if (!normalized) {
      hexDraft = hsvToHex(hsv.h, hsv.s, hsv.v);
      return;
    }
    const next = hexToHsv(normalized);
    if (!next) return;
    emit(next);
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
      close();
    }
  }

  $effect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (!rootEl) return;
      if (rootEl.contains(e.target as Node)) return;
      close();
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      window.removeEventListener("mousedown", handleClickOutside, true);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div bind:this={rootEl} class={cn("relative inline-flex items-center gap-1.5", className)}>
  <button
    type="button"
    aria-label={label ? `Edit ${label}` : "Edit color"}
    onclick={() => (open = !open)}
    class="rounded-md border border-border shadow-sm transition-shadow hover:shadow-md"
    style="width: {swatchSize}px; height: {swatchSize}px; background: {normalizeHex(value) ??
      '#000000'};"
  ></button>
  <input
    type="text"
    spellcheck={false}
    bind:value={hexDraft}
    onblur={commitHexDraft}
    onkeydown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitHexDraft();
        (e.currentTarget as HTMLInputElement).blur();
      }
    }}
    class="h-7 w-[88px] rounded-md border border-border bg-card px-2 text-[12px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
  />
  {#if onReset}
    <button
      type="button"
      onclick={onReset}
      disabled={!canReset}
      aria-label="Reset color"
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

  {#if open}
    <div
      role="dialog"
      aria-label={label ? `${label} color picker` : "Color picker"}
      class="absolute left-0 top-[calc(100%+6px)] z-[80] w-[228px] rounded-lg border border-border bg-popover p-3 shadow-xl"
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
          class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style="left: {hsv.s}%; top: {100 - hsv.v}%;"
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
          class="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-transparent shadow"
          style="left: {(hsv.h / 360) * 100}%;"
        ></div>
      </div>

      <div class="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <label class="flex flex-col gap-0.5">
          <span class="text-muted-foreground">H</span>
          <input
            type="number"
            min="0"
            max="360"
            value={Math.round(hsv.h)}
            onchange={(e) =>
              setHsv("h", Number((e.currentTarget as HTMLInputElement).value))}
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
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
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
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
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
          />
        </label>
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
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
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
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
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
            class="h-7 w-full rounded-md border border-border bg-card px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
          />
        </label>
      </div>
    </div>
  {/if}
</div>

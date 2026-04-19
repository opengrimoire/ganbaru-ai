<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import {
    FONT_SCALE_MIN,
    FONT_SCALE_MAX,
    DEFAULT_FONT_SCALE,
    DEFAULT_FONT_FAMILY_ID,
    clampFontScale,
  } from "$lib/stores/preferences";
  import type { EventColor } from "$lib/components/calendar/types";
  import { cn } from "$lib/utils";
  import StepperControl from "./StepperControl.svelte";
  import CustomSelect from "./CustomSelect.svelte";

  let {
    onNavigate,
  }: {
    onNavigate?: (section: "appearance" | "themes") => void;
  } = $props();

  const theme = getTheme();
  const preferences = getPreferences();
  const zoom = getZoom();
  const calZoom = getCalendarZoom();

  // A compact preview row of representative event-palette slots. Shows how
  // the theme's colors look without dumping all 24 swatches in the picker.
  const PREVIEW_SLOTS: readonly EventColor[] = [
    "tomato",
    "tangerine",
    "banana",
    "basil",
    "peacock",
    "blueberry",
    "grape",
    "graphite",
  ];

  const FONT_SCALE_STEP = 0.05;

  function incrementFontScale() {
    preferences.setFontScale(clampFontScale(preferences.fontScale + FONT_SCALE_STEP));
  }
  function decrementFontScale() {
    preferences.setFontScale(clampFontScale(preferences.fontScale - FONT_SCALE_STEP));
  }

  const fontFamilyOptions = $derived(
    preferences.fontFamilies.map((f) => ({
      value: f.id,
      label:
        f.id === DEFAULT_FONT_FAMILY_ID
          ? `${f.displayName} (recommended)`
          : f.displayName,
      style: `font-family: ${f.cssStack};`,
    })),
  );

  let themePickerOpen = $state(false);
  let themePickerRoot: HTMLDivElement | undefined = $state();

  const themeOptions = $derived(Object.values(theme.registry));
  const activeTheme = $derived(theme.current);

  function handleKeydown(e: KeyboardEvent) {
    if (!themePickerOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      themePickerOpen = false;
    }
  }

  $effect(() => {
    if (!themePickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (!themePickerRoot) return;
      if (themePickerRoot.contains(e.target as Node)) return;
      themePickerOpen = false;
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      window.removeEventListener("mousedown", handleClickOutside, true);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col gap-6">
  <!-- Theme -->
  <section class="flex flex-col gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-foreground">Theme</h2>
    <div
      class="flex flex-col gap-0 overflow-hidden rounded-lg bg-card dark:bg-background"
    >
      <div class="flex items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="text-[13px] text-foreground">Active theme</div>
          <div
            class="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            {activeTheme.base}
            <span class="text-muted-foreground/60">·</span>
            {theme.isBuiltin(activeTheme.id) ? "built-in" : "user"}
          </div>
        </div>
        <div bind:this={themePickerRoot} class="relative">
          <button
            type="button"
            onclick={() => (themePickerOpen = !themePickerOpen)}
            aria-haspopup="listbox"
            aria-expanded={themePickerOpen}
            class="flex h-7 min-w-[220px] items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            <span class="flex items-center gap-1.5">
              {#each PREVIEW_SLOTS.slice(0, 6) as slot}
                <span
                  class="h-2.5 w-2.5 rounded-full"
                  style="background-color: {activeTheme.eventPalette[slot]};"
                ></span>
              {/each}
              <span class="ml-1 truncate">{activeTheme.displayName}</span>
            </span>
            <ChevronDown
              size={13}
              strokeWidth={2}
              class={cn(
                "shrink-0 transition-transform",
                themePickerOpen && "rotate-180",
              )}
            />
          </button>
          {#if themePickerOpen}
            <div
              role="listbox"
              class="absolute right-0 top-[calc(100%+4px)] z-[80] min-w-full overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
            >
              {#each themeOptions as option}
                {@const isActive = option.id === theme.id}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onclick={() => {
                    theme.setTheme(option.id);
                    themePickerOpen = false;
                  }}
                  class={cn(
                    "flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[12px] transition-colors",
                    isActive
                      ? "bg-accent/60 text-foreground"
                      : "text-foreground hover:bg-accent/40",
                  )}
                >
                  <span class="flex items-center gap-1.5">
                    {#each PREVIEW_SLOTS.slice(0, 6) as slot}
                      <span
                        class="h-2.5 w-2.5 rounded-full"
                        style="background-color: {option.eventPalette[slot]};"
                      ></span>
                    {/each}
                    <span class="ml-1 truncate">{option.displayName}</span>
                  </span>
                  {#if isActive}
                    <Check size={12} strokeWidth={2.5} class="shrink-0" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      {#if onNavigate}
        <button
          type="button"
          onclick={() => onNavigate?.("themes")}
          class="flex items-center gap-1 self-start px-4 py-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Manage themes
        </button>
      {/if}
    </div>
  </section>

  <!-- Text and zoom -->
  <section class="flex flex-col gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-foreground">Text and zoom</h2>
    <div
      class="divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
    >
      <CustomSelect
        label="Font family"
        description="Resolves through system or installed fonts."
        value={preferences.fontFamilyId}
        options={fontFamilyOptions}
        onChange={(id) => preferences.setFontFamily(id)}
        canReset={preferences.fontFamilyId !== DEFAULT_FONT_FAMILY_ID}
        onReset={() => preferences.resetFontFamily()}
      />
      <StepperControl
        label="Text size"
        description="Multiplies the base text size across the app."
        displayValue={`${Math.round(preferences.fontScale * 100)}%`}
        canIncrement={preferences.fontScale < FONT_SCALE_MAX}
        canDecrement={preferences.fontScale > FONT_SCALE_MIN}
        canReset={preferences.fontScale !== DEFAULT_FONT_SCALE}
        onIncrement={incrementFontScale}
        onDecrement={decrementFontScale}
        onReset={() => preferences.resetFontScale()}
      />
      <StepperControl
        label="App zoom"
        description="Scales the whole interface. Shortcut: Ctrl +, Ctrl -, Ctrl 0."
        displayValue={`${zoom.percent}%`}
        canIncrement={zoom.canZoomIn}
        canDecrement={zoom.canZoomOut}
        canReset={!zoom.isDefault}
        onIncrement={() => zoom.zoomIn()}
        onDecrement={() => zoom.zoomOut()}
        onReset={() => zoom.reset()}
      />
      <StepperControl
        label="Calendar zoom (5min / 10min / 15min / 30min)"
        description="Hour row height. Finer rows enable smaller slot snapping."
        displayValue={`${calZoom.zoomPercent}% (${calZoom.gridMinutes}min)`}
        canIncrement={calZoom.canZoomIn}
        canDecrement={calZoom.canZoomOut}
        canReset={!calZoom.isDefault}
        onIncrement={() => calZoom.zoomStep(1)}
        onDecrement={() => calZoom.zoomStep(-1)}
        onReset={() => calZoom.reset()}
      />
    </div>
  </section>
</div>

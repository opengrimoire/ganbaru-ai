<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
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
</script>

<div class="flex flex-col gap-6">
  <!-- Theme -->
  <section class="flex flex-col gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-foreground">Theme</h2>
    <div
      class="divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
    >
      {#each Object.values(theme.registry) as option}
        {@const isActive = option.id === theme.id}
        <button
          onclick={() => theme.setTheme(option.id)}
          class={cn(
            "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors",
            isActive ? "bg-accent/50" : "hover:bg-accent/30",
          )}
        >
          <div class="min-w-0 flex-1">
            <div class="text-[13px] text-foreground">
              {option.displayName}
            </div>
            <div
              class="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              {option.base}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1">
              {#each PREVIEW_SLOTS as slot}
                <span
                  class="h-3.5 w-3.5 rounded-full"
                  style="background-color: {option.eventPalette[slot]};"
                ></span>
              {/each}
            </div>
            {#if isActive}
              <Check size={14} strokeWidth={2.5} class="shrink-0 text-foreground" />
            {/if}
          </div>
        </button>
      {/each}
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

<script lang="ts">
  import { tick } from "svelte";
  import { FALLBACK_COLOR_INDEX, type EventColor } from "./types";
  import { moveRovingIndex } from "./event-panel-utils";
  import { EVENT_COLOR_OPTIONS, getEventColor } from "./utils";
  import { contrastRatio } from "$lib/components/ui/colorMath";
  import { resolveCalendarTokens, type Theme } from "$lib/stores/themes";

  let {
    color,
    theme,
    onselect,
  }: {
    color: EventColor | undefined;
    theme: Theme;
    onselect: (color: EventColor | undefined) => void;
  } = $props();

  let open = $state(false);
  let buttonEl: HTMLButtonElement | undefined = $state();
  let paletteEl: HTMLDivElement | undefined = $state();
  let activeIndex = $state(0);

  const selectedColor = $derived(color ?? FALLBACK_COLOR_INDEX);
  const colorEntry = $derived(getEventColor(color, theme));
  const calendarTokens = $derived(resolveCalendarTokens(theme));
  const pickerBg = $derived(calendarTokens["--cal-bg"]);
  const pickerText = $derived(calendarTokens["--cal-time-label"]);
  const pickerRing = $derived(calendarTokens["--cal-gridline"]);
  const selectionBorder = $derived(
    contrastRatio(pickerBg, "#000000") >= contrastRatio(pickerBg, "#ffffff")
      ? "#000000"
      : "#ffffff",
  );

  function swatchStyle(bg: string): string {
    return `background-color: ${bg};`;
  }

  function selectedIndex(): number {
    return Math.max(0, EVENT_COLOR_OPTIONS.findIndex((entry) => entry === selectedColor));
  }

  async function focusButton() {
    await tick();
    buttonEl?.focus();
  }

  async function focusSwatch(index: number) {
    await tick();
    paletteEl?.querySelector<HTMLButtonElement>(`[data-color-index="${index}"]`)?.focus();
  }

  function openPalette(source: "keyboard" | "pointer") {
    activeIndex = selectedIndex();
    open = true;
    if (source === "keyboard") void focusSwatch(activeIndex);
  }

  function closePalette(source: "keyboard" | "pointer") {
    open = false;
    if (source === "keyboard") void focusButton();
  }

  function togglePalette() {
    if (open) closePalette("pointer");
    else openPalette("pointer");
  }

  function selectColor(nextColor: EventColor, source: "keyboard" | "pointer"): void {
    if (selectedColor !== nextColor) onselect(nextColor);
    if (source === "keyboard") closePalette("keyboard");
  }

  function handleButtonKeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    openPalette("keyboard");
  }

  function handleSwatchKeydown(e: KeyboardEvent, index: number, nextColor: EventColor) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePalette("keyboard");
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      selectColor(nextColor, "keyboard");
      return;
    }

    const nextIndex = moveRovingIndex({
      currentIndex: index,
      itemCount: EVENT_COLOR_OPTIONS.length,
      key: e.key,
      orientation: "grid",
      columns: 4,
    });
    if (nextIndex === index) return;
    e.preventDefault();
    e.stopPropagation();
    activeIndex = nextIndex;
    void focusSwatch(nextIndex);
  }
</script>

<div class="relative flex items-center">
  <button
    bind:this={buttonEl}
    onclick={togglePalette}
    onkeydown={handleButtonKeydown}
    class="size-4 shrink-0 rounded-sm"
    style="background-color: {colorEntry.bg};"
    title="Event color"
    data-app-tooltip-focus-disabled="true"
  ></button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-60" onclick={() => closePalette("pointer")}></div>
    <div
      bind:this={paletteEl}
      class="absolute right-0 top-full z-61 mt-1 grid gap-1.5 rounded-lg p-2.5 shadow-lg ring-1"
      style="
        grid-template-columns: repeat(4, 1.25rem);
        background-color: {pickerBg};
        color: {pickerText};
        --selection-border: {selectionBorder};
        --tw-ring-color: {pickerRing};
      "
    >
      {#each EVENT_COLOR_OPTIONS as c, index}
        {@const entry = getEventColor(c, theme)}
        <button
          data-color-index={index}
          tabindex={activeIndex === index ? 0 : -1}
          onclick={() => { selectColor(c, "pointer"); }}
          onfocus={() => { activeIndex = index; }}
          onkeydown={(e) => handleSwatchKeydown(e, index, c)}
          class="calendar-color-swatch size-5 rounded-[3px]"
          class:swatch-selected={selectedColor === c}
          style={swatchStyle(entry.bg)}
          title={entry.bg}
          data-app-tooltip-focus-disabled="true"
        ></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .calendar-color-swatch {
    position: relative;
    overflow: hidden;
  }

  .calendar-color-swatch.swatch-selected::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 2px solid var(--selection-border);
    border-radius: inherit;
    pointer-events: none;
  }
</style>

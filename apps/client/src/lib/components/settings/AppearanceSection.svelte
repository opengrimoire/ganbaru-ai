<script lang="ts">
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
  import type { ThemeId } from "$lib/stores/themes";
  import StepperControl from "./StepperControl.svelte";
  import CustomSelect from "./CustomSelect.svelte";
  import ThemeList from "./ThemeList.svelte";
  import ThemeEditor from "./ThemeEditor.svelte";

  const theme = getTheme();
  const preferences = getPreferences();
  const zoom = getZoom();
  const calZoom = getCalendarZoom();

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

  let mode = $state<"list" | "editor">("list");
  let editingId = $state<ThemeId | undefined>(undefined);

  const editingTheme = $derived(
    editingId ? theme.registry[editingId] : undefined,
  );

  function openEditor(id: ThemeId) {
    editingId = id;
    mode = "editor";
  }

  function exitEditor() {
    mode = "list";
    editingId = undefined;
  }
</script>

{#if mode === "editor" && editingTheme}
  <ThemeEditor theme={editingTheme} onDone={exitEditor} />
{:else}
  <div class="flex flex-col gap-6">
    <ThemeList onOpenEditor={openEditor} />

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
{/if}

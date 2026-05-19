<script lang="ts">
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { APP_ZOOM_LEVELS, getZoom } from "$lib/stores/zoom.svelte";
  import {
    CALENDAR_ZOOM_PERCENT_LEVELS,
    calendarZoomGridMinutesForPercent,
    getCalendarZoom,
  } from "$lib/stores/calendarZoom.svelte";
  import {
    DEFAULT_FONT_SCALE,
    DEFAULT_FONT_FAMILY_ID,
    FONT_SCALE_LEVELS,
  } from "$lib/stores/preferences";
  import CustomSelect from "./CustomSelect.svelte";
  import ThemeList from "./ThemeList.svelte";

  const preferences = getPreferences();
  const zoom = getZoom();
  const calZoom = getCalendarZoom();

  type SelectOption = { value: string; label: string; style?: string };

  function percentString(percent: number): string {
    return String(Math.round(percent));
  }

  function handleAppZoomChange(value: string) {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return;
    zoom.setLevel(percent / 100);
  }

  function handleCalendarZoomChange(value: string) {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return;
    calZoom.setZoomPercent(percent);
  }

  function handleFontScaleChange(value: string) {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return;
    preferences.setFontScale(percent / 100);
  }

  const appZoomOptions: readonly SelectOption[] = APP_ZOOM_LEVELS.map((level) => {
    const percent = Math.round(level * 100);
    return { value: percentString(percent), label: `${percent}%` };
  });

  const calendarZoomOptions: readonly SelectOption[] = CALENDAR_ZOOM_PERCENT_LEVELS.map(
    (percent) => ({
      value: percentString(percent),
      label: `${percent}% (${calendarZoomGridMinutesForPercent(percent)}min)`,
    }),
  );

  const baseFontScaleOptions: readonly SelectOption[] = FONT_SCALE_LEVELS.map((level) => {
    const percent = Math.round(level * 100);
    return { value: percentString(percent), label: `${percent}%` };
  });

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

  const fontScaleValue = $derived(percentString(preferences.fontScale * 100));
  const fontScaleOptions = $derived.by(() => {
    if (baseFontScaleOptions.some((option) => option.value === fontScaleValue)) {
      return baseFontScaleOptions;
    }
    return [
      ...baseFontScaleOptions,
      { value: fontScaleValue, label: `${fontScaleValue}%` },
    ].sort((a, b) => Number(a.value) - Number(b.value));
  });
</script>

<div class="flex flex-col gap-6">
  <ThemeList />

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Zoom</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label="App zoom"
        description="Scales the whole interface. Shortcut: Ctrl +, Ctrl -, Ctrl 0"
        value={percentString(zoom.percent)}
        options={appZoomOptions}
        onChange={handleAppZoomChange}
        canReset={!zoom.isDefault}
        onReset={() => zoom.reset()}
      />
      <CustomSelect
        label="Calendar zoom (5min / 10min / 15min / 30min)"
        description="Hour row height. Finer rows enable smaller slot snapping"
        value={percentString(calZoom.zoomPercent)}
        options={calendarZoomOptions}
        onChange={handleCalendarZoomChange}
        canReset={!calZoom.isDefault}
        onReset={() => calZoom.reset()}
      />
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Text</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label="Font family"
        description="Resolves through system or installed fonts"
        value={preferences.fontFamilyId}
        options={fontFamilyOptions}
        onChange={(id) => preferences.setFontFamily(id)}
        canReset={preferences.fontFamilyId !== DEFAULT_FONT_FAMILY_ID}
        onReset={() => preferences.resetFontFamily()}
      />
      <CustomSelect
        label="Text size"
        description="Multiplies the base text size across the app"
        value={fontScaleValue}
        options={fontScaleOptions}
        onChange={handleFontScaleChange}
        canReset={preferences.fontScale !== DEFAULT_FONT_SCALE}
        onReset={() => preferences.resetFontScale()}
      />
    </div>
  </section>
</div>

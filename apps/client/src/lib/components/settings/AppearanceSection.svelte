<script lang="ts">
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { APP_ZOOM_LEVELS, getZoom } from "$lib/stores/zoom.svelte";
  import {
    CALENDAR_ZOOM_PERCENT_LEVELS,
    calendarZoomGridMinutesForPercent,
    getCalendarZoom,
  } from "$lib/stores/calendarZoom.svelte";
  import {
    DEFAULT_CALENDAR_TIME_FORMAT,
    DEFAULT_FONT_SCALE,
    DEFAULT_FONT_FAMILY_ID,
    FONT_SCALE_LEVELS,
    isLanguagePreference,
  } from "$lib/stores/preferences";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import CustomSelect from "./CustomSelect.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";
  import ThemeList from "./ThemeList.svelte";

  const preferences = getPreferences();
  const zoom = getZoom();
  const calZoom = getCalendarZoom();
  const { t } = getLocalization();

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

  const languageOptions = $derived<SelectOption[]>(
    preferences.languagePreferences.map((language) => {
      if (language === "system") {
        return { value: language, label: t("language.systemOption") };
      }
      if (language === "en") {
        return { value: language, label: t("language.englishOption") };
      }
      return { value: language, label: t("language.spanishOption") };
    }),
  );

  const timeFormatOptions = $derived<SelectOption[]>([
    { value: "24h", label: t("settings.appearance.timeFormat24h") },
    { value: "12h", label: t("settings.appearance.timeFormat12h") },
  ]);

  const calendarZoomOptions = $derived<SelectOption[]>(CALENDAR_ZOOM_PERCENT_LEVELS.map(
    (percent) => ({
      value: percentString(percent),
      label: t(
        "settings.appearance.calendarZoomOption",
        percent,
        calendarZoomGridMinutesForPercent(percent),
      ),
    }),
  ));

  const baseFontScaleOptions: readonly SelectOption[] = FONT_SCALE_LEVELS.map((level) => {
    const percent = Math.round(level * 100);
    return { value: percentString(percent), label: `${percent}%` };
  });

  const fontFamilyOptions = $derived(
    preferences.fontFamilies.map((f) => ({
      value: f.id,
      label:
        f.id === DEFAULT_FONT_FAMILY_ID
          ? `${f.displayName} (${t("settings.appearance.recommended")})`
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
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("settings.appearance.zoomHeading")}</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label={t("settings.appearance.appZoom")}
        descriptionShortcuts={["Mod + +", "Mod + -", "Mod + 0"]}
        value={percentString(zoom.percent)}
        options={appZoomOptions}
        onChange={handleAppZoomChange}
        canReset={!zoom.isDefault}
        onReset={() => zoom.reset()}
      />
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("settings.appearance.textHeading")}</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label={t("settings.appearance.fontFamily")}
        description={t("settings.appearance.fontFamilyDescription")}
        value={preferences.fontFamilyId}
        options={fontFamilyOptions}
        onChange={(id) => preferences.setFontFamily(id)}
        canReset={preferences.fontFamilyId !== DEFAULT_FONT_FAMILY_ID}
        onReset={() => preferences.resetFontFamily()}
      />
      <CustomSelect
        label={t("settings.appearance.textSize")}
        description={t("settings.appearance.textSizeDescription")}
        value={fontScaleValue}
        options={fontScaleOptions}
        onChange={handleFontScaleChange}
        canReset={preferences.fontScale !== DEFAULT_FONT_SCALE}
        onReset={() => preferences.resetFontScale()}
      />
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("settings.appearance.languageHeading")}</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label={t("language.preferenceLabel")}
        description={t("language.preferenceDescription")}
        value={preferences.languagePreference}
        options={languageOptions}
        onChange={(value) => {
          if (isLanguagePreference(value)) preferences.setLanguagePreference(value);
        }}
        canReset={preferences.languagePreference !== "system"}
        onReset={() => preferences.setLanguagePreference("system")}
      />
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("settings.appearance.calendarHeading")}</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label={t("settings.appearance.calendarZoom")}
        descriptionShortcuts={["Shift + +", "Shift + -", "Shift + 0"]}
        value={percentString(calZoom.zoomPercent)}
        options={calendarZoomOptions}
        onChange={handleCalendarZoomChange}
        canReset={!calZoom.isDefault}
        onReset={() => calZoom.reset()}
      />
      <CustomSelect
        label={t("settings.appearance.timeFormat")}
        description={t("settings.appearance.timeFormatDescription")}
        value={preferences.calendarTimeFormat}
        options={timeFormatOptions}
        onChange={(value) => {
          if (value === "24h" || value === "12h") preferences.setCalendarTimeFormat(value);
        }}
        canReset={preferences.calendarTimeFormat !== DEFAULT_CALENDAR_TIME_FORMAT}
        onReset={() => preferences.resetCalendarTimeFormat()}
      />
      <ToggleSetting
        label={t("settings.appearance.dimPastEventColors")}
        description={t("settings.appearance.dimPastEventColorsDescription")}
        checked={preferences.calendarDimPastEvents}
        onChange={(checked) => preferences.setCalendarDimPastEvents(checked)}
      />
    </div>
  </section>
</div>

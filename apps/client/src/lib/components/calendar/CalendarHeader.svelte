<script lang="ts">
  import type { CalendarViewMode } from "./types";
  import {
    formatDatePart,
    formatMonthYear,
    isToday,
  } from "./utils";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { onMount, tick } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Check from "@lucide/svelte/icons/check";
  import Settings from "@lucide/svelte/icons/settings";
  import Layers from "@lucide/svelte/icons/layers";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { calendarDisplayName } from "$lib/calendar/calendar-display";
  import { formatList } from "$lib/i18n/formatters";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import MiniDatePicker from "./MiniDatePicker.svelte";

  const calendarsStore = getCalendars();
  const settingsLauncher = getSettingsLauncher();
  const calZoom = getCalendarZoom();
  const localization = getLocalization();
  const { t } = localization;
  const locale = $derived(localization.locale);

  // Calendar account selector state
  let showAccountPicker = $state(false);

  // Mini calendar popover state
  let showMiniCalendar = $state(false);
  let miniCalendarButton: HTMLButtonElement | undefined = $state();

  let {
    anchorDate,
    viewMode,
    onNavigate,
    onViewChange,
    onDaySelect,
  }: {
    anchorDate: Date;
    viewMode: CalendarViewMode;
    onNavigate: (direction: "today" | "back" | "forward") => void;
    onViewChange: (mode: CalendarViewMode) => void;
    onDaySelect: (date: Date) => void;
  } = $props();

  const viewOptions = $derived.by((): {
    mode: CalendarViewMode;
    label: string;
    title: string;
    shortcuts: string[];
  }[] => [
    { mode: "day", label: "1d", title: t("calendar.toolbar.dayView"), shortcuts: ["1"] },
    {
      mode: "workweek",
      label: "5d",
      title: t("calendar.toolbar.workCycleView"),
      shortcuts: ["2"],
    },
    { mode: "week", label: "7d", title: t("calendar.toolbar.weekView"), shortcuts: ["3"] },
    {
      mode: "month",
      label: "31d",
      title: t("calendar.toolbar.monthView"),
      shortcuts: ["4"],
    },
  ]);
  const todayShortcuts = ["0"] as const;

  function shortcutTitle(shortcuts: readonly string[]): string {
    const labels = shortcuts.map((shortcut) =>
      t("calendar.toolbar.shortcutKey", shortcut),
    );
    if (labels.length === 1) return labels[0];
    return formatList(locale, labels, { type: "disjunction" });
  }

  // Keyboard shortcuts for view switching and "today". Arrow-key navigation is
  // owned by CalendarView so target readiness gating and stale-event drops
  // apply uniformly. Adding a second listener here would let
  // auto-repeat keydowns bypass the gate and drain the queue for seconds
  // after the user releases the key.
  onMount(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      switch (e.key) {
        case "0":
          e.preventDefault();
          onNavigate("today");
          break;
        case "1":
          e.preventDefault();
          onViewChange("day");
          break;
        case "2":
          e.preventDefault();
          onViewChange("workweek");
          break;
        case "3":
          e.preventDefault();
          onViewChange("week");
          break;
        case "4":
          e.preventDefault();
          onViewChange("month");
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const isOnToday = $derived(isToday(anchorDate));
  const anchorDateStr = $derived(formatDatePart(anchorDate));
  const pickerHighlightMode = $derived(
    viewMode === "day" ? "day" : viewMode === "week" ? "week" : viewMode === "workweek" ? "workweek" : "none",
  );

  function handleHeaderClick() {
    showMiniCalendar = !showMiniCalendar;
  }

  async function focusMiniCalendarButton() {
    await tick();
    miniCalendarButton?.focus();
  }

  function closeMiniCalendar(source?: "keyboard" | "pointer") {
    showMiniCalendar = false;
    if (source === "keyboard") void focusMiniCalendarButton();
  }

  // Wheel navigation on the header row mirrors the arrow controls.
  let wheelCooldown = false;

  function handleToolbarWheel(e: WheelEvent) {
    e.preventDefault();
    if (wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;

    const delta = e.deltaY > 0 ? 1 : -1;
    onNavigate(delta > 0 ? "forward" : "back");

    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  function selectPickerDay(dateStr: string, source?: "keyboard" | "pointer") {
    const [year, month, day] = dateStr.split("-").map(Number);
    onDaySelect(new Date(year, month - 1, day));
    closeMiniCalendar(source);
  }
</script>

<!-- Toolbar row -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-calendar-edit-close-zone
  class="flex shrink-0 items-center gap-1 px-3"
  style="height: var(--cal-header-row-h); background-color: var(--cal-header-bg); border-bottom: 1px solid var(--sidebar);"
  onwheel={handleToolbarWheel}
>
  <!-- Back arrow -->
  <button
    onclick={() => onNavigate("back")}
    class="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    title={t("calendar.toolbar.previousTitle", shortcutTitle(["←"]))}
    aria-label={t("calendar.toolbar.previous")}
  >
    <ChevronLeft size={14} />
  </button>

  <!-- Month/year label with mini calendar popover -->
  <div class="relative">
    <button
      bind:this={miniCalendarButton}
      onclick={handleHeaderClick}
      class="flex h-7 items-center rounded-md px-1.5 text-sm font-semibold leading-none text-foreground transition-colors {showMiniCalendar ? 'bg-accent' : 'hover:bg-accent'}"
    >
      {formatMonthYear(anchorDate, locale)}
    </button>

    {#if showMiniCalendar}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div data-calendar-edit-close-ignore class="fixed inset-0 z-40" onclick={() => closeMiniCalendar("pointer")}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-calendar-edit-close-ignore
        class="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-card text-card-foreground p-2.5 shadow-lg"
        style="--foreground: var(--card-foreground);"
      >
        <MiniDatePicker
          selectedDate={anchorDateStr}
          highlightMode={pickerHighlightMode}
          onselect={selectPickerDay}
          oncancel={closeMiniCalendar}
        />
      </div>
    {/if}
  </div>

  <!-- Forward arrow -->
  <button
    onclick={() => onNavigate("forward")}
    class="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    title={t("calendar.toolbar.nextTitle", shortcutTitle(["→"]))}
    aria-label={t("calendar.toolbar.next")}
  >
    <ChevronRight size={14} />
  </button>

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- View selector -->
  <div class="flex items-center gap-0.5">
    <button
      onclick={() => calZoom.zoomStep(-1)}
      disabled={!calZoom.canZoomOut}
      class="flex h-7 w-7 items-center justify-center rounded-md transition-colors {!calZoom.canZoomOut
        ? 'cursor-default text-muted-foreground/30'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
      title={t("calendar.toolbar.zoomOutTitle")}
      aria-label={t("calendar.toolbar.zoomOut")}
    >
      <Minus size={13} />
    </button>
    <button
      onclick={() => calZoom.zoomStep(1)}
      disabled={!calZoom.canZoomIn}
      class="flex h-7 w-7 items-center justify-center rounded-md transition-colors {!calZoom.canZoomIn
        ? 'cursor-default text-muted-foreground/30'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
      title={t("calendar.toolbar.zoomInTitle")}
      aria-label={t("calendar.toolbar.zoomIn")}
    >
      <Plus size={13} />
    </button>
    {#each viewOptions as opt}
      <button
        onclick={() => onViewChange(opt.mode)}
        class="rounded-md px-2.5 py-1 text-xs font-medium {viewMode === opt.mode
          ? 'bg-card text-card-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
        title={`${opt.title} (${shortcutTitle(opt.shortcuts)})`}
      >
        {opt.label}
      </button>
    {/each}
  </div>

  <!-- Today button -->
  <button
    onclick={() => onNavigate("today")}
    disabled={isOnToday}
    class="ml-1 flex h-7 w-7 items-center justify-center rounded-md transition-colors {isOnToday
      ? 'text-muted-foreground/30 cursor-default'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
    title={t("calendar.toolbar.goToToday", shortcutTitle(todayShortcuts))}
  >
    <RotateCcw size={13} />
  </button>

  <!-- Calendar account picker -->
  <div class="relative ml-1">
    <button
      onclick={() => { showAccountPicker = !showAccountPicker; }}
      class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={t("calendar.toolbar.calendars")}
      aria-label={t("calendar.toolbar.calendars")}
    >
      <Layers size={13} />
    </button>

    {#if showAccountPicker}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div data-calendar-edit-close-ignore class="fixed inset-0 z-40" onclick={() => (showAccountPicker = false)}></div>
      <div data-calendar-edit-close-ignore class="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-card text-card-foreground p-2.5 shadow-lg" style="--foreground: var(--card-foreground);">
        <p class="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("calendar.toolbar.calendars")}</p>
        {#each calendarsStore.list as cal}
          {@const checked = cal.visible}
          {@const displayName = calendarDisplayName(cal)}
          <button
            onclick={() => calendarsStore.toggleVisibility(cal.id)}
            class="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 hover:bg-accent"
          >
            <span
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border {checked ? 'border-primary bg-primary' : 'border-muted-foreground'}"
            >
              {#if checked}
                <Check size={12} class="text-primary-foreground" />
              {/if}
            </span>
            <span class="truncate text-sm text-foreground">{displayName}</span>
            {#if cal.readOnly}
              <span class="ml-auto text-[0.6rem] text-muted-foreground/60">
                {t("calendar.toolbar.readOnly")}
              </span>
            {/if}
          </button>
        {/each}
        <div class="my-1.5 border-t border-border"></div>
        <button
          onclick={() => {
            showAccountPicker = false;
            settingsLauncher.open("calendars");
          }}
          class="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Settings size={14} />
          <span>{t("calendar.toolbar.settings")}</span>
        </button>
      </div>
    {/if}
  </div>
</div>

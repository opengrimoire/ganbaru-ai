<script lang="ts">
  import type { CalendarViewMode } from "$lib/calendar/types";
  import {
    formatDatePart,
    formatMonthYear,
    isToday,
  } from "$lib/calendar/utils";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import { onMount, tick } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Check from "@lucide/svelte/icons/check";
  import Settings from "@lucide/svelte/icons/settings";
  import Layers from "@lucide/svelte/icons/layers";
  import { getSettingsLauncher } from "$lib/stores/settings-launcher.svelte";
  import { getCalendarZoom } from "$lib/stores/calendar-zoom.svelte";
  import { calendarDisplayName } from "$lib/calendar/display";
  import { formatList } from "$lib/i18n/formatters";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import MiniDatePicker from "$lib/components/ui/MiniDatePicker.svelte";

  const calendarsStore = getCalendars();
  const settingsLauncher = getSettingsLauncher();
  const calZoom = getCalendarZoom();
  const mobileBackStack = getMobileBackStack();
  const localization = getLocalization();
  const { t } = localization;
  const locale = $derived(localization.locale);

  // Calendar account selector state
  let showAccountPicker = $state(false);

  // Mini calendar popover state
  let showMiniCalendar = $state(false);
  let showViewPicker = $state(false);
  let toolbarElement: HTMLDivElement | undefined = $state();
  let miniCalendarButton: HTMLButtonElement | undefined = $state();
  let monthYearMeasure: HTMLSpanElement | undefined = $state();
  let useCompactMonthYear = $state(false);

  let {
    anchorDate,
    viewMode,
    onNavigate,
    onViewChange,
    onDaySelect,
    mobileLayout = false,
  }: {
    anchorDate: Date;
    viewMode: CalendarViewMode;
    onNavigate: (direction: "today" | "back" | "forward") => void;
    onViewChange: (mode: CalendarViewMode) => void;
    onDaySelect: (date: Date) => void;
    mobileLayout?: boolean;
  } = $props();

  const viewOptions = $derived.by(() => {
    const options: {
      mode: CalendarViewMode;
      label: string;
      title: string;
      shortcuts: string[];
    }[] = [
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
    ];
    return options;
  });
  const activeViewOption = $derived(
    viewOptions.find((option) => option.mode === viewMode) ?? viewOptions[0],
  );
  const todayShortcuts = ["0"] as const;

  function shortcutTitle(shortcuts: readonly string[]): string {
    const labels = shortcuts.map((shortcut) =>
      t("calendar.toolbar.shortcutKey", shortcut),
    );
    if (labels.length === 1) return labels[0];
    return formatList(locale, labels, { type: "disjunction" });
  }

  $effect(() => {
    if (!mobileLayout || !showMiniCalendar) return;
    return mobileBackStack.activate({
      handle: () => {
        showMiniCalendar = false;
      },
    });
  });

  $effect(() => {
    if (!mobileLayout || !showAccountPicker) return;
    return mobileBackStack.activate({
      handle: () => {
        showAccountPicker = false;
      },
    });
  });

  $effect(() => {
    if (!mobileLayout || !showViewPicker) return;
    return mobileBackStack.activate({
      handle: () => {
        showViewPicker = false;
      },
    });
  });

  // Keyboard shortcuts for view switching and "today". Arrow-key navigation is
  // owned by CalendarView so target readiness gating and stale-event drops
  // apply uniformly. Adding a second listener here would let
  // auto-repeat keydowns bypass the gate and drain the queue for seconds
  // after the user releases the key.
  onMount(() => {
    const monthYearObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateMonthYearLabel);
    if (toolbarElement) monthYearObserver?.observe(toolbarElement);
    if (monthYearMeasure) monthYearObserver?.observe(monthYearMeasure);
    updateMonthYearLabel();

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
          if (mobileLayout) break;
          e.preventDefault();
          onViewChange("workweek");
          break;
        case "3":
          if (mobileLayout) break;
          e.preventDefault();
          onViewChange("week");
          break;
        case "4":
          if (mobileLayout) break;
          e.preventDefault();
          onViewChange("month");
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      monthYearObserver?.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
    };
  });

  const isOnToday = $derived(isToday(anchorDate));
  const anchorDateStr = $derived(formatDatePart(anchorDate));
  const fullMonthYear = $derived(formatMonthYear(anchorDate, locale));
  const compactMonthYear = $derived(formatMonthYear(anchorDate, locale, "short"));
  const pickerHighlightMode = $derived(
    viewMode === "day" ? "day" : viewMode === "week" ? "week" : viewMode === "workweek" ? "workweek" : "none",
  );

  function handleHeaderClick() {
    showAccountPicker = false;
    showViewPicker = false;
    showMiniCalendar = !showMiniCalendar;
  }

  function updateMonthYearLabel(): void {
    if (!mobileLayout || !toolbarElement || !miniCalendarButton || !monthYearMeasure) {
      useCompactMonthYear = false;
      return;
    }
    const toolbarStyle = window.getComputedStyle(toolbarElement);
    const buttonStyle = window.getComputedStyle(miniCalendarButton);
    const parsedToolbarPaddingLeft = Number.parseFloat(toolbarStyle.paddingLeft);
    const parsedToolbarPaddingRight = Number.parseFloat(toolbarStyle.paddingRight);
    const parsedButtonPaddingLeft = Number.parseFloat(buttonStyle.paddingLeft);
    const parsedButtonPaddingRight = Number.parseFloat(buttonStyle.paddingRight);
    const toolbarPadding = (Number.isFinite(parsedToolbarPaddingLeft) ? parsedToolbarPaddingLeft : 0)
      + (Number.isFinite(parsedToolbarPaddingRight) ? parsedToolbarPaddingRight : 0);
    const buttonPadding = (Number.isFinite(parsedButtonPaddingLeft) ? parsedButtonPaddingLeft : 0)
      + (Number.isFinite(parsedButtonPaddingRight) ? parsedButtonPaddingRight : 0);
    const fixedControlsWidth = Array.from(
      toolbarElement.querySelectorAll<HTMLElement>("[data-calendar-mobile-fixed]"),
      (element) => element.offsetWidth,
    ).reduce((total, width) => total + width, 0);
    const availableWidth = Math.max(
      0,
      toolbarElement.clientWidth - toolbarPadding - fixedControlsWidth - buttonPadding,
    );
    useCompactMonthYear = monthYearMeasure.scrollWidth > availableWidth + 0.5;
  }

  $effect(() => {
    void fullMonthYear;
    void mobileLayout;
    void tick().then(updateMonthYearLabel);
  });

  function selectView(mode: CalendarViewMode): void {
    showViewPicker = false;
    onViewChange(mode);
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
  bind:this={toolbarElement}
  data-calendar-edit-close-zone
  class="flex shrink-0 items-center {mobileLayout ? 'gap-0 px-1' : 'gap-1 px-3'}"
  style="height: var(--cal-header-row-h); background-color: var(--cal-header-bg); border-bottom: 1px solid var(--sidebar);"
  onwheel={handleToolbarWheel}
>
  <div class="flex min-w-0 items-center">
    <!-- Back arrow -->
    <button
      data-calendar-mobile-fixed={mobileLayout || undefined}
      onclick={() => onNavigate("back")}
      class="flex shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent {mobileLayout ? 'h-12 w-10' : 'h-7 w-6'}"
      title={t("calendar.toolbar.previousTitle", shortcutTitle(["←"]))}
      aria-label={t("calendar.toolbar.previous")}
    >
      <ChevronLeft size={14} />
    </button>

    <!-- Month/year label with mini calendar popover -->
    <div class="relative min-w-0">
      <button
        bind:this={miniCalendarButton}
        onclick={handleHeaderClick}
        class="relative flex items-center rounded-md px-1.5 text-identity font-medium leading-none text-foreground transition-colors {mobileLayout ? 'h-12 min-w-0 justify-start' : 'h-7'} {showMiniCalendar ? 'bg-accent' : 'hover:bg-accent'}"
      >
        <span bind:this={monthYearMeasure} aria-hidden="true" class="pointer-events-none absolute invisible whitespace-nowrap">
          {fullMonthYear}
        </span>
        <span class="whitespace-nowrap">{mobileLayout && useCompactMonthYear ? compactMonthYear : fullMonthYear}</span>
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
      data-calendar-mobile-fixed={mobileLayout || undefined}
      onclick={() => onNavigate("forward")}
      class="flex shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent {mobileLayout ? 'h-12 w-10' : 'h-7 w-6'}"
      title={t("calendar.toolbar.nextTitle", shortcutTitle(["→"]))}
      aria-label={t("calendar.toolbar.next")}
    >
      <ChevronRight size={14} />
    </button>
  </div>

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- View selector -->
  {#if mobileLayout}
  <div data-calendar-mobile-fixed class="relative shrink-0">
    <button
      type="button"
      class="flex h-12 w-12 items-center justify-center gap-0.5 rounded-md text-xs font-medium text-foreground transition-colors hover:bg-accent {showViewPicker ? 'bg-accent' : ''}"
      aria-label={activeViewOption.title}
      title={activeViewOption.title}
      aria-haspopup="menu"
      aria-expanded={showViewPicker}
      onclick={() => {
        showMiniCalendar = false;
        showAccountPicker = false;
        showViewPicker = !showViewPicker;
      }}
    >
      <span>{activeViewOption.label}</span>
      <ChevronDown size={11} aria-hidden="true" />
    </button>
    {#if showViewPicker}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div data-calendar-edit-close-ignore class="fixed inset-0 z-40" onclick={() => (showViewPicker = false)}></div>
      <div
        data-calendar-edit-close-ignore
        class="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-border bg-card p-1.5 text-card-foreground shadow-lg"
        role="menu"
        aria-label={t("calendar.toolbar.views")}
      >
        {#each viewOptions as opt}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={viewMode === opt.mode}
            class="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left hover:bg-accent {viewMode === opt.mode ? 'bg-accent text-foreground' : 'text-muted-foreground'}"
            onclick={() => selectView(opt.mode)}
          >
            <span class="w-7 text-xs font-semibold text-foreground">{opt.label}</span>
            <span class="text-sm">{opt.title}</span>
          </button>
        {/each}
        <div class="mt-1 flex items-center justify-end border-t border-border pt-1">
          <button
            type="button"
            disabled={!calZoom.canZoomOut}
            class="flex h-12 w-12 items-center justify-center rounded-md transition-colors {!calZoom.canZoomOut ? 'text-muted-foreground/30' : 'text-foreground active:bg-accent'}"
            title={t("calendar.toolbar.zoomOut")}
            aria-label={t("calendar.toolbar.zoomOut")}
            onclick={() => calZoom.zoomStep(-1)}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            disabled={!calZoom.canZoomIn}
            class="flex h-12 w-12 items-center justify-center rounded-md transition-colors {!calZoom.canZoomIn ? 'text-muted-foreground/30' : 'text-foreground active:bg-accent'}"
            title={t("calendar.toolbar.zoomIn")}
            aria-label={t("calendar.toolbar.zoomIn")}
            onclick={() => calZoom.zoomStep(1)}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
    {/if}
  </div>
  {:else}
  <div class="flex items-center gap-0.5">
    <button
      onclick={() => calZoom.zoomStep(-1)}
      disabled={!calZoom.canZoomOut}
      class="flex h-7 w-7 items-center justify-center rounded-md transition-colors {!calZoom.canZoomOut
        ? 'cursor-default text-muted-foreground/30'
        : 'text-foreground hover:bg-accent'}"
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
        : 'text-foreground hover:bg-accent'}"
      title={t("calendar.toolbar.zoomInTitle")}
      aria-label={t("calendar.toolbar.zoomIn")}
    >
      <Plus size={13} />
    </button>
    {#each viewOptions as opt}
      <button
        onclick={() => onViewChange(opt.mode)}
        class="flex h-6 items-center rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent {viewMode === opt.mode
          ? 'text-foreground'
          : 'text-muted-foreground'}"
        title={`${opt.title} (${shortcutTitle(opt.shortcuts)})`}
      >
        {opt.label}
      </button>
    {/each}
  </div>
  {/if}

  <!-- Today button -->
  <button
    data-calendar-mobile-fixed={mobileLayout || undefined}
    onclick={() => onNavigate("today")}
    disabled={isOnToday}
    class="flex shrink-0 items-center justify-center rounded-md transition-colors {mobileLayout ? 'h-12 w-12' : 'ml-1 h-7 w-7'} {isOnToday
      ? 'text-muted-foreground/30 cursor-default'
      : 'text-foreground hover:bg-accent'}"
    title={t("calendar.toolbar.goToToday", shortcutTitle(todayShortcuts))}
  >
    <RotateCcw size={13} />
  </button>

  <!-- Calendar account picker -->
  <div data-calendar-mobile-fixed={mobileLayout || undefined} class="relative shrink-0 {mobileLayout ? '' : 'ml-1'}">
    <button
      onclick={() => {
        showMiniCalendar = false;
        showViewPicker = false;
        showAccountPicker = !showAccountPicker;
      }}
      class="flex items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent {mobileLayout ? 'h-12 w-12' : 'h-7 w-7'}"
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
            class="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 hover:bg-accent {mobileLayout ? 'min-h-12 py-2' : 'py-1.5'}"
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
          class="flex w-full items-center gap-2 rounded px-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground {mobileLayout ? 'min-h-12 py-2' : 'py-1.5'}"
        >
          <Settings size={14} />
          <span>{t("calendar.toolbar.settings")}</span>
        </button>
      </div>
    {/if}
  </div>
</div>

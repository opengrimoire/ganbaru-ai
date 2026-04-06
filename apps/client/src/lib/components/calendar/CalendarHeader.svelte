<script lang="ts">
  import type { CalendarViewMode } from "./types";
  import {
    formatMonthYear,
    getMonthGrid,
    getWeekDays,
    isToday,
    isSameDay,
    isPastDay,
  } from "./utils";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Check from "@lucide/svelte/icons/check";
  import Plus from "@lucide/svelte/icons/plus";
  import Layers from "@lucide/svelte/icons/layers";

  const calendarsStore = getCalendars();

  // Calendar account selector state
  let showAccountPicker = $state(false);

  // Mini calendar popover state
  let showMiniCalendar = $state(false);

  // Picker drill-down: days (default) -> months -> years
  type PickerMode = "days" | "months" | "years";
  let pickerMode: PickerMode = $state("days");
  let pickerYear = $state(new Date().getFullYear());
  let yearPageStart = $state(new Date().getFullYear() - 4);

  const shortMonths = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const yearPageYears = $derived(
    Array.from({ length: 12 }, (_, i) => yearPageStart + i),
  );

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

  const viewOptions: { mode: CalendarViewMode; label: string }[] = [
    { mode: "day", label: "1d" },
    { mode: "week", label: "7d" },
    { mode: "month", label: "31d" },
  ];

  const isOnToday = $derived(isToday(anchorDate));

  // Mini calendar state (independent month navigation)
  let miniDate = $state(new Date());

  // Sync mini calendar when anchorDate changes month
  $effect(() => {
    const a = anchorDate;
    if (
      miniDate.getFullYear() !== a.getFullYear() ||
      miniDate.getMonth() !== a.getMonth()
    ) {
      miniDate = new Date(a);
    }
  });

  const miniMonth = $derived(miniDate.getMonth());
  const miniYear = $derived(miniDate.getFullYear());
  const miniWeeks = $derived(getMonthGrid(miniYear, miniMonth));
  const miniLabel = $derived(formatMonthYear(miniDate));

  // Reset picker to days when anchorDate changes (navigation or selection),
  // unless the change came from scrolling within the picker itself.
  let skipPickerReset = false;
  $effect(() => {
    anchorDate;
    if (skipPickerReset) {
      skipPickerReset = false;
      return;
    }
    pickerMode = "days";
  });

  function handleHeaderClick() {
    if (!showMiniCalendar) {
      showMiniCalendar = true;
      return;
    }
    // Drill-down within the open popover
    if (pickerMode === "days") {
      pickerYear = anchorDate.getFullYear();
      pickerMode = "months";
    } else if (pickerMode === "months") {
      yearPageStart = pickerYear - 4;
      pickerMode = "years";
    } else {
      pickerMode = "days";
    }
  }

  function closeMiniCalendar() {
    showMiniCalendar = false;
    pickerMode = "days";
  }

  function selectMonth(monthIndex: number) {
    const d = new Date(pickerYear, monthIndex, 1);
    onDaySelect(d);
    closeMiniCalendar();
  }

  function selectYear(year: number) {
    pickerYear = year;
    pickerMode = "months";
  }

  // Current viewed week days (for week view highlight)
  const anchorWeekDays = $derived(getWeekDays(anchorDate));

  function isInAnchorWeek(day: Date): boolean {
    return anchorWeekDays.some((wd) => isSameDay(wd, day));
  }

  const dayLetters = ["M", "T", "W", "T", "F", "S", "S"];

  // Wheel navigation on mini calendar popover
  let wheelCooldown = false;

  function handlePickerWheel(e: WheelEvent) {
    e.preventDefault();
    if (wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;

    const delta = e.deltaY > 0 ? 1 : -1;

    if (pickerMode === "days") {
      if (showMiniCalendar) {
        // Browse months inside the popover without changing main view
        const d = new Date(miniDate);
        d.setMonth(d.getMonth() + delta);
        miniDate = d;
      } else {
        onNavigate(delta > 0 ? "forward" : "back");
      }
    } else if (pickerMode === "months") {
      const d = new Date(anchorDate);
      d.setMonth(d.getMonth() + delta);
      d.setDate(1);
      pickerYear = d.getFullYear();
      skipPickerReset = true;
      onDaySelect(d);
    } else {
      yearPageStart += delta * 12;
    }

    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  function miniPrev() {
    const d = new Date(miniDate);
    d.setMonth(d.getMonth() - 1);
    miniDate = d;
  }

  function miniNext() {
    const d = new Date(miniDate);
    d.setMonth(d.getMonth() + 1);
    miniDate = d;
  }

  function selectDay(date: Date) {
    onDaySelect(date);
    closeMiniCalendar();
  }
</script>

<!-- Toolbar row -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex shrink-0 items-center gap-1 px-3"
  style="height: var(--cal-header-row-h); background-color: var(--cal-header-bg); border-bottom: 1px solid var(--sidebar);"
  onwheel={handlePickerWheel}
>
  <!-- Back arrow -->
  <button
    onclick={() => onNavigate("back")}
    class="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    title="Previous"
  >
    <ChevronLeft size={14} />
  </button>

  <!-- Month/year label with mini calendar popover -->
  <div class="relative">
    <button
      onclick={handleHeaderClick}
      class="flex h-7 items-center rounded-md px-1.5 text-sm font-semibold leading-none text-foreground transition-colors {showMiniCalendar ? 'bg-accent' : 'hover:bg-accent'}"
    >
      {#if pickerMode === "days" || !showMiniCalendar}
        {formatMonthYear(anchorDate)}
      {:else}
        {pickerYear}
      {/if}
    </button>

    {#if showMiniCalendar}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fixed inset-0 z-40" onclick={closeMiniCalendar}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-card p-2.5 shadow-lg"
        onwheel={handlePickerWheel}
      >
        {#if pickerMode === "days"}
          <!-- Popover header with month navigation -->
          <div class="mb-1 flex items-center justify-between">
            <button
              onclick={miniPrev}
              class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onclick={() => { pickerYear = miniYear; pickerMode = "months"; }}
              class="rounded-md px-2 py-0.5 text-xs font-semibold text-foreground hover:bg-accent"
            >
              {miniLabel}
            </button>
            <button
              onclick={miniNext}
              class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <!-- Day letters -->
          <div class="grid grid-cols-7 gap-x-0 text-center">
            {#each dayLetters as letter}
              <span class="py-1 text-xs text-muted-foreground">{letter}</span>
            {/each}
          </div>

          <!-- Date grid -->
          {#each miniWeeks as week}
            <div class="grid grid-cols-7 gap-x-0 text-center">
              {#each week as day}
                {@const inMonth = day.getMonth() === miniMonth}
                {@const today = isToday(day)}
                {@const selected = viewMode === "day" && isSameDay(day, anchorDate)}
                {@const inWeek = viewMode === "week" && isInAnchorWeek(day)}
                {@const past = isPastDay(day)}
                <button
                  onclick={() => selectDay(day)}
                  class="flex h-6 w-full items-center justify-center rounded-sm text-xs hover:bg-accent"
                  style={today
                    ? "background-color: var(--cal-today-circle); color: var(--cal-today-circle-text); font-weight: 700;"
                    : selected
                      ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
                      : inWeek
                        ? "background-color: color-mix(in srgb, var(--accent) 50%, transparent); color: var(--foreground);"
                        : !inMonth
                          ? "opacity: 0.25;"
                          : past
                            ? "opacity: 0.45; color: var(--foreground);"
                            : "color: var(--foreground);"}
                >
                  {day.getDate()}
                </button>
              {/each}
            </div>
          {/each}

        {:else if pickerMode === "months"}
          <!-- Month grid header -->
          <div class="mb-1 flex items-center justify-center">
            <button
              onclick={() => { yearPageStart = pickerYear - 4; pickerMode = "years"; }}
              class="rounded-md px-2 py-0.5 text-xs font-semibold text-foreground hover:bg-accent"
            >
              {pickerYear}
            </button>
          </div>
          <!-- Month grid (4 rows x 3 cols) -->
          <div class="grid grid-cols-3 gap-1 py-1">
            {#each shortMonths as name, i}
              {@const isAnchor = pickerYear === anchorDate.getFullYear() && i === anchorDate.getMonth()}
              <button
                onclick={() => selectMonth(i)}
                class="rounded-sm py-2 text-center text-xs font-medium {isAnchor
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-foreground hover:bg-accent'}"
              >
                {name}
              </button>
            {/each}
          </div>

        {:else}
          <!-- Year grid header -->
          <div class="mb-1 flex items-center justify-between">
            <button
              onclick={() => { yearPageStart -= 12; }}
              class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft size={14} />
            </button>
            <span class="text-xs font-semibold text-foreground">
              {yearPageStart} - {yearPageStart + 11}
            </span>
            <button
              onclick={() => { yearPageStart += 12; }}
              class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <!-- Year grid (4 rows x 3 cols) -->
          <div class="grid grid-cols-3 gap-1 py-1">
            {#each yearPageYears as year}
              {@const isAnchor = year === anchorDate.getFullYear()}
              <button
                onclick={() => selectYear(year)}
                class="rounded-sm py-2 text-center text-xs font-medium {isAnchor
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-foreground hover:bg-accent'}"
              >
                {year}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Forward arrow -->
  <button
    onclick={() => onNavigate("forward")}
    class="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    title="Next"
  >
    <ChevronRight size={14} />
  </button>

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- View selector -->
  <div class="flex items-center gap-0.5">
    {#each viewOptions as opt}
      <button
        onclick={() => onViewChange(opt.mode)}
        class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {viewMode === opt.mode
          ? 'bg-card text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
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
    title="Go to today"
  >
    <RotateCcw size={13} />
  </button>

  <!-- Calendar account picker -->
  <div class="relative ml-1">
    <button
      onclick={() => { showAccountPicker = !showAccountPicker; }}
      class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title="Calendars"
    >
      <Layers size={14} />
    </button>

    {#if showAccountPicker}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fixed inset-0 z-40" onclick={() => (showAccountPicker = false)}></div>
      <div class="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-card p-2.5 shadow-lg">
        <p class="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Calendars</p>
        {#each calendarsStore.list as cal}
          {@const checked = cal.visible}
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
            <span class="truncate text-sm text-foreground">{cal.name}</span>
            {#if cal.readOnly}
              <span class="ml-auto text-[9px] text-muted-foreground/60">read-only</span>
            {/if}
          </button>
        {/each}
        <div class="my-1.5 border-t border-border"></div>
        <button
          onclick={() => {}}
          class="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus size={14} />
          <span>Sync other accounts</span>
        </button>
      </div>
    {/if}
  </div>
</div>

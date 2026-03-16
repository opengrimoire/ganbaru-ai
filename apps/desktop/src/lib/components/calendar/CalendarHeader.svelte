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
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Check from "@lucide/svelte/icons/check";
  import Plus from "@lucide/svelte/icons/plus";

  // Calendar account selector state
  let showAccountPicker = $state(false);

  // Mock calendar accounts
  const calendarAccounts = [
    { id: "ganbaruai", label: "GanbaruAI" },
  ];

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
    enabledAccounts,
    onNavigate,
    onViewChange,
    onDaySelect,
    onAccountToggle,
  }: {
    anchorDate: Date;
    viewMode: CalendarViewMode;
    enabledAccounts: Set<string>;
    onNavigate: (direction: "today" | "back" | "forward") => void;
    onViewChange: (mode: CalendarViewMode) => void;
    onDaySelect: (date: Date) => void;
    onAccountToggle: (id: string) => void;
  } = $props();

  const viewOptions: { mode: CalendarViewMode; label: string }[] = [
    { mode: "day", label: "1d" },
    { mode: "week", label: "7d" },
    { mode: "month", label: "31d" },
  ];

  const isOnToday = $derived(isToday(anchorDate));

  // Mini calendar state — independent month navigation
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
  let skipPickerReset = false; // plain variable, not $state — avoids re-triggering the effect
  $effect(() => {
    anchorDate;
    if (skipPickerReset) {
      skipPickerReset = false;
      return;
    }
    pickerMode = "days";
  });

  function handleHeaderClick() {
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

  function selectMonth(monthIndex: number) {
    const d = new Date(pickerYear, monthIndex, 1);
    onDaySelect(d);
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

  // Wheel navigation on mini calendar
  let wheelCooldown = false;

  function handlePickerWheel(e: WheelEvent) {
    e.preventDefault();
    if (wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;

    const delta = e.deltaY > 0 ? 1 : -1;

    if (pickerMode === "days") {
      onNavigate(delta > 0 ? "forward" : "back");
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
  }
</script>

<div
  class="flex w-60 shrink-0 flex-col"
  style="background-color: var(--cal-header-bg);"
>
  <!-- Month/year label — aligned with sticky day-header row -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex shrink-0 items-center justify-center px-3"
    style="height: var(--cal-header-row-h);"
    onwheel={handlePickerWheel}
  >
    <button
      onclick={handleHeaderClick}
      class="rounded-md px-2 py-0.5 text-lg leading-none font-semibold text-foreground hover:bg-accent"
    >
      {#if pickerMode === "days"}
        {formatMonthYear(anchorDate)}
      {:else}
        {pickerYear}
      {/if}
    </button>
  </div>

  <!-- Mini calendar / month picker / year picker -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="mx-3 mt-0 mb-1.5" onwheel={handlePickerWheel}>
    {#if pickerMode === "days"}
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
      <!-- Month grid (4 rows x 3 cols) -->
      <div class="grid grid-cols-3 gap-1 py-1">
        {#each shortMonths as name, i}
          {@const isAnchor = pickerYear === anchorDate.getFullYear() && i === anchorDate.getMonth()}
          <button
            onclick={() => selectMonth(i)}
            class="rounded-sm py-2.5 text-center text-sm font-medium hover:bg-accent {isAnchor
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground'}"
          >
            {name}
          </button>
        {/each}
      </div>

    {:else}
      <!-- Year grid (4 rows x 3 cols, scrollable by page) -->
      <div class="grid grid-cols-3 gap-1 py-1">
        {#each yearPageYears as year}
          {@const isAnchor = year === anchorDate.getFullYear()}
          <button
            onclick={() => selectYear(year)}
            class="rounded-sm py-2.5 text-center text-sm font-medium hover:bg-accent {isAnchor
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground'}"
          >
            {year}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- View selector + today -->
  <div class="mx-3 mt-1 mb-3 flex items-center gap-0.5">
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
    <div class="flex-1"></div>
    <button
      onclick={() => onNavigate("today")}
      disabled={isOnToday}
      class="flex h-6 w-6 items-center justify-center rounded-md transition-colors {isOnToday
        ? 'text-muted-foreground/30 cursor-default'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
      title="Go to today"
    >
      <RotateCcw size={13} />
    </button>
  </div>

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Calendar account picker -->
  <div class="relative mx-2 mb-2">
    {#if showAccountPicker}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fixed inset-0 z-40" onclick={() => (showAccountPicker = false)}></div>
      <div class="absolute bottom-full left-0 z-50 mb-1 w-full rounded-md border border-border bg-card p-2.5 shadow-lg">
        <p class="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Calendars</p>
        {#each calendarAccounts as account}
          {@const checked = enabledAccounts.has(account.id)}
          <button
            onclick={() => onAccountToggle(account.id)}
            class="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 hover:bg-accent"
          >
            <span
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border {checked ? 'border-primary bg-primary' : 'border-muted-foreground'}"
            >
              {#if checked}
                <Check size={12} class="text-primary-foreground" />
              {/if}
            </span>
            <span class="truncate text-sm text-foreground">{account.label}</span>
          </button>
        {/each}
        <div class="my-1.5 border-t border-border"></div>
        <!-- TODO: implement account sync flow -->
        <button
          onclick={() => {}}
          class="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus size={14} />
          <span>Sync other accounts</span>
        </button>
      </div>
    {/if}

    <button
      onclick={() => (showAccountPicker = !showAccountPicker)}
      class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <span class="h-3 w-3 shrink-0 rounded-full bg-primary"></span>
      <span class="flex-1 truncate">My calendars</span>
      <ChevronUp size={14} class={showAccountPicker ? "" : "rotate-180"} />
    </button>
  </div>
</div>

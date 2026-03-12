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
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";

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
    { mode: "day", label: "Day" },
    { mode: "week", label: "Week" },
    { mode: "month", label: "Month" },
  ];

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

  // Current viewed week days (for week view highlight)
  const anchorWeekDays = $derived(getWeekDays(anchorDate));

  function isInAnchorWeek(day: Date): boolean {
    return anchorWeekDays.some((wd) => isSameDay(wd, day));
  }

  const dayLetters = ["M", "T", "W", "T", "F", "S", "S"];

  // Wheel navigation on mini calendar
  let wheelCooldown = false;

  function handleMiniWheel(e: WheelEvent) {
    e.preventDefault();
    if (wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;
    onNavigate(e.deltaY > 0 ? "forward" : "back");
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
  class="flex w-48 shrink-0 flex-col border-r"
  style="background-color: var(--cal-header-bg); border-color: var(--cal-gridline);"
>
  <!-- Month/year label — aligned with sticky day-header row -->
  <div
    class="flex shrink-0 items-center border-b px-3"
    style="border-color: var(--cal-gridline); height: var(--cal-header-row-h);"
  >
    <span class="text-lg font-semibold text-foreground">
      {formatMonthYear(anchorDate)}
    </span>
  </div>

  <!-- Mini monthly calendar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="mx-2 mt-2 mb-1" onwheel={handleMiniWheel}>
    <!-- Day letters -->
    <div class="grid grid-cols-7 text-center">
      {#each dayLetters as letter}
        <span class="py-0.5 text-[10px] text-muted-foreground">{letter}</span>
      {/each}
    </div>

    <!-- Date grid -->
    {#each miniWeeks as week}
      <div class="grid grid-cols-7 text-center">
        {#each week as day}
          {@const inMonth = day.getMonth() === miniMonth}
          {@const today = isToday(day)}
          {@const selected = viewMode === "day" && isSameDay(day, anchorDate)}
          {@const inWeek = viewMode === "week" && isInAnchorWeek(day)}
          {@const past = isPastDay(day)}
          <button
            onclick={() => selectDay(day)}
            class="flex h-5 w-full items-center justify-center text-[10px] transition-colors hover:bg-accent"
            class:rounded={!inWeek}
            class:rounded-l={inWeek && isSameDay(day, anchorWeekDays[0])}
            class:rounded-r={inWeek && isSameDay(day, anchorWeekDays[6])}
            style={today
              ? "background-color: var(--cal-today-circle); color: var(--cal-today-circle-text); font-weight: 700;"
              : selected
                ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
                : inWeek
                  ? "background-color: var(--accent); opacity: 0.5; color: var(--foreground);"
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
  </div>

  <!-- Navigation row -->
  <div class="mx-3 mt-1 mb-3 flex items-center gap-1">
    <button
      onclick={() => onNavigate("today")}
      class="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
    >
      Today
    </button>
    <div class="flex-1"></div>
    <button
      onclick={() => onNavigate("back")}
      class="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
    >
      <ChevronLeft size={16} />
    </button>
    <button
      onclick={() => onNavigate("forward")}
      class="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
    >
      <ChevronRight size={16} />
    </button>
  </div>

  <!-- View selector -->
  <div class="mx-3 flex flex-col gap-0.5">
    {#each viewOptions as opt}
      <button
        onclick={() => onViewChange(opt.mode)}
        class="rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors {viewMode === opt.mode
          ? 'bg-card text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
      >
        {opt.label}
      </button>
    {/each}
  </div>
</div>

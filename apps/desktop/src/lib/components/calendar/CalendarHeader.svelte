<script lang="ts">
  import type { CalendarViewMode } from "./types";
  import {
    formatMonthYear,
    getMonthGrid,
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

  const dayLetters = ["M", "T", "W", "T", "F", "S", "S"];

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
  <div class="mx-2 mt-2 mb-1">
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
          {@const selected = isSameDay(day, anchorDate)}
          {@const past = isPastDay(day)}
          <button
            onclick={() => selectDay(day)}
            class="flex h-5 w-full items-center justify-center rounded text-[10px] transition-colors hover:bg-accent"
            style={today
              ? "background-color: var(--cal-today-circle); color: var(--cal-today-circle-text); font-weight: 700;"
              : selected
                ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
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

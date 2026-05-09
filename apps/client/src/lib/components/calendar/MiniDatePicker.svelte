<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import {
    type DatePickerDay,
    buildCalendarGrid,
    SHORT_MONTHS,
    DAY_LETTERS,
  } from "./date-picker-utils";

  let {
    selectedDate,
    minDate,
    small = false,
    highlightMode = "day",
    onselect,
  }: {
    selectedDate: string;
    minDate?: string;
    small?: boolean;
    highlightMode?: "day" | "week" | "none";
    onselect: (dateStr: string) => void;
  } = $props();

  type PickerMode = "days" | "months" | "years";

  function parseDateParts(dateStr: string): { year: number; month: number; day: number } | undefined {
    const parts = dateStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return undefined;
    const [year, month, day] = parts;
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return { year, month, day };
  }

  function formatDateStr(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function selectedDateParts(): { year: number; month: number; day: number } {
    const parsed = parseDateParts(selectedDate);
    if (parsed) return parsed;
    const today = new Date();
    return {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      day: today.getDate(),
    };
  }

  const initParts = selectedDateParts();
  const initYear = initParts.year;
  const initMonth = initParts.month;

  let year = $state(initYear);
  let month = $state(initMonth);
  let pickerMode: PickerMode = $state("days");
  let yearPageStart = $state(initYear - 4);
  let previousSelectedDate = $state<string | undefined>();
  let wheelCooldown = false;

  const monthLabel = $derived(
    new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  );
  const yearPageYears = $derived(Array.from({ length: 12 }, (_, i) => yearPageStart + i));
  const days = $derived.by(() => buildCalendarGrid(year, month, selectedDate));

  const textSize = $derived(small ? "text-[11px]" : "text-[12px]");
  const todayStr = $derived.by(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });

  const selectedWeekRange = $derived.by(() => {
    if (highlightMode !== "week") return undefined;
    const parsed = parseDateParts(selectedDate);
    if (!parsed) return undefined;
    const selected = new Date(parsed.year, parsed.month - 1, parsed.day);
    const mondayOffset = selected.getDay() === 0 ? -6 : 1 - selected.getDay();
    const start = new Date(selected);
    start.setDate(selected.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: formatDateStr(start), end: formatDateStr(end) };
  });

  $effect(() => {
    if (previousSelectedDate === undefined) {
      previousSelectedDate = selectedDate;
      return;
    }
    if (selectedDate === previousSelectedDate) return;
    previousSelectedDate = selectedDate;
    const parsed = parseDateParts(selectedDate);
    if (!parsed) return;
    year = parsed.year;
    month = parsed.month;
    yearPageStart = parsed.year - 4;
    pickerMode = "days";
  });

  function prevMonth() {
    if (month === 1) { month = 12; year--; }
    else month--;
  }

  function nextMonth() {
    if (month === 12) { month = 1; year++; }
    else month++;
  }

  function handleHeaderClick() {
    if (pickerMode === "days") pickerMode = "months";
    else if (pickerMode === "months") { yearPageStart = year - 4; pickerMode = "years"; }
    else pickerMode = "days";
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;

    const delta = e.deltaY > 0 ? 1 : -1;

    if (pickerMode === "days") {
      if (delta > 0) nextMonth();
      else prevMonth();
    } else if (pickerMode === "months") {
      year += delta;
    } else {
      yearPageStart += delta * 12;
    }

    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  function dayIsSelected(day: DatePickerDay): boolean {
    return highlightMode === "day" && day.selected;
  }

  function dayIsInWeek(day: DatePickerDay): boolean {
    return !!selectedWeekRange
      && day.dateStr >= selectedWeekRange.start
      && day.dateStr <= selectedWeekRange.end;
  }

  function selectDay(day: DatePickerDay) {
    if (minDate && day.dateStr < minDate) return;
    onselect(day.dateStr);
    const [y, m] = day.dateStr.split("-").map(Number);
    year = y;
    month = m;
  }

  function selectMonth(monthIndex: number) {
    month = monthIndex + 1;
    pickerMode = "days";
  }

  function selectYear(y: number) {
    year = y;
    pickerMode = "months";
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mb-1 flex items-center justify-between" onwheel={handleWheel}>
  {#if pickerMode === "days"}
    <button
      onclick={prevMonth}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft size={14} />
    </button>
  {:else if pickerMode === "years"}
    <button
      onclick={() => { yearPageStart -= 12; }}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft size={14} />
    </button>
  {:else}
    <div class="h-6 w-6" aria-hidden="true"></div>
  {/if}

  <button onclick={handleHeaderClick}
    class="rounded-md px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent">
    {#if pickerMode === "days"}
      {monthLabel}
    {:else if pickerMode === "months"}
      {year}
    {:else}
      {yearPageStart} - {yearPageStart + 11}
    {/if}
  </button>

  {#if pickerMode === "days"}
    <button
      onclick={nextMonth}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronRight size={14} />
    </button>
  {:else if pickerMode === "years"}
    <button
      onclick={() => { yearPageStart += 12; }}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronRight size={14} />
    </button>
  {:else}
    <div class="h-6 w-6" aria-hidden="true"></div>
  {/if}
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onwheel={handleWheel}>
  {#if pickerMode === "days"}
    <div class="grid grid-cols-7 gap-x-0 text-center">
      {#each DAY_LETTERS as letter}
        <span class="py-0.5 text-[9px] text-muted-foreground">{letter}</span>
      {/each}
    </div>
    <div class="grid grid-cols-7 gap-x-0 text-center">
      {#each days as day}
        {@const belowMin = !!minDate && day.dateStr < minDate}
        {@const past = day.currentMonth && day.dateStr < todayStr}
        <button onclick={() => selectDay(day)}
          class="flex h-6 w-full items-center justify-center rounded-sm {textSize}
            {belowMin ? 'cursor-not-allowed' : 'hover:bg-accent'}"
          style={day.today
            ? "background-color: var(--primary); color: var(--primary-foreground); font-weight: 700;"
            : dayIsSelected(day)
              ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
            : dayIsInWeek(day)
              ? "background-color: color-mix(in srgb, var(--accent) 50%, transparent); color: var(--foreground);"
              : belowMin
                ? "color: color-mix(in srgb, var(--foreground) 20%, var(--background));"
                : !day.currentMonth
                  ? "color: color-mix(in srgb, var(--foreground) 25%, var(--background));"
                  : past
                    ? "color: color-mix(in srgb, var(--foreground) 45%, var(--background));"
                    : "color: var(--foreground);"}
        >{day.day}</button>
      {/each}
    </div>
  {:else if pickerMode === "months"}
    <div class="grid grid-cols-3 gap-1 py-1">
      {#each SHORT_MONTHS as name, i}
        <button onclick={() => selectMonth(i)}
          class="rounded-sm py-2 text-center {textSize} font-medium
            {i + 1 === month ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground hover:bg-accent'}">
          {name}
        </button>
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-3 gap-1 py-1">
      {#each yearPageYears as y}
        <button onclick={() => selectYear(y)}
          class="rounded-sm py-2 text-center {textSize} font-medium
            {y === year ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground hover:bg-accent'}">
          {y}
        </button>
      {/each}
    </div>
  {/if}
</div>

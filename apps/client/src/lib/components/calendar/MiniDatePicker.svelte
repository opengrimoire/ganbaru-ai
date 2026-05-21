<script lang="ts">
  import { onMount, tick } from "svelte";
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
    highlightToday = true,
    activeHighlight = "accent",
    onselect,
    oncancel,
  }: {
    selectedDate: string;
    minDate?: string;
    small?: boolean;
    highlightMode?: "day" | "week" | "none";
    highlightToday?: boolean;
    activeHighlight?: "accent" | "primary";
    onselect: (dateStr: string, source?: "keyboard" | "pointer") => void;
    oncancel?: (source?: "keyboard" | "pointer") => void;
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
  const initDay = initParts.day;

  let year = $state(initYear);
  let month = $state(initMonth);
  let activeDateStr = $state(formatDateStr(new Date(initYear, initMonth - 1, initDay)));
  let pickerMode: PickerMode = $state("days");
  let yearPageStart = $state(initYear - 4);
  let previousSelectedDate = $state<string | undefined>();
  let wheelCooldown = false;
  let pickerEl: HTMLDivElement | undefined = $state();
  let headerButtonEl: HTMLButtonElement | undefined = $state();

  const monthLabel = $derived(
    new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  );
  const yearPageYears = $derived(Array.from({ length: 12 }, (_, i) => yearPageStart + i));
  const days = $derived.by(() => buildCalendarGrid(year, month, activeDateStr));

  const textSize = $derived(small ? "text-[0.733333rem]" : "text-[0.8rem]");
  const todayStr = $derived.by(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });

  const selectedWeekRange = $derived.by(() => {
    if (highlightMode !== "week") return undefined;
    const parsed = parseDateParts(activeDateStr);
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
    activeDateStr = formatDateStr(new Date(parsed.year, parsed.month - 1, parsed.day));
    yearPageStart = parsed.year - 4;
    pickerMode = "days";
  });

  onMount(() => {
    void focusActiveGridButton();
  });

  function datePartsFor(dateStr: string): { year: number; month: number; day: number } {
    return parseDateParts(dateStr) ?? selectedDateParts();
  }

  function daysInMonth(yearValue: number, monthValue: number): number {
    return new Date(yearValue, monthValue, 0).getDate();
  }

  function setActiveDateParts(yearValue: number, monthValue: number, dayValue: number): boolean {
    const day = Math.min(dayValue, daysInMonth(yearValue, monthValue));
    const next = formatDateStr(new Date(yearValue, monthValue - 1, day));
    if (minDate && next < minDate) return false;
    activeDateStr = next;
    year = yearValue;
    month = monthValue;
    return true;
  }

  function setActiveDateStr(dateStr: string): boolean {
    const parsed = parseDateParts(dateStr);
    if (!parsed || (minDate && dateStr < minDate)) return false;
    activeDateStr = dateStr;
    year = parsed.year;
    month = parsed.month;
    return true;
  }

  async function focusHeaderButton() {
    await tick();
    headerButtonEl?.focus();
  }

  async function focusActiveGridButton() {
    await tick();
    if (!pickerEl) return;
    if (pickerMode === "days") {
      pickerEl.querySelector<HTMLButtonElement>(`[data-date="${activeDateStr}"]`)?.focus();
    } else if (pickerMode === "months") {
      pickerEl.querySelector<HTMLButtonElement>(`[data-month="${month - 1}"]`)?.focus();
    } else {
      pickerEl.querySelector<HTMLButtonElement>(`[data-year="${year}"]`)?.focus();
    }
  }

  function prevMonth() {
    const parts = datePartsFor(activeDateStr);
    const next = new Date(year, month - 2, 1);
    if (!setActiveDateParts(next.getFullYear(), next.getMonth() + 1, parts.day)) {
      year = next.getFullYear();
      month = next.getMonth() + 1;
    }
  }

  function nextMonth() {
    const parts = datePartsFor(activeDateStr);
    const next = new Date(year, month, 1);
    if (!setActiveDateParts(next.getFullYear(), next.getMonth() + 1, parts.day)) {
      year = next.getFullYear();
      month = next.getMonth() + 1;
    }
  }

  function prevYear() {
    const parts = datePartsFor(activeDateStr);
    setActiveDateParts(year - 1, month, parts.day);
  }

  function nextYear() {
    const parts = datePartsFor(activeDateStr);
    setActiveDateParts(year + 1, month, parts.day);
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
      if (delta > 0) nextYear();
      else prevYear();
    } else {
      yearPageStart += delta * 12;
    }

    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  function handleHeaderEnter() {
    handleHeaderClick();
    void focusActiveGridButton();
  }

  function shiftActiveDate(daysDelta: number) {
    const parts = datePartsFor(activeDateStr);
    const next = new Date(parts.year, parts.month - 1, parts.day + daysDelta);
    if (setActiveDateStr(formatDateStr(next))) {
      void focusActiveGridButton();
    }
  }

  function shiftActiveMonth(monthDelta: number) {
    const parts = datePartsFor(activeDateStr);
    const next = new Date(year, month - 1 + monthDelta, 1);
    setActiveDateParts(next.getFullYear(), next.getMonth() + 1, parts.day);
    void focusActiveGridButton();
  }

  function ensureActiveYearVisible() {
    while (year < yearPageStart) yearPageStart -= 12;
    while (year > yearPageStart + 11) yearPageStart += 12;
  }

  function shiftActiveYear(yearDelta: number) {
    const parts = datePartsFor(activeDateStr);
    if (setActiveDateParts(year + yearDelta, month, parts.day)) {
      ensureActiveYearVisible();
      void focusActiveGridButton();
    }
  }

  function handleHeaderArrow(key: string) {
    if (key === "ArrowDown") {
      void focusActiveGridButton();
      return;
    }
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;

    if (pickerMode === "days") {
      if (key === "ArrowLeft") prevMonth();
      else nextMonth();
    } else if (pickerMode === "months") {
      if (key === "ArrowLeft") prevYear();
      else nextYear();
    } else if (key === "ArrowLeft") {
      yearPageStart -= 12;
    } else {
      yearPageStart += 12;
    }
  }

  function handlePickerKeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target as HTMLElement | null;
    const headerFocused = target === headerButtonEl;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (headerFocused) oncancel?.("keyboard");
      else void focusHeaderButton();
      return;
    }

    const gridFocused = !!target?.closest("[data-picker-grid]");
    if (!headerFocused && !gridFocused) return;

    if (e.key === "Enter" && headerFocused) {
      e.preventDefault();
      e.stopPropagation();
      handleHeaderEnter();
      return;
    }

    if (e.key === "Enter" && gridFocused) {
      e.preventDefault();
      e.stopPropagation();
      if (pickerMode === "days") {
        onselect(activeDateStr, "keyboard");
      } else if (pickerMode === "months") {
        pickerMode = "days";
        void focusActiveGridButton();
      } else {
        yearPageStart = year - 4;
        pickerMode = "months";
        void focusActiveGridButton();
      }
      return;
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();

    if (headerFocused) {
      handleHeaderArrow(e.key);
      return;
    }

    if (pickerMode === "days") {
      if (e.key === "ArrowLeft") shiftActiveDate(-1);
      else if (e.key === "ArrowRight") shiftActiveDate(1);
      else if (e.key === "ArrowUp") shiftActiveDate(-7);
      else shiftActiveDate(7);
    } else if (pickerMode === "months") {
      if (e.key === "ArrowLeft") shiftActiveMonth(-1);
      else if (e.key === "ArrowRight") shiftActiveMonth(1);
      else if (e.key === "ArrowUp") shiftActiveMonth(-3);
      else shiftActiveMonth(3);
    } else if (pickerMode === "years") {
      if (e.key === "ArrowLeft") shiftActiveYear(-1);
      else if (e.key === "ArrowRight") shiftActiveYear(1);
      else if (e.key === "ArrowUp") shiftActiveYear(-3);
      else shiftActiveYear(3);
    }
  }

  function dayIsSelected(day: DatePickerDay): boolean {
    return highlightMode === "day" && day.dateStr === activeDateStr;
  }

  function dayIsInWeek(day: DatePickerDay): boolean {
    return !!selectedWeekRange
      && day.dateStr >= selectedWeekRange.start
      && day.dateStr <= selectedWeekRange.end;
  }

  function activeDayStyle(): string {
    return activeHighlight === "primary"
      ? "background-color: var(--primary); color: var(--primary-foreground); font-weight: 700;"
      : "background-color: var(--accent); color: var(--foreground); font-weight: 600;";
  }

  function selectDay(day: DatePickerDay) {
    if (minDate && day.dateStr < minDate) return;
    activeDateStr = day.dateStr;
    onselect(day.dateStr, "pointer");
    const [y, m] = day.dateStr.split("-").map(Number);
    year = y;
    month = m;
  }

  function selectMonth(monthIndex: number) {
    const parts = datePartsFor(activeDateStr);
    setActiveDateParts(year, monthIndex + 1, parts.day);
    pickerMode = "days";
    void focusActiveGridButton();
  }

  function selectYear(y: number) {
    const parts = datePartsFor(activeDateStr);
    setActiveDateParts(y, month, parts.day);
    pickerMode = "months";
    void focusActiveGridButton();
  }
</script>

<div bind:this={pickerEl}>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mb-1 flex items-center justify-between" onwheel={handleWheel}>
  {#if pickerMode === "days"}
    <button
      onclick={prevMonth}
      onkeydown={handlePickerKeydown}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft size={14} />
    </button>
  {:else if pickerMode === "years"}
    <button
      onclick={() => { yearPageStart -= 12; }}
      onkeydown={handlePickerKeydown}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft size={14} />
    </button>
  {:else}
    <button
      onclick={prevYear}
      onkeydown={handlePickerKeydown}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft size={14} />
    </button>
  {/if}

  <button bind:this={headerButtonEl}
    onclick={handleHeaderClick}
    onkeydown={handlePickerKeydown}
    class="rounded-md px-2 py-0.5 text-[0.733333rem] font-medium text-foreground outline-none hover:bg-accent
      {activeHighlight === 'primary' ? 'focus:bg-primary focus:text-primary-foreground' : 'focus:bg-accent'}">
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
      onkeydown={handlePickerKeydown}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronRight size={14} />
    </button>
  {:else if pickerMode === "years"}
    <button
      onclick={() => { yearPageStart += 12; }}
      onkeydown={handlePickerKeydown}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronRight size={14} />
    </button>
  {:else}
    <button
      onclick={nextYear}
      onkeydown={handlePickerKeydown}
      class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronRight size={14} />
    </button>
  {/if}
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-picker-grid onwheel={handleWheel}>
  {#if pickerMode === "days"}
    <div class="grid grid-cols-7 gap-x-0 text-center">
      {#each DAY_LETTERS as letter}
        <span class="py-0.5 text-[0.6rem] text-muted-foreground">{letter}</span>
      {/each}
    </div>
    <div class="grid grid-cols-7 gap-x-0 text-center">
      {#each days as day}
        {@const belowMin = !!minDate && day.dateStr < minDate}
        {@const past = day.currentMonth && day.dateStr < todayStr}
        <button
          data-date={day.dateStr}
          tabindex={day.dateStr === activeDateStr ? 0 : -1}
          onkeydown={handlePickerKeydown}
          onclick={() => selectDay(day)}
          class="flex h-6 w-full items-center justify-center rounded-sm {textSize}
            {belowMin ? 'cursor-not-allowed' : 'hover:bg-accent'}"
          style={highlightToday && day.today
            ? "background-color: var(--primary); color: var(--primary-foreground); font-weight: 700;"
            : dayIsSelected(day)
              ? activeDayStyle()
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
        <button
          data-month={i}
          tabindex={i + 1 === month ? 0 : -1}
          onkeydown={handlePickerKeydown}
          onclick={() => selectMonth(i)}
          class="rounded-sm py-2 text-center {textSize} font-medium
            {i + 1 === month ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground hover:bg-accent'}">
          {name}
        </button>
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-3 gap-1 py-1">
      {#each yearPageYears as y}
        <button
          data-year={y}
          tabindex={y === year ? 0 : -1}
          onkeydown={handlePickerKeydown}
          onclick={() => selectYear(y)}
          class="rounded-sm py-2 text-center {textSize} font-medium
            {y === year ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground hover:bg-accent'}">
          {y}
        </button>
      {/each}
    </div>
  {/if}
</div>
</div>

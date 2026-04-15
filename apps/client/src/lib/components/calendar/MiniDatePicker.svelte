<script lang="ts">
  import { type CalDay, buildCalendarGrid, SHORT_MONTHS, DAY_LETTERS } from "./event-panel-utils";

  let {
    selectedDate,
    minDate,
    small = false,
    onselect,
  }: {
    selectedDate: string;
    minDate?: string;
    small?: boolean;
    onselect: (dateStr: string) => void;
  } = $props();

  type PickerMode = "days" | "months" | "years";

  // svelte-ignore state_referenced_locally (component remounts per use, initial-only capture is correct)
  const initParts = selectedDate ? selectedDate.split("-").map(Number) : [];
  const initYear = initParts[0] || new Date().getFullYear();
  const initMonth = initParts[1] || new Date().getMonth() + 1;

  let year = $state(initYear);
  let month = $state(initMonth);
  let pickerMode: PickerMode = $state("days");
  let yearPageStart = $state(initYear - 4);
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

  function selectDay(day: CalDay) {
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
<div class="mb-1 flex items-center justify-center" onwheel={handleWheel}>
  <button onclick={handleHeaderClick}
    class="rounded-md px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-black/5 dark:hover:bg-black/15">
    {#if pickerMode === "days"}
      {monthLabel}
    {:else}
      {year}
    {/if}
  </button>
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
            {belowMin ? 'cursor-not-allowed' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          style={day.selected
            ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
            : day.today
              ? "background-color: var(--primary); color: var(--primary-foreground); font-weight: 700;"
              : belowMin
                ? "opacity: 0.2;"
                : !day.currentMonth
                  ? "opacity: 0.25;"
                  : past
                    ? "opacity: 0.45; color: var(--foreground);"
                    : "color: var(--foreground);"}
        >{day.day}</button>
      {/each}
    </div>
  {:else if pickerMode === "months"}
    <div class="grid grid-cols-3 gap-1 py-1">
      {#each SHORT_MONTHS as name, i}
        <button onclick={() => selectMonth(i)}
          class="rounded-sm py-2 text-center {textSize} font-medium
            {i + 1 === month ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
          {name}
        </button>
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-3 gap-1 py-1">
      {#each yearPageYears as y}
        <button onclick={() => selectYear(y)}
          class="rounded-sm py-2 text-center {textSize} font-medium
            {y === year ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
          {y}
        </button>
      {/each}
    </div>
  {/if}
</div>

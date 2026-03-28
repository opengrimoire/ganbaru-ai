<script lang="ts">
  import type { RecurrenceConfig, RecurrenceFrequency, Weekday } from "./types";
  import { formatRecurrenceLabel } from "./rrule";
  import { bounceIcon } from "./event-panel-utils";
  import MiniDatePicker from "./MiniDatePicker.svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Repeat from "@lucide/svelte/icons/repeat";

  let {
    recurrence = $bindable<RecurrenceConfig | undefined>(undefined),
    startDate,
    rdate,
    expanded,
    ontoggle,
    onexpand,
    onchange,
  }: {
    recurrence: RecurrenceConfig | undefined;
    startDate: string;
    rdate?: string[];
    expanded: boolean;
    ontoggle: () => void;
    onexpand: () => void;
    onchange: () => void;
  } = $props();

  const FREQ_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
    { value: "daily", label: "days" },
    { value: "weekly", label: "weeks" },
    { value: "monthly", label: "months" },
    { value: "yearly", label: "years" },
  ];

  const ALL_WEEKDAYS: { value: Weekday; label: string }[] = [
    { value: "MO", label: "Mon" },
    { value: "TU", label: "Tue" },
    { value: "WE", label: "Wed" },
    { value: "TH", label: "Thu" },
    { value: "FR", label: "Fri" },
    { value: "SA", label: "Sat" },
    { value: "SU", label: "Sun" },
  ];

  const WEEKDAY_MAP: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  const recFrequency = $derived.by((): RecurrenceFrequency => recurrence?.frequency ?? "daily");
  const recInterval = $derived.by(() => recurrence?.interval ?? 1);
  const recWeekdays = $derived.by(() => new Set<Weekday>(recurrence?.weekdays ?? []));
  const recEndType = $derived.by((): "never" | "until" | "count" => recurrence?.end.type ?? "never");
  const recEndDate = $derived.by(() => {
    if (recurrence && recurrence.end.type === "until") return recurrence.end.date;
    return "";
  });
  const recEndCount = $derived.by(() => {
    if (recurrence && recurrence.end.type === "count") return recurrence.end.count;
    return 13;
  });
  const label = $derived(recurrence ? formatRecurrenceLabel(recurrence) : "");

  function defaultUntilDate(): string {
    const [y, m, d] = startDate.split("-").map(Number);
    const dt = new Date(y, m - 1 + 3, d - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }

  function getEventWeekday(): Weekday {
    const [y, m, d] = startDate.split("-").map(Number);
    return WEEKDAY_MAP[new Date(y, m - 1, d).getDay()];
  }

  function getEventDayOfMonth(): number {
    return parseInt(startDate.split("-")[2], 10);
  }

  function getEventOrdinalWeekday(): { ordinal: number; day: Weekday; label: string } {
    const [y, m, d] = startDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const weekday = WEEKDAY_MAP[date.getDay()];
    const ordinal = Math.ceil(d / 7);
    const dayLabel = ALL_WEEKDAYS.find((w) => w.value === weekday)?.label ?? weekday;
    const ordSuffix = ordinal === 1 ? "1st" : ordinal === 2 ? "2nd" : ordinal === 3 ? "3rd" : `${ordinal}th`;
    return { ordinal, day: weekday, label: `${ordSuffix} ${dayLabel}` };
  }

  type MonthlyMode = "day" | "ordinal";
  const monthlyMode = $derived.by((): MonthlyMode => {
    if (recurrence?.ordinalWeekdays && recurrence.ordinalWeekdays.length > 0) return "ordinal";
    return "day";
  });

  function setMonthlyMode(mode: MonthlyMode) {
    if (!recurrence || recurrence.frequency !== "monthly") return;
    if (mode === "day") {
      recurrence = { ...recurrence, ordinalWeekdays: undefined, byMonthDay: [getEventDayOfMonth()] };
    } else {
      const ow = getEventOrdinalWeekday();
      recurrence = { ...recurrence, byMonthDay: undefined, ordinalWeekdays: [{ day: ow.day, ordinal: ow.ordinal }] };
    }
    onchange();
  }

  function updateFrequency(freq: RecurrenceFrequency) {
    if (!recurrence) return;
    let weekdays = freq === "weekly" ? recurrence.weekdays : undefined;
    if (freq === "weekly" && (!weekdays || weekdays.length === 0)) weekdays = [getEventWeekday()];
    recurrence = { ...recurrence, frequency: freq, weekdays, ordinalWeekdays: undefined, byMonthDay: undefined, byMonth: undefined };
    onchange();
  }

  function updateInterval(val: number) {
    if (!recurrence) return;
    recurrence = { ...recurrence, interval: Math.max(1, val) };
    onchange();
  }

  function toggleWeekday(day: Weekday) {
    if (!recurrence) return;
    const current = new Set(recurrence.weekdays ?? []);
    if (current.has(day)) current.delete(day);
    else current.add(day);
    if (current.size === 0) return;
    recurrence = { ...recurrence, weekdays: ALL_WEEKDAYS.map((w) => w.value).filter((d) => current.has(d)) };
    onchange();
  }

  function updateEndType(type: "never" | "until" | "count") {
    if (!recurrence) return;
    if (type === "never") recurrence = { ...recurrence, end: { type: "never" } };
    else if (type === "until") recurrence = { ...recurrence, end: { type: "until", date: defaultUntilDate() } };
    else recurrence = { ...recurrence, end: { type: "count", count: 13 } };
    onchange();
  }

  function updateEndDate(date: string) {
    if (!recurrence) return;
    recurrence = { ...recurrence, end: { type: "until", date } };
    onchange();
  }

  function updateEndCount(count: number) {
    if (!recurrence) return;
    recurrence = { ...recurrence, end: { type: "count", count: Math.max(1, count) } };
    onchange();
  }

  // ─── End date picker ──────────────────────────────────────────
  let pickerOpen = $state(false);
  let dateBtn: HTMLInputElement | undefined = $state();
  let dateText = $state("");

  function syncDateText() {
    const d = recEndDate || defaultUntilDate();
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    dateText = dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function parseDateInput() {
    const parsed = new Date(dateText);
    if (!isNaN(parsed.getTime())) {
      const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
      updateEndDate(iso);
    }
    syncDateText();
  }

  $effect(() => {
    const _dep = recEndDate;
    syncDateText();
  });

  function positionPicker(node: HTMLElement) {
    if (!dateBtn) return { destroy() {} };
    const r = dateBtn.getBoundingClientRect();
    const pw = 224;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    node.style.left = `${left}px`;
    node.style.top = `${r.bottom + 4}px`;
    return { destroy() {} };
  }

  function selectCalDay(dateStr: string) {
    updateEndDate(dateStr);
    pickerOpen = false;
  }
</script>

<div class="flex flex-col rounded-lg overflow-hidden" style="background-color: var(--panel-contrast);">
  <div class="section-header flex items-stretch" class:section-active={!!recurrence}>
    <button onclick={(e) => { bounceIcon(e); ontoggle(); }}
      class="flex w-9 shrink-0 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-black/15
        {recurrence ? 'text-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground'}">
      <Repeat size={13} />
    </button>
    <button onclick={onexpand}
      class="flex flex-1 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-black/15">
      <span class="translate-y-[1.13px] text-[11px] {recurrence ? 'text-foreground' : 'text-muted-foreground'}">Repeat</span>
      <span class="ml-auto translate-y-[1.13px] truncate text-[10px] text-muted-foreground">{recurrence ? label : "None"}</span>
    </button>
  </div>
  {#if expanded && recurrence}
    <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="repeat" class="flex flex-col gap-2.5 border-t border-border/60 p-2.5" style="background-color: var(--panel-bg);">
      <!-- Every N [frequency] -->
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-muted-foreground">Every</span>
        <input type="number" value={recInterval}
          oninput={(e) => updateInterval(parseInt(e.currentTarget.value, 10) || 1)}
          min={1} max={99}
          class="num-input w-10 rounded-md bg-black/5 dark:bg-black/15 px-1 py-1 text-center text-[11px] text-[#1F1F1F] dark:text-[#E3E3E3] outline-none"
          onkeydown={(e) => e.stopPropagation()} />
        <div class="flex gap-1">
          {#each FREQ_OPTIONS as opt}
            <button onclick={() => updateFrequency(opt.value)}
              class="rounded-md px-2 py-1 text-[11px] transition-all
                {recFrequency === opt.value
                  ? 'bg-black/5 dark:bg-black/15 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
            >{opt.label}</button>
          {/each}
        </div>
      </div>

      <!-- Weekday picker (weekly) -->
      {#if recFrequency === "weekly"}
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Repeat on</span>
          <div class="grid grid-cols-7 gap-1">
            {#each ALL_WEEKDAYS as wd}
              <button onclick={() => toggleWeekday(wd.value)}
                class="flex h-7 items-center justify-center rounded-md text-[10px] transition-all
                  {recWeekdays.has(wd.value)
                    ? 'bg-black/5 dark:bg-black/15 text-foreground'
                    : 'bg-black/[0.02] dark:bg-black/[0.06] text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
              >{wd.label}</button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Monthly sub-options -->
      {#if recFrequency === "monthly"}
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Repeat on</span>
          <div class="flex gap-1.5">
            <button onclick={() => setMonthlyMode("day")}
              class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-all
                {monthlyMode === 'day'
                  ? 'bg-black/5 dark:bg-black/15 text-foreground'
                  : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
              <div class="h-3.5 w-3.5 shrink-0 rounded-full
                {monthlyMode === 'day' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
              </div>
              <span>Day {getEventDayOfMonth()}</span>
            </button>
            <button onclick={() => setMonthlyMode("ordinal")}
              class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-all
                {monthlyMode === 'ordinal'
                  ? 'bg-black/5 dark:bg-black/15 text-foreground'
                  : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
              <div class="h-3.5 w-3.5 shrink-0 rounded-full
                {monthlyMode === 'ordinal' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
              </div>
              <span>{getEventOrdinalWeekday().label}</span>
            </button>
          </div>
        </div>
      {/if}

      <!-- Ends -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Ends</span>

        <button onclick={() => updateEndType("never")}
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-all
            {recEndType === 'never'
              ? 'bg-black/5 dark:bg-black/15 text-foreground'
              : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
          <div class="h-3.5 w-3.5 shrink-0 rounded-full
            {recEndType === 'never' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
          </div>
          <span>Never</span>
        </button>

        <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]">
          <button onclick={() => updateEndType("until")}
            class="flex w-12 items-center gap-2 text-foreground transition-all">
            <div class="h-3.5 w-3.5 shrink-0 rounded-full
              {recEndType === 'until' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
            </div>
            <span>On</span>
          </button>
          <div class="relative">
            <input bind:this={dateBtn}
              type="text"
              bind:value={dateText}
              onclick={() => { if (recEndType !== "until") updateEndType("until"); pickerOpen = !pickerOpen; }}
              onblur={parseDateInput}
              onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); parseDateInput(); pickerOpen = false; } }}
              class="w-[110px] rounded bg-black/5 dark:bg-black/15 px-2 py-0.5 text-[11px] outline-none transition-colors
                {recEndType === 'until' ? 'text-[#1F1F1F] dark:text-[#E3E3E3]' : 'text-muted-foreground'}
                {pickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}" />

            {#if pickerOpen}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="fixed inset-0 z-[60]" onclick={() => { pickerOpen = false; }}></div>
              <div class="fixed z-[61] w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60"
                use:positionPicker>
                <MiniDatePicker selectedDate={recEndDate || defaultUntilDate()} small onselect={selectCalDay} />
              </div>
            {/if}
          </div>
        </div>

        <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]">
          <button onclick={() => updateEndType("count")}
            class="flex w-12 items-center gap-2 text-foreground transition-all">
            <div class="h-3.5 w-3.5 shrink-0 rounded-full
              {recEndType === 'count' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
            </div>
            <span>After</span>
          </button>
          <div class="flex items-center gap-1.5">
            <input type="number" value={recEndCount}
              onfocus={() => { if (recEndType !== "count") updateEndType("count"); }}
              oninput={(e) => updateEndCount(parseInt(e.currentTarget.value, 10) || 1)}
              min={1} max={999}
              class="num-input w-10 rounded bg-black/5 dark:bg-black/15 px-1 py-0.5 text-center text-[11px] outline-none
                {recEndType === 'count' ? 'text-[#1F1F1F] dark:text-[#E3E3E3]' : 'text-muted-foreground'}"
              onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} />
            <span class="{recEndType === 'count' ? 'text-[#1F1F1F] dark:text-[#E3E3E3]' : 'text-muted-foreground'}">times</span>
          </div>
        </div>
      </div>

      <!-- RDATE indicator -->
      {#if rdate && rdate.length > 0}
        <span class="text-[10px] italic text-muted-foreground">+ {rdate.length} additional date{rdate.length > 1 ? "s" : ""}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .section-header {
    transition: background-color 180ms ease-out;
  }
  .section-active {
    background-color: rgba(0, 0, 0, 0.03);
  }
  :global(.dark) .section-active {
    background-color: rgba(0, 0, 0, 0.08);
  }
  .num-input {
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .num-input::-webkit-inner-spin-button,
  .num-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
</style>

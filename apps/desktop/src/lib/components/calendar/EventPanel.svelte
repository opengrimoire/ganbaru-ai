<script lang="ts">
  import type {
    CalendarEvent, EventColor, EventStatus, EventTransparency, PomodoroConfig,
    RecurrenceConfig, RecurrenceFrequency, RecurringScope, Weekday,
  } from "./types";
  import { formatRecurrenceLabel } from "./rrule";
  import { onMount, untrack } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import "@fontsource-variable/inter";
  import { EVENT_COLOR_OPTIONS, getEventColor } from "./utils";
  import { getTheme } from "$lib/stores/theme.svelte";
  import X from "@lucide/svelte/icons/x";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";
  import Timer from "@lucide/svelte/icons/timer";
  import Music from "@lucide/svelte/icons/music";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Plus from "@lucide/svelte/icons/plus";
  import Bold from "@lucide/svelte/icons/bold";
  import Italic from "@lucide/svelte/icons/italic";
  import Underline from "@lucide/svelte/icons/underline";
  import ListOrdered from "@lucide/svelte/icons/list-ordered";
  import List from "@lucide/svelte/icons/list";
  import Link from "@lucide/svelte/icons/link";
  import RemoveFormatting from "@lucide/svelte/icons/remove-formatting";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Sun from "@lucide/svelte/icons/sun";
  import Eye from "@lucide/svelte/icons/eye";
  import AlignLeft from "@lucide/svelte/icons/align-left";
  import Check from "@lucide/svelte/icons/check";


  const theme = getTheme();

  const PANEL_WIDTH = 320;
  const PANEL_GAP = 8;

  let {
    mode,
    start,
    end,
    event,
    anchor,
    externalDirty = false,
    readOnly = false,
    onSave,
    onDelete,
    onClose,
    onChange,
    onScopeChange,
  }: {
    mode: "create" | "edit";
    start?: string;
    end?: string;
    event?: CalendarEvent;
    anchor: { x: number; y: number; width: number; height: number };
    externalDirty?: boolean;
    readOnly?: boolean;
    onSave: (data: {
      title: string;
      start: string;
      end: string;
      color?: EventColor;
      description: string;
      recurrence?: RecurrenceConfig;
      notifications?: number[];
      pomodoroConfig?: PomodoroConfig;
      allDay?: boolean;
      location?: string;
      url?: string;
      transparency?: EventTransparency;
      status?: EventStatus;
    }, scope?: RecurringScope) => void;
    onDelete?: (id: string, scope?: RecurringScope) => void;
    onClose: () => void;
    onChange?: (data: Partial<CalendarEvent>) => void;
    onScopeChange?: (scope: RecurringScope) => void;
  } = $props();

  // ─── Core fields ────────────────────────────────────────────────
  let title = $state("");
  let startTime = $state("");
  let endTime = $state("");
  let startDate = $state("");
  let endDate = $state("");
  let color: EventColor | undefined = $state(undefined);
  let description = $state("");
  let scope: RecurringScope = $state("this");

  // ─── New fields (import prep) ──────────────────────────────────
  let allDay = $state(false);
  let location = $state("");
  let eventUrl = $state("");
  let transparency: EventTransparency = $state("opaque");
  let eventStatus: EventStatus = $state("confirmed");

  // ─── Description editor ─────────────────────────────────────────
  let descOpen = $state(false);
  let editorEl: HTMLDivElement | undefined = $state();
  let descAreaEl: HTMLDivElement | undefined = $state();

  function openDescEditor() {
    descOpen = true;
    requestAnimationFrame(() => {
      if (editorEl) {
        editorEl.innerHTML = description;
        editorEl.focus();
        // Place cursor at end
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(editorEl);
          sel.collapseToEnd();
        }
      }
    });
  }

  let descClosing = $state(false);

  function closeDescEditor() {
    if (!descOpen || descClosing) return;
    descClosing = true;
    descOpen = false;
    // Keep element in DOM during toolbar slide-out, then release
    setTimeout(() => { descClosing = false; }, 250);
  }

  function handlePanelClick(e: MouseEvent) {
    if (descOpen && descAreaEl && !descAreaEl.contains(e.target as Node)) {
      closeDescEditor();
    }
  }

  function handleEditorInput() {
    if (editorEl) {
      description = editorEl.innerHTML;
      emitChange();
    }
  }

  function execFormat(command: string, value?: string) {
    document.execCommand(command, false, value);
    editorEl?.focus();
    handleEditorInput();
  }

  let linkPopoverOpen = $state(false);
  let linkUrl = $state("https://");
  let linkBtnEl: HTMLButtonElement | undefined = $state();
  let linkInputEl: HTMLInputElement | undefined = $state();
  let savedSelection: Range | null = null;

  function openLinkPopover() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelection = sel.getRangeAt(0).cloneRange();
    }
    const selectedText = sel?.toString() ?? "";
    linkUrl = selectedText.startsWith("http") ? selectedText : "https://";
    linkPopoverOpen = true;
    requestAnimationFrame(() => {
      linkInputEl?.focus();
      linkInputEl?.select();
    });
  }

  function handleEditorPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text.startsWith("http")) return; // let normal paste happen
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return; // no selection, normal paste
    e.preventDefault();
    document.execCommand("createLink", false, text);
    handleEditorInput();
  }

  function applyLink() {
    if (!linkUrl || linkUrl === "https://") { linkPopoverOpen = false; return; }
    if (savedSelection) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelection);
    }
    document.execCommand("createLink", false, linkUrl);
    editorEl?.focus();
    handleEditorInput();
    linkPopoverOpen = false;
    savedSelection = null;
  }

  function positionLinkPopover(node: HTMLElement) {
    if (!linkBtnEl) return { destroy() {} };
    const r = linkBtnEl.getBoundingClientRect();
    const pw = node.offsetWidth || 220;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    node.style.left = `${left}px`;
    node.style.top = `${r.bottom + 4}px`;
    return { destroy() {} };
  }

  const descPreview = $derived.by(() => {
    if (!description) return "";
    // Strip HTML tags for the collapsed preview line
    const tmp = document.createElement("div");
    tmp.innerHTML = description;
    return tmp.textContent?.trim() ?? "";
  });

  // ─── Pomodoro ───────────────────────────────────────────────────
  type PomodoroPreset = "auto" | "deep" | "creative" | "extended" | "custom";
  // Sync description HTML into the persistent editor element when not actively editing
  $effect(() => {
    if (!descOpen && !descClosing && editorEl) {
      editorEl.innerHTML = description;
    }
  });

  const POMO_PRESETS: Record<Exclude<PomodoroPreset, "custom">, { focus: number; short: number; long: number; label: string; desc: string }> = {
    auto: { focus: 40, short: 5, long: 10, label: "Automatic", desc: "Default" },
    deep: { focus: 40, short: 5, long: 10, label: "Deep focus", desc: "F 40 / SB 5 / LB 10" },
    creative: { focus: 25, short: 5, long: 15, label: "Creative", desc: "F 25 / SB 5 / LB 15" },
    extended: { focus: 50, short: 10, long: 10, label: "Extended", desc: "F 50 / SB 10 / LB 10" },
  };
  let pomodoroEnabled = $state(false);
  let pomodoroPreset: PomodoroPreset = $state("auto");
  let focusDuration = $state(40);
  let shortBreak = $state(5);
  let longBreak = $state(10);
  let idleTimeoutEnabled = $state(true);
  const IDLE_TIMEOUT_DEFAULT = 1;

  function inferPreset(f: number, s: number, l: number): PomodoroPreset {
    for (const [key, val] of Object.entries(POMO_PRESETS) as [Exclude<PomodoroPreset, "custom">, typeof POMO_PRESETS["auto"]][]) {
      if (key !== "auto" && val.focus === f && val.short === s && val.long === l) return key;
    }
    return "custom";
  }

  function applyPomoPreset(preset: PomodoroPreset) {
    pomodoroPreset = preset;
    if (preset !== "custom") {
      const vals = POMO_PRESETS[preset];
      focusDuration = vals.focus;
      shortBreak = vals.short;
      longBreak = vals.long;
    }
    emitChange();
  }

  const pomoSummary = $derived.by(() => {
    if (!pomodoroEnabled) return "None";
    if (pomodoroPreset === "custom") return `Custom (${focusDuration}/${shortBreak}/${longBreak})`;
    return POMO_PRESETS[pomodoroPreset]?.label ?? "Custom";
  });

  // ─── Notifications ──────────────────────────────────────────────
  const NOTIF_PRESETS: { value: number; label: string }[] = [
    { value: 0, label: "At start" },
    { value: 5, label: "5 minutes before" },
    { value: 10, label: "10 minutes before" },
    { value: 30, label: "30 minutes before" },
    { value: 60, label: "1 hour before" },
    { value: 1440, label: "1 day before" },
  ];
  const CUSTOM_UNITS: { value: number; label: string }[] = [
    { value: 1, label: "minutes" },
    { value: 60, label: "hours" },
    { value: 1440, label: "days" },
    { value: 10080, label: "weeks" },
  ];
  let notifEnabled = $state(false);
  let notifSelected = $state(new Set<number>());
  let customNotifs: { amount: number; unit: number }[] = $state([]);
  let customNotifDropdown = $state<number | null>(null);
  let customNotifBtns: (HTMLButtonElement | undefined)[] = $state([]);

  function toggleNotif(minutes: number) {
    const next = new Set(notifSelected);
    if (next.has(minutes)) next.delete(minutes);
    else next.add(minutes);
    notifSelected = next;
    emitChange();
  }

  function addCustomNotif() {
    if (customNotifs.length >= 2) return;
    customNotifs = [...customNotifs, { amount: 1, unit: 10080 }];
    emitChange();
  }

  function removeCustomNotif(idx: number) {
    customNotifs = customNotifs.filter((_, i) => i !== idx);
    emitChange();
  }

  function updateCustomNotif(idx: number, amount: number, unit: number) {
    customNotifs = customNotifs.map((n, i) => i === idx ? { amount, unit } : n);
    emitChange();
  }

  function positionNotifDropdown(node: HTMLElement, idx: number) {
    const btn = customNotifBtns[idx];
    if (!btn) return { destroy() {} };
    const r = btn.getBoundingClientRect();
    const pw = node.offsetWidth || 120;
    let left = r.left;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    node.style.left = `${left}px`;
    node.style.top = `${r.bottom + 4}px`;
    return { destroy() {} };
  }

  function collectNotifications(): number[] | undefined {
    if (!notifEnabled) return undefined;
    const result: number[] = [...notifSelected];
    for (const cn of customNotifs) result.push(cn.amount * cn.unit);
    return result.length > 0 ? [...new Set(result)].sort((a, b) => a - b) : undefined;
  }

  function formatNotifMinutes(minutes: number): string {
    if (minutes === 0) return "At start";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (minutes < 1440) {
      if (mins === 0) return `${hours} hour${hours === 1 ? "" : "s"} before`;
      return `${hours}h ${mins}m before`;
    }
    const days = Math.floor(minutes / 1440);
    if (minutes % 1440 === 0) return `${days} day${days === 1 ? "" : "s"} before`;
    const remHours = Math.floor((minutes % 1440) / 60);
    return `${days}d ${remHours}h before`;
  }

  const notifSummary = $derived.by(() => {
    if (!notifEnabled) return "None";
    const all: number[] = [...notifSelected];
    for (const cn of customNotifs) all.push(cn.amount * cn.unit);
    if (all.length === 0) return "None";
    const sorted = [...new Set(all)].sort((a, b) => a - b);
    return sorted.map((m) => {
      const preset = NOTIF_PRESETS.find((p) => p.value === m);
      return preset ? preset.label : formatNotifMinutes(m);
    }).join(", ");
  });

  // ─── Recurrence ─────────────────────────────────────────────────
  let recurrence: RecurrenceConfig | undefined = $state(undefined);

  const FREQ_OPTIONS: { value: RecurrenceFrequency; singular: string; plural: string }[] = [
    { value: "daily", singular: "day", plural: "days" },
    { value: "weekly", singular: "week", plural: "weeks" },
    { value: "monthly", singular: "month", plural: "months" },
    { value: "yearly", singular: "year", plural: "years" },
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
  const recurrenceLabel = $derived(recurrence ? formatRecurrenceLabel(recurrence) : "");

  function defaultUntilDate(): string {
    const [y, m, d] = startDate.split("-").map(Number);
    const dt = new Date(y, m - 1 + 3, d - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }

  const WEEKDAY_MAP: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function getEventWeekday(): Weekday {
    const [y, m, d] = startDate.split("-").map(Number);
    return WEEKDAY_MAP[new Date(y, m - 1, d).getDay()];
  }

  function updateRecFrequency(freq: RecurrenceFrequency) {
    if (!recurrence) return;
    let weekdays = freq === "weekly" ? recurrence.weekdays : undefined;
    if (freq === "weekly" && (!weekdays || weekdays.length === 0)) {
      weekdays = [getEventWeekday()];
    }
    recurrence = { ...recurrence, frequency: freq, weekdays };
    emitChange();
  }

  function updateRecInterval(val: number) {
    if (!recurrence) return;
    recurrence = { ...recurrence, interval: Math.max(1, val) };
    emitChange();
  }

  function toggleWeekday(day: Weekday) {
    if (!recurrence) return;
    const current = new Set(recurrence.weekdays ?? []);
    if (current.has(day)) current.delete(day);
    else current.add(day);
    if (current.size === 0) return;
    recurrence = { ...recurrence, weekdays: ALL_WEEKDAYS.map((w) => w.value).filter((d) => current.has(d)) };
    emitChange();
  }

  function updateRecEndType(type: "never" | "until" | "count") {
    if (!recurrence) return;
    if (type === "never") recurrence = { ...recurrence, end: { type: "never" } };
    else if (type === "until") {
      const d = defaultUntilDate();
      recurrence = { ...recurrence, end: { type: "until", date: d } };
      const [y, m] = d.split("-").map(Number);
      calYear = y;
      calMonth = m;
    }
    else recurrence = { ...recurrence, end: { type: "count", count: 13 } };
    emitChange();
  }

  function updateRecEndDate(date: string) {
    if (!recurrence) return;
    recurrence = { ...recurrence, end: { type: "until", date } };
    emitChange();
  }

  function updateRecEndCount(count: number) {
    if (!recurrence) return;
    recurrence = { ...recurrence, end: { type: "count", count: Math.max(1, count) } };
    emitChange();
  }

  // ─── Mini calendar picker (recurrence end date) ────────────────
  let recEndPickerOpen = $state(false);
  let recEndDateBtn: HTMLInputElement | undefined = $state();
  let recEndDateText = $state("");

  function syncRecEndDateText() {
    const d = recEndDate || defaultUntilDate();
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    recEndDateText = dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function parseRecEndDateInput() {
    const parsed = new Date(recEndDateText);
    if (!isNaN(parsed.getTime())) {
      const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
      updateRecEndDate(iso);
      const [y, m] = iso.split("-").map(Number);
      calYear = y;
      calMonth = m;
    }
    syncRecEndDateText();
  }

  $effect(() => {
    // Keep text in sync when recEndDate changes (e.g. from calendar pick)
    const _dep = recEndDate;
    syncRecEndDateText();
  });

  function positionEndPicker(node: HTMLElement) {
    function update() {
      if (!recEndDateBtn) return;
      const r = recEndDateBtn.getBoundingClientRect();
      const pw = 224; // w-56 = 14rem = 224px
      let left = r.left + r.width / 2 - pw / 2;
      left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
      node.style.left = `${left}px`;
      node.style.top = `${r.bottom + 4}px`;
    }
    update();
    return { destroy() {} };
  }


  let calYear = $state(new Date().getFullYear());
  let calMonth = $state(new Date().getMonth() + 1);

  type CalPickerMode = "days" | "months" | "years";
  let calPickerMode: CalPickerMode = $state("days");
  let calYearPageStart = $state(new Date().getFullYear() - 4);
  let calWheelCooldown = false;

  const calMonthLabel = $derived(
    new Date(calYear, calMonth - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  );

  function prevCalMonth() {
    if (calMonth === 1) { calMonth = 12; calYear--; }
    else calMonth--;
  }

  function nextCalMonth() {
    if (calMonth === 12) { calMonth = 1; calYear++; }
    else calMonth++;
  }

  function handleCalHeaderClick() {
    if (calPickerMode === "days") {
      calPickerMode = "months";
    } else if (calPickerMode === "months") {
      calYearPageStart = calYear - 4;
      calPickerMode = "years";
    } else {
      calPickerMode = "days";
    }
  }

  function selectCalMonth(monthIndex: number) {
    calMonth = monthIndex + 1;
    calPickerMode = "days";
  }

  function selectCalYear(year: number) {
    calYear = year;
    calPickerMode = "months";
  }

  const calYearPageYears = $derived(Array.from({ length: 12 }, (_, i) => calYearPageStart + i));

  function handleCalWheel(e: WheelEvent) {
    e.preventDefault();
    if (calWheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    calWheelCooldown = true;

    const delta = e.deltaY > 0 ? 1 : -1;

    if (calPickerMode === "days") {
      if (delta > 0) nextCalMonth();
      else prevCalMonth();
    } else if (calPickerMode === "months") {
      calYear += delta;
    } else {
      calYearPageStart += delta * 12;
    }

    setTimeout(() => { calWheelCooldown = false; }, 300);
  }

  interface CalDay {
    day: number;
    dateStr: string;
    currentMonth: boolean;
    selected: boolean;
    today: boolean;
  }

  function buildCalendarGrid(y: number, m: number, selectedStr: string): CalDay[] {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const firstDow = new Date(y, m - 1, 1).getDay();
    const startOffset = firstDow === 0 ? 6 : firstDow - 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const daysInPrevMonth = new Date(y, m - 1, 0).getDate();
    const days: CalDay[] = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      const ds = `${py}-${String(pm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, dateStr: ds, currentMonth: false, selected: ds === selectedStr, today: ds === todayStr });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, dateStr: ds, currentMonth: true, selected: ds === selectedStr, today: ds === todayStr });
    }
    const totalNeeded = Math.ceil(days.length / 7) * 7;
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    for (let d = 1; days.length < totalNeeded; d++) {
      const ds = `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, dateStr: ds, currentMonth: false, selected: ds === selectedStr, today: ds === todayStr });
    }
    return days;
  }

  const calDays = $derived.by(() => buildCalendarGrid(calYear, calMonth, recEndDate));

  function selectCalDay(day: CalDay) {
    updateRecEndDate(day.dateStr);
    const [y, m] = day.dateStr.split("-").map(Number);
    calYear = y;
    calMonth = m;
    recEndPickerOpen = false;
  }

  // ─── Date picker ──────────────────────────────────────────────
  let datepickerOpen = $state(false);
  let dpYear = $state(new Date().getFullYear());
  let dpMonth = $state(new Date().getMonth() + 1);

  type DpPickerMode = "days" | "months" | "years";
  let dpPickerMode: DpPickerMode = $state("days");
  let dpYearPageStart = $state(new Date().getFullYear() - 4);
  let dpWheelCooldown = false;

  const dpShortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dpYearPageYears = $derived(Array.from({ length: 12 }, (_, i) => dpYearPageStart + i));
  const dpDayLetters = ["M", "T", "W", "T", "F", "S", "S"];

  const dpMonthLabel = $derived(
    new Date(dpYear, dpMonth - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  );

  function prevDpMonth() {
    if (dpMonth === 1) { dpMonth = 12; dpYear--; }
    else dpMonth--;
  }

  function nextDpMonth() {
    if (dpMonth === 12) { dpMonth = 1; dpYear++; }
    else dpMonth++;
  }

  const dpDays = $derived.by(() => buildCalendarGrid(dpYear, dpMonth, startDate));

  function selectDpDay(day: CalDay) {
    // Shift endDate by the same delta to preserve event duration
    if (startDate && endDate) {
      const [oy, om, od] = startDate.split("-").map(Number);
      const [ey, em, ed] = endDate.split("-").map(Number);
      const oldStart = new Date(oy, om - 1, od);
      const oldEnd = new Date(ey, em - 1, ed);
      const daySpan = Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000);
      const [ny, nm, nd] = day.dateStr.split("-").map(Number);
      const newEnd = new Date(ny, nm - 1, nd + daySpan);
      endDate = `${newEnd.getFullYear()}-${String(newEnd.getMonth() + 1).padStart(2, "0")}-${String(newEnd.getDate()).padStart(2, "0")}`;
    } else {
      endDate = day.dateStr;
    }
    startDate = day.dateStr;
    const [y, m] = day.dateStr.split("-").map(Number);
    dpYear = y;
    dpMonth = m;
    dpPickerMode = "days";
    datepickerOpen = false;
    emitChange();
  }

  function selectDpMonth(monthIndex: number) {
    dpMonth = monthIndex + 1;
    dpPickerMode = "days";
  }

  function selectDpYear(year: number) {
    dpYear = year;
    dpPickerMode = "months";
  }

  function handleDpHeaderClick() {
    if (dpPickerMode === "days") {
      dpPickerMode = "months";
    } else if (dpPickerMode === "months") {
      dpYearPageStart = dpYear - 4;
      dpPickerMode = "years";
    } else {
      dpPickerMode = "days";
    }
  }

  function handleDpWheel(e: WheelEvent) {
    e.preventDefault();
    if (dpWheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    dpWheelCooldown = true;

    const delta = e.deltaY > 0 ? 1 : -1;

    if (dpPickerMode === "days") {
      if (delta > 0) nextDpMonth();
      else prevDpMonth();
    } else if (dpPickerMode === "months") {
      dpYear += delta;
    } else {
      dpYearPageStart += delta * 12;
    }

    setTimeout(() => { dpWheelCooldown = false; }, 300);
  }

  function toggleDatepicker() {
    timePickerTarget = null;
    endDatepickerOpen = false;
    showAsPicker = false;
    statusPicker = false;
    datepickerOpen = !datepickerOpen;
    if (datepickerOpen && startDate) {
      const [y, m] = startDate.split("-").map(Number);
      dpYear = y;
      dpMonth = m;
      dpPickerMode = "days";
    }
  }

  // ─── End date picker ─────────────────────────────────────────
  let endDatepickerOpen = $state(false);
  let edpYear = $state(new Date().getFullYear());
  let edpMonth = $state(new Date().getMonth() + 1);
  let edpPickerMode: DpPickerMode = $state("days");
  let edpYearPageStart = $state(new Date().getFullYear() - 4);
  let edpWheelCooldown = false;

  const edpMonthLabel = $derived(
    new Date(edpYear, edpMonth - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  );
  const edpYearPageYears = $derived(Array.from({ length: 12 }, (_, i) => edpYearPageStart + i));
  const edpDays = $derived.by(() => buildCalendarGrid(edpYear, edpMonth, endDate));

  function toggleEndDatepicker() {
    timePickerTarget = null;
    datepickerOpen = false;
    showAsPicker = false;
    statusPicker = false;
    endDatepickerOpen = !endDatepickerOpen;
    if (endDatepickerOpen && endDate) {
      const [y, m] = endDate.split("-").map(Number);
      edpYear = y;
      edpMonth = m;
      edpPickerMode = "days";
    }
  }

  function selectEdpDay(day: CalDay) {
    // Don't allow end date before start date
    if (day.dateStr < startDate) return;
    endDate = day.dateStr;
    const [y, m] = day.dateStr.split("-").map(Number);
    edpYear = y;
    edpMonth = m;
    edpPickerMode = "days";
    endDatepickerOpen = false;
    emitChange();
  }

  function handleEdpHeaderClick() {
    if (edpPickerMode === "days") edpPickerMode = "months";
    else if (edpPickerMode === "months") { edpYearPageStart = edpYear - 4; edpPickerMode = "years"; }
    else edpPickerMode = "days";
  }

  function handleEdpWheel(e: WheelEvent) {
    e.preventDefault();
    if (edpWheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    edpWheelCooldown = true;
    const delta = e.deltaY > 0 ? 1 : -1;
    if (edpPickerMode === "days") {
      if (delta > 0) { if (edpMonth === 12) { edpMonth = 1; edpYear++; } else edpMonth++; }
      else { if (edpMonth === 1) { edpMonth = 12; edpYear--; } else edpMonth--; }
    } else if (edpPickerMode === "months") edpYear += delta;
    else edpYearPageStart += delta * 12;
    setTimeout(() => { edpWheelCooldown = false; }, 300);
  }

  // ─── Time picker ─────────────────────────────────────────────
  const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });

  let timePickerTarget: "start" | "end" | null = $state(null);
  let timePickerEl: HTMLDivElement | undefined = $state();
  let nearestSlot = $state("");
  let showAsPicker = $state(false);
  let statusPicker = $state(false);

  function computeNearestSlot(time: string) {
    const [h, m] = (time || "0:0").split(":").map(Number);
    nearestSlot = TIME_SLOTS[Math.min(Math.round((h * 60 + m) / 30), TIME_SLOTS.length - 1)];
  }

  function openTimePicker(target: "start" | "end") {
    datepickerOpen = false;
    endDatepickerOpen = false;
    showAsPicker = false;
    statusPicker = false;
    computeNearestSlot(target === "start" ? startTime : endTime);
    timePickerTarget = target;
    if (timePickerTarget) {
      requestAnimationFrame(() => {
        if (!timePickerEl) return;
        const current = target === "start" ? startTime : endTime;
        let scrollTarget = timePickerEl.querySelector(`[data-time="${current}"]`);
        if (!scrollTarget && current) {
          const [h, m] = current.split(":").map(Number);
          const nearestIdx = Math.min(Math.round((h * 60 + m) / 30), TIME_SLOTS.length - 1);
          scrollTarget = timePickerEl.querySelector(`[data-time="${TIME_SLOTS[nearestIdx]}"]`);
        }
        scrollTarget?.scrollIntoView({ block: "center" });
      });
    }
  }

  function selectTime(time: string) {
    if (timePickerTarget === "start") {
      startTime = time;
      syncEndDateFromTimes();
    } else if (timePickerTarget === "end") {
      endTime = time;
      syncEndDateFromTimes();
    }
    timePickerTarget = null;
    emitChange();
  }

  /** When times change, set endDate = startDate + 1 day if end < start, else same day. */
  function syncEndDateFromTimes() {
    if (!startDate) return;
    if (endTime < startTime) {
      const [y, m, d] = startDate.split("-").map(Number);
      const next = new Date(y, m - 1, d + 1);
      endDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    } else {
      endDate = startDate;
    }
  }

  // ─── Tab system ─────────────────────────────────────────────────
  type Section = "pomodoro" | "notifications" | "repeat" | "music";
  let openSection: Section | null = $state(null);

  function isSectionEnabled(s: Section): boolean {
    if (s === "pomodoro") return pomodoroEnabled;
    if (s === "notifications") return notifEnabled;
    if (s === "repeat") return !!recurrence;
    return false;
  }

  /** Icon click: toggle the feature on/off with sensible defaults. */
  function bounceIcon(e: MouseEvent) {
    const btn = (e.currentTarget as HTMLElement).querySelector("svg");
    if (!btn) return;
    btn.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.2)" },
        { transform: "scale(1)" },
      ],
      { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }

  function handleToggle(s: Section, e?: MouseEvent) {
    if (e) bounceIcon(e);
    if (s === "music") return;
    const enabled = isSectionEnabled(s);
    if (enabled) {
      // Disable
      if (s === "pomodoro") pomodoroEnabled = false;
      if (s === "notifications") { notifEnabled = false; notifSelected = new Set(); customNotifs = []; }
      if (s === "repeat") recurrence = undefined;
      if (openSection === s) openSection = null;
    } else {
      // Enable with defaults
      if (s === "pomodoro") { pomodoroEnabled = true; applyPomoPreset("auto"); idleTimeoutEnabled = true; }
      if (s === "notifications") { notifEnabled = true; notifSelected = new Set([0]); }
      if (s === "repeat") recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
    }
    emitChange();
  }

  /** Label click: expand/collapse the details panel. */
  function handleExpand(s: Section) {
    // Auto-activate repeat when expanding for the first time
    if (s === "repeat" && !recurrence && openSection !== s) {
      recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
      emitChange();
    }
    openSection = openSection === s ? null : s;
    if (openSection) {
      requestAnimationFrame(() => {
        const el = panelEl?.querySelector(`[data-section="${openSection}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  // ─── Panel positioning & drag ───────────────────────────────────
  let titleInput: HTMLInputElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();
  let panelHeight = $state(0);
  let dragOffset = $state({ x: 0, y: 0 });
  let isDragging = $state(false);
  let userDragged = false;
  let dragStart = { x: 0, y: 0 };
  let baseLeft = $state(0);
  let baseTop = $state(0);

  const isRecurring = $derived(
    mode === "edit" && !!event && (!!event.recurringParentId || !!event.recurrence),
  );

  // ─── Initialization ─────────────────────────────────────────────
  let lastInitKey = "";

  $effect(() => {
    const key = mode === "edit" ? (event?.id ?? "") : "create";
    if (key === lastInitKey) return;
    lastInitKey = key;

    if (mode === "edit" && event) {
      title = event.title;
      startDate = event.start.split(" ")[0] ?? "";
      startTime = event.start.split(" ")[1] ?? "";
      endDate = event.end.split(" ")[0] ?? "";
      endTime = event.end.split(" ")[1] ?? "";
      color = event.color;
      description = event.description ?? "";
      recurrence = event.recurrence ? { ...event.recurrence } : undefined;
      allDay = event.allDay ?? false;
      location = event.location ?? "";
      eventUrl = event.url ?? "";
      transparency = event.transparency ?? "opaque";
      eventStatus = event.status ?? "confirmed";

      const pc = event.pomodoroConfig;
      pomodoroEnabled = !!pc;
      if (pc) {
        focusDuration = pc.focusDurationMinutes;
        shortBreak = pc.shortBreakMinutes;
        longBreak = pc.longBreakMinutes;
        pomodoroPreset = inferPreset(pc.focusDurationMinutes, pc.shortBreakMinutes, pc.longBreakMinutes);
        idleTimeoutEnabled = pc.idleTimeoutMinutes !== null;
      } else {
        focusDuration = 40; shortBreak = 5; longBreak = 10;
        pomodoroPreset = "auto";
        idleTimeoutEnabled = true;
      }

      const notifs = event.notifications;
      notifEnabled = !!notifs && notifs.length > 0;
      notifSelected = new Set<number>();
      customNotifs = [];
      if (notifs) {
        const presetValues = new Set(NOTIF_PRESETS.map((p) => p.value));
        for (const m of notifs) {
          if (presetValues.has(m)) notifSelected.add(m);
          else {
            let found = false;
            for (const u of [...CUSTOM_UNITS].reverse()) {
              if (m > 0 && m % u.value === 0 && customNotifs.length < 2) {
                customNotifs = [...customNotifs, { amount: m / u.value, unit: u.value }];
                found = true;
                break;
              }
            }
            if (!found && customNotifs.length < 2) customNotifs = [...customNotifs, { amount: m, unit: 1 }];
          }
        }
      }

      if (recurrence?.end.type === "until") {
        const [y, m] = recurrence.end.date.split("-").map(Number);
        calYear = y;
        calMonth = m;
      }
    } else if (mode === "create") {
      title = "";
      startDate = (start ?? "").split(" ")[0] ?? "";
      startTime = (start ?? "").split(" ")[1] ?? "";
      endDate = (end ?? "").split(" ")[0] ?? "";
      endTime = (end ?? "").split(" ")[1] ?? "";
      color = undefined;
      description = "";
      recurrence = undefined;
      pomodoroEnabled = true;
      pomodoroPreset = "auto";
      focusDuration = 40; shortBreak = 5; longBreak = 10;
      idleTimeoutEnabled = true;
      notifEnabled = true;
      notifSelected = new Set([0]);
      customNotifs = [];
      allDay = false;
      location = "";
      eventUrl = "";
      transparency = "opaque";
      eventStatus = "confirmed";
    }

    descOpen = false;
    datepickerOpen = false;
    endDatepickerOpen = false;
    timePickerTarget = null;
    showAsPicker = false;
    statusPicker = false;
    hasChanges = false;
    openSection = null;
    scope = "this";
    dragOffset = { x: 0, y: 0 };
    userDragged = false;
  });

  // Sync date/time from event prop when block is dragged/resized externally.
  // Only updates time fields — not title/description/etc. which the user may
  // have edited in the panel. Doesn't trigger hasChanges since the drag already
  // committed the time change to the DB.
  $effect(() => {
    if (mode === "edit" && event) {
      startDate = event.start.split(" ")[0] ?? "";
      startTime = event.start.split(" ")[1] ?? "";
      endDate = event.end.split(" ")[0] ?? "";
      endTime = event.end.split(" ")[1] ?? "";
    } else if (mode === "create") {
      startDate = (start ?? "").split(" ")[0] ?? "";
      startTime = (start ?? "").split(" ")[1] ?? "";
      endDate = (end ?? "").split(" ")[0] ?? "";
      endTime = (end ?? "").split(" ")[1] ?? "";
    }
  });

  // Sync editor content when it first appears (e.g. editing existing event with description)
  $effect(() => {
    if (descOpen && editorEl && editorEl.innerHTML !== description) {
      editorEl.innerHTML = description;
    }
  });

  // Track actual panel height for initial placement estimates
  $effect(() => {
    if (!panelEl) return;
    const observer = new ResizeObserver(() => {
      panelHeight = panelEl!.offsetHeight;
    });
    observer.observe(panelEl);
    return () => observer.disconnect();
  });

  // Entrance animation
  onMount(() => {
    if (!panelEl) return;
    const el = panelEl;
    const anchorCenterX = anchor.x - anchor.width / 2;
    const anchorCenterY = anchor.y + anchor.height / 2;
    const rect = el.getBoundingClientRect();
    const originX = ((anchorCenterX - rect.left) / rect.width) * 100;
    const originY = ((anchorCenterY - rect.top) / rect.height) * 100;
    el.style.transformOrigin = `clamp(0%, ${originX}%, 100%) clamp(0%, ${originY}%, 100%)`;
    el.animate(
      [
        { transform: "scale(0.92)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  });

  // Pin base position when anchor changes; read panelHeight without tracking
  // so height changes from expanding sections don't reposition the panel.
  // Skip repositioning if the user has manually dragged the panel.
  $effect(() => {
    const _a = anchor;
    if (userDragged) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ph = untrack(() => panelHeight) || 520;

    let left: number;
    const leftSpace = _a.x - _a.width - PANEL_GAP;
    const rightSpace = vw - _a.x - PANEL_GAP;
    if (leftSpace >= PANEL_WIDTH) left = _a.x - _a.width - PANEL_GAP - PANEL_WIDTH;
    else if (rightSpace >= PANEL_WIDTH) left = _a.x + PANEL_GAP;
    else left = Math.max(PANEL_GAP, (vw - PANEL_WIDTH) / 2);

    baseLeft = Math.max(PANEL_GAP, Math.min(vw - PANEL_WIDTH - PANEL_GAP, left));
    baseTop = Math.max(PANEL_GAP, Math.min(vh - ph - PANEL_GAP, _a.y));
    dragOffset = { x: 0, y: 0 };
  });

  // ─── Dirty tracking ────────────────────────────────────────────
  let hasChanges = $state(false);
  const saveReady = $derived(mode === "create" || hasChanges || externalDirty);

  // ─── Emit changes ───────────────────────────────────────────────
  function emitChange() {
    hasChanges = true;
    // Auto-adjust endDate when times are manually typed
    if (startDate && startTime && endTime && endDate === startDate && endTime < startTime) {
      syncEndDateFromTimes();
    }
    onChange?.({
      title: title.trim(),
      start: `${startDate} ${startTime}`,
      end: `${endDate} ${endTime}`,
      color,
      description,
      recurrence,
      notifications: collectNotifications(),
      pomodoroConfig: pomodoroEnabled ? {
        focusDurationMinutes: focusDuration,
        shortBreakMinutes: shortBreak,
        longBreakMinutes: longBreak,
        pomodoroCount: 4,
        idleTimeoutMinutes: idleTimeoutEnabled ? IDLE_TIMEOUT_DEFAULT : null,
      } : undefined,
      allDay: allDay || undefined,
      location: location || undefined,
      url: eventUrl || undefined,
      transparency: transparency !== "opaque" ? transparency : undefined,
      status: eventStatus !== "confirmed" ? eventStatus : undefined,
    });
  }

  $effect(() => {
    if (mode === "create" && titleInput) titleInput.select();
  });

  // ─── Panel position ─────────────────────────────────────────────
  // Uses pinned baseTop/baseLeft so expanding sections grow downward
  // without shifting the top. When the bottom would exceed the viewport,
  // the top nudges upward by exactly the overflow — switching to purely
  // upward growth. No scroll; Save button stays visible.
  const panelStyle = $derived.by(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ph = panelHeight || 520;

    let left = Math.max(PANEL_GAP, Math.min(vw - PANEL_WIDTH - PANEL_GAP, baseLeft + dragOffset.x));
    let top = Math.max(PANEL_GAP, baseTop + dragOffset.y);

    const overflow = top + ph + PANEL_GAP - vh;
    if (overflow > 0) {
      top = Math.max(PANEL_GAP, top - overflow);
    }

    return `position:fixed; left:${left}px; top:${top}px; width:${PANEL_WIDTH}px; z-index:50;`;
  });

  const colorEntry = $derived(getEventColor(color, theme.isDark));
  const accentColor = $derived(color ? colorEntry.accent : "var(--primary)");

  const shortDate = $derived.by(() => {
    if (!startDate) return "";
    const [y, m, d] = startDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  });

  const isCrossMidnight = $derived(endDate !== "" && endDate !== startDate);

  const shortEndDate = $derived.by(() => {
    if (!endDate || !isCrossMidnight) return "";
    const [y, m, d] = endDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  });

  // ─── Build data and handlers ────────────────────────────────────
  function buildSaveData() {
    return {
      title: title.trim() || "Focus session",
      start: `${startDate} ${startTime}`,
      end: `${endDate} ${endTime}`,
      color,
      description,
      recurrence,
      notifications: collectNotifications(),
      pomodoroConfig: pomodoroEnabled ? {
        focusDurationMinutes: focusDuration,
        shortBreakMinutes: shortBreak,
        longBreakMinutes: longBreak,
        pomodoroCount: 4,
        idleTimeoutMinutes: idleTimeoutEnabled ? IDLE_TIMEOUT_DEFAULT : null,
      } : undefined,
      allDay: allDay || undefined,
      location: location || undefined,
      url: eventUrl || undefined,
      transparency: transparency !== "opaque" ? transparency : undefined,
      status: eventStatus !== "confirmed" ? eventStatus : undefined,
    };
  }

  let saving = $state(false);

  function handleSave() {
    if (saving) return;
    const data = buildSaveData();
    const s = isRecurring ? scope : undefined;
    if (!panelEl) { onSave(data, s); return; }

    saving = true;

    setTimeout(() => {
      panelEl!.animate(
        [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(0.95)", opacity: 0 },
        ],
        { duration: 140, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
      ).onfinish = () => onSave(data, s);
    }, 250);
  }
  function handleDeleteClick() { if (event && onDelete) onDelete(event.id, isRecurring ? scope : undefined); }
  function handleScopeClick(s: RecurringScope) { scope = s; onScopeChange?.(s); }

  function handleDragStart(e: PointerEvent) {
    isDragging = true;
    dragStart = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handleDragMove(e: PointerEvent) { if (isDragging) dragOffset = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }; }
  function handleDragEnd() { isDragging = false; userDragged = true; }

  function handleKeydown(e: KeyboardEvent) {
    // Let the description editor handle its own shortcuts (Ctrl+Z, etc.)
    if (descOpen && editorEl?.contains(document.activeElement)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); }
    // Escape is handled by CalendarView's global keydown listener
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={panelEl}
  class="panel-root rounded-xl border border-border"
  style:box-shadow="0 2px 8px rgba(0,0,0,0.3)"
  style="{panelStyle} background-color: var(--panel-bg);"
  onclick={(e) => { e.stopPropagation(); handlePanelClick(e); }}
  onkeydown={handleKeydown}
>
  <!-- Drag handle bar with close button -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sticky top-0 z-10 flex items-center rounded-t-xl border-b border-border/60 px-1.5 cursor-grab active:cursor-grabbing"
    style="background-color: var(--panel-contrast);"
    onpointerdown={handleDragStart}
    onpointermove={handleDragMove}
    onpointerup={handleDragEnd}
  >
    <div class="flex flex-1 items-center justify-center py-1.5">
      <div class="h-1 w-8 rounded-full bg-muted-foreground/40"></div>
    </div>
    {#if mode === "edit" && onDelete && event && !readOnly}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()}>
        <button onclick={handleDeleteClick}
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()}>
      <button onclick={onClose}
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
        title="Close">
        <X size={13} />
      </button>
    </div>
  </div>

  <div class="flex flex-col gap-3 p-3.5">

    <!-- Scope selector (recurring events only) -->
    {#if isRecurring}
      <div class="mb-1 flex min-w-0 rounded-md p-0.5" style="background-color: var(--panel-contrast);">
        {#each [["this", "Only this"], ["following", "Following"], ["all", "All"]] as [val, lbl]}
          <button
            onclick={() => handleScopeClick(val as RecurringScope)}
            class="flex-1 rounded px-2 py-1 text-[10px] font-medium transition-all
              {scope === val
                ? 'bg-emerald-600 dark:bg-emerald-800 text-white dark:text-emerald-100 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
          >{lbl}</button>
        {/each}
      </div>
    {/if}

    <!-- Title -->
    <div class="title-wrapper relative flex items-center gap-2.5 px-1">
      <input
        bind:this={titleInput}
        type="text"
        bind:value={title}
        placeholder="Session title..."
        class="min-w-0 flex-1 bg-transparent py-0.5 text-[14px] font-semibold text-foreground outline-none placeholder:text-[#444746] dark:placeholder:text-[#C4C7C5]"
        oninput={emitChange}
        onkeydown={(e) => e.stopPropagation()}
      />
    </div>
    <hr class="border-[#C4C7C5] dark:border-[#444746] -mt-2 mx-1" />

    <!-- Date + time -->
    <div class="relative -mt-1 flex items-center px-1 text-[12px]">
      <!-- Start date (left) -->
      <div class="relative z-[1] shrink-0">
        <button onclick={toggleDatepicker}
          class="rounded py-1 transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
            {datepickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}">
          {shortDate}
        </button>

        <!-- Floating start date picker -->
        {#if datepickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { datepickerOpen = false; }}></div>
          <div class="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="mb-1 flex items-center justify-center" onwheel={handleDpWheel}>
              <button onclick={handleDpHeaderClick}
                class="rounded-md px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-black/5 dark:hover:bg-black/15">
                {#if dpPickerMode === "days"}
                  {dpMonthLabel}
                {:else}
                  {dpYear}
                {/if}
              </button>
            </div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div onwheel={handleDpWheel}>
              {#if dpPickerMode === "days"}
                <div class="grid grid-cols-7 gap-x-0 text-center">
                  {#each dpDayLetters as letter}
                    <span class="py-0.5 text-[9px] text-muted-foreground">{letter}</span>
                  {/each}
                </div>
                <div class="grid grid-cols-7 gap-x-0 text-center">
                  {#each dpDays as day}
                    {@const now = new Date()}
                    {@const past = day.currentMonth && day.dateStr < `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`}
                    <button onclick={() => selectDpDay(day)}
                      class="flex h-6 w-full items-center justify-center rounded-sm text-[12px] hover:bg-black/5 dark:hover:bg-black/15"
                      style={day.selected
                        ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
                        : day.today
                          ? "background-color: var(--primary); color: var(--primary-foreground); font-weight: 700;"
                          : !day.currentMonth
                            ? "opacity: 0.25;"
                            : past
                              ? "opacity: 0.45; color: var(--foreground);"
                              : "color: var(--foreground);"}
                    >{day.day}</button>
                  {/each}
                </div>
              {:else if dpPickerMode === "months"}
                <div class="grid grid-cols-3 gap-1 py-1">
                  {#each dpShortMonths as name, i}
                    <button onclick={() => selectDpMonth(i)}
                      class="rounded-sm py-2 text-center text-[12px] font-medium hover:bg-black/5 dark:hover:bg-black/15
                        {i + 1 === dpMonth ? 'bg-primary text-primary-foreground' : 'text-foreground'}">
                      {name}
                    </button>
                  {/each}
                </div>
              {:else}
                <div class="grid grid-cols-3 gap-1 py-1">
                  {#each dpYearPageYears as year}
                    <button onclick={() => selectDpYear(year)}
                      class="rounded-sm py-2 text-center text-[12px] font-medium hover:bg-black/5 dark:hover:bg-black/15
                        {year === dpYear ? 'bg-primary text-primary-foreground' : 'text-foreground'}">
                      {year}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="flex-1"></div>

      <!-- Time group (absolutely centered on the panel, hidden when all-day) -->
      <div class="absolute inset-x-0 z-[2] flex items-center justify-center gap-1 py-1 pointer-events-none" class:hidden={allDay}>
        <div class="pointer-events-auto relative flex items-center gap-1">
        <input type="text" bind:value={startTime}
          oninput={emitChange}
          onclick={() => openTimePicker("start")}
          maxlength={5} placeholder="HH:MM"
          class="w-[42px] rounded bg-transparent px-0.5 py-0.5 text-center text-[12px] outline-none transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
            {timePickerTarget === 'start' ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          onkeydown={(e) => e.stopPropagation()} />
        <span class="text-muted-foreground/60">&ndash;</span>
        <input type="text" bind:value={endTime}
          oninput={emitChange}
          onclick={() => openTimePicker("end")}
          maxlength={5} placeholder="HH:MM"
          class="w-[42px] rounded bg-transparent px-0.5 py-0.5 text-center text-[12px] outline-none transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
            {timePickerTarget === 'end' ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          onkeydown={(e) => e.stopPropagation()} />

        <!-- Floating time picker -->
        {#if timePickerTarget}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { timePickerTarget = null; }}></div>
          {@const isEnd = timePickerTarget === 'end'}
          {@const startMinutes = (() => { const [h, m] = (startTime || "0:0").split(":").map(Number); return h * 60 + m; })()}
          <div class="absolute top-full z-20 mt-1 rounded-lg bg-popover shadow-lg ring-1 ring-border/60"
            style="left: {isEnd ? '50%' : '0'}; width: {isEnd ? '115px' : '72px'};">
            <div bind:this={timePickerEl}
              class="time-picker-scroll max-h-[200px] overflow-y-auto">
              {#each TIME_SLOTS as slot}
                {@const selected = (isEnd ? endTime : startTime) === slot}
                {@const isNow = slot === nearestSlot}
                {@const durMin = (() => { if (!isEnd) return -1; const [h, m] = slot.split(":").map(Number); let d = h * 60 + m - startMinutes; if (d <= 0) d += 1440; return d >= 1440 ? -1 : d; })()}
                {@const durHrs = durMin > 0 ? durMin / 60 : 0}
                {@const durLabel = durMin > 0 ? (durMin % 60 === 0 ? `${durHrs} ${durHrs === 1 ? 'hr' : 'hrs'}` : `${durHrs.toFixed(1)} hrs`) : ""}
                <button onclick={() => selectTime(slot)}
                  data-time={slot}
                  class="flex w-full items-center px-2 py-1 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-black/15
                    {selected ? 'bg-accent' : ''}"
                  style="font-weight: {isNow ? 600 : selected ? 500 : 400}; color: {isNow || selected ? 'var(--foreground)' : 'var(--muted-foreground)'};">
                  <span>{slot}</span>
                  {#if durLabel}
                    <span class="ml-1.5 text-[10px]" style="color: var(--muted-foreground); font-weight: 400;">({durLabel})</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
        </div>
      </div>

      <!-- End date (right, shown when cross-midnight) -->
      {#if isCrossMidnight}
        <div class="relative z-[1] shrink-0">
          <button onclick={toggleEndDatepicker}
            class="rounded py-1 transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
              {endDatepickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}">
            {shortEndDate}
          </button>

          <!-- Floating end date picker -->
          {#if endDatepickerOpen}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="fixed inset-0 z-[19]" onclick={() => { endDatepickerOpen = false; }}></div>
            <div class="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="mb-1 flex items-center justify-center" onwheel={handleEdpWheel}>
                <button onclick={handleEdpHeaderClick}
                  class="rounded-md px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-black/5 dark:hover:bg-black/15">
                  {#if edpPickerMode === "days"}
                    {edpMonthLabel}
                  {:else}
                    {edpYear}
                  {/if}
                </button>
              </div>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div onwheel={handleEdpWheel}>
                {#if edpPickerMode === "days"}
                  <div class="grid grid-cols-7 gap-x-0 text-center">
                    {#each dpDayLetters as letter}
                      <span class="py-0.5 text-[9px] text-muted-foreground">{letter}</span>
                    {/each}
                  </div>
                  <div class="grid grid-cols-7 gap-x-0 text-center">
                    {#each edpDays as day}
                      {@const beforeStart = day.dateStr < startDate}
                      {@const now = new Date()}
                      {@const past = day.currentMonth && day.dateStr < `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`}
                      <button onclick={() => selectEdpDay(day)}
                        class="flex h-6 w-full items-center justify-center rounded-sm text-[12px]
                          {beforeStart ? 'cursor-not-allowed' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
                        style={day.selected
                          ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
                          : day.today
                            ? "background-color: var(--primary); color: var(--primary-foreground); font-weight: 700;"
                            : beforeStart
                              ? "opacity: 0.2;"
                              : !day.currentMonth
                                ? "opacity: 0.25;"
                                : past
                                  ? "opacity: 0.45; color: var(--foreground);"
                                  : "color: var(--foreground);"}
                      >{day.day}</button>
                    {/each}
                  </div>
                {:else if edpPickerMode === "months"}
                  <div class="grid grid-cols-3 gap-1 py-1">
                    {#each dpShortMonths as name, i}
                      <button onclick={() => { edpMonth = i + 1; edpPickerMode = "days"; }}
                        class="rounded-sm py-2 text-center text-[12px] font-medium hover:bg-black/5 dark:hover:bg-black/15
                          {i + 1 === edpMonth ? 'bg-primary text-primary-foreground' : 'text-foreground'}">
                        {name}
                      </button>
                    {/each}
                  </div>
                {:else}
                  <div class="grid grid-cols-3 gap-1 py-1">
                    {#each edpYearPageYears as year}
                      <button onclick={() => { edpYear = year; edpPickerMode = "months"; }}
                        class="rounded-sm py-2 text-center text-[12px] font-medium hover:bg-black/5 dark:hover:bg-black/15
                          {year === edpYear ? 'bg-primary text-primary-foreground' : 'text-foreground'}">
                        {year}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- All-day / Availability / Status -->
    <div class="-mt-1 flex items-center rounded-lg px-1 text-[11px] leading-none" style="background-color: var(--panel-contrast);">
      <!-- All day -->
      <button
        onclick={() => { allDay = !allDay; if (allDay) { startTime = "00:00"; endTime = "00:00"; } emitChange(); }}
        disabled={readOnly}
        class="flex items-center gap-1.5 rounded-md px-2.5 py-2 transition-colors
          {allDay ? 'bg-black/5 dark:bg-black/15 text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
      >
        <Sun size={13} class="shrink-0" />
        <span>All day</span>
      </button>


      <!-- Show as -->
      <div class="relative">
        <button
          onclick={() => { showAsPicker = !showAsPicker; statusPicker = false; datepickerOpen = false; endDatepickerOpen = false; timePickerTarget = null; }}
          disabled={readOnly}
          class="flex items-center gap-1.5 rounded-md px-2.5 py-2 transition-colors hover:bg-black/5 dark:hover:bg-black/15
            {showAsPicker ? 'text-foreground' : 'text-muted-foreground'}"
          title="Show as"
        >
          <Eye size={13} class="shrink-0" />
          <span class="text-foreground">{transparency === "transparent" ? "Free" : "Busy"}</span>
        </button>
        {#if showAsPicker}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { showAsPicker = false; }}></div>
          <div class="absolute left-0 top-full z-20 mt-1 w-24 rounded-lg bg-popover shadow-lg ring-1 ring-border/60">
            {#each (["opaque", "transparent"] as const) as t}
              <button
                onclick={() => { transparency = t; showAsPicker = false; emitChange(); }}
                class="flex w-full items-center px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-black/15
                  {transparency === t ? 'text-foreground font-medium' : 'text-muted-foreground'}"
              >{t === "opaque" ? "Busy" : "Free"}</button>
            {/each}
          </div>
        {/if}
      </div>


      <!-- Status -->
      <div class="relative">
        <button
          onclick={() => { statusPicker = !statusPicker; showAsPicker = false; datepickerOpen = false; endDatepickerOpen = false; timePickerTarget = null; }}
          disabled={readOnly}
          class="flex items-center gap-1.5 rounded-md px-2.5 py-2 capitalize transition-colors hover:bg-black/5 dark:hover:bg-black/15
            {statusPicker ? 'text-foreground' : 'text-muted-foreground'}"
          title="Status"
        >
          <CircleCheck size={13} class="shrink-0" />
          <span class="text-foreground">{eventStatus}</span>
        </button>
        {#if statusPicker}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { statusPicker = false; }}></div>
          <div class="absolute left-0 top-full z-20 mt-1 w-28 rounded-lg bg-popover shadow-lg ring-1 ring-border/60">
            {#each (["confirmed", "tentative", "cancelled"] as const) as s}
              <button
                onclick={() => { eventStatus = s; statusPicker = false; emitChange(); }}
                class="flex w-full items-center px-2.5 py-1.5 text-left text-[12px] capitalize transition-colors hover:bg-black/5 dark:hover:bg-black/15
                  {eventStatus === s ? 'text-foreground font-medium' : 'text-muted-foreground'}"
              >{s}</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Description / Location / URL -->
    <div class="-mt-1 flex flex-col rounded-lg overflow-hidden" style="background-color: var(--panel-contrast);">
      <!-- Description -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div bind:this={descAreaEl}>
        {#if descOpen}
          <!-- Toolbar (aligned with editor text via padding-left) -->
          <div transition:slide={{ duration: 250, easing: cubicOut }} class="flex items-center gap-0.5 py-1 pr-3" style="padding-left: 35px;">
            {#each [
              { icon: Bold, cmd: "bold", title: "Bold" },
              { icon: Italic, cmd: "italic", title: "Italic" },
              { icon: Underline, cmd: "underline", title: "Underline" },
            ] as btn}
              {@const Icon = btn.icon}
              <button
                onmousedown={(e) => e.preventDefault()}
                onclick={() => execFormat(btn.cmd)}
                class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
                title={btn.title}
              ><Icon size={13} /></button>
            {/each}
            <div class="mx-0.5 h-3.5 w-px bg-border/60"></div>
            {#each [
              { icon: ListOrdered, cmd: "insertOrderedList", title: "Numbered list" },
              { icon: List, cmd: "insertUnorderedList", title: "Bulleted list" },
            ] as btn}
              {@const Icon = btn.icon}
              <button
                onmousedown={(e) => e.preventDefault()}
                onclick={() => execFormat(btn.cmd)}
                class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
                title={btn.title}
              ><Icon size={13} /></button>
            {/each}
            <div class="mx-0.5 h-3.5 w-px bg-border/60"></div>
            <button bind:this={linkBtnEl}
              onmousedown={(e) => e.preventDefault()}
              onclick={openLinkPopover}
              class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
              title="Insert link"
            ><Link size={13} /></button>
            {#if linkPopoverOpen}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div class="fixed inset-0 z-[60]" onclick={() => { linkPopoverOpen = false; }}></div>
              <div class="fixed z-[61] flex items-center gap-1.5 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60"
                use:positionLinkPopover>
                <input bind:this={linkInputEl}
                  type="text" bind:value={linkUrl} placeholder="https://..."
                  onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") { linkPopoverOpen = false; } }}
                  class="w-40 rounded bg-black/5 dark:bg-black/15 px-2 py-1 text-[11px] text-[#1F1F1F] dark:text-[#E3E3E3] outline-none placeholder:text-muted-foreground"
                />
                <button onclick={applyLink}
                  class="rounded bg-black/5 dark:bg-black/15 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-black/10 dark:hover:bg-black/25">
                  Apply
                </button>
              </div>
            {/if}
            <button
              onmousedown={(e) => e.preventDefault()}
              onclick={() => execFormat("removeFormat")}
              class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
              title="Remove formatting"
            ><RemoveFormatting size={13} /></button>
            <button
              onmousedown={(e) => e.preventDefault()}
              onclick={closeDescEditor}
              class="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
              title="Done"
            ><Check size={13} /></button>
          </div>
        {/if}
        <!-- Icon + content row -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="flex items-center gap-2.5 px-3 pb-2 leading-none transition-[padding-top] duration-250 ease-out {descOpen ? 'pt-0' : 'pt-2'} {!descOpen && !descClosing ? 'cursor-text' : ''}"
          onclick={() => { if (!descOpen && !descClosing) openDescEditor(); }}
        >
          <AlignLeft size={13} class="shrink-0 text-foreground" />
          <div class="min-w-0 flex-1">
            {#if descOpen || descClosing || descPreview}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                bind:this={editorEl}
                contenteditable={descOpen && !descClosing}
                class="desc-editor desc-content max-h-[80px] overflow-y-auto text-[11px] leading-[15px] text-foreground outline-none"
                class:desc-editing={descOpen && !descClosing}
                oninput={handleEditorInput}
                onpaste={handleEditorPaste}
                onkeydown={(e) => { if (descOpen) e.stopPropagation(); }}
              ></div>
            {:else}
              <span class="text-[11px] text-muted-foreground/40">Add description</span>
            {/if}
          </div>
        </div>
      </div>
      <!-- Location -->
      <div class="flex items-center gap-2.5 border-t border-border/40 px-3 py-2 text-[11px] leading-none">
        <MapPin size={13} class="shrink-0 text-foreground" />
        <input type="text" bind:value={location} placeholder="Add location"
          disabled={readOnly}
          class="min-w-0 flex-1 bg-transparent leading-none text-foreground outline-none placeholder:text-muted-foreground/40"
          oninput={emitChange} onkeydown={(e) => e.stopPropagation()} />
      </div>
      <!-- URL -->
      <div class="flex items-center gap-2.5 border-t border-border/40 px-3 py-2 text-[11px] leading-none">
        <ExternalLink size={13} class="shrink-0 text-foreground" />
        <input type="url" bind:value={eventUrl} placeholder="Add URL"
          disabled={readOnly}
          class="min-w-0 flex-1 bg-transparent leading-none text-foreground outline-none placeholder:text-muted-foreground/40"
          oninput={emitChange} onkeydown={(e) => e.stopPropagation()} />
      </div>
    </div>

    <!-- ═══════════ Feature sections (vertical) ═══════════ -->
    <div class="flex flex-col gap-1.5">

      <!-- 1) Pomodoro -->
      <div class="flex flex-col rounded-lg overflow-hidden" style="background-color: var(--panel-contrast);">
        <div class="section-header flex items-stretch" class:section-active={pomodoroEnabled}>
          <button onclick={(e) => handleToggle("pomodoro", e)}
            class="flex w-9 shrink-0 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-black/15
              {pomodoroEnabled ? 'text-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground'}">
            <Timer size={13} />
          </button>
          <button onclick={() => handleExpand("pomodoro")}
            class="flex flex-1 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-black/15">
            <span class="translate-y-[1.13px] text-[11px] {pomodoroEnabled ? 'text-foreground' : 'text-muted-foreground'}">Pomodoro</span>
            <span class="ml-auto translate-y-[1.13px] truncate text-[10px] text-muted-foreground">{pomoSummary}</span>
          </button>
        </div>
        {#if openSection === "pomodoro"}
          <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="pomodoro" class="flex flex-col gap-1 border-t border-border/60 p-2.5" style="background-color: var(--panel-bg);">
            {#each Object.entries(POMO_PRESETS) as [key, val]}
              <button
                onclick={() => applyPomoPreset(key as PomodoroPreset)}
                class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] transition-all
                  {pomodoroPreset === key
                    ? 'bg-black/5 dark:bg-black/15 text-foreground'
                    : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
              >
                <span>{val.label}</span>
                <span class="ml-auto text-[10px] {pomodoroPreset === key ? 'text-muted-foreground' : 'text-muted-foreground'}">{val.desc}</span>
              </button>
            {/each}
            <button
              onclick={() => applyPomoPreset("custom")}
              class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] transition-all
                {pomodoroPreset === 'custom'
                  ? 'bg-black/5 dark:bg-black/15 text-foreground'
                  : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
            >
              <span>Custom</span>
            </button>
            {#if pomodoroPreset === "custom"}
              <div class="flex flex-col gap-1.5 px-2.5 pt-1">
                {#each [
                  { label: "Focus", value: focusDuration, set: (v: number) => { focusDuration = v; emitChange(); }, min: 1, max: 120 },
                  { label: "Short break", value: shortBreak, set: (v: number) => { shortBreak = v; emitChange(); }, min: 1, max: 30 },
                  { label: "Long break", value: longBreak, set: (v: number) => { longBreak = v; emitChange(); }, min: 1, max: 60 },
                ] as field}
                  <label class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span class="w-16">{field.label}</span>
                    <input type="number" value={field.value} min={field.min} max={field.max}
                      oninput={(e) => field.set(parseInt(e.currentTarget.value, 10) || field.min)}
                      class="num-input w-8 rounded bg-black/5 dark:bg-black/15 px-0.5 py-0.5 text-center text-[10px] text-[#1F1F1F] dark:text-[#E3E3E3] outline-none"
                      onkeydown={(e) => e.stopPropagation()} />
                    <span class="text-muted-foreground">min</span>
                  </label>
                {/each}
              </div>
            {/if}
            <div class="border-t border-border/40 mt-1 pt-0.5 px-0">
              <button
                onclick={() => { idleTimeoutEnabled = !idleTimeoutEnabled; emitChange(); }}
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] w-full transition-all
                  {idleTimeoutEnabled
                    ? 'bg-black/5 dark:bg-black/15 text-foreground'
                    : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
              >
                <div class="h-3.5 w-3.5 shrink-0 rounded
                  {idleTimeoutEnabled ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
                </div>
                <span>Pause on idle</span>
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- 2) Notifications -->
      <div class="flex flex-col rounded-lg overflow-hidden" style="background-color: var(--panel-contrast);">
        <div class="section-header flex items-stretch" class:section-active={notifEnabled}>
          <button onclick={(e) => handleToggle("notifications", e)}
            class="flex w-9 shrink-0 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-black/15
              {notifEnabled ? 'text-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground'}">
            <Bell size={13} />
          </button>
          <button onclick={() => handleExpand("notifications")}
            class="flex flex-1 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-black/15">
            <span class="translate-y-[1.13px] text-[11px] {notifEnabled ? 'text-foreground' : 'text-muted-foreground'}">Notifications</span>
            <span class="ml-auto translate-y-[1.13px] truncate text-[10px] text-muted-foreground">{notifSummary}</span>
          </button>
        </div>
        {#if openSection === "notifications"}
          <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="notifications" class="flex flex-col gap-1.5 border-t border-border/60 p-2.5" style="background-color: var(--panel-bg);">
            <div class="flex flex-col gap-0.5">
              {#each NOTIF_PRESETS as opt}
                <button
                  onclick={() => toggleNotif(opt.value)}
                  class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-all
                    {notifSelected.has(opt.value)
                      ? 'bg-black/5 dark:bg-black/15 text-foreground'
                      : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
                >
                  <div class="h-3.5 w-3.5 shrink-0 rounded
                    {notifSelected.has(opt.value) ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
                  </div>
                  <span>{opt.label}</span>
                </button>
              {/each}
            </div>
            {#each customNotifs as cn, idx}
              <div class="flex items-center gap-1.5 px-2">
                <input type="number" value={cn.amount} min={1} max={999}
                  oninput={(e) => updateCustomNotif(idx, parseInt(e.currentTarget.value, 10) || 1, cn.unit)}
                  class="num-input w-10 rounded bg-black/5 dark:bg-black/15 px-1 py-0.5 text-center text-[11px] text-[#1F1F1F] dark:text-[#E3E3E3] outline-none"
                  onkeydown={(e) => e.stopPropagation()} />
                <button bind:this={customNotifBtns[idx]}
                  onclick={() => { customNotifDropdown = customNotifDropdown === idx ? null : idx; }}
                  class="rounded bg-black/5 dark:bg-black/15 px-2 py-0.5 text-[11px] transition-colors
                    {customNotifDropdown === idx ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}
                    text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {CUSTOM_UNITS.find((u) => u.value === cn.unit)?.label ?? "minutes"}
                </button>
                <span class="text-[11px] text-muted-foreground">before</span>
                <button onclick={() => { removeCustomNotif(idx); customNotifDropdown = null; }}
                  class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                  <X size={12} />
                </button>

                <!-- Floating unit dropdown -->
                {#if customNotifDropdown === idx}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="fixed inset-0 z-[60]" onclick={() => { customNotifDropdown = null; }}></div>
                  <div class="fixed z-[61] rounded-lg bg-popover py-1 shadow-lg ring-1 ring-border/60"
                    use:positionNotifDropdown={idx}>
                    {#each CUSTOM_UNITS as u}
                      <button onclick={() => { updateCustomNotif(idx, cn.amount, u.value); customNotifDropdown = null; }}
                        class="flex w-full items-center px-3 py-1.5 text-left text-[11px] transition-colors
                          {cn.unit === u.value
                            ? 'bg-black/5 dark:bg-black/15 text-foreground'
                            : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
                        {u.label}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
            {#if customNotifs.length < 2}
              <button onclick={addCustomNotif}
                class="flex items-center gap-1 self-start rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:bg-black/5 dark:hover:bg-black/15">
                <Plus size={12} /> <span>Custom</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- 3) Repeat -->
      <div class="flex flex-col rounded-lg overflow-hidden" style="background-color: var(--panel-contrast);">
        <div class="section-header flex items-stretch" class:section-active={!!recurrence}>
          <button onclick={(e) => handleToggle("repeat", e)}
            class="flex w-9 shrink-0 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-black/15
              {recurrence ? 'text-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground'}">
            <Repeat size={13} />
          </button>
          <button onclick={() => handleExpand("repeat")}
            class="flex flex-1 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-black/15">
            <span class="translate-y-[1.13px] text-[11px] {recurrence ? 'text-foreground' : 'text-muted-foreground'}">Repeat</span>
            <span class="ml-auto translate-y-[1.13px] truncate text-[10px] text-muted-foreground">{recurrence ? recurrenceLabel : "None"}</span>
          </button>
        </div>
        {#if openSection === "repeat" && recurrence}
          <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="repeat" class="flex flex-col gap-2.5 border-t border-border/60 p-2.5" style="background-color: var(--panel-bg);">
            <!-- Every N [frequency] -->
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-muted-foreground">Every</span>
              <input type="number" value={recInterval}
                oninput={(e) => updateRecInterval(parseInt(e.currentTarget.value, 10) || 1)}
                min={1} max={99}
                class="num-input w-10 rounded-md bg-black/5 dark:bg-black/15 px-1 py-1 text-center text-[11px] text-[#1F1F1F] dark:text-[#E3E3E3] outline-none"
                onkeydown={(e) => e.stopPropagation()} />
              <div class="flex gap-1">
                {#each FREQ_OPTIONS as opt}
                  <button onclick={() => updateRecFrequency(opt.value)}
                    class="rounded-md px-2 py-1 text-[11px] transition-all
                      {recFrequency === opt.value
                        ? 'bg-black/5 dark:bg-black/15 text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
                  >{opt.plural}</button>
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

            <!-- Ends -->
            <div class="flex flex-col gap-1.5">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Ends</span>

              <!-- Never -->
              <button onclick={() => updateRecEndType("never")}
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-all
                  {recEndType === 'never'
                    ? 'bg-black/5 dark:bg-black/15 text-foreground'
                    : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
                <div class="h-3.5 w-3.5 shrink-0 rounded-full
                  {recEndType === 'never' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
                </div>
                <span>Never</span>
              </button>

              <!-- On -->
              <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]">
                <button onclick={() => updateRecEndType("until")}
                  class="flex w-12 items-center gap-2 transition-all
                    {recEndType === 'until'
                      ? 'text-foreground'
                      : 'text-foreground'}">
                  <div class="h-3.5 w-3.5 shrink-0 rounded-full
                    {recEndType === 'until' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
                  </div>
                  <span>On</span>
                </button>
                <div class="relative">
                  <input bind:this={recEndDateBtn}
                    type="text"
                    bind:value={recEndDateText}
                    onclick={() => { if (recEndType !== "until") updateRecEndType("until"); recEndPickerOpen = !recEndPickerOpen; }}
                    onblur={parseRecEndDateInput}
                    onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); parseRecEndDateInput(); recEndPickerOpen = false; } }}
                    class="w-[110px] rounded bg-black/5 dark:bg-black/15 px-2 py-0.5 text-[11px] outline-none transition-colors
                      {recEndType === 'until' ? 'text-[#1F1F1F] dark:text-[#E3E3E3]' : 'text-muted-foreground'}
                      {recEndPickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}" />

                  <!-- Floating date picker -->
                  {#if recEndPickerOpen}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="fixed inset-0 z-[60]" onclick={() => { recEndPickerOpen = false; }}></div>
                    <div class="fixed z-[61] w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60"
                      use:positionEndPicker>
                      <!-- Header — clickable drill-down -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div class="mb-1 flex items-center justify-center" onwheel={handleCalWheel}>
                        <button onclick={handleCalHeaderClick}
                          class="rounded-md px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-black/5 dark:hover:bg-black/15">
                          {#if calPickerMode === "days"}
                            {calMonthLabel}
                          {:else}
                            {calYear}
                          {/if}
                        </button>
                      </div>

                      <!-- Grid — scrollable -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div onwheel={handleCalWheel}>
                        {#if calPickerMode === "days"}
                          <div class="grid grid-cols-7 gap-x-0 text-center">
                            {#each ["M", "T", "W", "T", "F", "S", "S"] as letter}
                              <span class="py-0.5 text-[9px] text-muted-foreground">{letter}</span>
                            {/each}
                          </div>
                          <div class="grid grid-cols-7 gap-x-0 text-center">
                            {#each calDays as day}
                              {@const now = new Date()}
                              {@const past = day.currentMonth && day.dateStr < `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`}
                              <button onclick={() => selectCalDay(day)}
                                class="flex h-6 w-full items-center justify-center rounded-sm text-[11px] hover:bg-black/5 dark:hover:bg-black/15"
                                style={day.selected
                                  ? "background-color: var(--accent); color: var(--foreground); font-weight: 600;"
                                  : day.today
                                    ? "background-color: var(--primary); color: var(--primary-foreground); font-weight: 700;"
                                    : !day.currentMonth
                                      ? "opacity: 0.25;"
                                      : past
                                        ? "opacity: 0.45; color: var(--foreground);"
                                        : "color: var(--foreground);"}
                              >{day.day}</button>
                            {/each}
                          </div>

                        {:else if calPickerMode === "months"}
                          <div class="grid grid-cols-3 gap-1 py-1">
                            {#each dpShortMonths as name, i}
                              <button onclick={() => selectCalMonth(i)}
                                class="rounded-sm py-2 text-center text-[11px] font-medium hover:bg-black/5 dark:hover:bg-black/15
                                  {i + 1 === calMonth ? 'bg-primary text-primary-foreground' : 'text-foreground'}">
                                {name}
                              </button>
                            {/each}
                          </div>

                        {:else}
                          <div class="grid grid-cols-3 gap-1 py-1">
                            {#each calYearPageYears as year}
                              <button onclick={() => selectCalYear(year)}
                                class="rounded-sm py-2 text-center text-[11px] font-medium hover:bg-black/5 dark:hover:bg-black/15
                                  {year === calYear ? 'bg-primary text-primary-foreground' : 'text-foreground'}">
                                {year}
                              </button>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              </div>

              <!-- After -->
              <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]">
                <button onclick={() => updateRecEndType("count")}
                  class="flex w-12 items-center gap-2 transition-all
                    {recEndType === 'count'
                      ? 'text-foreground'
                      : 'text-foreground'}">
                  <div class="h-3.5 w-3.5 shrink-0 rounded-full
                    {recEndType === 'count' ? 'bg-[#6B6F6E] dark:bg-foreground' : 'ring-1 ring-inset ring-border'}">
                  </div>
                  <span>After</span>
                </button>
                <div class="flex items-center gap-1.5">
                  <input type="number" value={recEndCount}
                    onfocus={() => { if (recEndType !== "count") updateRecEndType("count"); }}
                    oninput={(e) => updateRecEndCount(parseInt(e.currentTarget.value, 10) || 1)}
                    min={1} max={999}
                    class="num-input w-10 rounded bg-black/5 dark:bg-black/15 px-1 py-0.5 text-center text-[11px] outline-none
                      {recEndType === 'count' ? 'text-[#1F1F1F] dark:text-[#E3E3E3]' : 'text-muted-foreground'}"
                    onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} />
                  <span class="{recEndType === 'count' ? 'text-[#1F1F1F] dark:text-[#E3E3E3]' : 'text-muted-foreground'}">times</span>
                </div>
              </div>
            </div>

          </div>
        {/if}
      </div>

      <!-- 4) Music -->
      <div class="flex flex-col rounded-lg overflow-hidden" style="background-color: var(--panel-contrast);">
        <div class="flex items-stretch">
          <button class="flex w-9 shrink-0 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-black/15 text-muted-foreground/50">
            <Music size={13} />
          </button>
          <button onclick={() => handleExpand("music")}
            class="flex flex-1 items-center px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-black/15">
            <span class="translate-y-[1.13px] text-[11px] text-muted-foreground">Music</span>
          </button>
        </div>
        {#if openSection === "music"}
          <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="music" class="border-t border-border/60 px-3 py-3 text-center text-[12px] text-muted-foreground/60" style="background-color: var(--panel-bg);">Coming soon</div>
        {/if}
      </div>

    </div>

    <!-- Colors -->
    <div class="flex flex-wrap items-center gap-2 px-1">
      {#each EVENT_COLOR_OPTIONS as c}
        {@const entry = getEventColor(c, theme.isDark)}
        <button onclick={() => { color = color === c ? undefined : c; emitChange(); }}
          class="h-[18px] w-[18px] shrink-0 rounded-full transition-all hover:scale-110"
          style="background:{entry.accent}; {color === c ? `box-shadow: 0 0 0 2px var(--card), 0 0 0 3.5px ${entry.accent}; transform: scale(1.15);` : ''}"
          title={c}></button>
      {/each}
    </div>

    <!-- Save -->
    {#if readOnly}
      <div class="flex w-full items-center justify-center rounded-lg py-1.5 text-[11px] text-muted-foreground/60"
        style="background-color: var(--panel-contrast);">
        Read-only
      </div>
    {:else}
      <button onclick={handleSave}
        class="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] transition-all
          {saving || saveReady
            ? 'bg-emerald-600 dark:bg-emerald-800 text-white dark:text-emerald-100 hover:opacity-90'
            : 'text-muted-foreground cursor-default'}"
        style="background-color: {saving || saveReady ? '' : 'var(--panel-contrast)'};">
        {#if saving}
          <CircleCheck size={13} />
          <span>Saved</span>
        {:else}
          <span>Save</span>
        {/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .panel-root {
    --panel-bg: #F0F4F9;
    --panel-contrast: #E8EDF5;
    font-family: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .time-picker-scroll {
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 24px, black calc(100% - 24px), transparent);
    mask-image: linear-gradient(to bottom, transparent, black 24px, black calc(100% - 24px), transparent);
  }

  :global(.dark) .panel-root {
    --panel-bg: #282A2C;
    --panel-contrast: #1E1F20;
    --foreground: #C4C7C5;
    --muted-foreground: #9EA1A0;
  }

  .section-header {
    transition: background-color 180ms ease-out;
  }

  .section-active {
    background-color: rgba(0, 0, 0, 0.04);
  }

  :global(.dark) .section-active {
    background-color: rgba(255, 255, 255, 0.04);
  }

  .num-input::-webkit-inner-spin-button,
  .num-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .num-input {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .title-wrapper::after {
    content: "";
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 24px;
    background: linear-gradient(to right, transparent, var(--panel-bg));
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .title-wrapper:not(:focus-within)::after {
    opacity: 1;
  }

  .desc-content {
    transition: background-color 250ms ease-out, padding 250ms ease-out, border-radius 250ms ease-out;
    padding: 0;
    background-color: transparent;
    border-radius: 0;
  }

  .desc-editing {
    background-color: rgba(0, 0, 0, 0.05);
    padding: 6px 8px;
    border-radius: 4px;
  }

  :global(.dark) .desc-editing {
    background-color: rgba(0, 0, 0, 0.15);
  }

  .desc-editor:empty::before {
    content: "Type something...";
    color: var(--muted-foreground);
    opacity: 0.5;
    pointer-events: none;
  }

  .desc-editor :global(ul),
  .desc-editor :global(ol) {
    padding-left: 1.25em;
    margin: 2px 0;
  }
  .desc-editor :global(ul) {
    list-style: disc;
  }
  .desc-editor :global(ol) {
    list-style: decimal;
  }
  .desc-editor :global(a) {
    color: var(--primary);
    text-decoration: underline;
  }
  .desc-editor :global(b),
  .desc-editor :global(strong) {
    font-weight: 600;
  }
  .desc-editor :global(i),
  .desc-editor :global(em) {
    font-style: italic;
  }
  .desc-editor :global(u) {
    text-decoration: underline;
  }
</style>

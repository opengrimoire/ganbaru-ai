<script lang="ts">
  import type {
    CalendarEvent, EventColor, EventStatus, EventTransparency, EventVisibility,
    EventAttendee, EventOrganizer, GeoCoordinates, GuestPermissions,
    PomodoroConfig, RecurrenceConfig, RecurringScope,
  } from "./types";
  import { bounceIcon } from "./event-panel-utils";
  import MiniDatePicker from "./MiniDatePicker.svelte";
  import TimePicker from "./TimePicker.svelte";
  import ColorPicker from "./ColorPicker.svelte";
  import DescriptionEditor from "./DescriptionEditor.svelte";
  import AttendeesSection from "./AttendeesSection.svelte";
  import PomodoroSection from "./PomodoroSection.svelte";
  import NotificationsSection from "./NotificationsSection.svelte";
  import RecurrenceSection from "./RecurrenceSection.svelte";
  import { onMount, untrack } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import "@fontsource-variable/inter";
  import { getTheme } from "$lib/stores/theme.svelte";

  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Music from "@lucide/svelte/icons/music";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Sun from "@lucide/svelte/icons/sun";
  import Eye from "@lucide/svelte/icons/eye";
  import Check from "@lucide/svelte/icons/check";
  import Shield from "@lucide/svelte/icons/shield";
  import Lock from "@lucide/svelte/icons/lock";


  const theme = getTheme();

  const PANEL_WIDTH = 320;
  const PANEL_GAP = 8;
  const TITLE_BAR_HEIGHT = 40;

  let {
    mode,
    start,
    end,
    event,
    anchor,
    initialAllDay = false,
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
    initialAllDay?: boolean;
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
      visibility?: EventVisibility;
      attendees?: EventAttendee[];
      guestPermissions?: GuestPermissions;
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
  let stashedStartTime = "";
  let stashedEndTime = "";
  let location = $state("");
  let eventUrl = $state("");
  let transparency: EventTransparency = $state("opaque");
  let eventStatus: EventStatus = $state("confirmed");
  let visibility: EventVisibility = $state("public");

  // ─── Attendees ─────────────────────────────────────────────────
  let attendees: EventAttendee[] = $state([]);
  let guestCanModify = $state(false);
  let guestCanInviteOthers = $state(true);
  let guestCanSeeOtherGuests = $state(true);


  // ─── Read-only imported fields ────────────────────────────────────
  let organizer: EventOrganizer | undefined = $state(undefined);
  let geo: GeoCoordinates | undefined = $state(undefined);
  let rdate: string[] | undefined = $state(undefined);

  // ─── Pomodoro ───────────────────────────────────────────────────
  let pomodoroEnabled = $state(false);
  let pomodoroPreset: "auto" | "deep" | "creative" | "extended" | "custom" = $state("auto");
  let focusDuration = $state(40);
  let shortBreak = $state(5);
  let longBreak = $state(10);
  let idleTimeoutEnabled = $state(true);
  const IDLE_TIMEOUT_DEFAULT = 1;

  // ─── Notifications ──────────────────────────────────────────────
  let notifEnabled = $state(false);
  let notifSelected = $state(new Set<number>());
  let customNotifs: { amount: number; unit: number }[] = $state([]);

  function collectNotifications(): number[] | undefined {
    if (!notifEnabled) return undefined;
    const result: number[] = [...notifSelected];
    for (const cn of customNotifs) result.push(cn.amount * cn.unit);
    return result.length > 0 ? [...new Set(result)].sort((a, b) => a - b) : undefined;
  }

  // ─── Recurrence ─────────────────────────────────────────────────
  let recurrence: RecurrenceConfig | undefined = $state(undefined);

  // ─── Date pickers ──────────────────────────────────────────────
  let datepickerOpen = $state(false);
  let endDatepickerOpen = $state(false);

  function selectDpDay(dateStr: string) {
    if (startDate && endDate) {
      const [oy, om, od] = startDate.split("-").map(Number);
      const [ey, em, ed] = endDate.split("-").map(Number);
      const oldStart = new Date(oy, om - 1, od);
      const oldEnd = new Date(ey, em - 1, ed);
      const daySpan = Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000);
      const [ny, nm, nd] = dateStr.split("-").map(Number);
      const newEnd = new Date(ny, nm - 1, nd + daySpan);
      endDate = `${newEnd.getFullYear()}-${String(newEnd.getMonth() + 1).padStart(2, "0")}-${String(newEnd.getDate()).padStart(2, "0")}`;
    } else {
      endDate = dateStr;
    }
    startDate = dateStr;
    datepickerOpen = false;
    emitChange();
  }

  function selectEdpDay(dateStr: string) {
    endDate = dateStr;
    endDatepickerOpen = false;
    emitChange();
  }

  function toggleDatepicker() {
    if (readOnly) return;
    timePickerTarget = null;
    endDatepickerOpen = false;
    showAsPicker = false;
    statusPicker = false;
    datepickerOpen = !datepickerOpen;
  }

  function toggleEndDatepicker() {
    if (readOnly) return;
    timePickerTarget = null;
    datepickerOpen = false;
    showAsPicker = false;
    statusPicker = false;
    endDatepickerOpen = !endDatepickerOpen;
  }

  // ─── Time picker ─────────────────────────────────────────────
  let timePickerTarget: "start" | "end" | null = $state(null);
  let showAsPicker = $state(false);
  let statusPicker = $state(false);
  let visibilityPicker = $state(false);


  function openTimePicker(target: "start" | "end") {
    if (readOnly) return;
    datepickerOpen = false;
    endDatepickerOpen = false;
    showAsPicker = false;
    statusPicker = false;
    timePickerTarget = target;
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


  function handleToggle(s: Section, e?: MouseEvent) {
    if (readOnly) return;
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
      if (s === "pomodoro") { pomodoroEnabled = true; pomodoroPreset = "auto"; focusDuration = 40; shortBreak = 5; longBreak = 10; idleTimeoutEnabled = true; }
      if (s === "notifications") { notifEnabled = true; notifSelected = new Set([0]); }
      if (s === "repeat") recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
    }
    emitChange();
  }

  /** Label click: expand/collapse the details panel. */
  function handleExpand(s: Section) {
    if (readOnly) return;
    // Auto-activate repeat when expanding for the first time
    if (s === "repeat" && !recurrence && openSection !== s) {
      recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
      emitChange();
    }
    const opening = openSection !== s;
    openSection = opening ? s : null;
    if (opening && panelEl) {
      // Decide pinning direction only when opening
      const rect = panelEl.getBoundingClientRect();
      const vh = window.innerHeight;
      const roomBelow = vh - PANEL_GAP - rect.bottom;
      const roomAbove = rect.top - minTop;
      // Pin bottom when there's less room below, so panel expands upward
      if (roomBelow < roomAbove) {
        pinnedBottom = rect.bottom;
        pinnedDragY = dragOffset.y;
      } else {
        pinnedBottom = 0;
      }
    } else if (!opening && pinnedBottom > 0) {
      // Closing: keep the same pinning from open, release after animation.
      // Bake the rendered position into baseTop so rawTop matches after clearing.
      setTimeout(() => {
        if (pinnedBottom > 0 && panelEl) {
          baseTop = panelEl.getBoundingClientRect().top - dragOffset.y;
        }
        pinnedBottom = 0;
      }, 200);
    }
  }

  // ─── Panel positioning & drag ───────────────────────────────────
  let titleInput: HTMLInputElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();
  let panelHeight = $state(0);
  let pinnedBottom = $state(0);
  let pinnedDragY = 0;
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
      stashedStartTime = "";
      stashedEndTime = "";
      location = event.location ?? "";
      eventUrl = event.url ?? "";
      transparency = event.transparency ?? "opaque";
      eventStatus = event.status ?? "confirmed";
      visibility = event.visibility ?? "public";
      organizer = event.organizer;
      attendees = event.attendees ?? [];
      guestCanModify = event.guestPermissions?.canModify ?? false;
      guestCanInviteOthers = event.guestPermissions?.canInviteOthers ?? true;
      guestCanSeeOtherGuests = event.guestPermissions?.canSeeOtherGuests ?? true;
      geo = event.geo;
      rdate = event.rdate;

      const pc = event.pomodoroConfig;
      pomodoroEnabled = !!pc;
      if (pc) {
        focusDuration = pc.focusDurationMinutes;
        shortBreak = pc.shortBreakMinutes;
        longBreak = pc.longBreakMinutes;
        const f = pc.focusDurationMinutes, s = pc.shortBreakMinutes, l = pc.longBreakMinutes;
        pomodoroPreset = (f === 25 && s === 5 && l === 15) ? "creative" : (f === 50 && s === 10 && l === 10) ? "extended" : (f === 40 && s === 5 && l === 10) ? "deep" : "custom";
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
        const presetValues = new Set([0, 5, 10, 30, 60, 1440]);
        const customUnitsDesc = [10080, 1440, 60, 1]; // weeks, days, hours, minutes
        for (const m of notifs) {
          if (presetValues.has(m)) notifSelected.add(m);
          else {
            let found = false;
            for (const u of customUnitsDesc) {
              if (m > 0 && m % u === 0 && customNotifs.length < 2) {
                customNotifs = [...customNotifs, { amount: m / u, unit: u }];
                found = true;
                break;
              }
            }
            if (!found && customNotifs.length < 2) customNotifs = [...customNotifs, { amount: m, unit: 1 }];
          }
        }
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
      allDay = initialAllDay;
      stashedStartTime = "";
      stashedEndTime = "";
      location = "";
      eventUrl = "";
      transparency = "opaque";
      eventStatus = "confirmed";
    }

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
  // Only updates time fields, not title/description/etc. which the user may
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

  // Track actual panel height for initial placement estimates
  $effect(() => {
    if (!panelEl) return;
    const observer = new ResizeObserver(() => {
      panelHeight = panelEl!.offsetHeight;
    });
    observer.observe(panelEl);
    return () => observer.disconnect();
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
    baseTop = Math.max(minTop, Math.min(vh - ph - PANEL_GAP, _a.y));
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
      visibility: visibility !== "public" ? visibility : undefined,
      attendees: attendees.length > 0 ? attendees : undefined,
    });
  }

  $effect(() => {
    if (mode === "create" && titleInput) titleInput.select();
  });

  // ─── Panel position ─────────────────────────────────────────────
  // When a section is expanded, the panel's bottom edge is pinned at
  // its pre-expansion position so it only grows upward. Otherwise the
  // top is pinned and the panel grows downward, nudging up only if
  // it would overflow the viewport.
  const minTop = TITLE_BAR_HEIGHT + PANEL_GAP;

  const panelStyle = $derived.by(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ph = panelHeight || 520;

    const left = Math.max(PANEL_GAP, Math.min(vw - PANEL_WIDTH - PANEL_GAP, baseLeft + dragOffset.x));
    const rawTop = Math.max(minTop, baseTop + dragOffset.y);

    if (pinnedBottom > 0) {
      // Section expanding: use CSS bottom to pin the bottom edge perfectly.
      // The browser keeps it fixed frame-by-frame without JS timing issues.
      const dragDelta = dragOffset.y - pinnedDragY;
      const bottomCss = Math.max(PANEL_GAP, Math.round(vh - pinnedBottom - dragDelta));
      const maxH = Math.round(pinnedBottom + dragDelta - minTop);
      return `position:fixed; left:${Math.round(left)}px; bottom:${bottomCss}px; max-height:${maxH}px; width:${PANEL_WIDTH}px; z-index:50;`;
    }

    // Normal: pin top, nudge up if overflowing bottom
    let top = rawTop;
    const overflow = top + ph + PANEL_GAP - vh;
    if (overflow > 0) {
      top = Math.max(minTop, top - overflow);
    }

    return `position:fixed; left:${Math.round(left)}px; top:${Math.round(top)}px; width:${PANEL_WIDTH}px; z-index:50;`;
  });


  const shortDate = $derived.by(() => {
    if (!startDate) return "";
    const [y, m, d] = startDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  });

  const isCrossMidnight = $derived(endDate !== "" && endDate !== startDate);

  const shortEndDate = $derived.by(() => {
    if (!endDate) return "";
    const [y, m, d] = endDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  });

  // ─── Build data and handlers ────────────────────────────────────
  function buildSaveData() {
    const hasNonDefaultPerms = guestCanModify || !guestCanInviteOthers || !guestCanSeeOtherGuests;
    return {
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
      visibility: visibility !== "public" ? visibility : undefined,
      attendees: attendees.length > 0 ? attendees : undefined,
      guestPermissions: hasNonDefaultPerms ? {
        canModify: guestCanModify,
        canInviteOthers: guestCanInviteOthers,
        canSeeOtherGuests: guestCanSeeOtherGuests,
      } : undefined,
    };
  }

  let saving = $state(false);

  function handleSave() {
    if (saving || !saveReady) return;
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
        { duration: 80, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
      ).onfinish = () => onSave(data, s);
    }, 200);
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); }
    // Escape is handled by CalendarView's global keydown listener
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={panelEl}
  class="panel-root flex flex-col"
  data-readonly={readOnly || undefined}
  style="box-shadow: 0 0 2px 0px var(--panel-edge), 0 1px 2px var(--panel-shadow); {panelStyle} background-color: var(--panel-bg);"
  onclick={(e) => e.stopPropagation()}
  onkeydown={handleKeydown}
>
  <!-- Drag handle bar with close button -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sticky top-0 z-10 flex items-center pl-3.5 pr-1.5 cursor-grab active:cursor-grabbing"
    style="background-color: var(--sidebar);"
    onpointerdown={handleDragStart}
    onpointermove={handleDragMove}
    onpointerup={handleDragEnd}
  >
    <div class="flex flex-1 items-center justify-center py-2.5">
      <div class="h-[1.5px] w-8 bg-muted-foreground/50"></div>
    </div>
  </div>

  <!-- Fixed top: title + date -->
  <div class="shrink-0 flex flex-col gap-2.5 px-3.5 pt-2.5">

    <!-- Scope selector (recurring events only) -->
    {#if isRecurring}
      <div class="flex min-w-0 rounded-none p-0.5" style="background-color: var(--panel-contrast);">
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

    <!-- Title + color circle -->
    <div class="flex items-center gap-2 px-1">
      <div class="title-wrapper relative min-w-0 flex-1">
        <input
          bind:this={titleInput}
          type="text"
          bind:value={title}
          placeholder="Session title..."
          disabled={readOnly}
          class="w-full bg-transparent py-0.5 text-[14px] font-semibold text-foreground outline-none placeholder:text-[#444746] dark:placeholder:text-[#C4C7C5]"
          oninput={emitChange}
          onkeydown={(e) => e.stopPropagation()}
        />
      </div>
      {#if !readOnly}
        <ColorPicker {color} isDark={theme.isDark} onselect={(c) => { color = c; emitChange(); }} />
      {/if}
    </div>
    <hr class="border-[#C4C7C5] dark:border-[#444746] -mt-2 mx-1" />

    <!-- Date + time -->
    <div class="relative -mt-1 flex items-center px-1 text-[12px]">
      <!-- Start date (left) -->
      <div class="relative z-[1] shrink-0">
        <button onclick={toggleDatepicker}
          class="rounded py-1 transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
            {readOnly ? '' : datepickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}">
          {shortDate}
        </button>

        <!-- Floating start date picker -->
        {#if datepickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { datepickerOpen = false; }}></div>
          <div class="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
            <MiniDatePicker selectedDate={startDate} onselect={selectDpDay} />
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
          disabled={readOnly}
          maxlength={5} placeholder="HH:MM"
          class="w-[42px] rounded bg-transparent px-0.5 py-0.5 text-center text-[12px] outline-none transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
            {readOnly ? '' : timePickerTarget === 'start' ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          onkeydown={(e) => e.stopPropagation()} />
        <span class="text-muted-foreground/60">&ndash;</span>
        <input type="text" bind:value={endTime}
          oninput={emitChange}
          onclick={() => openTimePicker("end")}
          disabled={readOnly}
          maxlength={5} placeholder="HH:MM"
          class="w-[42px] rounded bg-transparent px-0.5 py-0.5 text-center text-[12px] outline-none transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
            {readOnly ? '' : timePickerTarget === 'end' ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          onkeydown={(e) => e.stopPropagation()} />

        <!-- Floating time picker -->
        {#if timePickerTarget}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { timePickerTarget = null; }}></div>
          {@const isEnd = timePickerTarget === 'end'}
          {@const startMins = (() => { const [h, m] = (startTime || "0:0").split(":").map(Number); return h * 60 + m; })()}
          <div class="absolute top-full z-20 mt-1 rounded-lg bg-popover shadow-lg ring-1 ring-border/60"
            style="left: {isEnd ? '50%' : '0'}; width: {isEnd ? '115px' : '72px'};">
            <TimePicker
              currentTime={isEnd ? endTime : startTime}
              {isEnd}
              startMinutes={startMins}
              onselect={selectTime} />
          </div>
        {/if}
        </div>
      </div>

      <!-- End date (right) -->
      <div class="relative z-[1] shrink-0">
        <button onclick={toggleEndDatepicker}
          class="rounded py-1 transition-colors text-[#1F1F1F] dark:text-[#E3E3E3]
            {readOnly ? '' : endDatepickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}">
          {shortEndDate}
        </button>

        <!-- Floating end date picker -->
        {#if endDatepickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { endDatepickerOpen = false; }}></div>
          <div class="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
            <MiniDatePicker selectedDate={endDate} minDate={startDate} onselect={selectEdpDay} />
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Middle: all-day, description, location, URL (hidden when a section is expanded) -->
  {#if !openSection}
  <div transition:slide={{ duration: 180, easing: cubicOut }} class="flex flex-col gap-3 px-3.5 py-1.5">

    <!-- All-day / Availability / Status / Visibility -->
    <div class="-mt-1 flex items-center rounded-none px-0.5 text-[10px] leading-none" style="background-color: var(--panel-contrast);">
      <!-- All day -->
      <button
        onclick={() => {
          allDay = !allDay;
          if (allDay) {
            stashedStartTime = startTime;
            stashedEndTime = endTime;
            startTime = "00:00";
            endTime = "00:00";
          } else if (stashedStartTime && stashedStartTime !== "00:00") {
            startTime = stashedStartTime;
            endTime = stashedEndTime;
            stashedStartTime = "";
            stashedEndTime = "";
            syncEndDateFromTimes();
          } else {
            const now = new Date();
            const m = Math.ceil(now.getMinutes() / 15) * 15;
            now.setMinutes(m, 0, 0);
            const hh = String(now.getHours()).padStart(2, "0");
            const mm = String(now.getMinutes()).padStart(2, "0");
            startTime = `${hh}:${mm}`;
            const end = new Date(now.getTime() + 3600000);
            endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
            stashedStartTime = "";
            stashedEndTime = "";
            syncEndDateFromTimes();
          }
          emitChange();
        }}
        disabled={readOnly}
        class="flex items-center gap-1 rounded-none px-2 py-2 transition-colors
          {allDay ? 'bg-black/5 dark:bg-black/15 text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-black/5 dark:hover:bg-black/15'}"
        title="All day"
      >
        <Sun size={12} class="shrink-0" />
        <span>All day</span>
      </button>

      <!-- Show as -->
      <div class="relative">
        <button
          onclick={() => { showAsPicker = !showAsPicker; statusPicker = false; visibilityPicker = false; datepickerOpen = false; endDatepickerOpen = false; timePickerTarget = null; }}
          disabled={readOnly}
          class="flex items-center gap-1 rounded-none px-2 py-2 transition-colors hover:bg-black/5 dark:hover:bg-black/15
            {showAsPicker ? 'text-foreground' : 'text-muted-foreground'}"
          title="Show as"
        >
          <Eye size={12} class="shrink-0" />
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
          onclick={() => { statusPicker = !statusPicker; showAsPicker = false; visibilityPicker = false; datepickerOpen = false; endDatepickerOpen = false; timePickerTarget = null; }}
          disabled={readOnly}
          class="flex items-center gap-1 rounded-none px-2 py-2 capitalize transition-colors hover:bg-black/5 dark:hover:bg-black/15
            {statusPicker ? 'text-foreground' : 'text-muted-foreground'}"
          title="Status"
        >
          <CircleCheck size={12} class="shrink-0" />
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

      <!-- Visibility -->
      <div class="relative">
        <button
          onclick={() => { visibilityPicker = !visibilityPicker; showAsPicker = false; statusPicker = false; datepickerOpen = false; endDatepickerOpen = false; timePickerTarget = null; }}
          disabled={readOnly}
          class="flex items-center gap-1 rounded-none px-2 py-2 capitalize transition-colors hover:bg-black/5 dark:hover:bg-black/15
            {visibilityPicker ? 'text-foreground' : 'text-muted-foreground'}"
          title="Visibility"
        >
          {#if visibility === "public"}
            <Shield size={12} class="shrink-0" />
          {:else}
            <Lock size={12} class="shrink-0" />
          {/if}
          <span class="{visibility !== 'public' ? 'text-foreground' : ''}">{visibility}</span>
        </button>
        {#if visibilityPicker}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-[19]" onclick={() => { visibilityPicker = false; }}></div>
          <div class="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg bg-popover shadow-lg ring-1 ring-border/60">
            {#each (["public", "private", "confidential"] as const) as v}
              <button
                onclick={() => { visibility = v; visibilityPicker = false; emitChange(); }}
                class="flex w-full items-center px-2.5 py-1.5 text-left text-[12px] capitalize transition-colors hover:bg-black/5 dark:hover:bg-black/15
                  {visibility === v ? 'text-foreground font-medium' : 'text-muted-foreground'}"
              >{v}</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Attendees / URL / Location / Description -->
    <div class="-mt-1 flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
      <!-- Attendees -->
      <AttendeesSection bind:attendees bind:guestCanModify bind:guestCanInviteOthers bind:guestCanSeeOtherGuests {organizer} {readOnly} onchange={emitChange} />
      <!-- URL -->
      <div class="flex items-center gap-2.5 border-t border-border/40 px-3 py-2 text-[11px] leading-none">
        <ExternalLink size={13} class="shrink-0 text-foreground" />
        <input type="url" bind:value={eventUrl} placeholder="Add URL"
          disabled={readOnly}
          class="min-w-0 flex-1 bg-transparent leading-none text-foreground outline-none placeholder:text-muted-foreground/40"
          oninput={emitChange} onkeydown={(e) => e.stopPropagation()} />
      </div>
      <!-- Location -->
      <div class="flex items-center gap-2.5 border-t border-border/40 px-3 py-2 text-[11px] leading-none">
        <MapPin size={13} class="shrink-0 text-foreground" />
        <input type="text" bind:value={location} placeholder="Add location"
          disabled={readOnly}
          class="min-w-0 flex-1 bg-transparent leading-none text-foreground outline-none placeholder:text-muted-foreground/40"
          oninput={emitChange} onkeydown={(e) => e.stopPropagation()} />
        {#if geo}
          <span class="shrink-0 text-[10px] text-muted-foreground/60">({geo.lat.toFixed(2)}, {geo.lng.toFixed(2)})</span>
        {/if}
      </div>
      <!-- Description -->
      <DescriptionEditor {description} {readOnly} onchange={(html) => { description = html; emitChange(); }} />
    </div>
  </div>
  {/if}

  <!-- Fixed bottom: feature sections (always visible) -->
  <div class="shrink-0 flex flex-col gap-1.5 px-3.5 py-1.5">

      <!-- 1) Pomodoro -->
      <PomodoroSection
        enabled={pomodoroEnabled}
        bind:preset={pomodoroPreset}
        bind:focusDuration bind:shortBreak bind:longBreak bind:idleTimeoutEnabled
        expanded={openSection === "pomodoro"}
        ontoggle={() => handleToggle("pomodoro")}
        onexpand={() => handleExpand("pomodoro")}
        onchange={emitChange} />

      <!-- 2) Notifications -->
      <NotificationsSection
        enabled={notifEnabled}
        bind:selected={notifSelected}
        bind:customNotifs
        expanded={openSection === "notifications"}
        ontoggle={() => handleToggle("notifications")}
        onexpand={() => handleExpand("notifications")}
        onchange={emitChange} />

      <!-- 3) Repeat -->
      <RecurrenceSection
        bind:recurrence
        {startDate}
        {rdate}
        expanded={openSection === "repeat"}
        ontoggle={() => handleToggle("repeat")}
        onexpand={() => handleExpand("repeat")}
        onchange={emitChange} />

      <!-- 4) Music -->
      <div class="flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
        <div class="flex items-stretch">
          <button class="flex w-9 shrink-0 items-center justify-center text-muted-foreground/50">
            <Music size={13} />
          </button>
          <button onclick={() => handleExpand("music")}
            class="flex flex-1 items-center px-2.5 py-2 text-left transition-colors">
            <span class="translate-y-[1.13px] text-[11px] text-muted-foreground">Music</span>
          </button>
        </div>
        {#if openSection === "music"}
          <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="music" class="px-3 py-3 text-center text-[12px] text-muted-foreground/60" style="background-color: var(--panel-bg);">Coming soon</div>
        {/if}
      </div>
  </div>

  <!-- Save (pinned outside scroll) -->
  <div class="shrink-0 px-3.5 pb-3.5 pt-1.5" style="background-color: var(--panel-bg);">
    {#if readOnly}
      <div class="flex w-full items-center justify-center rounded-none py-1.5 text-[11px] text-muted-foreground/60"
        style="background-color: var(--panel-contrast);">
        Read-only
      </div>
    {:else}
      <div class="flex">
        {#if mode === "edit" && onDelete && event}
          <button onclick={handleDeleteClick}
            class="flex w-9 shrink-0 items-center justify-center bg-black/[0.06] dark:bg-black/[0.30] text-foreground transition-colors hover:text-destructive"
            title="Delete">
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        {/if}
        <button onclick={handleSave}
          class="flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[12px] transition-all
            {saving || saveReady
              ? 'bg-emerald-600 dark:bg-emerald-800 text-white dark:text-emerald-100 hover:opacity-90'
              : 'text-muted-foreground cursor-not-allowed'}"
          style="background-color: {saving || saveReady ? '' : 'var(--panel-contrast)'};">
          {#if saving}
            <CircleCheck size={13} />
            <span>Saved</span>
          {:else}
            <span>Save</span>
          {/if}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .panel-root {
    --panel-bg: #F0F4F9;
    --panel-contrast: #E8EDF5;
    --panel-edge: rgba(0, 0, 0, 0.30);
    --panel-shadow: rgba(0, 0, 0, 0.12);
    font-family: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :global(.dark) .panel-root {
    --panel-bg: #2A2B2E;
    --panel-contrast: #222325;
    --panel-edge: rgba(0, 0, 0, 0.55);
    --panel-shadow: rgba(0, 0, 0, 0.40);
    --foreground: #C4C7C5;
    --muted-foreground: #9EA1A0;
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

  /* Kill all interactivity below the drag-handle bar when readOnly */
  .panel-root[data-readonly] :global(button:not(.panel-chrome)),
  .panel-root[data-readonly] :global(input),
  .panel-root[data-readonly] :global([contenteditable]) {
    pointer-events: none !important;
    cursor: default !important;
  }

</style>

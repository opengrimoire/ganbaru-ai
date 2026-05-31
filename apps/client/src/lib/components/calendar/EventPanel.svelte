<script lang="ts">
  import type {
    CalendarEvent, EventColor, EventStatus, EventSurfaceStatus, EventTransparency, EventVisibility,
    EventAttendee, EventOrganizer, GeoCoordinates, GuestPermissions, AttendeeStatus,
    PomodoroConfig, RecurrenceConfig, RecurringScope,
  } from "./types";
  import MiniDatePicker from "./MiniDatePicker.svelte";
  import TimePicker, { type TimePickerInputNavigation } from "./TimePicker.svelte";
  import ColorPicker from "./ColorPicker.svelte";
  import CalendarScrollbar from "./CalendarScrollbar.svelte";
  import MeetingSection from "./MeetingSection.svelte";
  import PomodoroSection from "./PomodoroSection.svelte";
  import NotificationsSection from "./NotificationsSection.svelte";
  import RecurrenceSection from "./RecurrenceSection.svelte";
  import { onMount, tick, untrack } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { deleteActionForCalendarEvent } from "./occurrence-protection";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import { cn } from "$lib/utils";
  import { formatShortcut, hasOnlyShortcutModifier, hasShortcutModifier } from "$lib/keyboard-shortcuts";
  import {
    commitTimeDraft,
    displayTimeDraft,
    moveRovingIndex,
    restoreTimeDraft,
    sanitizeTimeDraftInput,
  } from "./event-panel-utils";
  import { buildEventPanelInitKey } from "./event-panel-init-key";
  import { formatCalendarDate, formatTimeLabel } from "./utils";
  import {
    EVENT_PANEL_EDGE_MARGIN,
    EVENT_PANEL_MAX_WIDTH,
    EVENT_PANEL_TITLE_BAR_HEIGHT,
    getEventPanelUsableHeight,
    getResponsivePanelWidth,
    pickEventPanelLayout,
    type EventPanelLayout,
  } from "$lib/utils/responsive";

  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Archive from "@lucide/svelte/icons/archive";
  import Scissors from "@lucide/svelte/icons/scissors";
  import Music from "@lucide/svelte/icons/music";
  import Calendar1 from "@lucide/svelte/icons/calendar-1";
  import Clock4 from "@lucide/svelte/icons/clock-4";
  import Ban from "@lucide/svelte/icons/ban";
  import Smile from "@lucide/svelte/icons/smile";
  import Eye from "@lucide/svelte/icons/eye";
  import Lock from "@lucide/svelte/icons/lock";


  const theme = getTheme();
  const preferences = getPreferences();
  const viewport = getViewport();

  const DEFAULT_PANEL_HEIGHT = 540;
  const PANEL_MAX_WIDTH = Math.round(EVENT_PANEL_MAX_WIDTH * 1.08);
  const PANEL_GAP = EVENT_PANEL_EDGE_MARGIN;
  const TITLE_BAR_HEIGHT = EVENT_PANEL_TITLE_BAR_HEIGHT;
  const PANEL_HEIGHT_CONSTRAINT_TOLERANCE = 2;

  type PanelSaveData = {
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
    meetingEnabled?: boolean;
    attendees?: EventAttendee[];
    localParticipationStatus?: AttendeeStatus;
    guestPermissions?: GuestPermissions;
  };

  let {
    mode,
    panelSessionKey = 0,
    start,
    end,
    event,
    anchor,
    initialAllDay = false,
    externalDirty = false,
    detailsLoaded = false,
    recurringScopeEnabled = false,
    initialSyncSeeded = false,
    parked = false,
    readOnly = false,
    allowDeleteWhenReadOnly = false,
    skipInlineDeleteConfirm = false,
    inlineEndEventConfirm = false,
    lockStartControls = false,
    calendarIdentityEmail,
    loadFullEvent,
    onSave,
    onDelete,
    onEndEvent,
    onClose,
    onChange,
    onInitialSync,
    onScopeChange,
    onSurfaceStatusChange,
  }: {
    mode: "create" | "edit";
    panelSessionKey?: number;
    start?: string;
    end?: string;
    event?: CalendarEvent;
    anchor: { x: number; y: number; width: number; height: number };
    initialAllDay?: boolean;
    externalDirty?: boolean;
    detailsLoaded?: boolean;
    recurringScopeEnabled?: boolean;
    initialSyncSeeded?: boolean;
    parked?: boolean;
    readOnly?: boolean;
    allowDeleteWhenReadOnly?: boolean;
    skipInlineDeleteConfirm?: boolean;
    inlineEndEventConfirm?: boolean;
    lockStartControls?: boolean;
    calendarIdentityEmail?: string;
    /**
     * Fetches the panel detail row (description, attendees, organizer, etc.)
     * for an event id. Used as a fallback when edit mode receives a slim
     * event. Normal edit opens preload details before mounting.
     */
    loadFullEvent?: (id: string) => Promise<CalendarEvent | undefined>;
    onSave: (data: PanelSaveData, scope?: RecurringScope) => void | Promise<void>;
    onDelete?: (id: string, scope?: RecurringScope) => void;
    onEndEvent?: (data: PanelSaveData, scope?: RecurringScope) => void;
    onClose: () => void;
    onChange?: (data: Partial<CalendarEvent>) => void;
    onInitialSync?: (data: Partial<CalendarEvent>) => void;
    onScopeChange?: (scope: RecurringScope) => void;
    onSurfaceStatusChange?: (status: EventSurfaceStatus | undefined) => void;
  } = $props();

  const controlsDisabled = $derived(readOnly || parked);
  const startControlsDisabled = $derived(controlsDisabled || lockStartControls);
  const deleteControlsDisabled = $derived(parked || (readOnly && !allowDeleteWhenReadOnly));
  const scopeControlsDisabled = $derived(parked || (readOnly && !allowDeleteWhenReadOnly));
  const endEventAction = $derived(mode === "edit" && !!event && !!onEndEvent);
  const generalDisabledAffordance = $derived(parked);
  const startDisabledAffordance = $derived(parked || (lockStartControls && !readOnly));

  // ─── Core fields ────────────────────────────────────────────────
  let title = $state("");
  let startTime = $state("");
  let endTime = $state("");
  let startTimeDraft = $state("");
  let endTimeDraft = $state("");
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
  let visibility: EventVisibility = $state("private");

  // ─── Meeting (attendees + location + url bundle) ────────────────
  // Persisted flag. When false, Meeting data is retained in memory for
  // misclick safety but omitted from save/change payloads.
  let meetingEnabled = $state(false);
  let attendees: EventAttendee[] = $state([]);
  let localParticipationStatus: AttendeeStatus | undefined = $state(undefined);
  let guestCanModify = $state(false);
  let guestCanInviteOthers = $state(true);
  let guestCanSeeOtherGuests = $state(true);

  function hasNonDefaultGuestPermissions(value: GuestPermissions | undefined): boolean {
    return !!value && (value.canModify || !value.canInviteOthers || !value.canSeeOtherGuests);
  }

  function hasMeetingState(value: Partial<CalendarEvent>): boolean {
    return value.meetingEnabled === true
      || !!(value.attendees && value.attendees.length > 0)
      || !!value.organizer
      || !!value.location
      || !!value.url
      || !!value.geo
      || value.localParticipationStatus !== undefined
      || hasNonDefaultGuestPermissions(value.guestPermissions);
  }


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

  function applyDefaultIdleTimeoutPreference(): void {
    idleTimeoutEnabled = preferences.focusIdlePauseOnEventCreate;
  }

  function idleTimeoutMinutesForPayload(): number | null {
    return idleTimeoutEnabled ? preferences.focusIdleThresholdMinutes : null;
  }

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

  // ─── Inline delete confirmation ────────────────────────────────
  // Two-step delete: first click arms, second click confirms. Any other
  // click inside the panel disarms (see panel-root onclick below).
  let deleteArmed = $state(false);
  let confirmDeleteBtn: HTMLButtonElement | undefined = $state();
  const deleteAction = $derived(event ? deleteActionForCalendarEvent(event) : "delete");
  const deleteActionLabel = $derived(
    endEventAction ? "End event" : deleteAction === "archive" ? "Archive" : "Delete",
  );

  // ─── Date pickers ──────────────────────────────────────────────
  let datepickerOpen = $state(false);
  let endDatepickerOpen = $state(false);
  let startDateButton: HTMLButtonElement | undefined = $state();
  let endDateButton: HTMLButtonElement | undefined = $state();

  async function focusDateButton(target: "start" | "end") {
    await tick();
    if (target === "start") startDateButton?.focus();
    else endDateButton?.focus();
  }

  function cancelDpDay(source?: "keyboard" | "pointer") {
    datepickerOpen = false;
    if (source === "keyboard") void focusDateButton("start");
  }

  function cancelEdpDay(source?: "keyboard" | "pointer") {
    endDatepickerOpen = false;
    if (source === "keyboard") void focusDateButton("end");
  }

  function selectDpDay(dateStr: string, source?: "keyboard" | "pointer") {
    if (startControlsDisabled) return;
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
    if (source === "keyboard") void focusDateButton("start");
  }

  function selectEdpDay(dateStr: string, source?: "keyboard" | "pointer") {
    endDate = dateStr;
    endDatepickerOpen = false;
    emitChange();
    if (source === "keyboard") void focusDateButton("end");
  }

  function toggleDatepicker(source: "keyboard" | "pointer" = "pointer") {
    if (startControlsDisabled) return;
    timePickerTarget = null;
    timePickerKeyboardOpen = false;
    endDatepickerOpen = false;
    datepickerOpen = source === "keyboard" ? true : !datepickerOpen;
  }

  function toggleEndDatepicker(source: "keyboard" | "pointer" = "pointer") {
    if (controlsDisabled) return;
    timePickerTarget = null;
    timePickerKeyboardOpen = false;
    datepickerOpen = false;
    endDatepickerOpen = source === "keyboard" ? true : !endDatepickerOpen;
  }

  function handleDateButtonKeydown(e: KeyboardEvent, target: "start" | "end") {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (target === "start") toggleDatepicker("keyboard");
    else toggleEndDatepicker("keyboard");
  }

  // ─── Time picker ─────────────────────────────────────────────
  let timePickerTarget: "start" | "end" | null = $state(null);
  let timePickerKeyboardOpen = $state(false);
  let startTimeInput: HTMLInputElement | undefined = $state();
  let endTimeInput: HTMLInputElement | undefined = $state();
  let startTimeDraftEdited = $state(false);
  let endTimeDraftEdited = $state(false);
  let timeInputEditTarget: "start" | "end" | null = $state(null);
  let timePickerInputNavigation: TimePickerInputNavigation | null = $state(null);
  let timePickerInputNavigationSequence = 0;

  async function focusTimeInput(target: "start" | "end", moveCaretToEnd = false) {
    await tick();
    const input = target === "start" ? startTimeInput : endTimeInput;
    input?.focus();
    if (moveCaretToEnd && input) {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }

  function closeTimePicker(source?: "keyboard" | "pointer") {
    const target = timePickerTarget;
    timePickerTarget = null;
    timePickerKeyboardOpen = false;
    if (source === "keyboard" && target) void focusTimeInput(target);
  }

  function openTimePicker(target: "start" | "end", source: "keyboard" | "pointer" = "pointer") {
    if (controlsDisabled || (target === "start" && lockStartControls)) return;
    datepickerOpen = false;
    endDatepickerOpen = false;
    timePickerKeyboardOpen = source === "keyboard";
    timePickerInputNavigation = null;
    timePickerTarget = target;
  }

  function setTimeDraft(target: "start" | "end", value: string) {
    if (target === "start") startTimeDraft = value;
    else endTimeDraft = value;
  }

  function setTimeDraftEdited(target: "start" | "end", value: boolean) {
    if (target === "start") startTimeDraftEdited = value;
    else endTimeDraftEdited = value;
  }

  function isTimeDraftEdited(target: "start" | "end"): boolean {
    return target === "start" ? startTimeDraftEdited : endTimeDraftEdited;
  }

  function isTimeInputEditing(target: "start" | "end"): boolean {
    return timeInputEditTarget === target;
  }

  function isAnyTimeInputEditing(): boolean {
    return timeInputEditTarget !== null || startTimeDraftEdited || endTimeDraftEdited;
  }

  function timeInputDisplayValue(target: "start" | "end"): string {
    const draft = target === "start" ? startTimeDraft : endTimeDraft;
    const canonical = target === "start" ? startTime : endTime;
    if (isTimeInputEditing(target) || isTimeDraftEdited(target)) return draft;
    return formatTimeLabel(canonical || draft, preferences.calendarTimeFormat, "compact");
  }

  function timeInputMirrorValue(target: "start" | "end"): string {
    const displayValue = timeInputDisplayValue(target);
    if (displayValue) return displayValue;
    return preferences.calendarTimeFormat === "12h" ? "h:mmam" : "HH:MM";
  }

  function timePickerWidth(isEnd: boolean): string {
    if (preferences.calendarTimeFormat === "24h") return isEnd ? "124px" : "80px";
    return isEnd ? "148px" : "98px";
  }

  function editableTimeDraft(target: "start" | "end"): string {
    return restoreTimeDraft(target === "start" ? startTime : endTime, preferences.calendarTimeFormat);
  }

  function enterTimeInputEditMode(target: "start" | "end") {
    if (timeInputEditTarget !== target && !isTimeDraftEdited(target)) {
      setTimeDraft(target, editableTimeDraft(target));
    }
    timeInputEditTarget = target;
  }

  function leaveTimeInputEditMode(target?: "start" | "end") {
    if (!target || timeInputEditTarget === target) timeInputEditTarget = null;
  }

  function handleTimeDraftInput(e: Event & { currentTarget: HTMLInputElement }, target: "start" | "end") {
    if (target === "start" && lockStartControls) return;
    const inputType = "inputType" in e && typeof e.inputType === "string" ? e.inputType : "";
    const formatShortCompact = inputType !== "insertText" && inputType !== "deleteContentBackward";
    setTimeDraft(target, displayTimeDraft(e.currentTarget.value, formatShortCompact, preferences.calendarTimeFormat));
    setTimeDraftEdited(target, true);
    enterTimeInputEditMode(target);
    if (timePickerTarget === target) {
      timePickerTarget = null;
      timePickerKeyboardOpen = false;
    }
  }

  function handleTimeBeforeInput(e: InputEvent) {
    if (e.inputType !== "insertText") return;
    const text = e.data ?? "";
    const allowMeridiem = preferences.calendarTimeFormat === "12h";
    const sanitized = sanitizeTimeDraftInput(text, allowMeridiem);
    if (allowMeridiem ? sanitized.length > 0 : sanitized === text) return;
    e.preventDefault();
  }

  function syncTimeDrafts() {
    startTimeDraft = startTime;
    endTimeDraft = endTime;
    startTimeDraftEdited = false;
    endTimeDraftEdited = false;
    leaveTimeInputEditMode();
  }

  function commitTimeInput(target: "start" | "end"): boolean {
    if (target === "start" && lockStartControls) {
      restoreTimeInput("start");
      return false;
    }
    const previous = target === "start" ? startTime : endTime;
    const draft = target === "start" ? startTimeDraft : endTimeDraft;
    const result = commitTimeDraft(draft, previous, preferences.calendarTimeFormat);
    setTimeDraft(target, result.value);
    setTimeDraftEdited(target, false);
    leaveTimeInputEditMode(target);
    if (!result.committed) return false;

    if (target === "start") startTime = result.value;
    else endTime = result.value;
    syncEndDateFromTimes();
    emitChange();
    return true;
  }

  function restoreTimeInput(target: "start" | "end") {
    setTimeDraft(target, restoreTimeDraft(target === "start" ? startTime : endTime, preferences.calendarTimeFormat));
    setTimeDraftEdited(target, false);
    leaveTimeInputEditMode(target);
  }

  function selectTime(time: string, source?: "keyboard" | "pointer") {
    if (timePickerTarget === "start" && lockStartControls) {
      closeTimePicker(source);
      return;
    }
    if (timePickerTarget === "start") {
      startTime = time;
      startTimeDraft = time;
      startTimeDraftEdited = false;
      leaveTimeInputEditMode("start");
      syncEndDateFromTimes();
    } else if (timePickerTarget === "end") {
      endTime = time;
      endTimeDraft = time;
      endTimeDraftEdited = false;
      leaveTimeInputEditMode("end");
      syncEndDateFromTimes();
    }
    closeTimePicker(source);
    emitChange();
  }

  function cancelTimePicker(source?: "keyboard" | "pointer") {
    closeTimePicker(source);
  }

  function beginTimeTypingFromPicker(digit: string) {
    const target = timePickerTarget;
    if (!target || controlsDisabled || allDay || (target === "start" && lockStartControls)) return;
    timePickerTarget = null;
    timePickerKeyboardOpen = false;
    setTimeDraft(target, displayTimeDraft(digit, false, preferences.calendarTimeFormat));
    setTimeDraftEdited(target, true);
    enterTimeInputEditMode(target);
    void focusTimeInput(target, true);
  }

  function selectTimeInputText(target: "start" | "end") {
    const input = target === "start" ? startTimeInput : endTimeInput;
    input?.select();
  }

  function handleTimeInputClick(target: "start" | "end") {
    if (controlsDisabled || (target === "start" && lockStartControls)) return;
    const input = target === "start" ? startTimeInput : endTimeInput;
    const shouldSelectAll = timeInputEditTarget !== target || document.activeElement !== input;
    openTimePicker(target, "pointer");
    enterTimeInputEditMode(target);
    if (shouldSelectAll) selectTimeInputText(target);
  }

  function beginTimeTypingFromNavigation(target: "start" | "end", text: string) {
    if (target === "start" && lockStartControls) return;
    const draft = displayTimeDraft(text, false, preferences.calendarTimeFormat);
    if (!draft) return;
    if (timePickerTarget === target) {
      timePickerTarget = null;
      timePickerKeyboardOpen = false;
    }
    setTimeDraft(target, draft);
    setTimeDraftEdited(target, true);
    enterTimeInputEditMode(target);
    void focusTimeInput(target, true);
  }

  function moveOpenTimePickerFromInput(target: "start" | "end", key: "ArrowUp" | "ArrowDown") {
    if (target === "start" && lockStartControls) return false;
    if (timePickerTarget !== target) return false;
    timePickerKeyboardOpen = true;
    timePickerInputNavigation = {
      key,
      sequence: timePickerInputNavigationSequence + 1,
    };
    timePickerInputNavigationSequence += 1;
    return true;
  }

  function handleTimeInputKeydown(e: KeyboardEvent, target: "start" | "end") {
    if (e.key === "Enter" && hasShortcutModifier(e)) return;
    if ((e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e)) return;

    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const commitOnly = isTimeDraftEdited(target);
        commitTimeInput(target);
        if (commitOnly) {
          if (timePickerTarget === target) closeTimePicker("keyboard");
          leaveTimeInputEditMode(target);
          return;
        }
        openTimePicker(target, "keyboard");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        restoreTimeInput(target);
        if (timePickerTarget) closeTimePicker("keyboard");
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!isTimeInputEditing(target)) return;
        if (timePickerTarget === target) {
          timePickerTarget = null;
          timePickerKeyboardOpen = false;
        }
        e.stopPropagation();
        return;
      }
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && moveOpenTimePickerFromInput(target, e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (PANEL_ARROW_KEYS.has(e.key)) return;
      if (/^[\d:]$/.test(e.key) && !isTimeInputEditing(target)) {
        e.preventDefault();
        e.stopPropagation();
        beginTimeTypingFromNavigation(target, e.key);
        return;
      }
    }

    e.stopPropagation();
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
  type Section = "meeting" | "pomodoro" | "notifications" | "repeat" | "music";
  let openSection: Section | null = $state(null);

  const panelWidth = $derived(getResponsivePanelWidth(viewport.width, PANEL_MAX_WIDTH, PANEL_GAP));
  const panelLayout = $derived.by((): EventPanelLayout => (
    pickEventPanelLayout({
      viewport: { width: viewport.width, height: viewport.height },
      anchor,
      panelWidth: PANEL_MAX_WIDTH,
      edgeMargin: PANEL_GAP,
      titleBarHeight: TITLE_BAR_HEIGHT,
    })
  ));
  const panelCanDrag = $derived(panelLayout === "anchored" || panelLayout === "centered");
  const stackedDateTime = $derived(panelWidth < 300);

  function isSectionEnabled(s: Section): boolean {
    if (s === "meeting") return meetingEnabled;
    if (s === "pomodoro") return pomodoroEnabled;
    if (s === "notifications") return notifEnabled;
    if (s === "repeat") return !!recurrence;
    return false;
  }


  function handleToggle(s: Section) {
    if (controlsDisabled) return;
    if (s === "music") return;
    const enabled = isSectionEnabled(s);
    if (enabled) {
      // Disable: keep the meeting data in memory so a misclick is recoverable.
      // Save is what actually commits the erasure (buildSaveData gates on the flag).
      if (s === "meeting") meetingEnabled = false;
      if (s === "pomodoro") pomodoroEnabled = false;
      if (s === "notifications") { notifEnabled = false; notifSelected = new Set(); customNotifs = []; }
      if (s === "repeat") recurrence = undefined;
      if (openSection === s) openSection = null;
    } else {
      // Enable with defaults
      if (s === "meeting") { meetingEnabled = true; emitChange(); handleExpand("meeting"); return; }
      if (s === "pomodoro") { pomodoroEnabled = true; pomodoroPreset = "auto"; focusDuration = 40; shortBreak = 5; longBreak = 10; applyDefaultIdleTimeoutPreference(); }
      if (s === "notifications") { notifEnabled = true; notifSelected = new Set([0]); }
      if (s === "repeat") recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
    }
    emitChange();
  }

  function canExpandSection(s: Section): boolean {
    return !controlsDisabled || (s === "meeting" && readOnly && !parked && !!showHeavySections);
  }

  /** Label click: expand/collapse the details panel. */
  function handleExpand(s: Section) {
    if (!canExpandSection(s)) return;
    const canMutate = !controlsDisabled;
    // Auto-activate repeat when expanding for the first time.
    if (canMutate && s === "repeat" && !recurrence && openSection !== s) {
      recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
      emitChange();
    }
    // Auto-activate meeting when expanding from a disabled state.
    if (canMutate && s === "meeting" && !meetingEnabled && openSection !== s) {
      meetingEnabled = true;
      emitChange();
    }
    const opening = openSection !== s;
    openSection = opening ? s : null;
    if (opening && panelEl && panelCanDrag) {
      // Decide pinning direction only when opening
      const rect = panelEl.getBoundingClientRect();
      const vh = viewport.height;
      const roomBelow = vh - PANEL_GAP - rect.bottom;
      const roomAbove = rect.top - minTop;
      // Pin bottom when there's less room below, so panel expands upward
      if (roomBelow < roomAbove) {
        pinnedBottom = rect.bottom;
        pinnedDragY = dragOffset.y;
      } else {
        pinnedBottom = 0;
      }
    } else if (opening) {
      pinnedBottom = 0;
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
  let eventPanelScrollEl: HTMLDivElement | undefined = $state();
  let eventPanelContentEl: HTMLDivElement | undefined = $state();
  let panelHeight = $state(0);
  let panelPositionReady = $state(false);
  let pinnedBottom = $state(0);
  let pinnedDragY = 0;
  let dragOffset = $state({ x: 0, y: 0 });
  let isDragging = $state(false);
  let userDragged = false;
  let dragStart = { x: 0, y: 0 };
  let baseLeft = $state(0);
  let baseTop = $state(0);
  const minTop = TITLE_BAR_HEIGHT + PANEL_GAP;

  function clampFloatingLeft(left: number, viewportWidth: number, width: number): number {
    const maxLeft = Math.max(PANEL_GAP, viewportWidth - width - PANEL_GAP);
    return Math.max(PANEL_GAP, Math.min(maxLeft, left));
  }

  function clampFloatingTop(top: number, viewportHeight: number, visibleHeight: number): number {
    const maxTop = Math.max(minTop, viewportHeight - visibleHeight - PANEL_GAP);
    return Math.max(minTop, Math.min(maxTop, top));
  }

  function getAvailablePanelHeight(viewportHeight: number): number {
    return Math.max(
      96,
      getEventPanelUsableHeight(viewportHeight, TITLE_BAR_HEIGHT, PANEL_GAP),
    );
  }

  function getPinnedHeightLimit(viewportHeight: number): number {
    const dragDelta = dragOffset.y - pinnedDragY;
    const viewportBottom = Math.max(minTop + 96, viewportHeight - PANEL_GAP);
    const effectiveBottom = Math.min(pinnedBottom + dragDelta, viewportBottom);
    return Math.max(96, Math.round(effectiveBottom - minTop));
  }

  function getPanelHeightLimit(layout: EventPanelLayout, viewportHeight: number): number {
    const availableHeight = getAvailablePanelHeight(viewportHeight);
    if (layout === "bottom") return Math.min(560, availableHeight);
    if (pinnedBottom > 0) return getPinnedHeightLimit(viewportHeight);
    return availableHeight;
  }

  function shouldConstrainPanelHeight(limit: number): boolean {
    return panelHeight > 0 && panelHeight > limit + PANEL_HEIGHT_CONSTRAINT_TOLERANCE;
  }

  const isRecurring = $derived(
    mode === "edit" && recurringScopeEnabled,
  );

  // ─── Initialization ─────────────────────────────────────────────
  // Edit mode normally receives a full event row preloaded by CalendarView,
  // so the panel paints meeting details, visibility, and description in its
  // first stable render. The async `loadFullEvent` path remains as a fallback
  // for callers that still hand over a slim event.
  let lastInitKey = "";
  let lastFullKey = "";
  let lastHeavyAppliedKey = "";
  let initialized = $state(false);
  let fullEvent = $state<CalendarEvent | null>(null);
  let savePending = $state(false);
  const showHeavySections = $derived(mode === "create" || detailsLoaded || fullEvent);

  function resetExitAnimation() {
    const el = panelEl;
    if (!el) return;
    for (const animation of el.getAnimations()) {
      animation.cancel();
    }
  }

  // Trigger the heavy-field fetch whenever a different event opens. The
  // resolver checks `lastFullKey` again at completion so a stale promise
  // for an event the user already navigated away from can't clobber the
  // current panel.
  $effect(() => {
    if (parked || mode !== "edit" || !event?.id || detailsLoaded || !loadFullEvent) {
      fullEvent = null;
      lastFullKey = "";
      return;
    }
    const id = event.id;
    if (id === lastFullKey) return;
    lastFullKey = id;
    fullEvent = null;
    const lookupId = event.recurringParentId ?? id;
    loadFullEvent(lookupId).then((full) => {
      if (lastFullKey === id && full) fullEvent = full;
    }).catch((e) => {
      console.error("[EventPanel] loadFullEvent failed:", e);
    });
  });

  $effect(() => {
    const key = buildEventPanelInitKey({
      parked,
      mode,
      panelSessionKey,
      eventId: event?.id,
    });
    if (key === lastInitKey) return;
    lastInitKey = key;
    lastHeavyAppliedKey = "";
    resetExitAnimation();
    savePending = false;
    deleteArmed = false;
    initialized = false;
    panelHeight = 0;
    panelPositionReady = parked;

    if (mode === "edit" && event) {
      title = event.title;
      startDate = event.start.split(" ")[0] ?? "";
      startTime = event.start.split(" ")[1] ?? "";
      endDate = event.end.split(" ")[0] ?? "";
      endTime = event.end.split(" ")[1] ?? "";
      syncTimeDrafts();
      color = event.color;
      recurrence = event.recurrence ? { ...event.recurrence } : undefined;
      allDay = event.allDay ?? false;
      stashedStartTime = "";
      stashedEndTime = "";
      location = event.location ?? "";
      transparency = event.transparency ?? "opaque";
      eventStatus = event.status ?? "confirmed";
      rdate = event.rdate;
      description = event.description ?? "";
      eventUrl = event.url ?? "";
      visibility = event.visibility ?? "public";
      organizer = event.organizer;
      attendees = event.attendees ? [...event.attendees] : [];
      localParticipationStatus = event.localParticipationStatus;
      guestCanModify = event.guestPermissions?.canModify ?? false;
      guestCanInviteOthers = event.guestPermissions?.canInviteOthers ?? true;
      guestCanSeeOtherGuests = event.guestPermissions?.canSeeOtherGuests ?? true;
      geo = event.geo;
      meetingEnabled = hasMeetingState(event);

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
        applyDefaultIdleTimeoutPreference();
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
      syncTimeDrafts();
      color = undefined;
      description = "";
      recurrence = undefined;
      pomodoroEnabled = true;
      pomodoroPreset = "auto";
      focusDuration = 40; shortBreak = 5; longBreak = 10;
      applyDefaultIdleTimeoutPreference();
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
      visibility = "private";
      organizer = undefined;
      attendees = [];
      localParticipationStatus = undefined;
      guestCanModify = false;
      guestCanInviteOthers = true;
      guestCanSeeOtherGuests = true;
      geo = undefined;
      rdate = undefined;
      meetingEnabled = false;
    }

    datepickerOpen = false;
    endDatepickerOpen = false;
    timePickerTarget = null;
    timePickerKeyboardOpen = false;
    openSection = null;
    scope = "this";
    dragOffset = { x: 0, y: 0 };
    userDragged = false;

    // Sync the panel's initial field values so the session baseline exactly
    // matches what the user sees. This must not mark the session dirty: the
    // user has not edited anything yet. With this baseline in place, any
    // subsequent edit that reverts back to the original value restores a
    // clean session, and the panel can be closed silently (no "Discard
    // unsaved changes?" prompt).
    if (!parked && !initialSyncSeeded) {
      (onInitialSync ?? onChange)?.(buildChangesPayload());
    }
    initialized = true;

    if (!parked && mode === "create") {
      const selectKey = key;
      tick().then(() => {
        if (lastInitKey === selectKey && !parked && mode === "create") {
          titleInput?.select();
        }
      });
    }

    if (!parked) {
      const measureKey = key;
      tick().then(() => {
        if (lastInitKey === measureKey && !parked) {
          measurePanelNaturalHeight();
        }
      });
    }
  });

  // Heavy-field init: runs once per fullEvent arrival. The setInitialChanges
  // pattern merges these keys into both `changes` and `baseline` on the
  // session, so a subsequent emitChange that re-emits the same heavy values
  // does not flip dirty. Since the heavy sections are gated on `fullEvent`,
  // the user cannot have edited any of them before this runs, so overwriting
  // their state is safe.
  $effect(() => {
    if (detailsLoaded || !fullEvent) return;
    if (mode !== "edit") return;
    if (fullEvent.id === lastHeavyAppliedKey) return;
    lastHeavyAppliedKey = fullEvent.id;

    description = fullEvent.description ?? "";
    eventUrl = fullEvent.url ?? "";
    visibility = fullEvent.visibility ?? "public";
    organizer = fullEvent.organizer;
    attendees = fullEvent.attendees ? [...fullEvent.attendees] : [];
    localParticipationStatus = fullEvent.localParticipationStatus;
    guestCanModify = fullEvent.guestPermissions?.canModify ?? false;
    guestCanInviteOthers = fullEvent.guestPermissions?.canInviteOthers ?? true;
    guestCanSeeOtherGuests = fullEvent.guestPermissions?.canSeeOtherGuests ?? true;
    geo = fullEvent.geo;
    meetingEnabled = hasMeetingState(fullEvent);

    (onInitialSync ?? onChange)?.(buildHeavyInitPayload());
  });

  $effect(() => {
    if (!lockStartControls) return;
    datepickerOpen = false;
    if (timePickerTarget === "start") {
      timePickerTarget = null;
      timePickerKeyboardOpen = false;
      restoreTimeInput("start");
    }
  });

  // Sync date/time from event prop when block is dragged/resized externally.
  // Only updates time fields, not title/description/etc. which the user may
  // have edited in the panel. The session's diff-based dirty tracking handles
  // revert-to-original automatically.
  $effect(() => {
    if (isAnyTimeInputEditing()) return;
    if (mode === "edit" && event) {
      startDate = event.start.split(" ")[0] ?? "";
      startTime = event.start.split(" ")[1] ?? "";
      endDate = event.end.split(" ")[0] ?? "";
      endTime = event.end.split(" ")[1] ?? "";
      syncTimeDrafts();
    } else if (mode === "create") {
      startDate = (start ?? "").split(" ")[0] ?? "";
      startTime = (start ?? "").split(" ")[1] ?? "";
      endDate = (end ?? "").split(" ")[0] ?? "";
      endTime = (end ?? "").split(" ")[1] ?? "";
      syncTimeDrafts();
    }
  });

  function measurePanelNaturalHeight() {
    const panel = panelEl;
    if (!panel) return;

    const renderedHeight = panel.offsetHeight;
    let naturalHeight = panel.scrollHeight;

    if (eventPanelScrollEl) {
      const panelRect = panel.getBoundingClientRect();
      const scrollRect = eventPanelScrollEl.getBoundingClientRect();
      const chromeHeight = Math.max(0, panelRect.height - scrollRect.height);
      naturalHeight = Math.max(naturalHeight, chromeHeight + eventPanelScrollEl.scrollHeight);
    }

    panelHeight = Math.ceil(Math.max(renderedHeight, naturalHeight));
  }

  // Track natural panel height so scrolling starts only when the panel
  // cannot fit in the usable viewport height.
  $effect(() => {
    const panel = panelEl;
    if (!panel) return;

    const observer = new ResizeObserver(measurePanelNaturalHeight);
    observer.observe(panel);
    if (eventPanelScrollEl) observer.observe(eventPanelScrollEl);
    if (eventPanelContentEl) observer.observe(eventPanelContentEl);
    void tick().then(measurePanelNaturalHeight);

    return () => observer.disconnect();
  });


  // Pin base position when anchor changes. A newly opened panel waits for
  // its first real height measurement before becoming visible, then later
  // height changes from expanding sections do not reposition the panel.
  // Skip repositioning if the user has manually dragged the panel.
  $effect(() => {
    const _a = anchor;
    const layout = panelLayout;
    const width = panelWidth;
    const vw = viewport.width;
    const vh = viewport.height;
    const panel = panelEl;
    const ph = panelPositionReady ? untrack(() => panelHeight) : panelHeight;
    if (!panel || ph <= 0) {
      if (!parked) panelPositionReady = false;
      return;
    }
    if (!panelCanDrag) {
      dragOffset = { x: 0, y: 0 };
      pinnedBottom = 0;
      userDragged = false;
      panelPositionReady = true;
      return;
    }
    if (userDragged) return;
    const availableHeight = Math.max(
      96,
      getEventPanelUsableHeight(vh, TITLE_BAR_HEIGHT, PANEL_GAP),
    );
    const visibleHeight = Math.min(ph, availableHeight);

    let left: number;
    if (layout === "centered") {
      left = Math.round((vw - width) / 2);
    } else {
      const anchorLeft = _a.x - _a.width;
      const requiredSideSpace = width + PANEL_GAP * 2;
      const rightSpace = vw - _a.x;
      if (anchorLeft >= requiredSideSpace) left = anchorLeft - PANEL_GAP - width;
      else if (rightSpace >= requiredSideSpace) left = _a.x + PANEL_GAP;
      else left = Math.round((vw - width) / 2);
    }

    const top = layout === "centered" ? Math.round((vh - visibleHeight) / 2) : _a.y;

    baseLeft = clampFloatingLeft(left, vw, width);
    baseTop = clampFloatingTop(top, vh, visibleHeight);
    dragOffset = { x: 0, y: 0 };
    panelPositionReady = true;
  });

  // ─── Dirty tracking ────────────────────────────────────────────
  // Save is always available in create mode (even with default values).
  // In edit mode it tracks the session's diff-based dirty flag so that
  // reverting all edits back to the original values disables the button
  // again, matching the click-outside cancellation behavior.
  const saveReady = $derived(mode === "create" || externalDirty);
  const eventPanelBodyConstrained = $derived.by(() => (
    panelLayout === "fullscreen"
    || shouldConstrainPanelHeight(getPanelHeightLimit(panelLayout, viewport.height))
  ));

  // ─── Emit changes ───────────────────────────────────────────────
  /**
   * Build the full normalized patch the session tracks as "changes".
   * Shared by the initial-sync emit (establishes baseline) and every
   * subsequent emitChange (user edits). Keeping the shape identical is
   * what lets the session compare the two sides field-by-field and
   * detect revert-to-original without false positives.
   */
  function buildChangesPayload(): Partial<CalendarEvent> {
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
        idleTimeoutMinutes: idleTimeoutMinutesForPayload(),
      } : undefined,
      allDay: allDay || undefined,
      meetingEnabled: meetingEnabled || undefined,
      location: meetingEnabled && location ? location : undefined,
      url: meetingEnabled && eventUrl ? eventUrl : undefined,
      transparency: transparency !== "opaque" ? transparency : undefined,
      status: eventStatus !== "confirmed" ? eventStatus : undefined,
      visibility: visibility !== "public" ? visibility : undefined,
      attendees: meetingEnabled && attendees.length > 0 ? attendees : undefined,
      localParticipationStatus: meetingEnabled ? localParticipationStatus : undefined,
      guestPermissions: meetingEnabled && hasNonDefaultPerms ? {
        canModify: guestCanModify,
        canInviteOthers: guestCanInviteOthers,
        canSeeOtherGuests: guestCanSeeOtherGuests,
      } : undefined,
    };
  }

  /**
   * Initial sync payload restricted to the keys that arrive with the full
   * event row. The heavy sections are gated on `fullEvent`, so by the time
   * this fires the user has not been able to edit any of these fields in
   * the panel; merging them straight into `changes` and `baseline` won't
   * flip dirty. Slim keys are deliberately omitted so they don't overwrite
   * an in-progress slim edit that happened during the load window.
   */
  function buildHeavyInitPayload(): Partial<CalendarEvent> {
    const hasNonDefaultPerms = guestCanModify || !guestCanInviteOthers || !guestCanSeeOtherGuests;
    return {
      description,
      meetingEnabled: meetingEnabled || undefined,
      url: meetingEnabled && eventUrl ? eventUrl : undefined,
      visibility: visibility !== "public" ? visibility : undefined,
      attendees: meetingEnabled && attendees.length > 0 ? attendees : undefined,
      localParticipationStatus: meetingEnabled ? localParticipationStatus : undefined,
      guestPermissions: meetingEnabled && hasNonDefaultPerms ? {
        canModify: guestCanModify,
        canInviteOthers: guestCanInviteOthers,
        canSeeOtherGuests: guestCanSeeOtherGuests,
      } : undefined,
    };
  }

  function emitChange() {
    // Auto-adjust endDate when times are manually typed
    if (startDate && startTime && endTime && endDate === startDate && endTime < startTime) {
      syncEndDateFromTimes();
    }
    onChange?.(buildChangesPayload());
  }

  // ─── Panel position ─────────────────────────────────────────────
  // When a section is expanded, the panel's bottom edge is pinned at
  // its pre-expansion position so it only grows upward. Otherwise the
  // top is pinned and the panel grows downward, nudging up only if
  // it would overflow the viewport.
  const panelStyle = $derived.by(() => {
    const vw = viewport.width;
    const vh = viewport.height;
    const width = panelWidth;
    const availableHeight = getAvailablePanelHeight(vh);
    const layout = panelLayout;
    const ph = panelHeight || DEFAULT_PANEL_HEIGHT;
    const visibleHeight = Math.min(ph, availableHeight);

    if (layout === "fullscreen") {
      return `position:fixed; left:${PANEL_GAP}px; right:${PANEL_GAP}px; top:${minTop}px; bottom:${PANEL_GAP}px; z-index:50;`;
    }

    if (layout === "bottom") {
      const maxHeight = getPanelHeightLimit(layout, vh);
      const heightCss = shouldConstrainPanelHeight(maxHeight)
        ? `height:${Math.round(maxHeight)}px;`
        : "";
      return `position:fixed; left:${PANEL_GAP}px; right:${PANEL_GAP}px; bottom:${PANEL_GAP}px; max-height:${Math.round(maxHeight)}px; ${heightCss} z-index:50;`;
    }

    const left = clampFloatingLeft(baseLeft + dragOffset.x, vw, width);
    const rawTop = Math.max(minTop, baseTop + dragOffset.y);

    if (pinnedBottom > 0) {
      // Section expanding: use CSS bottom to pin the bottom edge perfectly.
      // The browser keeps it fixed frame-by-frame without JS timing issues.
      const dragDelta = dragOffset.y - pinnedDragY;
      const bottomCss = Math.max(PANEL_GAP, Math.round(vh - pinnedBottom - dragDelta));
      const maxH = getPinnedHeightLimit(vh);
      const heightCss = shouldConstrainPanelHeight(maxH)
        ? `height:${maxH}px;`
        : "";
      return `position:fixed; left:${Math.round(left)}px; bottom:${bottomCss}px; max-height:${maxH}px; ${heightCss} width:${Math.round(width)}px; z-index:50;`;
    }

    // Normal: pin top, nudge up if overflowing bottom
    let top = rawTop;
    const overflow = top + visibleHeight + PANEL_GAP - vh;
    if (overflow > 0) {
      top = Math.max(minTop, top - overflow);
    }

    const heightCss = shouldConstrainPanelHeight(availableHeight)
      ? `height:${Math.round(availableHeight)}px;`
      : "";
    return `position:fixed; left:${Math.round(left)}px; top:${Math.round(top)}px; width:${Math.round(width)}px; max-height:${Math.round(availableHeight)}px; ${heightCss} z-index:50;`;
  });
  const parkedPanelStyle = $derived(
    `position:fixed; left:-10000px; top:-10000px; width:${Math.round(panelWidth)}px; z-index:-1; pointer-events:none;`,
  );


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
  function buildSaveData(): PanelSaveData {
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
        idleTimeoutMinutes: idleTimeoutMinutesForPayload(),
      } : undefined,
      allDay: allDay || undefined,
      meetingEnabled: meetingEnabled || undefined,
      location: meetingEnabled && location ? location : undefined,
      url: meetingEnabled && eventUrl ? eventUrl : undefined,
      transparency: transparency !== "opaque" ? transparency : undefined,
      status: eventStatus !== "confirmed" ? eventStatus : undefined,
      visibility: visibility !== "public" ? visibility : undefined,
      attendees: meetingEnabled && attendees.length > 0 ? attendees : undefined,
      localParticipationStatus: meetingEnabled ? localParticipationStatus : undefined,
      guestPermissions: meetingEnabled && hasNonDefaultPerms ? {
        canModify: guestCanModify,
        canInviteOthers: guestCanInviteOthers,
        canSeeOtherGuests: guestCanSeeOtherGuests,
      } : undefined,
    };
  }

  async function handleSave() {
    if (parked) return;
    if (controlsDisabled) return;
    if (savePending || !saveReady) return;
    const data = buildSaveData();
    const s = isRecurring ? scope : undefined;
    savePending = true;
    try {
      await onSave(data, s);
    } finally {
      savePending = false;
    }
  }
  function handleDeleteClick() {
    if (deleteControlsDisabled) return;
    if (!parked && event && onDelete) onDelete(event.id, isRecurring ? scope : undefined);
  }

  function handleEndEventClick() {
    if (deleteControlsDisabled || !onEndEvent) return;
    const data: PanelSaveData = {
      ...buildSaveData(),
      end: formatCalendarDate(new Date()),
    };
    deleteArmed = false;
    onEndEvent(data, isRecurring ? scope : undefined);
  }

  function confirmArmedDelete() {
    if (!deleteArmed) return false;
    deleteArmed = false;
    if (endEventAction) handleEndEventClick();
    else handleDeleteClick();
    return true;
  }

  function armOrConfirmDelete() {
    if (mode !== "edit" || !event || (!onDelete && !onEndEvent)) return;
    if (deleteControlsDisabled) return;
    if (endEventAction) {
      if (!inlineEndEventConfirm) {
        handleEndEventClick();
        return;
      }
      if (!confirmArmedDelete()) deleteArmed = true;
      return;
    }
    // For deletes that would stop the active pomodoro session, skip the
    // inline arm step and go straight to delete. The parent will show a
    // modal that acts as the confirmation.
    if (skipInlineDeleteConfirm) {
      deleteArmed = false;
      handleDeleteClick();
      return;
    }
    if (!confirmArmedDelete()) deleteArmed = true;
  }

  function handlePanelClick(e: MouseEvent) {
    if (parked) return;
    e.stopPropagation();
    // Disarm the inline delete confirmation if the click landed outside the
    // confirm button. The confirm button handles its own disarm on click.
    if (deleteArmed && confirmDeleteBtn && !confirmDeleteBtn.contains(e.target as Node)) {
      deleteArmed = false;
    }
  }

  const PANEL_ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  const PANEL_FOCUSABLE_SELECTOR = [
    "button",
    "input",
    "textarea",
    "[contenteditable='true']",
    "[role='button']",
    "[tabindex]",
  ].join(",");

  interface PanelNavCandidate {
    el: HTMLElement;
    rect: DOMRect;
    centerX: number;
    centerY: number;
  }

  function isElementVisibleForPanelNav(el: HTMLElement): boolean {
    if (el.closest("[aria-hidden='true']")) return false;
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isEditablePanelNavTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const input = target.closest("input, textarea");
    if (input instanceof HTMLTextAreaElement) return true;
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.dataset.panelArrowNav === "true") return false;
    return true;
  }

  function panelNavTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest<HTMLElement>(PANEL_FOCUSABLE_SELECTOR);
  }

  function panelNavCandidates(): PanelNavCandidate[] {
    if (!panelEl) return [];
    return Array.from(panelEl.querySelectorAll<HTMLElement>(PANEL_FOCUSABLE_SELECTOR))
      .filter((el) => {
        if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.disabled) return false;
        }
        return isElementVisibleForPanelNav(el);
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          rect,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      });
  }

  function sortPanelNavCandidates(candidates: PanelNavCandidate[]): PanelNavCandidate[] {
    return [...candidates].sort((a, b) => {
      const rowDelta = a.centerY - b.centerY;
      if (Math.abs(rowDelta) > 10) return rowDelta;
      return a.centerX - b.centerX;
    });
  }

  function panelNavRows(candidates: PanelNavCandidate[]): PanelNavCandidate[][] {
    const rows: PanelNavCandidate[][] = [];
    for (const candidate of sortPanelNavCandidates(candidates)) {
      const previousRow = rows.at(-1);
      const rowCenter = previousRow
        ? previousRow.reduce((sum, item) => sum + item.centerY, 0) / previousRow.length
        : 0;
      const sameRowThreshold = Math.max(10, candidate.rect.height * 0.65);
      if (previousRow && Math.abs(candidate.centerY - rowCenter) <= sameRowThreshold) {
        previousRow.push(candidate);
      } else {
        rows.push([candidate]);
      }
    }
    return rows.map((row) => row.sort((a, b) => a.centerX - b.centerX));
  }

  function rowAndIndexFor(
    rows: PanelNavCandidate[][],
    current: HTMLElement,
  ): { rowIndex: number; itemIndex: number } | null {
    for (const [rowIndex, row] of rows.entries()) {
      const itemIndex = row.findIndex((candidate) => candidate.el === current);
      if (itemIndex >= 0) return { rowIndex, itemIndex };
    }
    return null;
  }

  function closestCandidateByX(row: PanelNavCandidate[], x: number): PanelNavCandidate | undefined {
    let best: { candidate: PanelNavCandidate; distance: number } | undefined;
    for (const candidate of row) {
      const distance = Math.abs(candidate.centerX - x);
      if (!best || distance < best.distance) best = { candidate, distance };
    }
    return best?.candidate;
  }

  function nextPanelArrowTarget(current: HTMLElement, key: string): HTMLElement | null {
    const rows = panelNavRows(panelNavCandidates());
    const currentPosition = rowAndIndexFor(rows, current);
    if (!currentPosition) return null;

    const currentRow = rows[currentPosition.rowIndex];
    const currentCandidate = currentRow[currentPosition.itemIndex];
    if (!currentCandidate) return null;

    if (key === "ArrowRight") {
      return currentRow[currentPosition.itemIndex + 1]?.el
        ?? rows[currentPosition.rowIndex + 1]?.[0]?.el
        ?? null;
    }

    if (key === "ArrowLeft") {
      return currentRow[currentPosition.itemIndex - 1]?.el
        ?? rows[currentPosition.rowIndex - 1]?.at(-1)?.el
        ?? null;
    }

    const targetRow = key === "ArrowDown"
      ? rows[currentPosition.rowIndex + 1]
      : rows[currentPosition.rowIndex - 1];
    return targetRow ? closestCandidateByX(targetRow, currentCandidate.centerX)?.el ?? null : null;
  }

  function focusPanelArrowTarget(target: HTMLElement) {
    target.focus();

    if (target === startTimeInput) {
      leaveTimeInputEditMode("start");
      startTimeInput.select();
    } else if (target === endTimeInput) {
      leaveTimeInputEditMode("end");
      endTimeInput.select();
    }
  }

  function handlePanelArrowKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || parked) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!PANEL_ARROW_KEYS.has(e.key)) return;
    if (isEditablePanelNavTarget(e.target)) return;

    const current = panelNavTarget(e.target);
    if (!current || !panelEl?.contains(current)) return;
    const next = nextPanelArrowTarget(current, e.key);
    if (!next) return;

    e.preventDefault();
    e.stopPropagation();
    focusPanelArrowTarget(next);
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /**
   * Local keydown handler for input/textarea elements. It stops propagation
   * for normal text editing while explicitly letting the panel's own shortcuts
   * (Mod+Enter save, Mod+D end/delete, Escape close) bubble up to the
   * window-level listeners.
   */
  function inputKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && hasShortcutModifier(e)) return;
    if ((e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e)) return;
    if (e.key === "Escape") return;
    e.stopPropagation();
  }

  function metadataButtonClass(extra?: string): string {
    return cn(
      "flex min-w-0 max-w-full items-center justify-center gap-1.5 rounded-none px-0 py-1.5",
      "text-foreground",
      disabledAffordanceClass(generalDisabledAffordance),
      extra,
    );
  }

  function metadataStartButtonClass(): string {
    return cn(
      "flex min-w-0 max-w-full items-center justify-center gap-1.5 rounded-none px-0 py-1.5",
      "text-foreground",
      disabledAffordanceClass(startDisabledAffordance),
    );
  }

  function disabledAffordanceClass(show: boolean): string {
    return show
      ? "disabled:cursor-not-allowed disabled:opacity-60"
      : "disabled:cursor-default disabled:opacity-100";
  }

  function startTimeShellStateClass(): string {
    if (!startControlsDisabled) {
      return timePickerTarget === "start"
        ? "ring-1 ring-primary/60"
        : "hover:bg-black/5 dark:hover:bg-black/15";
    }
    return startDisabledAffordance ? "cursor-not-allowed opacity-60" : "";
  }

  const METADATA_ICON_SIZE = 11;
  const METADATA_ICON_CLASS = "shrink-0 translate-y-[0.5px]";
  const SCOPE_OPTIONS: ReadonlyArray<{ value: RecurringScope; label: string }> = [
    { value: "this", label: "Only this" },
    { value: "following", label: "Following" },
    { value: "all", label: "All" },
  ];
  let scopeFocusIndex = $state(0);
  let metadataFocusIndex = $state(0);
  const metadataItemCount = $derived(showHeavySections ? 3 : 2);

  $effect(() => {
    if (metadataFocusIndex >= metadataItemCount) metadataFocusIndex = Math.max(0, metadataItemCount - 1);
  });

  async function focusPanelRovingButton(group: string, index: number) {
    await tick();
    panelEl
      ?.querySelector<HTMLButtonElement>(`[data-panel-roving="${group}"][data-roving-index="${index}"]`)
      ?.focus();
  }

  function setPanelRovingIndex(group: "scope" | "metadata", index: number) {
    if (group === "scope") scopeFocusIndex = index;
    else metadataFocusIndex = index;
  }

  function handlePanelRovingKeydown(
    e: KeyboardEvent,
    group: "scope" | "metadata",
    index: number,
    itemCount: number,
  ) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const nextIndex = moveRovingIndex({
      currentIndex: index,
      itemCount,
      key: e.key,
      orientation: "horizontal",
    });
    if (nextIndex === index) return;
    e.preventDefault();
    e.stopPropagation();
    setPanelRovingIndex(group, nextIndex);
    void focusPanelRovingButton(group, nextIndex);
  }

  function toggleTransparency() {
    if (controlsDisabled) return;
    datepickerOpen = false;
    endDatepickerOpen = false;
    timePickerTarget = null;
    timePickerKeyboardOpen = false;
    transparency = transparency === "transparent" ? "opaque" : "transparent";
    emitChange();
  }

  function toggleVisibility() {
    if (controlsDisabled) return;
    datepickerOpen = false;
    endDatepickerOpen = false;
    timePickerTarget = null;
    timePickerKeyboardOpen = false;
    visibility = visibility === "public" ? "private" : "public";
    emitChange();
  }

  function handleScopeClick(s: RecurringScope) {
    if (scopeControlsDisabled) return;
    scope = s;
    onScopeChange?.(s);
  }

  function handleDragStart(e: PointerEvent) {
    if (!panelCanDrag) return;
    if (parked) return;
    isDragging = true;
    dragStart = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handleDragMove(e: PointerEvent) {
    if (isDragging && panelCanDrag) dragOffset = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y };
  }
  function handleDragEnd() {
    if (isDragging) userDragged = panelCanDrag;
    isDragging = false;
  }

  // Global shortcut handling: active whenever the panel is mounted, so the
  // user does not have to click a field inside the panel first. If a modal
  // (ConfirmDialog) is open, its capture-phase window listener swallows the
  // event before it reaches this handler.
  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (parked) return;
      if (
        deleteArmed
        && e.key === "Enter"
        && !e.altKey
        && !e.ctrlKey
        && !e.metaKey
        && !e.shiftKey
      ) {
        e.preventDefault();
        confirmArmedDelete();
        return;
      }
      // Mod + Enter: save. Chosen over plain Enter so typing newlines
      // in the description textarea still works.
      if (e.key === "Enter" && hasShortcutModifier(e)) {
        e.preventDefault();
        handleSave();
        return;
      }
      // Mod + D: end the active event or arm delete; press again to confirm.
      // If delete would stop the active pomodoro block, the first press goes
      // straight to the modal (see armOrConfirmDelete).
      if ((e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e)) {
        e.preventDefault();
        armOrConfirmDelete();
        return;
      }
      // Escape is handled by CalendarView's global keydown listener
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={panelEl}
  class="panel-root flex flex-col"
  data-layout={panelLayout}
  data-readonly={controlsDisabled || undefined}
  data-parked={parked || undefined}
  aria-hidden={parked || undefined}
  style="box-shadow: 0 0 2px 0px var(--panel-edge), 0 1px 2px var(--panel-shadow); {parked ? parkedPanelStyle : panelStyle} background-color: var(--panel-bg); visibility: {initialized && panelPositionReady && !parked ? 'visible' : 'hidden'};"
  onclick={handlePanelClick}
  onkeydown={handlePanelArrowKeydown}
>
  <!-- Drag handle bar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class={cn(
      "sticky top-0 z-10 flex items-center pl-4 pr-2",
      panelCanDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default",
    )}
    style="background-color: var(--sidebar);"
    onpointerdown={handleDragStart}
    onpointermove={handleDragMove}
    onpointerup={handleDragEnd}
  >
    <div class="flex flex-1 items-center justify-center py-2.5">
      <div class="h-[1.5px] w-9 bg-muted-foreground/50"></div>
    </div>
  </div>

  <div
    class={cn(
      "relative min-h-0",
      eventPanelBodyConstrained ? "flex-1 overflow-hidden" : "shrink-0",
    )}
  >
    <div
      bind:this={eventPanelScrollEl}
      class={cn(
        "event-panel-scroll hide-scrollbar overscroll-contain",
        eventPanelBodyConstrained ? "h-full overflow-y-auto" : "overflow-visible",
      )}
    >
    <div bind:this={eventPanelContentEl}>
    <!-- Main editor: title + date -->
    <div class="shrink-0 px-4 pt-2.5">

    <!-- Scope selector (recurring events only) -->
    {#if isRecurring}
      <div class="relative top-0.5 mb-2 grid grid-cols-3 overflow-hidden rounded-sm bg-event-panel-contrast p-0.5 text-[0.733333rem]"
        role="radiogroup"
        aria-label="Apply changes to">
        {#each SCOPE_OPTIONS as option, index}
          <button
            role="radio"
            aria-checked={scope === option.value}
            onclick={() => handleScopeClick(option.value)}
            onfocus={() => { scopeFocusIndex = index; }}
            onkeydown={(e) => handlePanelRovingKeydown(e, "scope", index, SCOPE_OPTIONS.length)}
            data-panel-roving="scope"
            data-roving-index={index}
            tabindex={scopeFocusIndex === index ? 0 : -1}
            disabled={scopeControlsDisabled}
            class={cn(
              "readonly-interactive flex min-w-0 items-center justify-center rounded px-2 py-1 text-center font-semibold",
              scope === option.value
                ? "bg-action-confirm text-action-confirm-foreground"
                : "text-event-panel-input-text/70",
            )}
          >
            <span class="translate-y-[0.5px]">{option.label}</span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Title + color circle -->
    <div class="relative top-0.5 flex items-center gap-2.5 px-1">
      <div class="title-wrapper relative min-w-0 flex-1">
        <input
          bind:this={titleInput}
          type="text"
          bind:value={title}
          placeholder="Session title..."
          disabled={controlsDisabled}
          class="w-full bg-transparent py-0.5 text-[1rem] font-semibold text-foreground outline-none placeholder:text-event-panel-placeholder"
          oninput={emitChange}
          onkeydown={inputKeydown}
        />
      </div>
      {#if !controlsDisabled}
        <ColorPicker {color} theme={theme.current} onselect={(c) => { color = c; emitChange(); }} />
      {/if}
    </div>
    <hr class="border-event-panel-divider mx-1 mt-0.5" />

    <div class="mt-1.5 flex flex-col gap-px px-1">
      <!-- Date + time -->
      <div
        class="date-time-grid relative text-[0.866667rem] leading-none"
        data-stacked={stackedDateTime || undefined}
      >
      <!-- Start date -->
      <div class="relative z-1 min-w-0 justify-self-start">
        <button bind:this={startDateButton}
          onclick={() => toggleDatepicker("pointer")}
          onkeydown={(e) => handleDateButtonKeydown(e, "start")}
          disabled={startControlsDisabled}
          class={cn(
            "date-chip max-w-full rounded py-0.5 text-event-panel-input-text",
            disabledAffordanceClass(startDisabledAffordance),
            startControlsDisabled
              ? ""
              : datepickerOpen
                ? "ring-1 ring-primary/60"
                : "hover:bg-black/5 dark:hover:bg-black/15",
          )}>
          {shortDate}
        </button>

        <!-- Floating start date picker -->
        {#if datepickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-19" onclick={() => { datepickerOpen = false; }}></div>
          <div class="absolute left-0 top-full z-20 mt-1 w-60 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
            <MiniDatePicker
              selectedDate={startDate}
              highlightToday={false}
              activeHighlight="primary"
              onselect={selectDpDay}
              oncancel={cancelDpDay}
            />
          </div>
        {/if}
      </div>

      <!-- Time group, visually hidden when all-day so the date grid keeps its shape. -->
      <div
        class="time-group relative {timePickerTarget ? 'z-20' : 'z-2'} flex items-center justify-center gap-1.5 py-0.5"
        class:invisible={allDay}
        class:pointer-events-none={allDay}
        aria-hidden={allDay}
      >
        <span
          class="time-input-shell relative z-30 rounded text-center text-event-panel-input-text
            {preferences.calendarTimeFormat === '12h' ? 'text-[0.8rem]' : 'text-[0.866667rem]'}
            {startTimeShellStateClass()}"
          data-value={timeInputMirrorValue("start")}>
          <input bind:this={startTimeInput}
            type="text"
            data-panel-arrow-nav="true"
            inputmode={preferences.calendarTimeFormat === "12h" ? "text" : "numeric"}
            onbeforeinput={handleTimeBeforeInput}
            oninput={(e) => handleTimeDraftInput(e, "start")}
            onblur={() => commitTimeInput("start")}
            onclick={() => handleTimeInputClick("start")}
            disabled={startControlsDisabled || allDay}
            maxlength={preferences.calendarTimeFormat === "12h" ? 7 : 5}
            placeholder={preferences.calendarTimeFormat === "12h" ? "h:mmam" : "HH:MM"}
            class={cn(
              "time-input bg-transparent px-0 py-0.5 text-center outline-none",
              disabledAffordanceClass(startDisabledAffordance),
            )}
            value={timeInputDisplayValue("start")}
            onkeydown={(e) => handleTimeInputKeydown(e, "start")} />
        </span>
        <span class="text-muted-foreground/60">-</span>
        <span
          class="time-input-shell relative z-30 rounded text-center text-event-panel-input-text
            {preferences.calendarTimeFormat === '12h' ? 'text-[0.8rem]' : 'text-[0.866667rem]'}
            {controlsDisabled ? '' : timePickerTarget === 'end' ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          data-value={timeInputMirrorValue("end")}>
          <input bind:this={endTimeInput}
            type="text"
            data-panel-arrow-nav="true"
            inputmode={preferences.calendarTimeFormat === "12h" ? "text" : "numeric"}
            onbeforeinput={handleTimeBeforeInput}
            oninput={(e) => handleTimeDraftInput(e, "end")}
            onblur={() => commitTimeInput("end")}
            onclick={() => handleTimeInputClick("end")}
            disabled={controlsDisabled || allDay}
            maxlength={preferences.calendarTimeFormat === "12h" ? 7 : 5}
            placeholder={preferences.calendarTimeFormat === "12h" ? "h:mmam" : "HH:MM"}
            class="time-input bg-transparent px-0 py-0.5 text-center outline-none"
            value={timeInputDisplayValue("end")}
            onkeydown={(e) => handleTimeInputKeydown(e, "end")} />
        </span>

        <!-- Floating time picker -->
        {#if timePickerTarget}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-19" onpointerdown={() => closeTimePicker("pointer")}></div>
          {@const isEnd = timePickerTarget === 'end'}
          {@const startMins = (() => { const [h, m] = (startTime || "0:0").split(":").map(Number); return h * 60 + m; })()}
          <div class="absolute top-full z-20 mt-1 rounded-lg bg-popover shadow-lg ring-1 ring-border/60"
            style="left: {isEnd ? '50%' : '0'}; width: {timePickerWidth(isEnd)};">
            <TimePicker
              currentTime={isEnd ? endTime : startTime}
              {isEnd}
              startMinutes={startMins}
              focusOnOpen={timePickerKeyboardOpen}
              inputNavigation={timePickerInputNavigation}
              onselect={selectTime}
              oncancel={cancelTimePicker}
              ontypedigit={beginTimeTypingFromPicker} />
          </div>
        {/if}
      </div>

      <!-- End date -->
      <div class="relative z-1 min-w-0 justify-self-end text-right">
        <button bind:this={endDateButton}
          onclick={() => toggleEndDatepicker("pointer")}
          onkeydown={(e) => handleDateButtonKeydown(e, "end")}
          class="date-chip max-w-full rounded py-0.5 text-event-panel-input-text
            {controlsDisabled ? '' : endDatepickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}">
          {shortEndDate}
        </button>

        <!-- Floating end date picker -->
        {#if endDatepickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-19" onclick={() => { endDatepickerOpen = false; }}></div>
          <div class="absolute right-0 top-full z-20 mt-1 w-60 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
            <MiniDatePicker
              selectedDate={endDate}
              minDate={startDate}
              highlightToday={false}
              activeHighlight="primary"
              onselect={selectEdpDay}
              oncancel={cancelEdpDay}
            />
          </div>
        {/if}
      </div>
      </div>

    </div>
  </div>

  <!-- Metadata strip -->
  <div class="flex flex-col gap-3 px-4 pb-0 pt-1.5">

    <!-- All-day / Availability / Visibility -->
    <div class="flex w-full items-center justify-evenly overflow-hidden rounded-none bg-event-panel-contrast text-[0.733333rem]">
      <!-- All day -->
      <button
        onclick={() => {
          if (startControlsDisabled) return;
          timePickerTarget = null;
          timePickerKeyboardOpen = false;
          allDay = !allDay;
          if (allDay) {
            stashedStartTime = startTime;
            stashedEndTime = endTime;
            startTime = "00:00";
            endTime = "00:00";
            syncTimeDrafts();
          } else if (stashedStartTime && stashedStartTime !== "00:00") {
            startTime = stashedStartTime;
            endTime = stashedEndTime;
            stashedStartTime = "";
            stashedEndTime = "";
            syncEndDateFromTimes();
            syncTimeDrafts();
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
            syncTimeDrafts();
          }
          emitChange();
        }}
        onfocus={() => { metadataFocusIndex = 0; }}
        onkeydown={(e) => handlePanelRovingKeydown(e, "metadata", 0, metadataItemCount)}
        data-panel-roving="metadata"
        data-roving-index="0"
        tabindex={startControlsDisabled ? -1 : 0}
        disabled={startControlsDisabled}
        class={metadataStartButtonClass()}
      >
        {#if allDay}
          <Calendar1 size={METADATA_ICON_SIZE} class={METADATA_ICON_CLASS} />
          <span class="translate-y-[1.13px] truncate">All day</span>
        {:else}
          <Clock4 size={METADATA_ICON_SIZE} class={METADATA_ICON_CLASS} />
          <span class="translate-y-[1.13px] truncate">Timed</span>
        {/if}
      </button>

      <!-- Show as -->
      <button
        onclick={toggleTransparency}
        onfocus={() => { metadataFocusIndex = 1; }}
        onkeydown={(e) => handlePanelRovingKeydown(e, "metadata", 1, metadataItemCount)}
        data-panel-roving="metadata"
        data-roving-index="1"
        data-app-tooltip-focus-disabled="true"
        tabindex={0}
        disabled={controlsDisabled}
        class={metadataButtonClass()}
        title="Busy tells others you are unavailable for meetings."
      >
        {#if transparency === "transparent"}
          <Smile size={METADATA_ICON_SIZE} class={METADATA_ICON_CLASS} />
        {:else}
          <Ban size={METADATA_ICON_SIZE} class={METADATA_ICON_CLASS} />
        {/if}
        <span class="translate-y-[1.13px] truncate">{transparency === "transparent" ? "Free" : "Busy"}</span>
      </button>

      {#if showHeavySections}
        <button
          onclick={toggleVisibility}
          onfocus={() => { metadataFocusIndex = 2; }}
          onkeydown={(e) => handlePanelRovingKeydown(e, "metadata", 2, metadataItemCount)}
          data-panel-roving="metadata"
          data-roving-index="2"
          data-app-tooltip-focus-disabled="true"
          tabindex={0}
          disabled={controlsDisabled}
          class={metadataButtonClass("capitalize")}
          title="Private hides event details from other calendar viewers."
        >
          {#if visibility === "public"}
            <Eye size={METADATA_ICON_SIZE} class={METADATA_ICON_CLASS} />
          {:else}
            <Lock size={METADATA_ICON_SIZE} class={METADATA_ICON_CLASS} />
          {/if}
          <span class="translate-y-[1.13px] truncate">{visibility}</span>
        </button>
      {/if}
    </div>

  </div>

  <!-- Feature sections -->
  <div class="shrink-0 flex flex-col gap-1.5 px-4 py-1.5">

      <!-- 1) Meeting -->
      {#if showHeavySections}
        <MeetingSection
          enabled={meetingEnabled}
          bind:url={eventUrl}
          bind:location
          {geo}
          bind:attendees
          bind:localParticipationStatus
          bind:guestCanModify
          bind:guestCanInviteOthers
          bind:guestCanSeeOtherGuests
          {organizer}
          selfEmail={calendarIdentityEmail}
          {description}
          readOnly={controlsDisabled}
          allowReadOnlyExpand={readOnly && !parked}
          expanded={openSection === "meeting"}
          ontoggle={() => handleToggle("meeting")}
          onexpand={() => handleExpand("meeting")}
          onsurfacestatuschange={onSurfaceStatusChange}
          onchange={emitChange}
          ondescriptionchange={(html) => { description = html; emitChange(); }} />
      {/if}

      <!-- 2) Pomodoro -->
      <PomodoroSection
        enabled={pomodoroEnabled}
        bind:preset={pomodoroPreset}
        bind:focusDuration bind:shortBreak bind:longBreak bind:idleTimeoutEnabled
        expanded={openSection === "pomodoro"}
        ontoggle={() => handleToggle("pomodoro")}
        onexpand={() => handleExpand("pomodoro")}
        onchange={emitChange} />

      <!-- 3) Notifications -->
      <NotificationsSection
        enabled={notifEnabled}
        bind:selected={notifSelected}
        bind:customNotifs
        expanded={openSection === "notifications"}
        ontoggle={() => handleToggle("notifications")}
        onexpand={() => handleExpand("notifications")}
        onchange={emitChange} />

      <!-- 4) Repeat -->
      <RecurrenceSection
        bind:recurrence
        {startDate}
        {rdate}
        expanded={openSection === "repeat"}
        ontoggle={() => handleToggle("repeat")}
        onexpand={() => handleExpand("repeat")}
        onchange={emitChange} />

      <!-- 5) Music -->
      <div class="flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
        <div class="section-header flex items-stretch">
          <div aria-hidden="true" class="flex w-10 shrink-0 items-center justify-center text-muted-foreground/50">
            <Music size={14} />
          </div>
          <button onclick={() => handleExpand("music")}
            disabled={controlsDisabled}
            class="flex flex-1 items-center px-3 py-2 text-left">
            <span class="translate-y-[1.13px] text-[0.8rem] text-muted-foreground">Music</span>
          </button>
        </div>
        {#if openSection === "music"}
          <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="music" class="px-3.5 py-3 text-center text-[0.866667rem] text-muted-foreground/60" style="background-color: var(--panel-bg);">Coming soon</div>
        {/if}
      </div>
  </div>
  </div>
  </div>
    {#if eventPanelBodyConstrained}
      <CalendarScrollbar scrollContainer={eventPanelScrollEl} wheelPassthrough />
    {/if}
  </div>

  <!-- Save (pinned outside scroll) -->
  <div
    class={cn(
      "shrink-0 px-4",
      panelLayout === "fullscreen" ? "pb-2 pt-1" : "pb-3.5 pt-1.5",
    )}
    style="background-color: var(--panel-bg);"
  >
    {#if readOnly && !(allowDeleteWhenReadOnly && mode === "edit" && (onDelete || onEndEvent) && event)}
      <div class="flex w-full items-center justify-center rounded-none py-1.5 text-[0.8rem] text-muted-foreground/60"
        style="background-color: var(--panel-contrast);">
        Read only
      </div>
    {:else}
      <div class="panel-footer-actions flex">
        {#if deleteArmed && mode === "edit" && event && (onDelete || onEndEvent) && (!endEventAction || inlineEndEventConfirm)}
          <button
            bind:this={confirmDeleteBtn}
            onclick={() => { deleteArmed = false; if (endEventAction) handleEndEventClick(); else handleDeleteClick(); }}
            disabled={deleteControlsDisabled}
            class="readonly-interactive flex flex-1 items-center justify-center gap-2 py-1.5 text-[0.866667rem] text-action-danger-armed-foreground bg-action-danger-armed">
            {#if endEventAction}
              <Scissors size={14} strokeWidth={1.8} />
            {:else if deleteAction === "archive"}
              <Archive size={14} strokeWidth={1.8} />
            {:else}
              <Trash2 size={14} strokeWidth={1.8} />
            {/if}
            <span>Press again to {endEventAction ? "end event" : deleteAction} ({formatShortcut("Mod + D")})</span>
          </button>
        {:else}
          {#if mode === "edit" && (onDelete || onEndEvent) && event}
            <button onclick={armOrConfirmDelete}
              disabled={deleteControlsDisabled}
              class={cn(
                "readonly-interactive event-panel-delete-icon-button flex w-10 shrink-0 items-center justify-center text-foreground",
              )}
              title={`${deleteActionLabel} (${formatShortcut("Mod + D")})`}>
              {#if endEventAction}
                <Scissors size={14} strokeWidth={1.8} />
              {:else if deleteAction === "archive"}
                <Archive size={14} strokeWidth={1.8} />
              {:else}
                <Trash2 size={14} strokeWidth={1.8} />
              {/if}
            </button>
          {/if}
          {#if readOnly}
            <div class="flex flex-1 cursor-not-allowed items-center justify-center gap-2 py-1.5 text-[0.866667rem] text-muted-foreground"
              style="background-color: var(--panel-contrast);">
              <span>Read-only ({formatShortcut("Mod + D")} to archive)</span>
            </div>
          {:else}
          <button onclick={handleSave}
            disabled={controlsDisabled || savePending || !saveReady}
            class="flex flex-1 items-center justify-center gap-2 py-1.5 text-[0.866667rem]
              {saveReady
                ? 'bg-action-confirm text-action-confirm-foreground hover:opacity-90'
                : 'text-muted-foreground cursor-not-allowed'}"
            style="background-color: {saveReady ? '' : 'var(--panel-contrast)'};">
            <span>Save ({formatShortcut("Mod + Enter")})</span>
          </button>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .panel-root {
    --panel-bg: var(--event-panel-bg);
    --panel-contrast: var(--event-panel-contrast);
    --panel-edge: var(--event-panel-edge);
    --panel-shadow: var(--event-panel-shadow);
    --foreground: var(--event-panel-text);
    --muted-foreground: var(--event-panel-muted-text);
    font-variant-numeric: tabular-nums;
    min-height: 0;
    overflow: hidden;
  }

  .date-time-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    column-gap: 0.375rem;
  }

  .date-time-grid[data-stacked] {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    row-gap: 0.125rem;
  }

  .date-time-grid[data-stacked] .time-group {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-self: center;
  }

  .date-chip {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time-input::placeholder {
    font-size: 0.68rem;
  }

  .time-input-shell {
    position: relative;
    display: inline-block;
  }

  .time-input-shell::after {
    content: attr(data-value);
    display: block;
    font: inherit;
    letter-spacing: inherit;
    padding-block: 0.125rem;
    visibility: hidden;
    white-space: pre;
    pointer-events: none;
  }

  .time-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    font: inherit;
    letter-spacing: inherit;
    color: inherit;
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

  .event-panel-delete-icon-button {
    background-color: var(--panel-contrast);
    background-image: linear-gradient(rgb(0 0 0 / 3%), rgb(0 0 0 / 3%));
  }

  :global(.dark) .event-panel-delete-icon-button {
    background-image: linear-gradient(rgb(0 0 0 / 30%), rgb(0 0 0 / 30%));
  }

  :global(html[data-focus-intent="keyboard"]) .panel-root :global(.section-header button:focus) {
    position: relative;
    z-index: 1;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--ring);
  }

  :global(html[data-focus-intent="keyboard"]) .panel-root :global(.panel-footer-actions button:focus) {
    position: relative;
    z-index: 1;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--ring);
  }

  :global(html[data-focus-intent="keyboard"]) .panel-root :global([data-panel-roving="metadata"]:focus),
  :global(html[data-focus-intent="keyboard"]) .panel-root :global([data-panel-roving="scope"]:focus) {
    position: relative;
    z-index: 1;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--ring);
  }

  /* Kill all interactivity below the drag-handle bar when readOnly */
  .panel-root[data-readonly] :global(button:not(.panel-chrome):not(.readonly-interactive)),
  .panel-root[data-readonly] :global(input),
  .panel-root[data-readonly] :global([contenteditable]) {
    pointer-events: none !important;
    cursor: default !important;
  }

</style>

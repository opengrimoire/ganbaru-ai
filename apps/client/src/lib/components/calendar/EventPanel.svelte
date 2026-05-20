<script lang="ts">
  import type {
    CalendarEvent, EventColor, EventStatus, EventSurfaceStatus, EventTransparency, EventVisibility,
    EventAttendee, EventOrganizer, GeoCoordinates, GuestPermissions, AttendeeStatus,
    PomodoroConfig, RecurrenceConfig, RecurringScope,
  } from "./types";
  import MiniDatePicker from "./MiniDatePicker.svelte";
  import TimePicker from "./TimePicker.svelte";
  import ColorPicker from "./ColorPicker.svelte";
  import MeetingSection from "./MeetingSection.svelte";
  import PomodoroSection from "./PomodoroSection.svelte";
  import NotificationsSection from "./NotificationsSection.svelte";
  import RecurrenceSection from "./RecurrenceSection.svelte";
  import { onMount, tick, untrack } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import { cn } from "$lib/utils";
  import { formatShortcut, hasOnlyShortcutModifier, hasShortcutModifier } from "$lib/keyboard-shortcuts";
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
  import Music from "@lucide/svelte/icons/music";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleSlash from "@lucide/svelte/icons/circle-slash";
  import Sun from "@lucide/svelte/icons/sun";
  import Eye from "@lucide/svelte/icons/eye";
  import Lock from "@lucide/svelte/icons/lock";


  const theme = getTheme();
  const viewport = getViewport();

  const PANEL_MAX_WIDTH = EVENT_PANEL_MAX_WIDTH;
  const PANEL_GAP = EVENT_PANEL_EDGE_MARGIN;
  const TITLE_BAR_HEIGHT = EVENT_PANEL_TITLE_BAR_HEIGHT;

  let {
    mode,
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
    skipInlineDeleteConfirm = false,
    calendarIdentityEmail,
    loadFullEvent,
    onSave,
    onDelete,
    onClose,
    onChange,
    onInitialSync,
    onScopeChange,
    onSurfaceStatusChange,
  }: {
    mode: "create" | "edit";
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
    skipInlineDeleteConfirm?: boolean;
    calendarIdentityEmail?: string;
    /**
     * Fetches the panel detail row (description, attendees, organizer, etc.)
     * for an event id. Used as a fallback when edit mode receives a slim
     * event. Normal edit opens preload details before mounting.
     */
    loadFullEvent?: (id: string) => Promise<CalendarEvent | undefined>;
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
      meetingEnabled?: boolean;
      attendees?: EventAttendee[];
      localParticipationStatus?: AttendeeStatus;
      guestPermissions?: GuestPermissions;
    }, scope?: RecurringScope) => void;
    onDelete?: (id: string, scope?: RecurringScope) => void;
    onClose: () => void;
    onChange?: (data: Partial<CalendarEvent>) => void;
    onInitialSync?: (data: Partial<CalendarEvent>) => void;
    onScopeChange?: (scope: RecurringScope) => void;
    onSurfaceStatusChange?: (status: EventSurfaceStatus | undefined) => void;
  } = $props();

  const controlsDisabled = $derived(readOnly || parked);

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

  // ─── Inline delete confirmation ────────────────────────────────
  // Two-step delete: first click arms, second click confirms. Any other
  // click inside the panel disarms (see panel-root onclick below).
  let deleteArmed = $state(false);
  let confirmDeleteBtn: HTMLButtonElement | undefined = $state();

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
    if (controlsDisabled) return;
    timePickerTarget = null;
    endDatepickerOpen = false;
    datepickerOpen = !datepickerOpen;
  }

  function toggleEndDatepicker() {
    if (controlsDisabled) return;
    timePickerTarget = null;
    datepickerOpen = false;
    endDatepickerOpen = !endDatepickerOpen;
  }

  // ─── Time picker ─────────────────────────────────────────────
  let timePickerTarget: "start" | "end" | null = $state(null);


  function openTimePicker(target: "start" | "end") {
    if (controlsDisabled) return;
    datepickerOpen = false;
    endDatepickerOpen = false;
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
      if (s === "pomodoro") { pomodoroEnabled = true; pomodoroPreset = "auto"; focusDuration = 40; shortBreak = 5; longBreak = 10; idleTimeoutEnabled = true; }
      if (s === "notifications") { notifEnabled = true; notifSelected = new Set([0]); }
      if (s === "repeat") recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
    }
    emitChange();
  }

  /** Label click: expand/collapse the details panel. */
  function handleExpand(s: Section) {
    if (controlsDisabled) return;
    // Auto-activate repeat when expanding for the first time
    if (s === "repeat" && !recurrence && openSection !== s) {
      recurrence = { frequency: "daily", interval: 1, end: { type: "never" } };
      emitChange();
    }
    // Auto-activate meeting when expanding from a disabled state
    if (s === "meeting" && !meetingEnabled && openSection !== s) {
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
  let panelHeight = $state(0);
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
  let initialized = $state(false);
  let fullEvent = $state<CalendarEvent | null>(null);
  let saving = $state(false);
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
    const key = parked
      ? `parked:${mode}:${mode === "edit" ? (event?.id ?? "") : `${start ?? ""}:${end ?? ""}:${initialAllDay ? 1 : 0}`}`
      : mode === "edit" ? (event?.id ?? "") : `create:${start ?? ""}:${end ?? ""}:${initialAllDay ? 1 : 0}`;
    if (key === lastInitKey) return;
    lastInitKey = key;
    resetExitAnimation();
    saving = false;
    deleteArmed = false;
    initialized = false;

    if (mode === "edit" && event) {
      title = event.title;
      startDate = event.start.split(" ")[0] ?? "";
      startTime = event.start.split(" ")[1] ?? "";
      endDate = event.end.split(" ")[0] ?? "";
      endTime = event.end.split(" ")[1] ?? "";
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
  });

  // Heavy-field init: runs once per fullEvent arrival. The setInitialChanges
  // pattern merges these keys into both `changes` and `baseline` on the
  // session, so a subsequent emitChange that re-emits the same heavy values
  // does not flip dirty. Since the heavy sections are gated on `fullEvent`,
  // the user cannot have edited any of them before this runs, so overwriting
  // their state is safe.
  let lastHeavyAppliedKey = "";
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

  // Sync date/time from event prop when block is dragged/resized externally.
  // Only updates time fields, not title/description/etc. which the user may
  // have edited in the panel. The session's diff-based dirty tracking handles
  // revert-to-original automatically.
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
    const layout = panelLayout;
    const width = panelWidth;
    const vw = viewport.width;
    const vh = viewport.height;
    if (!panelCanDrag) {
      dragOffset = { x: 0, y: 0 };
      pinnedBottom = 0;
      userDragged = false;
      return;
    }
    if (userDragged) return;
    const ph = untrack(() => panelHeight) || 520;
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
  });

  // ─── Dirty tracking ────────────────────────────────────────────
  // Save is always available in create mode (even with default values).
  // In edit mode it tracks the session's diff-based dirty flag so that
  // reverting all edits back to the original values disables the button
  // again, matching the click-outside cancellation behavior.
  const saveReady = $derived(mode === "create" || externalDirty);

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
        idleTimeoutMinutes: idleTimeoutEnabled ? IDLE_TIMEOUT_DEFAULT : null,
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
    const availableHeight = Math.max(
      96,
      getEventPanelUsableHeight(vh, TITLE_BAR_HEIGHT, PANEL_GAP),
    );
    const layout = panelLayout;
    const ph = panelHeight || 520;
    const visibleHeight = Math.min(ph, availableHeight);

    if (layout === "fullscreen") {
      return `position:fixed; left:${PANEL_GAP}px; right:${PANEL_GAP}px; top:${minTop}px; bottom:${PANEL_GAP}px; z-index:50;`;
    }

    if (layout === "bottom") {
      const maxHeight = Math.min(560, availableHeight);
      return `position:fixed; left:${PANEL_GAP}px; right:${PANEL_GAP}px; bottom:${PANEL_GAP}px; max-height:${Math.round(maxHeight)}px; z-index:50;`;
    }

    const left = clampFloatingLeft(baseLeft + dragOffset.x, vw, width);
    const rawTop = Math.max(minTop, baseTop + dragOffset.y);

    if (pinnedBottom > 0) {
      // Section expanding: use CSS bottom to pin the bottom edge perfectly.
      // The browser keeps it fixed frame-by-frame without JS timing issues.
      const dragDelta = dragOffset.y - pinnedDragY;
      const bottomCss = Math.max(PANEL_GAP, Math.round(vh - pinnedBottom - dragDelta));
      const maxH = Math.max(96, Math.round(pinnedBottom + dragDelta - minTop));
      return `position:fixed; left:${Math.round(left)}px; bottom:${bottomCss}px; max-height:${maxH}px; width:${Math.round(width)}px; z-index:50;`;
    }

    // Normal: pin top, nudge up if overflowing bottom
    let top = rawTop;
    const overflow = top + visibleHeight + PANEL_GAP - vh;
    if (overflow > 0) {
      top = Math.max(minTop, top - overflow);
    }

    return `position:fixed; left:${Math.round(left)}px; top:${Math.round(top)}px; width:${Math.round(width)}px; max-height:${Math.round(availableHeight)}px; z-index:50;`;
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

  function handleSave() {
    if (parked) return;
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
  function handleDeleteClick() {
    if (!parked && event && onDelete) onDelete(event.id, isRecurring ? scope : undefined);
  }

  function armOrConfirmDelete() {
    if (mode !== "edit" || !event || !onDelete) return;
    // For deletes that would stop the active pomodoro session, skip the
    // inline arm step and go straight to delete. The parent will show a
    // modal that acts as the confirmation.
    if (skipInlineDeleteConfirm) {
      deleteArmed = false;
      handleDeleteClick();
      return;
    }
    if (deleteArmed) {
      deleteArmed = false;
      handleDeleteClick();
    } else {
      deleteArmed = true;
    }
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

  /**
   * Local keydown handler for input/textarea elements. Stops propagation so
   * keys like Mod+Z (undo text) don't leak into CalendarView's global
   * shortcut handler, while explicitly letting the panel's own shortcuts
   * (Mod+Enter save, Mod+D delete, Escape close) bubble up to the
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
      "flex min-w-0 max-w-full items-center justify-center gap-1 rounded-none px-2 py-2",
      "text-foreground",
      extra,
    );
  }

  function toggleTransparency() {
    if (controlsDisabled) return;
    datepickerOpen = false;
    endDatepickerOpen = false;
    timePickerTarget = null;
    transparency = transparency === "transparent" ? "opaque" : "transparent";
    emitChange();
  }

  function toggleVisibility() {
    if (controlsDisabled) return;
    datepickerOpen = false;
    endDatepickerOpen = false;
    timePickerTarget = null;
    visibility = visibility === "public" ? "private" : "public";
    emitChange();
  }

  function handleScopeClick(s: RecurringScope) { scope = s; onScopeChange?.(s); }

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
      // Mod + Enter: save. Chosen over plain Enter so typing newlines
      // in the description textarea still works.
      if (e.key === "Enter" && hasShortcutModifier(e)) {
        e.preventDefault();
        handleSave();
        return;
      }
      // Mod + D: arm delete; press again to confirm. If the target is
      // the active pomodoro block, the first press goes straight to the
      // modal (see armOrConfirmDelete).
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
  style="box-shadow: 0 0 2px 0px var(--panel-edge), 0 1px 2px var(--panel-shadow); {parked ? parkedPanelStyle : panelStyle} background-color: var(--panel-bg); visibility: {initialized && !parked ? 'visible' : 'hidden'};"
  onclick={handlePanelClick}
>
  <!-- Drag handle bar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class={cn(
      "sticky top-0 z-10 flex items-center pl-3.5 pr-1.5",
      panelCanDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default",
    )}
    style="background-color: var(--sidebar);"
    onpointerdown={handleDragStart}
    onpointermove={handleDragMove}
    onpointerup={handleDragEnd}
  >
    <div class="flex flex-1 items-center justify-center py-2.5">
      <div class="h-[1.5px] w-8 bg-muted-foreground/50"></div>
    </div>
  </div>

  <div class="event-panel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
  <!-- Main editor: title + date -->
  <div class="shrink-0 flex flex-col gap-2.5 px-3.5 pt-2.5">

    <!-- Scope selector (recurring events only) -->
    {#if isRecurring}
      <div class="flex min-w-0 rounded-none p-0.5" style="background-color: var(--panel-contrast);">
        {#each [["this", "Only this"], ["following", "Following"], ["all", "All"]] as [val, lbl]}
          <button
            onclick={() => handleScopeClick(val as RecurringScope)}
            disabled={controlsDisabled}
            class="flex-1 rounded px-2 py-1 text-[0.666667rem] font-medium
              {scope === val
                ? 'bg-action-confirm text-action-confirm-foreground shadow-sm'
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
          disabled={controlsDisabled}
          class="w-full bg-transparent py-0.5 text-[0.933333rem] font-semibold text-foreground outline-none placeholder:text-event-panel-placeholder"
          oninput={emitChange}
          onkeydown={inputKeydown}
        />
      </div>
      {#if !controlsDisabled}
        <ColorPicker {color} theme={theme.current} onselect={(c) => { color = c; emitChange(); }} />
      {/if}
    </div>
    <hr class="border-event-panel-divider -mt-2 mx-1" />

    <!-- Date + time -->
    <div
      class="date-time-grid relative -mt-1 px-1 text-[0.8rem]"
      data-stacked={stackedDateTime || undefined}
    >
      <!-- Start date -->
      <div class="relative z-1 min-w-0 justify-self-start">
        <button onclick={toggleDatepicker}
          class="date-chip max-w-full rounded py-1 text-event-panel-input-text
            {controlsDisabled ? '' : datepickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}">
          {shortDate}
        </button>

        <!-- Floating start date picker -->
        {#if datepickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-19" onclick={() => { datepickerOpen = false; }}></div>
          <div class="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
            <MiniDatePicker selectedDate={startDate} onselect={selectDpDay} />
          </div>
        {/if}
      </div>

      <!-- Time group, visually hidden when all-day so the date grid keeps its shape. -->
      <div
        class="time-group relative z-2 flex items-center justify-center gap-1 py-1"
        class:invisible={allDay}
        class:pointer-events-none={allDay}
        aria-hidden={allDay}
      >
        <input type="text" bind:value={startTime}
          oninput={emitChange}
          onclick={() => openTimePicker("start")}
          disabled={controlsDisabled || allDay}
          maxlength={5} placeholder="HH:MM"
          class="w-10.5 rounded bg-transparent px-0.5 py-0.5 text-center text-[0.8rem] outline-none text-event-panel-input-text
            {controlsDisabled ? '' : timePickerTarget === 'start' ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          onkeydown={inputKeydown} />
        <span class="text-muted-foreground/60">-</span>
        <input type="text" bind:value={endTime}
          oninput={emitChange}
          onclick={() => openTimePicker("end")}
          disabled={controlsDisabled || allDay}
          maxlength={5} placeholder="HH:MM"
          class="w-10.5 rounded bg-transparent px-0.5 py-0.5 text-center text-[0.8rem] outline-none text-event-panel-input-text
            {controlsDisabled ? '' : timePickerTarget === 'end' ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}"
          onkeydown={inputKeydown} />

        <!-- Floating time picker -->
        {#if timePickerTarget}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-19" onclick={() => { timePickerTarget = null; }}></div>
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

      <!-- End date -->
      <div class="relative z-1 min-w-0 justify-self-end text-right">
        <button onclick={toggleEndDatepicker}
          class="date-chip max-w-full rounded py-1 text-event-panel-input-text
            {controlsDisabled ? '' : endDatepickerOpen ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}">
          {shortEndDate}
        </button>

        <!-- Floating end date picker -->
        {#if endDatepickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-19" onclick={() => { endDatepickerOpen = false; }}></div>
          <div class="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60">
            <MiniDatePicker selectedDate={endDate} minDate={startDate} onselect={selectEdpDay} />
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Metadata strip -->
  <div class="flex flex-col gap-3 px-3.5 pb-0 pt-1.5">

    <!-- All-day / Availability / Visibility -->
    <div
      class="-mt-1 flex w-full items-center justify-evenly rounded-none px-0.5 text-[0.666667rem] leading-none"
      style="background-color: var(--panel-contrast);"
    >
      <!-- All day -->
      <button
        onclick={() => {
          timePickerTarget = null;
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
        disabled={controlsDisabled}
        class={cn(
          "flex min-w-0 max-w-full items-center justify-center gap-1 rounded-none px-2 py-2",
          allDay
            ? "text-foreground"
            : "text-muted-foreground/40",
        )}
      >
        <Sun size={12} class="shrink-0" />
        <span class="truncate">All day</span>
      </button>

      <!-- Show as -->
      <button
        onclick={toggleTransparency}
        disabled={controlsDisabled}
        class={metadataButtonClass()}
        title="Show as"
      >
        {#if transparency === "transparent"}
          <CircleCheck size={12} class="shrink-0" />
        {:else}
          <CircleSlash size={12} class="shrink-0" />
        {/if}
        <span class="truncate">{transparency === "transparent" ? "Free" : "Busy"}</span>
      </button>

      {#if showHeavySections}
        <button
          onclick={toggleVisibility}
          disabled={controlsDisabled}
          class={metadataButtonClass("capitalize")}
          title="Visibility"
        >
          {#if visibility === "public"}
            <Eye size={12} class="shrink-0" />
          {:else}
            <Lock size={12} class="shrink-0" />
          {/if}
          <span class="truncate">{visibility}</span>
        </button>
      {/if}
    </div>

  </div>

  <!-- Feature sections -->
  <div class="shrink-0 flex flex-col gap-1.5 px-3.5 py-1.5">

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
        <div class="flex items-stretch">
          <button class="flex w-9 shrink-0 items-center justify-center text-muted-foreground/50">
            <Music size={13} />
          </button>
          <button onclick={() => handleExpand("music")}
            disabled={controlsDisabled}
            class="flex flex-1 items-center px-2.5 py-2 text-left">
            <span class="translate-y-[1.13px] text-[0.733333rem] text-muted-foreground">Music</span>
          </button>
        </div>
        {#if openSection === "music"}
          <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="music" class="px-3 py-3 text-center text-[0.8rem] text-muted-foreground/60" style="background-color: var(--panel-bg);">Coming soon</div>
        {/if}
      </div>
  </div>
  </div>

  <!-- Save (pinned outside scroll) -->
  <div
    class={cn(
      "shrink-0 px-3.5",
      panelLayout === "fullscreen" ? "pb-2 pt-1" : "pb-3.5 pt-1.5",
    )}
    style="background-color: var(--panel-bg);"
  >
    {#if readOnly}
      <div class="flex w-full items-center justify-center rounded-none py-1.5 text-[0.733333rem] text-muted-foreground/60"
        style="background-color: var(--panel-contrast);">
        Read-only
      </div>
    {:else}
      <div class="flex">
        {#if deleteArmed && mode === "edit" && onDelete && event}
          <button
            bind:this={confirmDeleteBtn}
            onclick={() => { deleteArmed = false; handleDeleteClick(); }}
            disabled={controlsDisabled}
            class="flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[0.8rem] text-action-danger-armed-foreground bg-action-danger-armed">
            <Trash2 size={13} strokeWidth={1.8} />
            <span>Click again to delete ({formatShortcut("Mod + D")})</span>
          </button>
        {:else}
          {#if mode === "edit" && onDelete && event}
            <button onclick={armOrConfirmDelete}
              disabled={controlsDisabled}
              class="flex w-9 shrink-0 items-center justify-center bg-black/6 dark:bg-black/30 text-foreground hover:text-destructive"
              title={`Delete (${formatShortcut("Mod + D")})`}>
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          {/if}
          <button onclick={handleSave}
            disabled={controlsDisabled}
            class="flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[0.8rem]
              {saving || saveReady
                ? 'bg-action-confirm text-action-confirm-foreground hover:opacity-90'
                : 'text-muted-foreground cursor-not-allowed'}"
            style="background-color: {saving || saveReady ? '' : 'var(--panel-contrast)'};">
            {#if saving}
              <CircleCheck size={13} />
              <span>Saved</span>
            {:else}
              <span>Save ({formatShortcut("Mod + Enter")})</span>
            {/if}
          </button>
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
  }

  .event-panel-scroll {
    scrollbar-width: thin;
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

import type { CalendarEvent, EventColor, PomodoroConfig, RecurrenceConfig, RecurringScope } from "./types";

export type PanelAnchor = { x: number; y: number; width: number; height: number };

export type EditSessionState =
  | { mode: "closed" }
  | { mode: "create"; start: string; end: string; anchor: PanelAnchor }
  | {
      mode: "edit";
      originalEvent: CalendarEvent;
      instanceEvent: CalendarEvent;
      templateId: string;
      anchor: PanelAnchor;
    };

export interface CreatePreview {
  dateStr: string;
  startMinute: number;
  endMinute: number;
  title?: string;
  color?: EventColor;
  recurrence?: RecurrenceConfig;
  allDay?: boolean;
  endDateStr?: string;
}

export function createEditSession() {
  let state = $state<EditSessionState>({ mode: "closed" });
  let changes = $state<Partial<CalendarEvent>>({});
  let scope = $state<RecurringScope>("this");
  let dirty = $state(false);
  let createPreview = $state<CreatePreview | null>(null);

  return {
    get state() { return state; },
    get changes() { return changes; },
    get scope() { return scope; },
    get dirty() { return dirty; },
    get createPreview() { return createPreview; },

    openEdit(
      event: CalendarEvent,
      anchor: PanelAnchor,
      instanceEvent?: CalendarEvent,
    ) {
      const templateId = event.recurringParentId ?? event.id;
      state = {
        mode: "edit",
        originalEvent: { ...event },
        instanceEvent: instanceEvent ? { ...instanceEvent } : { ...event },
        templateId,
        anchor,
      };
      changes = {};
      scope = "this";
      dirty = false;
      createPreview = null;
    },

    openCreate(start: string, end: string, anchor: PanelAnchor, allDay?: boolean) {
      state = { mode: "create", start, end, anchor };
      const defaultPomodoro: PomodoroConfig = {
        focusDurationMinutes: 40,
        shortBreakMinutes: 5,
        longBreakMinutes: 10,
        pomodoroCount: 4,
        idleTimeoutMinutes: 1,
      };
      changes = allDay
        ? { allDay: true }
        : { pomodoroConfig: defaultPomodoro };
      scope = "this";
      dirty = false;

      const dateStr = start.split(" ")[0];
      const endDateStr = end.split(" ")[0];
      const [sh, sm] = (start.split(" ")[1] ?? "0:0").split(":").map(Number);
      const [eh, em] = (end.split(" ")[1] ?? "0:0").split(":").map(Number);
      createPreview = {
        dateStr,
        startMinute: sh * 60 + sm,
        endMinute: eh * 60 + em,
        allDay,
        endDateStr: allDay ? endDateStr : undefined,
      };
    },

    updateChanges(data: Partial<CalendarEvent>) {
      changes = { ...changes, ...data };
      dirty = true;

      // Keep createPreview in sync when in create mode
      if (state.mode === "create" && createPreview) {
        const updated = { ...createPreview };
        if (data.title !== undefined) updated.title = data.title;
        if (data.color !== undefined) updated.color = data.color;
        if (data.recurrence !== undefined) updated.recurrence = data.recurrence;
        if (data.start) {
          const dateStr = data.start.split(" ")[0];
          const [sh, sm] = (data.start.split(" ")[1] ?? "0:0").split(":").map(Number);
          updated.dateStr = dateStr;
          updated.startMinute = sh * 60 + sm;
        }
        if (data.end) {
          const [eh, em] = (data.end.split(" ")[1] ?? "0:0").split(":").map(Number);
          updated.endMinute = eh * 60 + em;
        }
        createPreview = updated;
      }

      // Keep create-mode state start/end in sync for panel (only when changed,
      // to avoid reassigning state and triggering anchor effect reset)
      if (state.mode === "create" && (data.start || data.end)) {
        state = {
          ...state,
          start: data.start ? String(data.start) : state.start,
          end: data.end ? String(data.end) : state.end,
        };
      }
    },

    updateScope(newScope: RecurringScope) {
      scope = newScope;
    },

    close() {
      state = { mode: "closed" };
      changes = {};
      scope = "this";
      dirty = false;
      createPreview = null;
    },
  };
}

export type EditSession = ReturnType<typeof createEditSession>;

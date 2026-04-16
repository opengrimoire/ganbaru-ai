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

/**
 * Deep-equal comparison for a single field of a CalendarEvent patch.
 * Treats missing and explicit undefined as equivalent.
 */
export function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null && b === null) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Returns true if `changes` represents any meaningful deviation from `baseline`.
 * Uses merge semantics: the "final" event is `{ ...baseline, ...changes }`,
 * so a field absent from `changes` takes the baseline value and never
 * counts as dirty. Only keys actually present in `changes` are compared,
 * which makes partial patches (e.g. a drag that emits only `start`/`end`)
 * behave correctly without requiring the panel's initial sync to have
 * already populated the baseline.
 */
export function isDirtyDiff(
  changes: Partial<CalendarEvent>,
  baseline: Partial<CalendarEvent>,
): boolean {
  for (const key of Object.keys(changes)) {
    const a = (changes as Record<string, unknown>)[key];
    const b = (baseline as Record<string, unknown>)[key];
    if (!fieldEqual(a, b)) return true;
  }
  return false;
}

export function createEditSession() {
  let state = $state<EditSessionState>({ mode: "closed" });
  let changes = $state<Partial<CalendarEvent>>({});
  let baseline = $state<Partial<CalendarEvent>>({});
  let scope = $state<RecurringScope>("this");
  let createPreview = $state<CreatePreview | null>(null);

  const dirty = $derived(isDirtyDiff(changes, baseline));

  function applyChanges(data: Partial<CalendarEvent>) {
    changes = { ...changes, ...data };

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
  }

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
      baseline = {};
      scope = "this";
      createPreview = null;
    },

    openCreate(start: string, end: string, anchor: PanelAnchor, allDay?: boolean) {
      state = { mode: "create", start, end, anchor };
      scope = "this";

      // Seed changes and baseline with the same default shape so the preview
      // can render the pomodoro badge (and all-day styling) on the first
      // frame. Mirroring the seed into baseline keeps the session clean:
      // the panel's initial sync will merge more fields into both sides on
      // mount without flipping dirty.
      const defaultPomodoro: PomodoroConfig = {
        focusDurationMinutes: 40,
        shortBreakMinutes: 5,
        longBreakMinutes: 10,
        pomodoroCount: 4,
        idleTimeoutMinutes: 1,
      };
      const initial: Partial<CalendarEvent> = allDay
        ? { allDay: true }
        : { pomodoroConfig: defaultPomodoro };
      changes = { ...initial };
      baseline = { ...initial };

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
      applyChanges(data);
    },

    /**
     * Sync panel-initial field values into both `changes` and `baseline`.
     * Because both sides receive the same shape, dirty stays false until the
     * user edits a field to a value that differs. If the user later reverts a
     * change to its baseline value, dirty flips back to false and the panel
     * can be closed silently (no "Discard unsaved changes?" prompt).
     *
     * Called by the panel on mount for both create mode (captures the default
     * field values) and edit mode (captures the event's current field values).
     * If any drag/resize already populated `changes` before the sync fires,
     * the sync preserves those values: the drag's start/end are propagated
     * into the baseline too if they weren't already supplied, so a drag
     * followed by a revert-drag still reaches a clean state.
     */
    setInitialChanges(data: Partial<CalendarEvent>) {
      applyChanges(data);
      // Merge into baseline. Existing baseline fields from this call win over
      // pre-existing ones so the panel's initial view is the canonical
      // baseline; any field that had already been patched by a pre-mount drag
      // stays in `changes` but also becomes part of the baseline via the
      // matching key that the panel just emitted (drag-adjusted start/end).
      baseline = { ...baseline, ...data };
    },

    updateScope(newScope: RecurringScope) {
      scope = newScope;
    },

    close() {
      state = { mode: "closed" };
      changes = {};
      baseline = {};
      scope = "this";
      createPreview = null;
    },
  };
}

export type EditSession = ReturnType<typeof createEditSession>;

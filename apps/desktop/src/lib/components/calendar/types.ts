export type CalendarViewMode = "week" | "day" | "month";

export type EventColor =
  | "blue"
  | "teal"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "pink"
  | "gray";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RecurrenceEnd =
  | { type: "never" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

export interface RecurrenceConfig {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays?: Weekday[];
  end: RecurrenceEnd;
}

export type RecurrencePreset =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "yearly";

export type RecurringScope = "this" | "following" | "all";

export interface PomodoroConfig {
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodoroCount: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // "YYYY-MM-DD HH:MM"
  end: string; // "YYYY-MM-DD HH:MM"
  timezone: string;
  calendarId: string;
  color?: EventColor;
  description?: string;
  recurrence?: RecurrenceConfig;
  /** Array of notification times in minutes before the event start. */
  notifications?: number[];
  pomodoroConfig?: PomodoroConfig;
  /** Dates excluded from recurrence expansion (YYYY-MM-DD). */
  exceptions?: string[];
  /** Set on virtual recurring instances; points to the DB-backed template event. */
  recurringParentId?: string;
}

export interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number; // percentage 0-100
  width: number; // percentage 0-100
  column: number;
  totalColumns: number;
  isClippedTop?: boolean; // event continues from previous day
  isClippedBottom?: boolean; // event continues into next day
}

export interface DragState {
  eventId: string;
  type: "move" | "resize-top" | "resize-bottom";
  originDate: string; // event's original start date "YYYY-MM-DD"
  startColumnDate: string; // column date where drag started "YYYY-MM-DD"
  originStartMinute: number;
  originEndMinute: number; // offset from originDate midnight, can be >1440
  pointerStartY: number;
  pointerStartX: number;
  columnWidth: number;
  startColumnIndex: number;
}

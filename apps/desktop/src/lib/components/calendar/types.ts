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

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // "YYYY-MM-DD HH:MM"
  end: string; // "YYYY-MM-DD HH:MM"
  color?: EventColor;
  focusDurationMinutes?: number;
  shortBreakMinutes?: number;
  longBreakMinutes?: number;
  pomodoroCount?: number;
}

export interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number; // percentage 0-100
  width: number; // percentage 0-100
  column: number;
  totalColumns: number;
}

export interface DragState {
  eventId: string;
  type: "move" | "resize-top" | "resize-bottom";
  originDate: string;
  originStartMinute: number;
  originEndMinute: number;
  pointerStartY: number;
  pointerStartX: number;
  columnWidth: number;
  startColumnIndex: number;
}

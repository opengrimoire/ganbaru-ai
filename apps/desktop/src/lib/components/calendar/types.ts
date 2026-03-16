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

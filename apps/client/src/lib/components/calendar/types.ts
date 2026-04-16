export type CalendarViewMode = "week" | "day" | "month";

export type EventColor =
  | "ruby"
  | "coral"
  | "tangerine"
  | "amber"
  | "honey"
  | "lime"
  | "emerald"
  | "jade"
  | "teal"
  | "cyan"
  | "sky"
  | "azure"
  | "indigo"
  | "violet"
  | "purple"
  | "orchid"
  | "rose"
  | "blush"
  | "slate"
  | "sage";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RecurrenceEnd =
  | { type: "never" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

export interface OrdinalWeekday {
  day: Weekday;
  /** e.g. 2 = "2nd", -1 = "last". Omit for simple weekday membership. */
  ordinal?: number;
}

export interface RecurrenceConfig {
  frequency: RecurrenceFrequency;
  interval: number;
  /** Simple BYDAY weekdays for weekly recurrence (backward compat). */
  weekdays?: Weekday[];
  /** BYDAY with ordinal prefixes (2TU, -1FR) for monthly/yearly. */
  ordinalWeekdays?: OrdinalWeekday[];
  /** BYMONTHDAY: day-of-month numbers (1-31, negative for end-of-month). */
  byMonthDay?: number[];
  /** BYMONTH: month numbers (1-12). */
  byMonth?: number[];
  /** BYSETPOS: position indices into the expanded candidate set. */
  bySetPos?: number[];
  /** BYYEARDAY: day-of-year numbers (1-366). */
  byYearDay?: number[];
  /** BYWEEKNO: ISO week numbers (1-53). */
  byWeekNo?: number[];
  /** WKST: which day starts the week (default MO per RFC 5545). */
  wkst?: Weekday;
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
  /** Minutes of idle (no mouse/keyboard) before auto-pausing. null = disabled. */
  idleTimeoutMinutes: number | null;
}

export type EventTransparency = "opaque" | "transparent";
export type EventStatus = "confirmed" | "tentative" | "cancelled";
export type EventVisibility = "public" | "private" | "confidential";

// Attendee types (RFC 5545 ATTENDEE/ORGANIZER)

export type AttendeeRole = "chair" | "req-participant" | "opt-participant" | "non-participant";
export type AttendeeStatus = "needs-action" | "accepted" | "declined" | "tentative" | "delegated";

export interface EventAttendee {
  id: string;
  name?: string;
  email: string;
  role: AttendeeRole;
  status: AttendeeStatus;
  rsvp: boolean;
}

export interface EventOrganizer {
  name?: string;
  email: string;
}

// Alarm types (RFC 5545 VALARM)

export type AlarmAction = "display" | "audio" | "email";

export interface EventAlarm {
  id: string;
  action: AlarmAction;
  triggerType: "relative" | "absolute";
  /** Duration string for relative ("-PT15M") or ISO datetime for absolute. */
  triggerValue: string;
  description?: string;
}

// Geo coordinates (RFC 5545 GEO)

export interface GeoCoordinates {
  lat: number;
  lng: number;
}

// Per-instance override (RFC 5545 RECURRENCE-ID)

export interface EventOverride {
  id: string;
  parentEventId: string;
  /** Original DTSTART of the overridden instance (ISO datetime). */
  recurrenceId: string;
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  url?: string;
  color?: EventColor;
  status?: EventStatus;
  transparency?: EventTransparency;
  visibility?: EventVisibility;
  extendedProperties?: Record<string, string>;
}

// Guest permissions (Google Calendar X-properties)

export interface GuestPermissions {
  /** Whether guests can modify the event (X-GOOGLE-GUEST-CAN-MODIFY). */
  canModify: boolean;
  /** Whether guests can invite others (X-GOOGLE-GUEST-CAN-INVITE-OTHERS). */
  canInviteOthers: boolean;
  /** Whether guests can see the attendee list (X-GOOGLE-GUEST-CAN-SEE-OTHER-GUESTS). */
  canSeeOtherGuests: boolean;
}

// Main event interface

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
  allDay?: boolean;
  location?: string;
  url?: string;
  transparency?: EventTransparency;
  status?: EventStatus;
  /** Original UID from imported .ics file, used for deduplication. */
  sourceUid?: string;
  /** RFC 5545 CLASS: controls visibility to other users. */
  visibility?: EventVisibility;
  /** RFC 5545 PRIORITY: 0 (undefined) to 9 (lowest). 1 = highest. */
  priority?: number;
  /** RFC 5545 CATEGORIES: tags/labels for the event. */
  categories?: string[];
  /** RFC 5545 GEO: latitude and longitude. */
  geo?: GeoCoordinates;
  /** RFC 5545 SEQUENCE: revision counter for change tracking. */
  sequence?: number;
  /** RFC 5545 RDATE: additional recurrence dates beyond the RRULE pattern. */
  rdate?: string[];
  /** Arbitrary extended properties (X-* from iCalendar). */
  extendedProperties?: Record<string, string>;
  /** RFC 5545 ORGANIZER: who created/owns the event. */
  organizer?: EventOrganizer;
  /** RFC 5545 ATTENDEE: participants and their RSVP status. */
  attendees?: EventAttendee[];
  /** RFC 5545 VALARM: rich alarm definitions (from imports). */
  alarms?: EventAlarm[];
  /** Per-instance overrides for recurring events (RECURRENCE-ID). */
  overrides?: EventOverride[];
  /** Guest permission flags (Google Calendar X-properties). */
  guestPermissions?: GuestPermissions;
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  source: string;
  visible: boolean;
  readOnly: boolean;
  sourceUrl?: string;
  lastSynced?: string;
}

export interface PositionedAllDayEvent {
  event: CalendarEvent;
  row: number;
  startCol: number;
  spanCols: number;
}

export interface AllDayDragState {
  eventId: string;
  type: "move" | "resize-start" | "resize-end";
  originStartCol: number;
  originSpanCols: number;
  originRow: number;
  pointerStartX: number;
  pointerStartY: number;
  columnBounds: DOMRect[];
}

export interface PositionedEvent {
  event: CalendarEvent;
  startMinute: number; // minutes since midnight
  durationMinutes: number; // length in minutes (clamped to MIN_EVENT_HEIGHT equivalent)
  left: number; // percentage 0-100
  width: number; // percentage 0-100
  column: number;
  totalColumns: number;
  isClippedTop?: boolean; // event continues from previous day
  isClippedBottom?: boolean; // event continues into next day
  hasEventBelow?: boolean; // another event starts right when this one ends
}

// Pomodoro segment types

export type SegmentPhase = "focus" | "short_break" | "long_break";

export type SegmentStatus = "planned" | "active" | "completed" | "skipped" | "interrupted";

export interface PlannedSegment {
  cycleNumber: number;
  phase: SegmentPhase;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
}

export interface AccentBarBand {
  topFraction: number;
  heightFraction: number;
  phase: SegmentPhase;
  status?: SegmentStatus;
}

export type PauseInterval = [string, string | null]; // [pauseStartIso, resumeIso | null]

export interface PersistedSegment {
  id: string;
  eventId: string;
  eventDate: string;
  runId: string;
  cycleNumber: number;
  phase: SegmentPhase;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  pauseLog: PauseInterval[];
  status: SegmentStatus;
}

export interface TimelineBand {
  topMinute: number; // minute-of-day (0-1440)
  heightMinutes: number; // duration in minutes
  phase: SegmentPhase;
  status: SegmentStatus;
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
  scrollTopAtStart: number; // scroll container scrollTop when drag began
  columnWidth: number;
  startColumnIndex: number;
}

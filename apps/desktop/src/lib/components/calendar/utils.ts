import type {
  CalendarEvent,
  EventColor,
  PositionedAllDayEvent,
  PositionedEvent,
} from "./types";

const MIN_EVENT_HEIGHT = 12;

// --- Date parsing and formatting ---

export function parseCalendarDate(str: string): Date {
  // "YYYY-MM-DD HH:MM" -> Date
  const [datePart, timePart] = str.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min] = (timePart ?? "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
}

export function formatCalendarDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

export function formatDatePart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// --- Week / day helpers ---

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Monday = 1, Sunday = 0 -> shift Sunday to 7
  const diff = (day === 0 ? 7 : day) - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekDays(anchorDate: Date): Date[] {
  const monday = startOfWeek(anchorDate);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function isPastDay(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

// --- Month helpers ---

export function getMonthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  const weeks: Date[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// --- Time helpers ---

export function minuteOfDay(dateStr: string): number {
  const timePart = dateStr.split(" ")[1] ?? "00:00";
  const [h, m] = timePart.split(":").map(Number);
  return h * 60 + m;
}

export function minuteToTop(minute: number, hourHeight: number): number {
  return (minute / 60) * hourHeight;
}

export function durationMinutes(start: string, end: string): number {
  const s = parseCalendarDate(start);
  const e = parseCalendarDate(end);
  return Math.max(0, (e.getTime() - s.getTime()) / 60000);
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export type DayNameFormat = "long" | "short" | "narrow" | "none";

export function formatDayName(
  date: Date,
  format: DayNameFormat,
): string {
  if (format === "none") return "";
  return date.toLocaleDateString("en-US", { weekday: format });
}

// --- Timezone helpers ---

export const GUTTER_WIDTH_PER_TZ = 46;

export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getTimezoneAbbr(tz: string, date?: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(date ?? new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

export function getHourInTimezone(
  baseDate: Date,
  hour: number,
  tz: string,
): string {
  const d = new Date(baseDate);
  d.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function getTimezoneOffset(tz: string, date?: Date): string {
  const d = date ?? new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(d);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

export function formatTimezoneName(tz: string): string {
  return tz.replace(/_/g, " ").replace(/\//g, " / ");
}

// Maps common city names, country names, and abbreviations to IANA timezone IDs.
// Only entries that aren't already discoverable via the IANA ID itself.
const TIMEZONE_ALIASES: Record<string, string[]> = {
  // Countries -> representative timezone(s)
  japan: ["Asia/Tokyo"],
  russia: ["Europe/Moscow", "Asia/Yekaterinburg", "Asia/Vladivostok", "Asia/Novosibirsk"],
  china: ["Asia/Shanghai"],
  india: ["Asia/Kolkata"],
  australia: ["Australia/Sydney", "Australia/Perth", "Australia/Adelaide"],
  brazil: ["America/Sao_Paulo", "America/Manaus"],
  canada: ["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Halifax"],
  germany: ["Europe/Berlin"],
  france: ["Europe/Paris"],
  uk: ["Europe/London"],
  "united kingdom": ["Europe/London"],
  england: ["Europe/London"],
  spain: ["Europe/Madrid"],
  italy: ["Europe/Rome"],
  netherlands: ["Europe/Amsterdam"],
  sweden: ["Europe/Stockholm"],
  norway: ["Europe/Oslo"],
  finland: ["Europe/Helsinki"],
  denmark: ["Europe/Copenhagen"],
  switzerland: ["Europe/Zurich"],
  portugal: ["Europe/Lisbon"],
  greece: ["Europe/Athens"],
  turkey: ["Europe/Istanbul"],
  egypt: ["Africa/Cairo"],
  "south africa": ["Africa/Johannesburg"],
  nigeria: ["Africa/Lagos"],
  kenya: ["Africa/Nairobi"],
  morocco: ["Africa/Casablanca"],
  israel: ["Asia/Jerusalem"],
  "south korea": ["Asia/Seoul"],
  korea: ["Asia/Seoul"],
  thailand: ["Asia/Bangkok"],
  vietnam: ["Asia/Ho_Chi_Minh"],
  philippines: ["Asia/Manila"],
  singapore: ["Asia/Singapore"],
  malaysia: ["Asia/Kuala_Lumpur"],
  indonesia: ["Asia/Jakarta"],
  pakistan: ["Asia/Karachi"],
  bangladesh: ["Asia/Dhaka"],
  "new zealand": ["Pacific/Auckland"],
  argentina: ["America/Argentina/Buenos_Aires"],
  chile: ["America/Santiago"],
  colombia: ["America/Bogota"],
  peru: ["America/Lima"],
  venezuela: ["America/Caracas"],
  cuba: ["America/Havana"],
  // Mexico cities and states
  mexico: ["America/Mexico_City", "America/Cancun", "America/Tijuana", "America/Chihuahua", "America/Monterrey"],
  monterrey: ["America/Monterrey"],
  guadalajara: ["America/Mexico_City"],
  cancun: ["America/Cancun"],
  tijuana: ["America/Tijuana"],
  chihuahua: ["America/Chihuahua"],
  merida: ["America/Merida"],
  mazatlan: ["America/Mazatlan"],
  hermosillo: ["America/Hermosillo"],
  // US cities
  "new york": ["America/New_York"],
  "los angeles": ["America/Los_Angeles"],
  chicago: ["America/Chicago"],
  denver: ["America/Denver"],
  phoenix: ["America/Phoenix"],
  houston: ["America/Chicago"],
  miami: ["America/New_York"],
  seattle: ["America/Los_Angeles"],
  "san francisco": ["America/Los_Angeles"],
  boston: ["America/New_York"],
  dallas: ["America/Chicago"],
  atlanta: ["America/New_York"],
  detroit: ["America/Detroit"],
  honolulu: ["Pacific/Honolulu"],
  anchorage: ["America/Anchorage"],
  // Other major cities
  london: ["Europe/London"],
  paris: ["Europe/Paris"],
  berlin: ["Europe/Berlin"],
  moscow: ["Europe/Moscow"],
  tokyo: ["Asia/Tokyo"],
  beijing: ["Asia/Shanghai"],
  shanghai: ["Asia/Shanghai"],
  mumbai: ["Asia/Kolkata"],
  delhi: ["Asia/Kolkata"],
  bangalore: ["Asia/Kolkata"],
  dubai: ["Asia/Dubai"],
  "hong kong": ["Asia/Hong_Kong"],
  taipei: ["Asia/Taipei"],
  seoul: ["Asia/Seoul"],
  bangkok: ["Asia/Bangkok"],
  jakarta: ["Asia/Jakarta"],
  sydney: ["Australia/Sydney"],
  melbourne: ["Australia/Melbourne"],
  auckland: ["Pacific/Auckland"],
  "buenos aires": ["America/Argentina/Buenos_Aires"],
  santiago: ["America/Santiago"],
  bogota: ["America/Bogota"],
  lima: ["America/Lima"],
  "sao paulo": ["America/Sao_Paulo"],
  rio: ["America/Sao_Paulo"],
  toronto: ["America/Toronto"],
  vancouver: ["America/Vancouver"],
  hawaii: ["Pacific/Honolulu"],
  alaska: ["America/Anchorage"],
  // Common abbreviations
  est: ["America/New_York"],
  cst: ["America/Chicago"],
  mst: ["America/Denver"],
  pst: ["America/Los_Angeles"],
  gmt: ["Europe/London"],
  utc: ["Etc/UTC"],
  cet: ["Europe/Berlin"],
  eet: ["Europe/Athens"],
  ist: ["Asia/Kolkata"],
  jst: ["Asia/Tokyo"],
  kst: ["Asia/Seoul"],
  hkt: ["Asia/Hong_Kong"],
  sgt: ["Asia/Singapore"],
  aest: ["Australia/Sydney"],
  nzst: ["Pacific/Auckland"],
};

let _ianaTimezones: string[] | null = null;

function getIanaTimezones(): string[] {
  if (_ianaTimezones) return _ianaTimezones;
  try {
    _ianaTimezones = Intl.supportedValuesOf("timeZone");
  } catch {
    _ianaTimezones = [];
  }
  return _ianaTimezones;
}

export function searchTimezones(
  query: string,
  exclude: string[],
  limit: number = 10,
): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results = new Set<string>();

  // Check aliases first (country names, city names, abbreviations)
  for (const [alias, tzIds] of Object.entries(TIMEZONE_ALIASES)) {
    if (alias.includes(q)) {
      for (const tz of tzIds) {
        if (!exclude.includes(tz)) results.add(tz);
      }
    }
  }

  // Then search IANA timezone IDs and formatted names
  const all = getIanaTimezones();
  for (const tz of all) {
    if (results.size >= limit) break;
    if (exclude.includes(tz)) continue;
    if (
      tz.toLowerCase().includes(q) ||
      formatTimezoneName(tz).toLowerCase().includes(q)
    ) {
      results.add(tz);
    }
  }

  return [...results].slice(0, limit);
}

export function snapToGrid(minute: number, gridMinutes: number = 10): number {
  return Math.round(minute / gridMinutes) * gridMinutes;
}

export function clampMinute(minute: number): number {
  return Math.max(0, Math.min(1440, minute));
}

// --- Cross-midnight helpers ---

/**
 * Returns the effective minute range for an event within a specific day.
 * For events that span midnight, this clips to [0, 1440] for the given day.
 */
export function effectiveMinuteRange(
  event: CalendarEvent,
  dateStr: string,
): { startMinute: number; endMinute: number } {
  const eventStartDate = event.start.split(" ")[0];
  const eventEndDate = event.end.split(" ")[0];

  const startMinute =
    eventStartDate < dateStr
      ? 0
      : eventStartDate === dateStr
        ? minuteOfDay(event.start)
        : 1440;

  const endMinute =
    eventEndDate > dateStr
      ? 1440
      : eventEndDate === dateStr
        ? minuteOfDay(event.end)
        : 0;

  return { startMinute, endMinute };
}

/**
 * Converts a base date string + minute offset to a full "YYYY-MM-DD HH:MM" string.
 * Handles overflow (minute > 1440 rolls to next day, negative rolls back).
 */
export function minuteOffsetToDateStr(
  baseDate: string,
  minute: number,
): string {
  const [y, m, d] = baseDate.split("-").map(Number);
  const base = new Date(y, m - 1, d, 0, 0, 0, 0);
  base.setMinutes(minute);
  return formatCalendarDate(base);
}

// --- Event filtering ---

export function eventsForDay(
  events: CalendarEvent[],
  date: Date,
): CalendarEvent[] {
  const dateStr = formatDatePart(date);
  const nextDateStr = formatDatePart(addDays(date, 1));
  const dayStart = `${dateStr} 00:00`;
  const dayEnd = `${nextDateStr} 00:00`;
  return events.filter((e) => !e.allDay && e.start < dayEnd && e.end > dayStart);
}

export function allDayEventsForDay(
  events: CalendarEvent[],
  date: Date,
): CalendarEvent[] {
  const dateStr = formatDatePart(date);
  return events.filter((e) => {
    if (!e.allDay) return false;
    const startDate = e.start.split(" ")[0];
    const endDate = e.end.split(" ")[0];
    return startDate <= dateStr && endDate >= dateStr;
  });
}

export function allDayEventsForWeek(
  events: CalendarEvent[],
  weekDays: Date[],
): CalendarEvent[] {
  if (weekDays.length === 0) return [];
  const weekStart = formatDatePart(weekDays[0]);
  const weekEnd = formatDatePart(weekDays[weekDays.length - 1]);
  return events.filter((e) => {
    if (!e.allDay) return false;
    const startDate = e.start.split(" ")[0];
    const endDate = e.end.split(" ")[0];
    return startDate <= weekEnd && endDate >= weekStart;
  });
}

export function layoutAllDayEventsForWeek(
  events: CalendarEvent[],
  weekDays: Date[],
): PositionedAllDayEvent[] {
  const allDay = allDayEventsForWeek(events, weekDays);
  if (allDay.length === 0 || weekDays.length === 0) return [];

  const weekStart = formatDatePart(weekDays[0]);
  const weekEnd = formatDatePart(weekDays[weekDays.length - 1]);
  const dayStrs = weekDays.map(formatDatePart);

  // Sort by duration descending (longer events first), then start ascending
  const sorted = [...allDay].sort((a, b) => {
    const aStart = a.start.split(" ")[0];
    const bStart = b.start.split(" ")[0];
    const aEnd = a.end.split(" ")[0];
    const bEnd = b.end.split(" ")[0];
    const aDur = dayStrs.filter((d) => d >= aStart && d <= aEnd).length;
    const bDur = dayStrs.filter((d) => d >= bStart && d <= bEnd).length;
    if (bDur !== aDur) return bDur - aDur;
    return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
  });

  // rows[row][col] = true if occupied
  const rows: boolean[][] = [];
  const result: PositionedAllDayEvent[] = [];

  for (const event of sorted) {
    const startDate = event.start.split(" ")[0];
    const endDate = event.end.split(" ")[0];
    const clippedStart = startDate < weekStart ? weekStart : startDate;
    const clippedEnd = endDate > weekEnd ? weekEnd : endDate;

    const startCol = dayStrs.indexOf(clippedStart);
    const endCol = dayStrs.indexOf(clippedEnd);
    if (startCol < 0 || endCol < 0) continue;
    const spanCols = endCol - startCol + 1;

    // Find lowest row with no overlap
    let row = 0;
    outer: while (true) {
      if (!rows[row]) rows[row] = new Array(weekDays.length).fill(false);
      for (let c = startCol; c <= endCol; c++) {
        if (rows[row][c]) { row++; continue outer; }
      }
      break;
    }

    // Mark occupied
    for (let c = startCol; c <= endCol; c++) {
      rows[row][c] = true;
    }

    result.push({ event, row, startCol, spanCols });
  }

  return result;
}

// --- Overlap layout algorithm ---

interface EventWithRange {
  event: CalendarEvent;
  startMinute: number;
  endMinute: number;
}

export function layoutEventsForDay(
  events: CalendarEvent[],
  hourHeight: number,
  dateStr?: string,
): PositionedEvent[] {
  if (events.length === 0) return [];

  // Compute effective minute ranges for each event on this date
  const items: EventWithRange[] = events.map((event) => {
    if (dateStr) {
      return { event, ...effectiveMinuteRange(event, dateStr) };
    }
    // Fallback for callers that don't pass dateStr (e.g. month view)
    return {
      event,
      startMinute: minuteOfDay(event.start),
      endMinute: minuteOfDay(event.end),
    };
  });

  // Sort by start time, then by duration descending (longer first)
  const sorted = [...items].sort((a, b) => {
    const startDiff = a.startMinute - b.startMinute;
    if (startDiff !== 0) return startDiff;
    return (
      b.endMinute - b.startMinute - (a.endMinute - a.startMinute)
    );
  });

  // Build collision groups
  const groups: EventWithRange[][] = [];
  let currentGroup: EventWithRange[] = [];
  let groupEnd = 0;

  for (const item of sorted) {
    if (currentGroup.length > 0 && item.startMinute >= groupEnd) {
      groups.push(currentGroup);
      currentGroup = [];
      groupEnd = 0;
    }

    currentGroup.push(item);
    groupEnd = Math.max(groupEnd, item.endMinute);
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Assign columns within each group
  const result: PositionedEvent[] = [];

  for (const group of groups) {
    const columns: EventWithRange[][] = [];

    for (const item of group) {
      let placed = false;

      for (let colIdx = 0; colIdx < columns.length; colIdx++) {
        const col = columns[colIdx];
        const lastInCol = col[col.length - 1];
        if (item.startMinute >= lastInCol.endMinute) {
          col.push(item);
          placed = true;
          break;
        }
      }

      if (!placed) {
        columns.push([item]);
      }
    }

    const totalColumns = columns.length;
    const RIGHT_GUTTER_PCT = 8;
    const usable = 100 - RIGHT_GUTTER_PCT;

    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      for (const item of columns[colIdx]) {
        const top = minuteToTop(item.startMinute, hourHeight);
        const dur = item.endMinute - item.startMinute;
        const rawHeight = (dur / 60) * hourHeight;
        const height = Math.max(rawHeight, MIN_EVENT_HEIGHT);
        const left = (colIdx / totalColumns) * usable;
        const width = (1 / totalColumns) * usable;

        const isClippedTop = dateStr
          ? item.startMinute === 0 &&
            item.event.start.split(" ")[0] !== dateStr
          : false;
        const isClippedBottom = dateStr
          ? item.endMinute === 1440 &&
            item.event.end.split(" ")[0] !== dateStr
          : false;

        result.push({
          event: item.event,
          top,
          height,
          left,
          width,
          column: colIdx,
          totalColumns,
          isClippedTop,
          isClippedBottom,
        });
      }
    }
  }

  return result;
}

// --- Event color palette ---

interface ColorEntry {
  bg: string;
  accent: string;
  text: string;
}

const LIGHT_TEXT = "#1c1c1e";
const DARK_TEXT = "#f0f0f2";

const LIGHT_COLORS: Record<EventColor, ColorEntry> = {
  ruby:      { bg: "#f0c2c2", accent: "#b82e2e", text: LIGHT_TEXT },
  coral:     { bg: "#f0cec2", accent: "#b8532e", text: LIGHT_TEXT },
  tangerine: { bg: "#f0d7c2", accent: "#b86e2e", text: LIGHT_TEXT },
  amber:     { bg: "#f0e0c2", accent: "#b88a2e", text: LIGHT_TEXT },
  honey:     { bg: "#f0e8c2", accent: "#b8a12e", text: LIGHT_TEXT },
  lime:      { bg: "#e4f0c2", accent: "#95b82e", text: LIGHT_TEXT },
  emerald:   { bg: "#c2f0d5", accent: "#2eb867", text: LIGHT_TEXT },
  jade:      { bg: "#c2f0e4", accent: "#2eb895", text: LIGHT_TEXT },
  teal:      { bg: "#c2f0ee", accent: "#2eb8b3", text: LIGHT_TEXT },
  cyan:      { bg: "#c2e7f0", accent: "#2e9cb8", text: LIGHT_TEXT },
  sky:       { bg: "#c2dbf0", accent: "#2e7ab8", text: LIGHT_TEXT },
  azure:     { bg: "#c2d1f0", accent: "#2e5cb8", text: LIGHT_TEXT },
  indigo:    { bg: "#c2c6f0", accent: "#2e39b8", text: LIGHT_TEXT },
  violet:    { bg: "#d0c2f0", accent: "#572eb8", text: LIGHT_TEXT },
  purple:    { bg: "#ddc2f0", accent: "#7e2eb8", text: LIGHT_TEXT },
  orchid:    { bg: "#ecc2f0", accent: "#ac2eb8", text: LIGHT_TEXT },
  rose:      { bg: "#f0c2d5", accent: "#b82e67", text: LIGHT_TEXT },
  blush:     { bg: "#f0c2c9", accent: "#b82e45", text: LIGHT_TEXT },
  slate:     { bg: "#d2d8e0", accent: "#5e6f87", text: LIGHT_TEXT },
  sage:      { bg: "#d0e1d6", accent: "#5a8c6a", text: LIGHT_TEXT },
};

const DARK_COLORS: Record<EventColor, ColorEntry> = {
  ruby:      { bg: "#6f2a2a", accent: "#c05959", text: DARK_TEXT },
  coral:     { bg: "#6f3c2a", accent: "#c07459", text: DARK_TEXT },
  tangerine: { bg: "#6f4a2a", accent: "#c08959", text: DARK_TEXT },
  amber:     { bg: "#6f582a", accent: "#c09d59", text: DARK_TEXT },
  honey:     { bg: "#6f632a", accent: "#c0af59", text: DARK_TEXT },
  lime:      { bg: "#5e6f2a", accent: "#a6c059", text: DARK_TEXT },
  emerald:   { bg: "#2a6f47", accent: "#59c084", text: DARK_TEXT },
  jade:      { bg: "#2a6f5e", accent: "#59c0a6", text: DARK_TEXT },
  teal:      { bg: "#2a6f6d", accent: "#59c0bc", text: DARK_TEXT },
  cyan:      { bg: "#2a616f", accent: "#59abc0", text: DARK_TEXT },
  sky:       { bg: "#2a506f", accent: "#5991c0", text: DARK_TEXT },
  azure:     { bg: "#2a416f", accent: "#597bc0", text: DARK_TEXT },
  indigo:    { bg: "#2a306f", accent: "#5961c0", text: DARK_TEXT },
  violet:    { bg: "#3f2a6f", accent: "#7859c0", text: DARK_TEXT },
  purple:    { bg: "#522a6f", accent: "#9559c0", text: DARK_TEXT },
  orchid:    { bg: "#692a6f", accent: "#b759c0", text: DARK_TEXT },
  rose:      { bg: "#6f2a47", accent: "#c05984", text: DARK_TEXT },
  blush:     { bg: "#6f2a36", accent: "#c0596a", text: DARK_TEXT },
  slate:     { bg: "#414b58", accent: "#7b899d", text: DARK_TEXT },
  sage:      { bg: "#3f5a48", accent: "#78a185", text: DARK_TEXT },
};

export function getEventColor(
  color: EventColor | undefined,
  isDark: boolean,
): ColorEntry {
  const key = color ?? "slate";
  return isDark ? DARK_COLORS[key] : LIGHT_COLORS[key];
}

export const EVENT_COLOR_OPTIONS: EventColor[] = [
  "ruby", "coral", "tangerine", "amber", "honey",
  "lime", "emerald", "jade", "teal", "cyan",
  "sky", "azure", "indigo", "violet", "purple",
  "orchid", "rose", "blush", "slate", "sage",
];

/**
 * Smooth-scroll wheel handler for Linux/discrete-tick environments.
 * Intercepts wheel events and lerps scrollTop toward a target position.
 */
export function createSmoothScroll(
  getEl: () => HTMLElement | undefined,
  damping = 0.6,
  ease = 0.15,
): (e: WheelEvent) => void {
  let target = -1;
  let running = false;

  function tick() {
    const el = getEl();
    if (!el) { running = false; return; }
    const diff = target - el.scrollTop;
    if (Math.abs(diff) < 0.5) { running = false; return; }
    const step = diff * ease;
    el.scrollTop += Math.abs(step) < 1 ? Math.sign(diff) : step;
    requestAnimationFrame(tick);
  }

  return (e: WheelEvent) => {
    const el = getEl();
    if (!el) return;
    e.preventDefault();
    if (target < 0 || !running) target = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    target = Math.max(0, Math.min(max, target + e.deltaY * damping));
    if (!running) { running = true; requestAnimationFrame(tick); }
  };
}


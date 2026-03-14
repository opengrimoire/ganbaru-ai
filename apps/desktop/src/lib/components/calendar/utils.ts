import type {
  CalendarEvent,
  EventColor,
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

// --- Event filtering ---

export function eventsForDay(
  events: CalendarEvent[],
  date: Date,
): CalendarEvent[] {
  const dateStr = formatDatePart(date);
  return events.filter((e) => e.start.startsWith(dateStr));
}

// --- Overlap layout algorithm ---

export function layoutEventsForDay(
  events: CalendarEvent[],
  hourHeight: number,
): PositionedEvent[] {
  if (events.length === 0) return [];

  // Sort by start time, then by duration descending (longer first)
  const sorted = [...events].sort((a, b) => {
    const startDiff = minuteOfDay(a.start) - minuteOfDay(b.start);
    if (startDiff !== 0) return startDiff;
    return durationMinutes(b.start, b.end) - durationMinutes(a.start, a.end);
  });

  // Build collision groups
  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [];
  let groupEnd = 0;

  for (const event of sorted) {
    const startMin = minuteOfDay(event.start);
    const endMin = minuteOfDay(event.end);

    if (currentGroup.length > 0 && startMin >= groupEnd) {
      groups.push(currentGroup);
      currentGroup = [];
      groupEnd = 0;
    }

    currentGroup.push(event);
    groupEnd = Math.max(groupEnd, endMin);
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Assign columns within each group
  const result: PositionedEvent[] = [];

  for (const group of groups) {
    const columns: CalendarEvent[][] = [];

    for (const event of group) {
      const eStart = minuteOfDay(event.start);
      const eEnd = minuteOfDay(event.end);
      let placed = false;

      for (let colIdx = 0; colIdx < columns.length; colIdx++) {
        const col = columns[colIdx];
        const lastInCol = col[col.length - 1];
        if (eStart >= minuteOfDay(lastInCol.end)) {
          col.push(event);
          placed = true;
          break;
        }
      }

      if (!placed) {
        columns.push([event]);
      }
    }

    const totalColumns = columns.length;

    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      for (const event of columns[colIdx]) {
        const startMin = minuteOfDay(event.start);
        const dur = durationMinutes(event.start, event.end);
        const top = minuteToTop(startMin, hourHeight);
        const rawHeight = (dur / 60) * hourHeight;
        const height = Math.max(rawHeight, MIN_EVENT_HEIGHT);
        const left = (colIdx / totalColumns) * 100;
        const width = (1 / totalColumns) * 100;

        result.push({
          event,
          top,
          height,
          left,
          width,
          column: colIdx,
          totalColumns,
        });
      }
    }
  }

  return result;
}

// --- Event color palette ---

interface ColorEntry {
  bg: string;
  border: string;
  text: string;
}

const LIGHT_COLORS: Record<EventColor, ColorEntry> = {
  blue: { bg: "#D3E3FD", border: "#4A7CC9", text: "#1A3A6B" },
  teal: { bg: "#C8F0E8", border: "#2D9D8F", text: "#14524A" },
  green: { bg: "#C8E6C9", border: "#4CAF50", text: "#1B5E20" },
  amber: { bg: "#FFE0B2", border: "#F9A825", text: "#7A4100" },
  red: { bg: "#FFCDD2", border: "#E53935", text: "#7F1D1D" },
  purple: { bg: "#E1D5F0", border: "#8E6BBF", text: "#3E1F6E" },
  pink: { bg: "#F8D0D8", border: "#D4708A", text: "#6B1D32" },
  gray: { bg: "#E0E0E0", border: "#9E9E9E", text: "#424242" },
};

const DARK_COLORS: Record<EventColor, ColorEntry> = {
  blue: { bg: "#1A3556", border: "#5B9BF5", text: "#C4DBFC" },
  teal: { bg: "#0D3D38", border: "#4DB6A9", text: "#B2DFDB" },
  green: { bg: "#1A3A1F", border: "#66BB6A", text: "#A5D6A7" },
  amber: { bg: "#3E2E10", border: "#FFB74D", text: "#FFE0B2" },
  red: { bg: "#3B1515", border: "#EF5350", text: "#FFCDD2" },
  purple: { bg: "#2A1845", border: "#AB87D8", text: "#D7C4EC" },
  pink: { bg: "#3B1525", border: "#E08AA0", text: "#F8D0D8" },
  gray: { bg: "#2A2A2C", border: "#888", text: "#CACACA" },
};

export function getEventColor(
  color: EventColor | undefined,
  isDark: boolean,
): ColorEntry {
  const key = color ?? "blue";
  return isDark ? DARK_COLORS[key] : LIGHT_COLORS[key];
}

export const EVENT_COLOR_OPTIONS: EventColor[] = [
  "blue",
  "teal",
  "green",
  "amber",
  "red",
  "purple",
  "pink",
  "gray",
];

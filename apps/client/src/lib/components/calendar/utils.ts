import type {
  CalendarEvent,
  EventColor,
  PositionedAllDayEvent,
  PositionedEvent,
} from "./types";
import { FALLBACK_COLOR_INDEX, PALETTE_SIZE } from "./types";

const MIN_EVENT_HEIGHT = 4;

// Date parsing and formatting

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

/**
 * Validate that a calendar time string is in the correct format.
 * Expected: "YYYY-MM-DD HH:MM" with integer hours (0-23) and minutes (0-59).
 */
export function isValidCalendarTime(str: string): boolean {
  if (typeof str !== "string") return false;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return false;
  const [, , month, day, hour, minute] = match.map(Number);
  return (
    month >= 1 && month <= 12 &&
    day >= 1 && day <= 31 &&
    hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59
  );
}

/**
 * Sanitize a calendar time string to ensure clean "YYYY-MM-DD HH:MM" format.
 * Handles:
 * - Floating point minutes (rounds them)
 * - Missing time part (defaults to 00:00)
 * - Out of range values (clamps them)
 * Returns null if the input is completely invalid.
 */
export function sanitizeCalendarTime(str: string): string | null {
  if (typeof str !== "string" || !str.trim()) return null;

  // Try to parse the date part
  const parts = str.trim().split(" ");
  const datePart = parts[0];
  const timePart = parts[1] ?? "00:00";

  // Validate date part format
  const dateMatch = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return null;

  // Parse time part, handling potential floats
  const timeParts = timePart.split(":");
  if (timeParts.length < 2) return null;

  let hour = parseFloat(timeParts[0]);
  let minute = parseFloat(timeParts[1]);

  // Handle NaN
  if (isNaN(hour)) hour = 0;
  if (isNaN(minute)) minute = 0;

  // Round and clamp
  hour = Math.max(0, Math.min(23, Math.round(hour)));
  minute = Math.max(0, Math.min(59, Math.round(minute)));

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");

  return `${datePart} ${hh}:${mm}`;
}

// Week / day helpers

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

// Month helpers

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

// Time helpers

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

// Timezone helpers

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
  return Math.max(0, Math.min(1440, Math.round(minute)));
}

// Cross-midnight helpers

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

// Event filtering

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

/** All events (all-day first, then timed) for a given day. Used by MonthView. */
export function allEventsForDay(
  events: CalendarEvent[],
  date: Date,
): CalendarEvent[] {
  const allDay = allDayEventsForDay(events, date).sort((a, b) => {
    const aTitle = (a.title || "").toLowerCase();
    const bTitle = (b.title || "").toLowerCase();
    if (aTitle !== bTitle) return aTitle < bTitle ? -1 : 1;
    return a.start.localeCompare(b.start);
  });
  const timed = eventsForDay(events, date).sort((a, b) => a.start.localeCompare(b.start));
  return [...allDay, ...timed];
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
  }).sort((a, b) => {
    const aTitle = (a.title || "").toLowerCase();
    const bTitle = (b.title || "").toLowerCase();
    if (aTitle !== bTitle) return aTitle < bTitle ? -1 : 1;
    return a.start.localeCompare(b.start);
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

  // Sort alphabetically by title, then by start date as tiebreaker
  const sorted = [...allDay].sort((a, b) => {
    const aTitle = (a.title || "").toLowerCase();
    const bTitle = (b.title || "").toLowerCase();
    if (aTitle !== bTitle) return aTitle < bTitle ? -1 : 1;
    return a.start.localeCompare(b.start);
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

// Overlap layout algorithm

interface EventWithRange {
  event: CalendarEvent;
  startMinute: number;
  endMinute: number;
}

/** Minimum event duration in minutes that maps to MIN_EVENT_HEIGHT at default zoom. */
const MIN_EVENT_MINUTES = (MIN_EVENT_HEIGHT / 67) * 60;

export function layoutEventsForDay(
  events: CalendarEvent[],
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

  // Build set of all start minutes for adjacency detection
  const startMinutes = new Set(sorted.map((item) => item.startMinute));

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
    const RIGHT_GUTTER_PCT = 12;
    const usable = 100 - RIGHT_GUTTER_PCT;

    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      for (const item of columns[colIdx]) {
        const dur = item.endMinute - item.startMinute;
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
          startMinute: item.startMinute,
          durationMinutes: Math.max(dur, MIN_EVENT_MINUTES),
          left,
          width,
          column: colIdx,
          totalColumns,
          isClippedTop,
          isClippedBottom,
          hasEventBelow: startMinutes.has(item.endMinute),
        });
      }
    }
  }

  return result;
}

// Event color palette
//
// Palette values live in the theme registry (see stores/themes.ts). The
// functions below take a Theme and resolve the active palette into
// {bg, text} entries, applying contrast-aware text selection and caching
// the resolved palette per theme ID so switching themes is cheap.

import type { Theme } from "$lib/stores/themes";

export interface ColorEntry {
  bg: string;
  text: string;
}

// Contrast text tokens. Light-mode events default to white, pale swatches
// flip to near-black. Dark-mode events default to near-black, very-dark
// blended variants flip to near-white.
const LIGHT_TEXT = "#ffffff";
const LIGHT_TEXT_ALT = "#1f1f1f";
const DARK_TEXT = "#131314";
const DARK_TEXT_ALT = "#e3e3e3";

// Luminance flip thresholds tuned against the 24-color built-in palette.
// Light-mode bgs brighter than LIGHT_FLIP_ABOVE cannot carry white text;
// dark-mode bgs darker than DARK_FLIP_BELOW cannot carry near-black text.
// Themes with palettes outside the tuned range may need custom thresholds;
// for now these are shared across themes of a given base.
const LIGHT_FLIP_ABOVE = 0.65;
const DARK_FLIP_BELOW = 0.35;

/**
 * Linearly blend two hex colors in sRGB space.
 *
 * @param a Base hex color.
 * @param b Reference hex color to blend toward.
 * @param weightA Fraction of `a` in the result (0..1). The rest is `b`.
 */
export function blendHex(a: string, b: string, weightA: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const wb = 1 - weightA;
  const nr = Math.round(ar * weightA + br * wb);
  const ng = Math.round(ag * weightA + bg * wb);
  const nb = Math.round(ab * weightA + bb * wb);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

/**
 * Pick a readable foreground for a given background under the given theme
 * base. Rec. 709 coefficients on raw sRGB approximate perceived luminance;
 * accurate enough for contrast picking on the current palette. Themes
 * decide which alt token to use via their `base` field.
 */
function pickContrastText(bg: string, themeBase: "light" | "dark"): string {
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (themeBase === "dark") {
    return luminance < DARK_FLIP_BELOW ? DARK_TEXT_ALT : DARK_TEXT;
  }
  return luminance > LIGHT_FLIP_ABOVE ? LIGHT_TEXT_ALT : LIGHT_TEXT;
}

// Cache of resolved palettes keyed on the Theme object reference. Every
// `updateTheme` call produces a fresh object (via `mergeThemePatch`), so a
// WeakMap lookup naturally misses on edits and rebuilds the palette; old
// Theme objects get GC'd with their cache entries.
const resolvedPaletteCache = new WeakMap<Theme, ColorEntry[]>();

function resolvePalette(theme: Theme): ColorEntry[] {
  const cached = resolvedPaletteCache.get(theme);
  if (cached) return cached;
  const out: ColorEntry[] = [];
  for (let i = 0; i < theme.eventPalette.length; i++) {
    const bg = theme.eventPalette[i];
    out.push({ bg, text: pickContrastText(bg, theme.base) });
  }
  resolvedPaletteCache.set(theme, out);
  return out;
}

// Dedupes unknown-color warnings so a stray legacy value on many rows logs
// once per session.
const warnedUnknownColors = new Set<string>();

/**
 * Normalize a raw color value read from the database or an external import
 * into a valid EventColor (slot index 0..PALETTE_SIZE-1). Inputs outside
 * the range, or non-numeric inputs, log a single warning and return
 * undefined so the render layer falls back to the FALLBACK_COLOR_INDEX
 * slot without masking data drift.
 *
 * @param raw Value from an untrusted source (DB column, import file).
 * @returns A palette index, or undefined for null/empty/out-of-range inputs.
 */
export function normalizeEventColor(raw: unknown): EventColor | undefined {
  if (raw == null || raw === "") return undefined;
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    n = Number(raw);
    if (!Number.isFinite(n)) {
      if (!warnedUnknownColors.has(raw)) {
        warnedUnknownColors.add(raw);
        console.warn(`[calendar] non-numeric event color "${raw}", falling back to default`);
      }
      return undefined;
    }
  } else {
    const key = String(raw);
    if (!warnedUnknownColors.has(key)) {
      warnedUnknownColors.add(key);
      console.warn("[calendar] non-numeric event color:", raw);
    }
    return undefined;
  }
  if (!Number.isInteger(n) || n < 0 || n >= PALETTE_SIZE) {
    const key = String(raw);
    if (!warnedUnknownColors.has(key)) {
      warnedUnknownColors.add(key);
      console.warn(`[calendar] event color ${raw} out of range, falling back to default`);
    }
    return undefined;
  }
  return n;
}

/**
 * Resolve an event color within a theme. Out-of-range or undefined slots
 * fall back to FALLBACK_COLOR_INDEX. Pass the active theme from the theme
 * store at the call site.
 */
export function getEventColor(
  color: EventColor | undefined,
  theme: Theme,
): ColorEntry {
  const palette = resolvePalette(theme);
  if (color !== undefined && palette[color]) return palette[color];
  return palette[FALLBACK_COLOR_INDEX];
}

// Cache for computed dimmed colors (past, cancelled, free, outside-month).
// Keyed on the Theme reference so edits (which mint a new Theme object)
// naturally miss and recompute; old entries get GC'd with their themes.
const dimmedColorCache = new WeakMap<Theme, Map<string, ColorEntry>>();

/**
 * Compute a dimmed variant of an event color by blending the bg toward the
 * theme's blend canvas. Used in place of CSS opacity so contrast stays
 * predictable and text sub-pixel antialiasing is preserved.
 *
 * @param mainWeight Fraction of the event color in the result (0..1). The
 *   rest fills from the theme's blend canvas. Lower = more washed out.
 */
function getDimmedEventColor(
  color: EventColor | undefined,
  theme: Theme,
  mainWeight: number,
): ColorEntry {
  let inner = dimmedColorCache.get(theme);
  if (!inner) {
    inner = new Map();
    dimmedColorCache.set(theme, inner);
  }
  const key = `${color ?? FALLBACK_COLOR_INDEX}-${mainWeight}`;
  const cached = inner.get(key);
  if (cached) return cached;

  const base = getEventColor(color, theme);
  const bg = blendHex(base.bg, theme.blendCanvas, mainWeight);
  const text = pickContrastText(bg, theme.base);
  const entry: ColorEntry = { bg, text };
  inner.set(key, entry);
  return entry;
}

/**
 * Past variant: heavier fade on light themes (30% main), lighter on dark
 * themes (50% main) to preserve legibility. Text contrast is recomputed
 * from the dimmed bg.
 */
export function getPastEventColor(
  color: EventColor | undefined,
  theme: Theme,
): ColorEntry {
  return getDimmedEventColor(color, theme, theme.base === "dark" ? 0.5 : 0.3);
}

/**
 * Cancelled variant: heavily faded (~35% main). The dimmed bg crosses the
 * flip threshold so text resolves to the alt token, keeping the event
 * clearly de-emphasized but still readable.
 */
export function getCancelledEventColor(
  color: EventColor | undefined,
  theme: Theme,
): ColorEntry {
  return getDimmedEventColor(color, theme, 0.35);
}

/**
 * Free/transparent variant: moderately faded (~60% main).
 */
export function getFreeEventColor(
  color: EventColor | undefined,
  theme: Theme,
): ColorEntry {
  return getDimmedEventColor(color, theme, 0.6);
}

/**
 * Outside-month variant: strongest fade (~25% main). Used for events shown
 * in neighboring-month cells of the month grid.
 */
export function getOutsideMonthEventColor(
  color: EventColor | undefined,
  theme: Theme,
): ColorEntry {
  return getDimmedEventColor(color, theme, 0.25);
}

export const EVENT_COLOR_OPTIONS: readonly EventColor[] = Object.freeze(
  Array.from({ length: PALETTE_SIZE }, (_, i) => i),
);

/**
 * Smooth-scroll wheel handler for Linux/discrete-tick environments.
 * Intercepts wheel events and applies momentum-based scrolling with
 * exponential friction decay.
 *
 * Implementation note: We track scroll position internally (trackedPos)
 * rather than reading el.scrollTop each frame. Browsers may round or
 * clamp scrollTop values between write and read, causing cumulative
 * drift. This drift manifests as a "bounce back" effect, particularly
 * visible when scrolling down. By maintaining our own position and only
 * writing to the DOM, we avoid this browser-induced instability.
 */
interface SmoothScrollFn {
  (e: WheelEvent): void;
  cancel(): void;
}

export function createSmoothScroll(
  getEl: () => HTMLElement | undefined,
  gain = 3,
  friction = 6,
): SmoothScrollFn {
  let velocity = 0;
  let running = false;
  let prev = 0;
  let trackedPos: number | null = null;

  function tick(ts: number) {
    if (!running) return;
    const el = getEl();
    if (!el) {
      running = false;
      trackedPos = null;
      return;
    }
    if (!prev) {
      prev = ts;
      requestAnimationFrame(tick);
      return;
    }
    const dt = (ts - prev) / 1000;
    prev = ts;
    velocity *= Math.exp(-friction * dt);
    if (Math.abs(velocity) < 10) {
      velocity = 0;
      running = false;
      trackedPos = null;
      return;
    }
    const max = el.scrollHeight - el.clientHeight;

    // Use tracked position if available, otherwise sync from element
    if (trackedPos === null) trackedPos = el.scrollTop;
    const newPos = trackedPos + velocity * dt;

    // Stop immediately when hitting boundary
    if (velocity > 0 && newPos >= max) {
      el.scrollTop = max;
      velocity = 0;
      running = false;
      trackedPos = null;
      return;
    }
    if (velocity < 0 && newPos <= 0) {
      el.scrollTop = 0;
      velocity = 0;
      running = false;
      trackedPos = null;
      return;
    }

    trackedPos = newPos;
    el.scrollTop = newPos;
    requestAnimationFrame(tick);
  }

  const fn = ((e: WheelEvent) => {
    const el = getEl();
    if (!el) return;
    e.preventDefault();
    velocity += e.deltaY * gain;
    if (!running) {
      running = true;
      prev = 0;
      trackedPos = el.scrollTop;
      requestAnimationFrame(tick);
    }
  }) as SmoothScrollFn;

  fn.cancel = () => {
    running = false;
    velocity = 0;
    prev = 0;
    trackedPos = null;
  };

  return fn;
}


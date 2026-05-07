import type {
  CalendarEvent,
  EventColor,
  PositionedAllDayEvent,
  PositionedEvent,
} from "./types";
import { FALLBACK_COLOR_INDEX, PALETTE_SIZE } from "./types";
import { blendHex } from "$lib/components/ui/colorMath";

export { blendHex };

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
 * Detect that a stored datetime string is already in UTC ISO 8601 form
 * (ends with Z, with or without seconds and millis). Used by the io
 * round-trip to fall back to legacy parsing for unmigrated rows.
 */
export function isUtcIso(value: string): boolean {
  return typeof value === "string" && value.endsWith("Z") && value.includes("T");
}

/**
 * Convert a wall clock string ("YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS")
 * interpreted in `zone` to a UTC ISO 8601 instant ending in Z. DST ambiguity
 * resolves with `disambiguation: "compatible"`: in fall-back ambiguity (the
 * 1:30 AM that happens twice) pick the earlier instant; in spring-forward
 * gaps shift forward by the gap. Matches RFC 5545 conventions.
 */
export function wallClockToUtcIso(wallClock: string, zone: string): string {
  const normalized = wallClock.includes("T") ? wallClock : wallClock.replace(" ", "T");
  const padded = /T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
  const plain = Temporal.PlainDateTime.from(padded);
  const zoned = plain.toZonedDateTime(zone, { disambiguation: "compatible" });
  return zoned.toInstant().toString();
}

/**
 * Convert a UTC ISO 8601 instant to a "YYYY-MM-DD HH:MM" wall clock in
 * `zone`. The seconds and sub-second components are dropped; the calendar
 * UI works at minute granularity.
 */
export function utcIsoToWallClock(utcIso: string, zone: string): string {
  const instant = Temporal.Instant.from(utcIso);
  const zoned = instant.toZonedDateTimeISO(zone);
  const y = String(zoned.year).padStart(4, "0");
  const m = String(zoned.month).padStart(2, "0");
  const d = String(zoned.day).padStart(2, "0");
  const h = String(zoned.hour).padStart(2, "0");
  const min = String(zoned.minute).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
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

/**
 * Visible date range for a given view mode anchored on `anchor`. Returns
 * Temporal.PlainDate bounds with a 1-day margin on each side so off-by-one
 * edges (DST, week boundaries) don't drop overlapping events. Used by the
 * calendar store's window-scoped expansion cache.
 *
 * - `day`: anchor day, plus margin.
 * - `week`: 7 days starting from week-start of anchor (Monday), plus margin.
 * - `month`: the 6x7 month grid, plus margin.
 */
export function computeViewWindow(
  anchor: Date,
  mode: "day" | "week" | "month",
): { start: Temporal.PlainDate; end: Temporal.PlainDate } {
  if (mode === "day") {
    const d = Temporal.PlainDate.from(formatDatePart(anchor));
    return { start: d.subtract({ days: 1 }), end: d.add({ days: 1 }) };
  }
  if (mode === "week") {
    const monday = startOfWeek(anchor);
    const sunday = addDays(monday, 6);
    return {
      start: Temporal.PlainDate.from(formatDatePart(monday)).subtract({ days: 1 }),
      end: Temporal.PlainDate.from(formatDatePart(sunday)).add({ days: 1 }),
    };
  }
  const grid = getMonthGrid(anchor.getFullYear(), anchor.getMonth());
  const first = grid[0][0];
  const last = grid[5][6];
  return {
    start: Temporal.PlainDate.from(formatDatePart(first)).subtract({ days: 1 }),
    end: Temporal.PlainDate.from(formatDatePart(last)).add({ days: 1 }),
  };
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

/**
 * Full standard-time long name via Intl ("Iran Standard Time", "Pacific
 * Standard Time"). Falls back to the formatted IANA ID when Intl yields
 * nothing for the zone.
 */
export function getTimezoneLongName(tz: string, date?: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "long",
  }).formatToParts(date ?? new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? formatTimezoneName(tz);
}

/**
 * Last segment of an IANA ID with underscores converted to spaces. For
 * "Asia/Tehran" returns "Tehran"; for "America/Argentina/Buenos_Aires"
 * returns "Buenos Aires". Single-segment IDs return themselves.
 */
export function getTimezoneCity(tz: string): string {
  const segments = tz.split("/");
  const last = segments[segments.length - 1] ?? tz;
  return last.replace(/_/g, " ");
}

/**
 * First segment of an IANA ID. For "Asia/Tehran" returns "Asia"; for
 * "America/Argentina/Buenos_Aires" returns "America". Single-segment IDs
 * return an empty string.
 */
export function getTimezoneRegion(tz: string): string {
  const segments = tz.split("/");
  if (segments.length < 2) return "";
  return segments[0] ?? "";
}

/**
 * Numeric offset in minutes east of UTC at the given instant. Positive for
 * zones ahead of UTC (Tokyo +540, Kolkata +330), negative for zones behind
 * (Anchorage -540). "GMT" alone parses to 0.
 */
export function getTimezoneOffsetMinutes(tz: string, date?: Date): number {
  const raw = getTimezoneOffset(tz, date);
  if (!raw || raw === "GMT") return 0;
  const match = raw.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

/**
 * Strips the leading "GMT" from offset-form abbrevs so they fit a 46px
 * column. "GMT-10" becomes "-10", "GMT+5:30" becomes "+5:30", "PST" stays
 * "PST". Real abbrevs without a GMT prefix pass through unchanged.
 */
export function formatColumnHeaderAbbr(tz: string, date?: Date): string {
  const abbr = getTimezoneAbbr(tz, date);
  const stripped = abbr.replace(/^GMT(?=[+-])/, "");
  return stripped || abbr;
}

const DEPRECATED_TIMEZONE_IDS = new Set([
  "GMT",
  "UTC",
  "Universal",
  "Zulu",
  "GB",
  "GB-Eire",
  "NZ",
  "NZ-CHAT",
  "PRC",
  "ROK",
  "ROC",
  "W-SU",
  "EST",
  "MST",
  "HST",
  "EST5EDT",
  "CST6CDT",
  "MST7MDT",
  "PST8PDT",
  "Iran",
  "Israel",
  "Egypt",
  "Cuba",
  "Jamaica",
  "Libya",
  "Navajo",
  "Poland",
  "Portugal",
  "Singapore",
  "Turkey",
  "Hongkong",
  "Japan",
  "Eire",
  "Greenwich",
  "UCT",
]);

let _filteredTimezones: string[] | null = null;

/**
 * All IANA zones excluding `Etc/*` (POSIX-inverted signs) and known
 * deprecated single-segment aliases. Cached after first call.
 */
export function listAllTimezones(): string[] {
  if (_filteredTimezones) return _filteredTimezones;
  const all = getIanaTimezones();
  _filteredTimezones = all.filter((tz) => {
    if (tz.startsWith("Etc/")) return false;
    if (DEPRECATED_TIMEZONE_IDS.has(tz)) return false;
    return true;
  });
  return _filteredTimezones;
}

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

/**
 * Which form of timezone tag the calendar shows in the gutter column
 * header and as the trailing label in picker rows. The popover offset
 * always renders with a `UTC` prefix regardless of mode.
 *
 * - `acronym`: always show a letter form (Intl-provided when CLDR exposes
 *   one, e.g. `PST`/`CST`; long-name-derived otherwise, e.g. `KST`/`JST`/
 *   `AEST`/`ACWST`); falls through to numeric only for the handful of
 *   zones whose long name is itself `GMT+XX:00`.
 * - `utc`: always numeric (`-6`, `+9`, `+5:30`, `+14`), even for zones
 *   where Intl exposes a named short. The "UTC only" mode.
 * - `utc-fallback`: Intl's named short when available (`CST`, `PST`),
 *   numeric otherwise (`+9`, `+3:30`). Mirrors what Google Calendar does
 *   today; never derives an acronym, only uses what Intl ships.
 */
export type TimezoneAbbrMode = "acronym" | "utc" | "utc-fallback";

const ACRONYM_STOP_WORDS = new Set(["of", "the", "and"]);

/**
 * Derive a 2-5 letter acronym from a timezone's Intl long name. Used as
 * a fallback when Intl returns a `GMT±N` form for `timeZoneName: "short"`,
 * so users see e.g. "KST" / "JST" / "AEST" / "ACWST" instead of "+9" /
 * "+10" / "+8:45" for the many zones CLDR doesn't expose a short code
 * for. Returns null when the long name is itself an offset form (Intl
 * has no name for the zone, e.g., `Asia/Amman`'s long name is just
 * "GMT+03:00") or when the derivation produces fewer than 2 or more
 * than 5 letters. Lowercase mid-name particles (`de`, `la`, `del`,
 * `der`, `du`, etc.) and ampersand boundaries are skipped so names like
 * "Fernando de Noronha Standard Time" yield FNST and "Wallis & Futuna
 * Time" yields WFT.
 */
export function deriveAcronymFromLongName(longName: string): string | null {
  const trimmed = longName.trim();
  if (!trimmed) return null;
  if (/^(GMT|UTC|Coordinated)/.test(trimmed)) return null;
  const words = trimmed
    .split(/[\s\-&]+/)
    .filter((w) => {
      if (w.length === 0) return false;
      if (ACRONYM_STOP_WORDS.has(w.toLowerCase())) return false;
      // Drop mid-name particles ("de", "la", etc.) by skipping any token
      // that starts with a lowercase letter; significant zone words are
      // always capitalized in Intl long names.
      const head = w[0];
      if (head !== head.toUpperCase()) return false;
      // Token must start with a Latin letter; drops "&", "(", numerics,
      // etc. that survive the split.
      if (!/^[A-Za-z]/.test(w)) return false;
      return true;
    });
  if (words.length === 0) return null;
  const initials = words
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (!/^[A-Z]+$/.test(initials)) return null;
  if (initials.length < 2 || initials.length > 5) return null;
  return initials;
}

/**
 * Compact-numeric form of a long offset. Drops the `GMT` prefix, the
 * leading zero in the hour, and the `:00` minutes when zero. Used by the
 * "UTC only" trigger mode where every zone (including those Intl exposes
 * as `CST`/`PST`) shows a pure numeric offset for visual consistency.
 *
 * Examples: `GMT-06:00` -> `-6`, `GMT+05:30` -> `+5:30`, `GMT+14:00` ->
 * `+14`, `GMT` (UTC itself) -> `+0`. Strings that don't match the
 * `GMT±HH:MM` shape are returned with `GMT` stripped if present, else
 * passed through, so callers always receive a non-empty string.
 */
export function compactOffsetFromLong(longOffset: string): string {
  if (!longOffset || longOffset === "GMT") return "+0";
  const m = longOffset.match(/^GMT([+-])(\d{1,2}):(\d{2})$/);
  if (!m) {
    const stripped = longOffset.replace(/^GMT/, "");
    return stripped || "+0";
  }
  const sign = m[1];
  const hours = String(parseInt(m[2], 10));
  const minutes = m[3];
  return minutes === "00" ? `${sign}${hours}` : `${sign}${hours}:${minutes}`;
}

/**
 * Display- and search-ready snapshot of a timezone, baked once and reused
 * by the picker. The popover never calls Intl during render or per
 * keystroke; it reads from this object via `getTimezoneInfo`. Lowercase
 * mirrors of the search fields avoid per-keystroke `.toLowerCase()` allocs
 * inside the search loop.
 */
export interface TimezoneInfo {
  tz: string;
  abbr: string;
  columnAbbr: string;
  acronym: string;
  numericOffset: string;
  offset: string;
  offsetUtc: string;
  offsetMinutes: number;
  longName: string;
  city: string;
  region: string;
  longNameLower: string;
  cityLower: string;
  regionLower: string;
  abbrLower: string;
  ianaLower: string;
}

const timezoneInfoCache = new Map<string, TimezoneInfo>();

function buildTimezoneInfo(tz: string): TimezoneInfo {
  const abbr = getTimezoneAbbr(tz);
  const stripped = abbr.replace(/^GMT(?=[+-])/, "");
  const columnAbbr = stripped || abbr;
  const rawOffset = getTimezoneOffset(tz);
  // Normalize empty / GMT-only zones so callers always have a non-empty
  // string to render. Without this, "Africa/Abidjan" would render as ""
  // in the popover offset column.
  const offset = rawOffset || "GMT";
  const offsetUtc = offset.replace(/^GMT/, "UTC");
  const numericOffset = compactOffsetFromLong(offset);
  const offsetMinutes = getTimezoneOffsetMinutes(tz);
  const longName = getTimezoneLongName(tz);
  const city = getTimezoneCity(tz);
  const region = getTimezoneRegion(tz);
  // Acronym: prefer Intl's named form when it isn't the offset fallback,
  // else derive from the long name, else fall through to the stripped
  // numeric form so the column header always has something to show.
  let acronym: string;
  if (!/^GMT/.test(abbr)) {
    acronym = abbr;
  } else {
    const derived = deriveAcronymFromLongName(longName);
    acronym = derived ?? columnAbbr;
  }
  return {
    tz,
    abbr,
    columnAbbr,
    acronym,
    numericOffset,
    offset,
    offsetUtc,
    offsetMinutes,
    longName,
    city,
    region,
    longNameLower: longName.toLowerCase(),
    cityLower: city.toLowerCase(),
    regionLower: region.toLowerCase(),
    abbrLower: abbr.toLowerCase(),
    ianaLower: tz.toLowerCase(),
  };
}

/**
 * Cached, fully-resolved metadata for a timezone. First call for a given
 * zone runs three Intl.DateTimeFormat constructions; subsequent calls are
 * O(1) Map lookups. Safe to call from render paths.
 */
export function getTimezoneInfo(tz: string): TimezoneInfo {
  const cached = timezoneInfoCache.get(tz);
  if (cached) return cached;
  const info = buildTimezoneInfo(tz);
  timezoneInfoCache.set(tz, info);
  return info;
}

let _sortedByOffset: TimezoneInfo[] | null = null;

function getSortedByOffset(): TimezoneInfo[] {
  if (_sortedByOffset) return _sortedByOffset;
  const list = listAllTimezones().map(getTimezoneInfo);
  list.sort((a, b) => {
    if (a.offsetMinutes !== b.offsetMinutes) {
      return a.offsetMinutes - b.offsetMinutes;
    }
    return a.longName.localeCompare(b.longName);
  });
  _sortedByOffset = list;
  return list;
}

/**
 * Search timezones with ranked multi-field matching.
 *
 * Empty query returns the full filtered list (Etc/* and deprecated aliases
 * already removed by `listAllTimezones`) sorted by UTC offset ascending,
 * then long name ascending. This powers the browse-when-empty popover.
 *
 * Non-empty query ranks each candidate by where the query first matches.
 * Tiers (lower is better): long-name prefix, long-name contains, city
 * prefix, city contains, region prefix, region contains, abbrev prefix,
 * abbrev contains, IANA-id prefix, IANA-id contains. Within a tier,
 * candidates sort by UTC offset then long name. Excluded zones never
 * appear in results.
 */
export function searchTimezones(
  query: string,
  exclude: string[],
): string[] {
  const sorted = getSortedByOffset();
  const excludeSet = new Set(exclude);
  const q = query.toLowerCase().trim();

  if (!q) {
    const out: string[] = [];
    for (const info of sorted) {
      if (!excludeSet.has(info.tz)) out.push(info.tz);
    }
    return out;
  }

  type Scored = { info: TimezoneInfo; tier: number };
  const scored: Scored[] = [];

  for (const info of sorted) {
    if (excludeSet.has(info.tz)) continue;

    let tier = Infinity;
    if (info.longNameLower.startsWith(q)) tier = 0;
    else if (info.longNameLower.includes(q)) tier = 1;
    if (tier > 2) {
      if (info.cityLower.startsWith(q)) tier = Math.min(tier, 2);
      else if (info.cityLower.includes(q)) tier = Math.min(tier, 3);
    }
    if (tier > 4) {
      if (info.regionLower.startsWith(q)) tier = Math.min(tier, 4);
      else if (info.regionLower.includes(q)) tier = Math.min(tier, 5);
    }
    if (tier > 6) {
      if (info.abbrLower.startsWith(q)) tier = Math.min(tier, 6);
      else if (info.abbrLower.includes(q)) tier = Math.min(tier, 7);
    }
    if (tier > 8) {
      if (info.ianaLower.startsWith(q)) tier = Math.min(tier, 8);
      else if (info.ianaLower.includes(q)) tier = Math.min(tier, 9);
    }

    if (tier !== Infinity) {
      scored.push({ info, tier });
    }
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.info.offsetMinutes !== b.info.offsetMinutes) {
      return a.info.offsetMinutes - b.info.offsetMinutes;
    }
    return a.info.longName.localeCompare(b.info.longName);
  });

  return scored.map((s) => s.info.tz);
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

import { isThemeCalendarDark, type Theme } from "$lib/stores/themes";

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
 * Pick a readable foreground for a given event-tile background under a
 * light or dark calendar surface. Rec. 709 coefficients on raw sRGB
 * approximate perceived luminance; calibrated for the event-palette
 * flips, so `resolvePalette` keeps using this. New callers should
 * prefer `pickReadableForeground` in `colorMath.ts`, which uses
 * gamma-decoded WCAG luminance and guarantees AA contrast.
 *
 * The `darkCalendar` flag is resolved from the calendar canvas's
 * luminance (via `isThemeCalendarDark`), not from the theme's cosmetic
 * `base` label, so swapping the base label no longer changes tile text.
 *
 * @deprecated Use `pickReadableForeground` from `$lib/components/ui/colorMath`
 * for new code. Kept because the event palette was calibrated against the
 * threshold constants above.
 */
function pickContrastText(bg: string, darkCalendar: boolean): string {
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (darkCalendar) {
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
  const darkCal = isThemeCalendarDark(theme);
  const out: ColorEntry[] = [];
  for (let i = 0; i < theme.eventPalette.length; i++) {
    const bg = theme.eventPalette[i];
    out.push({ bg, text: pickContrastText(bg, darkCal) });
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
  const text = pickContrastText(bg, isThemeCalendarDark(theme));
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
  return getDimmedEventColor(color, theme, isThemeCalendarDark(theme) ? 0.5 : 0.3);
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

function getSmoothScrollDelta(e: WheelEvent): number {
  if (e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    return e.deltaX;
  }
  return e.deltaY;
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
    velocity += getSmoothScrollDelta(e) * gain;
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

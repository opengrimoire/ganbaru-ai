export interface NotesDatabaseDateValue {
  start: string;
  end: string | null;
  time_zone: string | null;
}

/** Identify real ISO calendar dates and optional local or offset time components. */
export function notesDatabaseDateBoundaryValid(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zoneHour, zoneMinute] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return false;
  return (hour === undefined || Number(hour) < 24) && (minute === undefined || Number(minute) < 60)
    && (second === undefined || Number(second) < 60) && (zoneHour === undefined || Number(zoneHour) < 24)
    && (zoneMinute === undefined || Number(zoneMinute) < 60);
}

/** Validate named zones with the same platform timezone data used for display. */
export function notesDatabaseTimeZoneValid(value: string): boolean {
  if (!value || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch (error: unknown) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/** Read canonical date fields without coercing unknown native values. */
export function notesDatabaseDateValue(value: unknown): NotesDatabaseDateValue | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const date = value as Record<string, unknown>;
  if (typeof date.start !== "string" || !date.start) return null;
  return {
    start: date.start,
    end: typeof date.end === "string" && date.end ? date.end : null,
    time_zone: typeof date.time_zone === "string" && date.time_zone ? date.time_zone : null,
  };
}

/** Compare boundaries on their ISO timeline, retaining wall time for dates without an offset. */
export function notesDatabaseDateBoundaryOrder(value: string): number {
  return Date.parse(/T/.test(value) ? /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z` : `${value}T00:00:00Z`);
}

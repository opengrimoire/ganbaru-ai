import type {
  OrdinalWeekday,
  RecurrenceConfig,
  RecurrenceFrequency,
  RecurrencePreset,
  Weekday,
} from "./types";

const ALL_WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const WORK_WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

const FREQ_MAP: Record<string, RecurrenceFrequency> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

const FREQ_REVERSE: Record<RecurrenceFrequency, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

const FREQ_UNIT_PLURAL: Record<RecurrenceFrequency, string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};

const BYDAY_RE = /^(-?\d+)?([A-Z]{2})$/;

/**
 * Parse a single BYDAY token like "MO", "2TU", or "-1FR".
 * Returns null if the token is not a valid weekday.
 */
function parseBydayToken(token: string): { day: Weekday; ordinal?: number } | null {
  const match = token.match(BYDAY_RE);
  if (!match) return null;
  const day = match[2] as Weekday;
  if (!ALL_WEEKDAYS.includes(day)) return null;
  const ordinal = match[1] ? parseInt(match[1], 10) : undefined;
  return { day, ordinal };
}

/**
 * Parse an UNTIL value which may be date-only (YYYYMMDD) or datetime (YYYYMMDDTHHMMSSZ).
 */
function parseUntil(raw: string): string {
  if (raw.length === 8) {
    // YYYYMMDD -> YYYY-MM-DD
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (raw.includes("T")) {
    // YYYYMMDDTHHMMSSZ -> YYYY-MM-DDTHH:MM:SSZ
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const time = raw.slice(9).replace("Z", "");
    const h = time.slice(0, 2);
    const m = time.slice(2, 4);
    const s = time.slice(4, 6);
    return `${date}T${h}:${m}:${s}Z`;
  }
  return raw;
}

/**
 * Serialize an until date string back to RRULE UNTIL format.
 */
function serializeUntil(date: string): string {
  if (date.includes("T")) {
    // YYYY-MM-DDTHH:MM:SSZ -> YYYYMMDDTHHMMSSZ
    return date.replace(/-/g, "").replace(/:/g, "");
  }
  // YYYY-MM-DD -> YYYYMMDD
  return date.replace(/-/g, "");
}

/**
 * Parse a comma-separated list of integers.
 */
function parseIntList(raw: string): number[] {
  return raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

// --- Serializer ---

export function recurrenceToRrule(config: RecurrenceConfig): string {
  const parts: string[] = [`FREQ=${FREQ_REVERSE[config.frequency]}`];

  if (config.interval > 1) {
    parts.push(`INTERVAL=${config.interval}`);
  }

  // BYDAY: ordinalWeekdays takes precedence over simple weekdays
  if (config.ordinalWeekdays && config.ordinalWeekdays.length > 0) {
    const tokens = config.ordinalWeekdays.map((ow) =>
      ow.ordinal != null ? `${ow.ordinal}${ow.day}` : ow.day,
    );
    parts.push(`BYDAY=${tokens.join(",")}`);
  } else if (config.weekdays && config.weekdays.length > 0) {
    parts.push(`BYDAY=${config.weekdays.join(",")}`);
  }

  if (config.byMonthDay && config.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${config.byMonthDay.join(",")}`);
  }

  if (config.byMonth && config.byMonth.length > 0) {
    parts.push(`BYMONTH=${config.byMonth.join(",")}`);
  }

  if (config.bySetPos && config.bySetPos.length > 0) {
    parts.push(`BYSETPOS=${config.bySetPos.join(",")}`);
  }

  if (config.byYearDay && config.byYearDay.length > 0) {
    parts.push(`BYYEARDAY=${config.byYearDay.join(",")}`);
  }

  if (config.byWeekNo && config.byWeekNo.length > 0) {
    parts.push(`BYWEEKNO=${config.byWeekNo.join(",")}`);
  }

  if (config.wkst && config.wkst !== "MO") {
    parts.push(`WKST=${config.wkst}`);
  }

  if (config.end.type === "count") {
    parts.push(`COUNT=${config.end.count}`);
  } else if (config.end.type === "until") {
    parts.push(`UNTIL=${serializeUntil(config.end.date)}`);
  }

  return parts.join(";");
}

// --- Parser ---

export function rruleToRecurrence(
  rrule: string,
  repeatUntil?: string,
): RecurrenceConfig {
  const params = new Map<string, string>();
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1) {
      params.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }

  const freqStr = params.get("FREQ") ?? "DAILY";
  const frequency: RecurrenceFrequency = FREQ_MAP[freqStr] ?? "daily";

  const intervalStr = params.get("INTERVAL");
  const interval = intervalStr ? parseInt(intervalStr, 10) : 1;

  // Parse BYDAY, distinguishing simple weekdays from ordinal weekdays
  const byday = params.get("BYDAY");
  let weekdays: Weekday[] | undefined;
  let ordinalWeekdays: OrdinalWeekday[] | undefined;
  if (byday) {
    const simple: Weekday[] = [];
    const ordinal: OrdinalWeekday[] = [];
    for (const token of byday.split(",")) {
      const parsed = parseBydayToken(token.trim());
      if (!parsed) continue;
      if (parsed.ordinal != null) {
        ordinal.push({ day: parsed.day, ordinal: parsed.ordinal });
      } else {
        simple.push(parsed.day);
      }
    }
    if (ordinal.length > 0) {
      ordinalWeekdays = ordinal;
      // If there are also simple entries, include them as ordinalWeekdays without ordinal
      if (simple.length > 0) {
        ordinalWeekdays = [...ordinal, ...simple.map((d) => ({ day: d }))];
      }
    } else if (simple.length > 0) {
      weekdays = simple;
    }
  }

  // Parse additional BY* rules
  const byMonthDayStr = params.get("BYMONTHDAY");
  const byMonthDay = byMonthDayStr ? parseIntList(byMonthDayStr) : undefined;

  const byMonthStr = params.get("BYMONTH");
  const byMonth = byMonthStr ? parseIntList(byMonthStr) : undefined;

  const bySetPosStr = params.get("BYSETPOS");
  const bySetPos = bySetPosStr ? parseIntList(bySetPosStr) : undefined;

  const byYearDayStr = params.get("BYYEARDAY");
  const byYearDay = byYearDayStr ? parseIntList(byYearDayStr) : undefined;

  const byWeekNoStr = params.get("BYWEEKNO");
  const byWeekNo = byWeekNoStr ? parseIntList(byWeekNoStr) : undefined;

  const wkstStr = params.get("WKST");
  const wkst: Weekday | undefined =
    wkstStr && ALL_WEEKDAYS.includes(wkstStr as Weekday) ? (wkstStr as Weekday) : undefined;

  // Parse end condition
  const countStr = params.get("COUNT");
  const untilStr = params.get("UNTIL");

  let end: RecurrenceConfig["end"];
  if (countStr) {
    end = { type: "count", count: parseInt(countStr, 10) };
  } else if (untilStr) {
    end = { type: "until", date: parseUntil(untilStr) };
  } else if (repeatUntil) {
    end = { type: "until", date: repeatUntil };
  } else {
    end = { type: "never" };
  }

  const config: RecurrenceConfig = { frequency, interval, end };
  if (weekdays?.length) config.weekdays = weekdays;
  if (ordinalWeekdays?.length) config.ordinalWeekdays = ordinalWeekdays;
  if (byMonthDay?.length) config.byMonthDay = byMonthDay;
  if (byMonth?.length) config.byMonth = byMonth;
  if (bySetPos?.length) config.bySetPos = bySetPos;
  if (byYearDay?.length) config.byYearDay = byYearDay;
  if (byWeekNo?.length) config.byWeekNo = byWeekNo;
  if (wkst) config.wkst = wkst;
  return config;
}

// --- Presets ---

export function presetToRecurrence(preset: RecurrencePreset): RecurrenceConfig | undefined {
  switch (preset) {
    case "none":
      return undefined;
    case "daily":
      return { frequency: "daily", interval: 1, end: { type: "never" } };
    case "weekdays":
      return {
        frequency: "weekly",
        interval: 1,
        weekdays: [...WORK_WEEKDAYS],
        end: { type: "never" },
      };
    case "weekly":
      return { frequency: "weekly", interval: 1, end: { type: "never" } };
    case "monthly":
      return { frequency: "monthly", interval: 1, end: { type: "never" } };
    case "yearly":
      return { frequency: "yearly", interval: 1, end: { type: "never" } };
  }
}

export function recurrenceToPreset(config: RecurrenceConfig): RecurrencePreset | null {
  if (config.end.type !== "never") return null;
  if (config.interval !== 1) return null;
  // Any BY* rule makes it non-preset
  if (config.ordinalWeekdays || config.byMonthDay || config.byMonth ||
      config.bySetPos || config.byYearDay || config.byWeekNo) return null;

  switch (config.frequency) {
    case "daily":
      return config.weekdays ? null : "daily";
    case "weekly": {
      if (!config.weekdays || config.weekdays.length === 0) return "weekly";
      if (
        config.weekdays.length === WORK_WEEKDAYS.length &&
        WORK_WEEKDAYS.every((d) => config.weekdays!.includes(d))
      ) {
        return "weekdays";
      }
      return null;
    }
    case "monthly":
      return config.weekdays ? null : "monthly";
    case "yearly":
      return config.weekdays ? null : "yearly";
  }
}

// --- Label formatting ---

function formatMonthDay(dateStr: string): string {
  const datePart = dateStr.split("T")[0];
  const [y, m, d] = datePart.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ORDINAL_SUFFIXES = ["th", "st", "nd", "rd"];

function ordinalSuffix(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return "th";
  if (n < 0) return "last";
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
  const mod10 = abs % 10;
  return `${abs}${ORDINAL_SUFFIXES[mod10] ?? "th"}`;
}

export function formatRecurrenceLabel(config: RecurrenceConfig): string {
  let label: string;

  if (config.interval === 1) {
    switch (config.frequency) {
      case "daily":
        label = "Daily";
        break;
      case "weekly":
        label = "Weekly";
        break;
      case "monthly":
        label = "Monthly";
        break;
      case "yearly":
        label = "Yearly";
        break;
    }
  } else {
    label = `Every ${config.interval} ${FREQ_UNIT_PLURAL[config.frequency]}`;
  }

  // Ordinal weekdays: "on the 2nd Tuesday"
  if (config.ordinalWeekdays && config.ordinalWeekdays.length > 0) {
    const parts = config.ordinalWeekdays.map((ow) => {
      const dayName = WEEKDAY_LABELS[ow.day];
      if (ow.ordinal != null) {
        if (ow.ordinal === -1) return `last ${dayName}`;
        return `${ordinalSuffix(ow.ordinal)} ${dayName}`;
      }
      return dayName;
    });
    label += ` on the ${parts.join(", ")}`;
  }
  // Simple weekdays: shown for weekly frequency, or any frequency with BYSETPOS
  else if (config.weekdays && config.weekdays.length > 0 &&
    (config.frequency === "weekly" || (config.bySetPos && config.bySetPos.length > 0))) {
    const dayLabels = config.weekdays.map((d) => WEEKDAY_LABELS[d]);
    label += ` on ${dayLabels.join(", ")}`;
  }

  // BYMONTHDAY
  if (config.byMonthDay && config.byMonthDay.length > 0) {
    const dayLabels = config.byMonthDay.map((d) => ordinalSuffix(d));
    label += ` on the ${dayLabels.join(", ")}`;
  }

  // BYSETPOS
  if (config.bySetPos && config.bySetPos.length > 0) {
    const posLabels = config.bySetPos.map((p) =>
      p === -1 ? "last" : ordinalSuffix(p),
    );
    label += ` (${posLabels.join(", ")} occurrence)`;
  }

  // End condition
  if (config.end.type === "until") {
    label += `, ends ${formatMonthDay(config.end.date)}`;
  } else if (config.end.type === "count") {
    label += `, ${config.end.count} times`;
  }

  return label;
}

import type {
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

const FREQ_UNIT_SINGULAR: Record<RecurrenceFrequency, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

const FREQ_UNIT_PLURAL: Record<RecurrenceFrequency, string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};

export function recurrenceToRrule(config: RecurrenceConfig): string {
  const parts: string[] = [`FREQ=${FREQ_REVERSE[config.frequency]}`];

  if (config.interval > 1) {
    parts.push(`INTERVAL=${config.interval}`);
  }

  if (config.weekdays && config.weekdays.length > 0) {
    parts.push(`BYDAY=${config.weekdays.join(",")}`);
  }

  if (config.end.type === "count") {
    parts.push(`COUNT=${config.end.count}`);
  } else if (config.end.type === "until") {
    parts.push(`UNTIL=${config.end.date.replace(/-/g, "")}`);
  }

  return parts.join(";");
}

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

  const byday = params.get("BYDAY");
  const weekdays: Weekday[] | undefined = byday
    ? (byday.split(",").filter((d) => ALL_WEEKDAYS.includes(d as Weekday)) as Weekday[])
    : undefined;

  const countStr = params.get("COUNT");
  const untilStr = params.get("UNTIL");

  let end: RecurrenceConfig["end"];
  if (countStr) {
    end = { type: "count", count: parseInt(countStr, 10) };
  } else if (untilStr) {
    // UNTIL format: YYYYMMDD -> YYYY-MM-DD
    const d = untilStr.length === 8
      ? `${untilStr.slice(0, 4)}-${untilStr.slice(4, 6)}-${untilStr.slice(6, 8)}`
      : untilStr;
    end = { type: "until", date: d };
  } else if (repeatUntil) {
    end = { type: "until", date: repeatUntil };
  } else {
    end = { type: "never" };
  }

  return { frequency, interval, weekdays, end };
}

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

function formatMonthDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  if (config.weekdays && config.weekdays.length > 0 && config.frequency === "weekly") {
    const dayLabels = config.weekdays.map((d) => WEEKDAY_LABELS[d]);
    label += ` on ${dayLabels.join(", ")}`;
  }

  if (config.end.type === "until") {
    label += `, ends ${formatMonthDay(config.end.date)}`;
  } else if (config.end.type === "count") {
    label += `, ${config.end.count} times`;
  }

  return label;
}

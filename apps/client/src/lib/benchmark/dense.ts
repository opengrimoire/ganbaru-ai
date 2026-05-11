/**
 * Deterministic dense calendar dataset generator.
 *
 * Dataset v1 creates `stackCount` overlapping timed events at the start of
 * every hour for each day in `[anchor - yearRadius, anchor + yearRadius)`.
 * Detail profile `d1` adds realistic event metadata without recurrence, so
 * the benchmark isolates the cost of long calendar history and dense visible
 * days instead of recurring-template expansion.
 */
import {
  benchmarkDatasetId,
  type BenchmarkDatasetProfile,
  type BenchmarkEventDraft,
} from "./types";

const MS_PER_DAY = 86_400_000;
const HOURS_PER_DAY = 24;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface DenseCalendarDateRange {
  start: string;
  endExclusive: string;
  days: number;
}

const DETAIL_TEMPLATES = [
  {
    title: "Focus block",
    action: "make progress on the planned milestone",
    category: "deep work",
    location: "Home office",
  },
  {
    title: "Project review",
    action: "review decisions, risks, and next steps",
    category: "planning",
    location: "Desk",
  },
  {
    title: "Team sync",
    action: "align on blockers and ownership",
    category: "collaboration",
    location: "Meeting room",
  },
  {
    title: "Admin pass",
    action: "clear inbox items and update records",
    category: "admin",
    location: "Office",
  },
  {
    title: "Personal routine",
    action: "handle the recurring personal routine",
    category: "personal",
    location: "Apartment",
  },
] as const;

const PROJECTS = [
  "calendar",
  "planning",
  "health",
  "finances",
  "learning",
  "maintenance",
] as const;

const LOCATIONS = [
  { name: "Home office", lat: 25.6866, lng: -100.3161 },
  { name: "Desk", lat: 25.6744, lng: -100.3182 },
  { name: "Meeting room", lat: 25.6861, lng: -100.3169 },
  { name: "Office", lat: 25.6791, lng: -100.3084 },
  { name: "Apartment", lat: 25.6912, lng: -100.3216 },
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function partsFromDate(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function dateToUtcMs(date: DateParts): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function partsFromUtcMs(ms: number): DateParts {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addYears(date: DateParts, years: number): DateParts {
  return {
    year: date.year + years,
    month: date.month,
    day: date.day,
  };
}

function addDays(date: DateParts, days: number): DateParts {
  return partsFromUtcMs(dateToUtcMs(date) + days * MS_PER_DAY);
}

function daysBetween(start: DateParts, endExclusive: DateParts): number {
  return Math.round((dateToUtcMs(endExclusive) - dateToUtcMs(start)) / MS_PER_DAY);
}

function fmtDate(date: DateParts): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function denseCalendarDateRange(
  dataset: BenchmarkDatasetProfile,
  anchor: Date,
): DenseCalendarDateRange {
  const anchorParts = partsFromDate(anchor);
  const startParts = addYears(anchorParts, -dataset.yearRadius);
  const endParts = addYears(anchorParts, dataset.yearRadius);
  return {
    start: fmtDate(startParts),
    endExclusive: fmtDate(endParts),
    days: daysBetween(startParts, endParts),
  };
}

export function countDenseCalendarEvents(
  dataset: BenchmarkDatasetProfile,
  anchor: Date,
): number {
  return denseCalendarDateRange(dataset, anchor).days * HOURS_PER_DAY * dataset.stackCount;
}

function templateFor(dayIndex: number, hour: number, stackIndex: number) {
  return DETAIL_TEMPLATES[(dayIndex + hour + stackIndex) % DETAIL_TEMPLATES.length];
}

function projectFor(dayIndex: number, hour: number, stackIndex: number): string {
  return PROJECTS[(dayIndex + hour * 2 + stackIndex) % PROJECTS.length];
}

function sourceUidFor(
  dataset: BenchmarkDatasetProfile,
  date: string,
  hour: number,
  stackIndex: number,
): string {
  return `dense-${dataset.version}-s${dataset.stackCount}-${dataset.detailProfile}-${date}T${pad2(hour)}-stack${stackIndex + 1}`;
}

function attendeesFor(date: string, hour: number, stackIndex: number) {
  if (stackIndex === 0) {
    return [
      {
        id: `dense-att-${date}-${pad2(hour)}-${stackIndex}-lead`,
        name: "Benchmark Lead",
        email: "lead@benchmark.local",
        role: "chair" as const,
        status: "accepted" as const,
        rsvp: true,
      },
    ];
  }
  if (stackIndex === 1) {
    return [
      {
        id: `dense-att-${date}-${pad2(hour)}-${stackIndex}-guest`,
        name: "Benchmark Guest",
        email: "guest@benchmark.local",
        role: "req-participant" as const,
        status: "needs-action" as const,
        rsvp: false,
      },
    ];
  }
  return undefined;
}

function buildDenseEvent(
  dataset: BenchmarkDatasetProfile,
  date: string,
  dayIndex: number,
  hour: number,
  stackIndex: number,
): BenchmarkEventDraft {
  const template = templateFor(dayIndex, hour, stackIndex);
  const project = projectFor(dayIndex, hour, stackIndex);
  const location = LOCATIONS[(dayIndex + stackIndex) % LOCATIONS.length];
  const start = `${date} ${pad2(hour)}:00`;
  const end = `${date} ${pad2(hour)}:50`;
  const datasetId = benchmarkDatasetId(dataset);
  const stackLabel = stackIndex + 1;
  return {
    title: `${template.title}: ${project} ${pad2(hour)}:00 #${stackLabel}`,
    start,
    end,
    sourceUid: sourceUidFor(dataset, date, hour, stackIndex),
    description: [
      `Agenda: ${template.action}.`,
      `Context: ${project} work with stacked hour ${stackLabel}.`,
      "Preparation: review the previous outcome, capture the next action, and leave a short summary.",
    ].join(" "),
    notifications: [10],
    color: (dayIndex + hour + stackIndex * 5) % 24,
    location: `${template.location}, ${location.name}`,
    url: `https://benchmark.local/${datasetId}/${date}/${pad2(hour)}/${stackLabel}`,
    transparency: stackIndex === 2 ? "transparent" : "opaque",
    status: (dayIndex + hour + stackIndex) % 11 === 0 ? "tentative" : "confirmed",
    visibility: template.category === "personal" ? "private" : "public",
    priority: 4 + (stackIndex % 3),
    categories: ["benchmark", dataset.detailProfile, template.category, project],
    geo: { lat: location.lat, lng: location.lng },
    extendedProperties: {
      "X-BENCHMARK-DATASET": datasetId,
      "X-BENCHMARK-DAY-INDEX": String(dayIndex),
      "X-BENCHMARK-STACK": String(stackLabel),
    },
    organizer: {
      name: "Benchmark Calendar",
      email: "owner@benchmark.local",
    },
    alarms: [
      {
        id: `dense-alarm-${date}-${pad2(hour)}-${stackIndex}`,
        action: "display",
        triggerType: "relative",
        triggerValue: "-PT10M",
        description: `${template.title} starts in 10 minutes`,
      },
    ],
    attendees: attendeesFor(date, hour, stackIndex),
    guestPermissions: {
      canModify: false,
      canInviteOthers: stackIndex !== 2,
      canSeeOtherGuests: true,
    },
  };
}

/**
 * Generate a deterministic slice of a dense dataset. `offset` and `count`
 * let seeding stream the 10-year dataset in chunks without allocating every
 * event in the browser at once.
 */
export function generateDenseCalendarEvents(opts: {
  dataset: BenchmarkDatasetProfile;
  anchor: Date;
  offset?: number;
  count?: number;
}): BenchmarkEventDraft[] {
  const total = countDenseCalendarEvents(opts.dataset, opts.anchor);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const end = opts.count === undefined
    ? total
    : Math.min(total, offset + Math.max(0, Math.floor(opts.count)));
  if (offset >= end) return [];

  const anchorParts = partsFromDate(opts.anchor);
  const startParts = addYears(anchorParts, -opts.dataset.yearRadius);
  const perDay = HOURS_PER_DAY * opts.dataset.stackCount;
  const events: BenchmarkEventDraft[] = [];

  for (let index = offset; index < end; index++) {
    const dayIndex = Math.floor(index / perDay);
    const withinDay = index % perDay;
    const hour = Math.floor(withinDay / opts.dataset.stackCount);
    const stackIndex = withinDay % opts.dataset.stackCount;
    const date = fmtDate(addDays(startParts, dayIndex));
    events.push(buildDenseEvent(opts.dataset, date, dayIndex, hour, stackIndex));
  }

  return events;
}

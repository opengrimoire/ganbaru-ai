/**
 * Deterministic synthetic event generator. The harness uses this to populate
 * a versioned, dedicated calendar so cross-build benchmarks compare on the
 * same input shape regardless of what the user happens to have imported.
 *
 * Determinism is the contract: for a given seed and N, the first N events
 * must be byte-identical across runs and across machines. The vitest suite
 * in `synth.test.ts` locks the first five events in golden form so silent
 * drift fails the build.
 *
 * Bumping the distribution requires renaming `SYNTH_VERSION` in `types.ts`
 * and the calendar grouping in the scenario module, then starting a new
 * row series in `docs/PERFORMANCE.md`. See the spec doc.
 */
import type { RecurrenceConfig } from "$lib/components/calendar/types";
import type { SynthEventDraft } from "./types";

/**
 * mulberry32: small, fast PRNG with adequate distribution for benchmarking.
 * Not cryptographically secure; do not use outside of the harness.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Default seed pinned in code so the dataset is reproducible across builds. */
export const DEFAULT_SEED = 0x1234;

const TITLES = [
  "Standup",
  "Sync",
  "1:1",
  "Review",
  "Deep work",
  "Planning",
  "Demo",
  "Office hours",
  "Customer call",
  "Retro",
];

const LOREM = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
  "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et",
  "dolore", "magna", "aliqua", "ut", "enim", "ad", "minim", "veniam",
];

const DURATIONS_MIN = [30, 60, 90];
const HOURS = [8, 9, 10, 11, 13, 14, 15, 16, 17];
const QUARTER_MINUTES = [0, 15, 30, 45];
const RECURRENCE_KINDS = ["daily", "weekly_mwf", "monthly"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pickInt(rand: () => number, max: number): number {
  return Math.floor(rand() * max);
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[pickInt(rand, arr.length)];
}

function makeDescription(rand: () => number): string {
  const wordCount = 8 + pickInt(rand, 30);
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(pick(rand, LOREM));
  }
  return words.join(" ");
}

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm + minutes);
  return {
    date: fmtDate(dt),
    time: `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`,
  };
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return fmtDate(dt);
}

function makeRecurrence(rand: () => number): RecurrenceConfig {
  const kind = pick(rand, RECURRENCE_KINDS);
  const capped = rand() < 0.5;
  const end: RecurrenceConfig["end"] = capped
    ? { type: "count", count: 20 }
    : { type: "never" };
  if (kind === "daily") {
    return { frequency: "daily", interval: 1, end };
  }
  if (kind === "weekly_mwf") {
    return {
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO", "WE", "FR"],
      end,
    };
  }
  return { frequency: "monthly", interval: 1, end };
}

/**
 * Generate `count` deterministic event drafts. The output spreads across
 * `[anchor - 365d, anchor + 365d]`. Distribution (v1):
 * - 70% timed plain
 * - 10% timed with description
 * - 10% recurring (mixed daily / weekly MWF / monthly; half COUNT=20)
 * - 5% all-day
 * - 5% with one alarm or 1-3 attendees
 */
export function generateSynthEvents(opts: {
  count: number;
  anchor: Date;
  seed?: number;
}): SynthEventDraft[] {
  const rand = mulberry32(opts.seed ?? DEFAULT_SEED);
  const events: SynthEventDraft[] = [];
  const anchorStr = fmtDate(opts.anchor);

  for (let i = 0; i < opts.count; i++) {
    const dayOffset = pickInt(rand, 730) - 365;
    const startDate = addDays(anchorStr, dayOffset);
    const hour = pick(rand, HOURS);
    const minute = pick(rand, QUARTER_MINUTES);
    const duration = pick(rand, DURATIONS_MIN);
    const startTime = `${pad2(hour)}:${pad2(minute)}`;
    const endShift = addMinutes(startDate, startTime, duration);
    const title = `${pick(rand, TITLES)} #${i + 1}`;

    const bucket = rand();
    if (bucket < 0.05) {
      // 5% all-day, single date span.
      events.push({
        title,
        start: `${startDate} 00:00`,
        end: `${startDate} 23:59`,
        allDay: true,
      });
      continue;
    }
    if (bucket < 0.10) {
      // 5% with one alarm OR 1-3 attendees.
      const useAlarm = rand() < 0.5;
      if (useAlarm) {
        events.push({
          title,
          start: `${startDate} ${startTime}`,
          end: `${endShift.date} ${endShift.time}`,
          alarms: [
            {
              id: `synth-alarm-${i}`,
              action: "display",
              triggerType: "relative",
              triggerValue: "-PT15M",
              description: title,
            },
          ],
        });
      } else {
        const attendeeCount = 1 + pickInt(rand, 3);
        const attendees = [];
        for (let a = 0; a < attendeeCount; a++) {
          attendees.push({
            id: `synth-att-${i}-${a}`,
            email: `synth${i}-${a}@benchmark.local`,
            role: "req-participant" as const,
            status: "needs-action" as const,
            rsvp: false,
          });
        }
        events.push({
          title,
          start: `${startDate} ${startTime}`,
          end: `${endShift.date} ${endShift.time}`,
          attendees,
        });
      }
      continue;
    }
    if (bucket < 0.20) {
      // 10% recurring.
      events.push({
        title,
        start: `${startDate} ${startTime}`,
        end: `${endShift.date} ${endShift.time}`,
        recurrence: makeRecurrence(rand),
      });
      continue;
    }
    if (bucket < 0.30) {
      // 10% timed with description.
      events.push({
        title,
        start: `${startDate} ${startTime}`,
        end: `${endShift.date} ${endShift.time}`,
        description: makeDescription(rand),
      });
      continue;
    }
    // 70% timed plain.
    events.push({
      title,
      start: `${startDate} ${startTime}`,
      end: `${endShift.date} ${endShift.time}`,
    });
  }

  return events;
}

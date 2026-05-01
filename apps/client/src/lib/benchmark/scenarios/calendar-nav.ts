/**
 * Week-view forward-nav scenario. Drives `navigate("forward")` once per
 * animation frame for the full stress window, which is the closest
 * automation can get to the user's "hold right arrow" measurement loop
 * without depending on real keyboard input timing.
 *
 * Seeding lays down a versioned synthetic calendar so Phase B compares
 * across builds. `cleanup` removes that calendar; the cascade in
 * `calendarsStore.remove` drops every seeded event in one transaction.
 */
import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import { getCalendar } from "$lib/stores/calendar.svelte";
import { getCalendars } from "$lib/stores/calendars.svelte";
import type { CalendarEvent } from "$lib/components/calendar/types";
import { generateSynthEvents, DEFAULT_SEED } from "../synth";
import { STRESS_DURATION_MS, type BenchmarkScenario, type SynthEventDraft } from "../types";

/** Anchor used by every `setup()` so Phase A and Phase B stress the same window. */
const SETUP_ANCHOR_ISO = "2026-04-30";

/** Calendar grouping name template. Renaming requires bumping `SYNTH_VERSION`. */
function synthCalendarFilename(version: string): string {
  return `benchmark-synth-${version}.ics`;
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function parseAnchor(): Date {
  const [y, m, d] = SETUP_ANCHOR_ISO.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Convert a deterministic synth draft into a full `CalendarEvent` ready for
 * `bulkImport`. The `sourceUid` is required: `classifyImportEvents` drops
 * events without one, so a deterministic per-index UID also lets a
 * re-seed land as updates rather than warn-and-skip.
 */
function draftToEvent(draft: SynthEventDraft, index: number, calendarId: string, version: string): CalendarEvent {
  const id = crypto.randomUUID();
  const event: CalendarEvent = {
    id,
    title: draft.title,
    start: draft.start,
    end: draft.end,
    timezone: localTimezone(),
    calendarId,
    sourceUid: `synth-${version}-${index}`,
    sequence: 1,
  };
  if (draft.allDay) event.allDay = true;
  if (draft.description) event.description = draft.description;
  if (draft.recurrence) event.recurrence = draft.recurrence;
  if (draft.alarms) event.alarms = draft.alarms;
  if (draft.attendees) event.attendees = draft.attendees;
  return event;
}

export const calendarNavScenario: BenchmarkScenario = {
  id: "calendar-nav",
  label: "Calendar week-view nav",
  description:
    "Drives forward week-view navigation for 3 seconds, then samples memory across the 5-minute idle decay window. Phase A runs against your current data; Phase B re-runs after a restart on a 1000-event synthetic calendar.",
  defaultSeedSize: 1000,

  async setup(): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run calendar benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseAnchor());
    // One frame for the view to settle before peak sampling starts.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  },

  runStress(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const handle = getCalendarNavHandle();
      const start = performance.now();
      let rafId = 0;

      const onAbort = () => {
        cancelAnimationFrame(rafId);
        resolve();
      };
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      function step() {
        if (signal.aborted) {
          resolve();
          return;
        }
        const elapsed = performance.now() - start;
        if (elapsed >= STRESS_DURATION_MS) {
          signal.removeEventListener("abort", onAbort);
          resolve();
          return;
        }
        handle.navigate("forward");
        rafId = requestAnimationFrame(step);
      }

      rafId = requestAnimationFrame(step);
    });
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    const calendarStore = getCalendar();
    const calendarsStore = getCalendars();
    const cal = await calendarsStore.findOrCreateImported(synthCalendarFilename(version));

    const drafts = generateSynthEvents({
      count: seedSize,
      anchor: parseAnchor(),
      seed: DEFAULT_SEED,
    });
    const events = drafts.map((d, i) => draftToEvent(d, i, cal.id, version));

    await calendarStore.bulkImport(events, cal.id);
    return { calendarId: cal.id, eventCount: events.length };
  },

  async cleanup(seedHandle: { calendarId: string }): Promise<void> {
    const calendarsStore = getCalendars();
    await calendarsStore.remove(seedHandle.calendarId);
  },
};

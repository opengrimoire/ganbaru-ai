import type { CalendarEvent } from "$lib/components/calendar/types";
import { parseCalendarDate } from "$lib/components/calendar/utils";

export interface SelectActivePomodoroBlockOptions {
  now: Date;
  activeBlockId: string | null;
  recentlyInterruptedBlockIds?: ReadonlySet<string>;
}

interface Candidate {
  event: CalendarEvent;
  endMs: number;
}

function activeCandidate(
  candidates: readonly Candidate[],
  blockId: string | null,
): CalendarEvent | undefined {
  if (!blockId) return undefined;
  return candidates.find((candidate) => candidate.event.id === blockId)?.event;
}

function compareCreatedAt(a: CalendarEvent, b: CalendarEvent): number {
  const aCreated = a.createdAt ?? "";
  const bCreated = b.createdAt ?? "";
  if (aCreated < bCreated) return -1;
  if (aCreated > bCreated) return 1;
  return a.id.localeCompare(b.id);
}

function compareCandidates(nowMs: number) {
  return (a: Candidate, b: Candidate): number => {
    const aRemaining = a.endMs - nowMs;
    const bRemaining = b.endMs - nowMs;
    if (aRemaining !== bRemaining) return aRemaining - bRemaining;
    return compareCreatedAt(a.event, b.event);
  };
}

export function selectActivePomodoroBlock(
  events: readonly CalendarEvent[],
  options: SelectActivePomodoroBlockOptions,
): CalendarEvent | undefined {
  const nowMs = options.now.getTime();
  const candidates = events
    .filter((event) => event.pomodoroConfig)
    .map<Candidate | undefined>((event) => {
      const startMs = parseCalendarDate(event.start).getTime();
      const endMs = parseCalendarDate(event.end).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
      if (nowMs < startMs || nowMs >= endMs) return undefined;
      return { event, endMs };
    })
    .filter((candidate): candidate is Candidate => candidate !== undefined);

  if (candidates.length === 0) return undefined;

  const current = activeCandidate(candidates, options.activeBlockId);
  if (current) return current;

  const interrupted = options.recentlyInterruptedBlockIds
    ? candidates.filter((candidate) => options.recentlyInterruptedBlockIds?.has(candidate.event.id))
    : [];
  if (interrupted.length > 0) {
    return interrupted.sort(compareCandidates(nowMs))[0].event;
  }

  return [...candidates].sort(compareCandidates(nowMs))[0].event;
}

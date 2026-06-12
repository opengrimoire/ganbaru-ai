import type { CalendarEvent } from "$lib/components/calendar/types";
import type { CalendarEventMutationTarget } from "./calendar-mutations";

export interface CalendarBlockStatePatch {
  blocks: CalendarEvent[];
  totalEventCount: number;
}

export function removeCalendarMutationTarget(
  blocks: readonly CalendarEvent[],
  totalEventCount: number,
  target: CalendarEventMutationTarget,
): CalendarBlockStatePatch {
  if (target.id.includes("::")) {
    const [parentId, date] = target.id.split("::");
    return {
      blocks: blocks.map((block) =>
        block.id === parentId
          ? { ...block, exceptions: [...(block.exceptions ?? []), date] }
          : block,
      ),
      totalEventCount,
    };
  }
  return {
    blocks: blocks.filter((block) => block.id !== target.id),
    totalEventCount: Math.max(0, totalEventCount - 1),
  };
}

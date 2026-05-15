import type { CalendarEvent } from "./types";

export interface EventIndicatorState {
  hasRepeat: boolean;
  hasCallLink: boolean;
  hasLocation: boolean;
  hasGenericMeeting: boolean;
  iconCount: number;
}

export function getEventIndicatorState(event: CalendarEvent): EventIndicatorState {
  const hasRepeat = !!event.recurrence || !!event.recurringParentId;
  const hasCallLink = event.hasCallLink === true || !!event.url;
  const hasLocation = !!event.location;
  const hasGenericMeeting = event.meetingEnabled === true && !hasCallLink && !hasLocation;
  const iconCount = [
    hasRepeat,
    hasCallLink,
    hasLocation,
    hasGenericMeeting,
  ].filter(Boolean).length;

  return {
    hasRepeat,
    hasCallLink,
    hasLocation,
    hasGenericMeeting,
    iconCount,
  };
}

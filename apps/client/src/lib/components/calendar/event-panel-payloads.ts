import {
  createCustomCountPomodoroConfig,
  createCustomSequencePomodoroConfig,
  createPresetPomodoroConfig,
  type PomodoroPresetKey,
  type SequencePomodoroRhythmStep,
} from "$lib/pomodoro/rhythm";
import type {
  AttendeeStatus,
  CalendarEvent,
  EventAttendee,
  EventColor,
  EventStatus,
  EventTransparency,
  EventVisibility,
  GuestPermissions,
  PomodoroConfig,
  RecurrenceConfig,
} from "./types";

export type PanelSaveData = {
  title: string;
  start: string;
  end: string;
  color?: EventColor;
  description: string;
  recurrence?: RecurrenceConfig;
  notifications?: number[];
  pomodoroConfig?: PomodoroConfig;
  allDay?: boolean;
  location?: string;
  url?: string;
  transparency?: EventTransparency;
  status?: EventStatus;
  visibility?: EventVisibility;
  meetingEnabled?: boolean;
  attendees?: EventAttendee[];
  localParticipationStatus?: AttendeeStatus;
  guestPermissions?: GuestPermissions;
};

export interface EventPanelNotificationInput {
  enabled: boolean;
  selected: ReadonlySet<number>;
  custom: ReadonlyArray<{ amount: number; unit: number }>;
}

export interface EventPanelPomodoroPayloadInput {
  allDay: boolean;
  enabled: boolean;
  preset: "adaptive" | "creative" | "balanced" | "deep" | "extended" | "custom";
  customRhythmMode: "simple" | "sequence";
  sequenceSteps: readonly SequencePomodoroRhythmStep[];
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakAfterFocusCount: number;
  idleTimeoutMinutes: number | null;
}

export interface EventPanelPayloadInput {
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  color: EventColor | undefined;
  description: string;
  recurrence: RecurrenceConfig | undefined;
  notifications: number[] | undefined;
  pomodoroConfig: PomodoroConfig | undefined;
  allDay: boolean;
  meetingEnabled: boolean;
  location: string;
  eventUrl: string;
  transparency: EventTransparency;
  eventStatus: EventStatus;
  visibility: EventVisibility;
  attendees: EventAttendee[];
  localParticipationStatus: AttendeeStatus | undefined;
  guestCanModify: boolean;
  guestCanInviteOthers: boolean;
  guestCanSeeOtherGuests: boolean;
}

export function hasNonDefaultGuestPermissions(value: GuestPermissions | undefined): boolean {
  return !!value && (value.canModify || !value.canInviteOthers || !value.canSeeOtherGuests);
}

export function hasMeetingState(value: Partial<CalendarEvent>): boolean {
  return value.meetingEnabled === true
    || !!(value.attendees && value.attendees.length > 0)
    || !!value.organizer
    || !!value.location
    || !!value.url
    || !!value.geo
    || value.localParticipationStatus !== undefined
    || hasNonDefaultGuestPermissions(value.guestPermissions);
}

export function collectEventPanelNotifications(
  input: EventPanelNotificationInput,
): number[] | undefined {
  if (!input.enabled) return undefined;
  const result: number[] = [...input.selected];
  for (const custom of input.custom) result.push(custom.amount * custom.unit);
  return result.length > 0 ? [...new Set(result)].sort((a, b) => a - b) : undefined;
}

export function buildEventPanelPomodoroConfig(
  input: EventPanelPomodoroPayloadInput,
): PomodoroConfig | undefined {
  if (input.allDay || !input.enabled) return undefined;
  if (input.preset !== "custom") {
    return createPresetPomodoroConfig(
      input.preset as PomodoroPresetKey,
      input.idleTimeoutMinutes,
    );
  }
  if (input.customRhythmMode === "sequence") {
    return createCustomSequencePomodoroConfig(
      input.sequenceSteps.length > 0
        ? [...input.sequenceSteps]
        : [{
            focusDurationMinutes: input.focusDurationMinutes,
            breakPhase: "short_break",
            breakDurationMinutes: input.shortBreakMinutes,
          }],
      input.idleTimeoutMinutes,
    );
  }
  return createCustomCountPomodoroConfig({
    focusDurationMinutes: input.focusDurationMinutes,
    shortBreakMinutes: input.shortBreakMinutes,
    longBreakMinutes: input.longBreakMinutes,
    longBreakAfterFocusCount: input.longBreakAfterFocusCount,
  }, input.idleTimeoutMinutes);
}

export function buildEventPanelChangesPayload(
  input: EventPanelPayloadInput,
): Partial<CalendarEvent> {
  return buildPayload(input);
}

export function buildEventPanelHeavyInitPayload(
  input: EventPanelPayloadInput,
): Partial<CalendarEvent> {
  const guestPermissions = guestPermissionsPayload(input);
  return {
    description: input.description,
    meetingEnabled: input.meetingEnabled || undefined,
    url: input.meetingEnabled && input.eventUrl ? input.eventUrl : undefined,
    visibility: input.visibility !== "public" ? input.visibility : undefined,
    attendees: input.meetingEnabled && input.attendees.length > 0 ? input.attendees : undefined,
    localParticipationStatus: input.meetingEnabled ? input.localParticipationStatus : undefined,
    guestPermissions: input.meetingEnabled ? guestPermissions : undefined,
  };
}

export function buildEventPanelSaveData(input: EventPanelPayloadInput): PanelSaveData {
  return buildPayload(input);
}

function buildPayload(input: EventPanelPayloadInput): PanelSaveData {
  const guestPermissions = guestPermissionsPayload(input);
  return {
    title: input.title.trim(),
    start: `${input.startDate} ${input.startTime}`,
    end: `${input.endDate} ${input.endTime}`,
    color: input.color,
    description: input.description,
    recurrence: input.recurrence,
    notifications: input.notifications,
    pomodoroConfig: input.pomodoroConfig,
    allDay: input.allDay || undefined,
    meetingEnabled: input.meetingEnabled || undefined,
    location: input.meetingEnabled && input.location ? input.location : undefined,
    url: input.meetingEnabled && input.eventUrl ? input.eventUrl : undefined,
    transparency: input.transparency !== "opaque" ? input.transparency : undefined,
    status: input.eventStatus !== "confirmed" ? input.eventStatus : undefined,
    visibility: input.visibility !== "public" ? input.visibility : undefined,
    attendees: input.meetingEnabled && input.attendees.length > 0 ? input.attendees : undefined,
    localParticipationStatus: input.meetingEnabled ? input.localParticipationStatus : undefined,
    guestPermissions: input.meetingEnabled ? guestPermissions : undefined,
  };
}

function guestPermissionsPayload(input: EventPanelPayloadInput): GuestPermissions | undefined {
  if (
    !input.guestCanModify
    && input.guestCanInviteOthers
    && input.guestCanSeeOtherGuests
  ) return undefined;
  return {
    canModify: input.guestCanModify,
    canInviteOthers: input.guestCanInviteOthers,
    canSeeOtherGuests: input.guestCanSeeOtherGuests,
  };
}

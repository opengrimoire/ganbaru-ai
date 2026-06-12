import { describe, expect, it } from "vitest";
import {
  blockedBreakEvent,
  blockedBurstEvents,
  blockedFocusEvent,
  breakSegment,
  focusSegment,
  runEvent,
} from "./adaptive-test-helpers";
import {
  deriveAdaptiveContextBucket,
  extractAdaptiveFeatures,
} from "./features";

describe("adaptive feature extraction", () => {
  it("excludes idle and manual pauses from clean focus", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
          pauseLog: [
            {
              startedAt: "2026-06-10T09:10:00.000Z",
              endedAt: "2026-06-10T09:15:00.000Z",
              reason: "idle",
            },
            {
              startedAt: "2026-06-10T09:20:00.000Z",
              endedAt: "2026-06-10T09:22:00.000Z",
              reason: "manual",
            },
          ],
        }),
      ],
    });

    expect(features.completedFocusSegments).toBe(1);
    expect(features.plannedFocusSeconds).toBe(40 * 60);
    expect(features.cleanFocusSeconds).toBe(33 * 60);
    expect(features.idlePauseCount).toBe(1);
    expect(features.idlePauseSeconds).toBe(5 * 60);
    expect(features.focusIdlePauseCount).toBe(1);
    expect(features.focusIdlePauseSeconds).toBe(5 * 60);
    expect(features.earlyFocusIdlePauseCount).toBe(1);
    expect(features.lateFocusIdlePauseCount).toBe(0);
    expect(features.manualPauseSeconds).toBe(2 * 60);
  });

  it("splits focus idle pauses by focus timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
          pauseLog: [
            {
              startedAt: "2026-06-10T09:03:00.000Z",
              endedAt: "2026-06-10T09:05:00.000Z",
              reason: "idle",
            },
            {
              startedAt: "2026-06-10T09:20:00.000Z",
              endedAt: "2026-06-10T09:22:00.000Z",
              reason: "idle",
            },
            {
              startedAt: "2026-06-10T09:37:00.000Z",
              endedAt: "2026-06-10T09:39:00.000Z",
              reason: "idle",
            },
          ],
        }),
      ],
    });

    expect(features.focusIdlePauseCount).toBe(3);
    expect(features.focusIdlePauseSeconds).toBe(6 * 60);
    expect(features.earlyFocusIdlePauseCount).toBe(1);
    expect(features.lateFocusIdlePauseCount).toBe(1);
  });

  it("counts blocked-site bursts in focus phases", () => {
    const features = extractAdaptiveFeatures({
      segments: [],
      blockEvents: blockedBurstEvents(),
    });

    expect(features.blockedAttemptCount).toBe(6);
    expect(features.focusBlockedAttemptCount).toBe(6);
    expect(features.blockedBurstCount).toBe(2);
  });

  it("counts repeated blocked attempts against the same source", () => {
    const features = extractAdaptiveFeatures({
      segments: [],
      blockEvents: [
        blockedFocusEvent("2026-06-10T09:01:00.000Z", "social-a"),
        blockedFocusEvent("2026-06-10T09:02:00.000Z", "social-a"),
        blockedFocusEvent("2026-06-10T09:03:00.000Z", "social-a"),
        blockedFocusEvent("2026-06-10T09:04:00.000Z", "social-b"),
        blockedFocusEvent("2026-06-10T09:05:00.000Z", "social-b"),
        blockedBreakEvent("2026-06-10T09:46:00.000Z", "short_break", "video-a"),
        blockedBreakEvent("2026-06-10T09:47:00.000Z", "short_break", "video-a"),
      ],
    });

    expect(features.repeatedBlockedSourceAttemptCount).toBe(4);
    expect(features.focusRepeatedBlockedSourceAttemptCount).toBe(3);
    expect(features.breakRepeatedBlockedSourceAttemptCount).toBe(1);
  });

  it("splits focus blocked attempts by focus timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
        }),
      ],
      blockEvents: [
        blockedFocusEvent("2026-06-10T09:02:00.000Z"),
        blockedFocusEvent("2026-06-10T09:08:00.000Z"),
        blockedFocusEvent("2026-06-10T09:20:00.000Z"),
        blockedFocusEvent("2026-06-10T09:34:00.000Z"),
        blockedFocusEvent("2026-06-10T09:38:00.000Z"),
      ],
    });

    expect(features.focusBlockedAttemptCount).toBe(5);
    expect(features.earlyFocusBlockedAttemptCount).toBe(2);
    expect(features.lateFocusBlockedAttemptCount).toBe(2);
  });

  it("splits go to break now events by focus timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:03:00.000Z",
          phase: "focus",
        }),
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:20:00.000Z",
          phase: "focus",
        }),
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:37:00.000Z",
          phase: "focus",
        }),
      ],
    });

    expect(features.goToBreakNowCount).toBe(3);
    expect(features.earlyGoToBreakNowCount).toBe(1);
    expect(features.lateGoToBreakNowCount).toBe(1);
  });

  it("infers go to break now from early focus completion before a break", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:08:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        breakSegment({
          plannedStart: "2026-06-10T09:08:00.000Z",
          plannedEnd: "2026-06-10T09:13:00.000Z",
          actualStart: "2026-06-10T09:08:00.000Z",
          actualEnd: "2026-06-10T09:13:00.000Z",
        }),
      ],
    });

    expect(features.goToBreakNowCount).toBe(1);
    expect(features.earlyGoToBreakNowCount).toBe(1);
    expect(features.lateGoToBreakNowCount).toBe(0);
  });

  it("does not double count explicit go to break now events", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:08:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        breakSegment({
          plannedStart: "2026-06-10T09:08:00.000Z",
          plannedEnd: "2026-06-10T09:13:00.000Z",
          actualStart: "2026-06-10T09:08:00.000Z",
          actualEnd: "2026-06-10T09:13:00.000Z",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:08:00.000Z",
          phase: "focus",
        }),
      ],
    });

    expect(features.goToBreakNowCount).toBe(1);
    expect(features.earlyGoToBreakNowCount).toBe(1);
  });

  it("tracks blocked attempts that happen during break overtime", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          phase: "short_break",
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:49:00.000Z",
        }),
        breakSegment({
          phase: "long_break",
          plannedStart: "2026-06-10T10:30:00.000Z",
          plannedEnd: "2026-06-10T10:40:00.000Z",
          actualStart: "2026-06-10T10:30:00.000Z",
          actualEnd: "2026-06-10T10:46:00.000Z",
        }),
      ],
      blockEvents: [
        blockedBreakEvent("2026-06-10T09:44:00.000Z", "short_break"),
        blockedBreakEvent("2026-06-10T09:47:00.000Z", "short_break"),
        blockedBreakEvent("2026-06-10T10:43:00.000Z", "long_break"),
      ],
    });

    expect(features.breakBlockedAttemptCount).toBe(3);
    expect(features.breakOvertimeBlockedAttemptCount).toBe(2);
    expect(features.shortBreakOvertimeBlockedAttemptCount).toBe(1);
    expect(features.longBreakOvertimeBlockedAttemptCount).toBe(1);
  });

  it("tracks failures that cluster late in a rhythm", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          rhythmPosition: 1,
          status: "completed",
          endReason: "completed",
        }),
        focusSegment({
          rhythmPosition: 3,
          status: "interrupted",
          endReason: "focus_failed",
        }),
        focusSegment({
          rhythmPosition: 4,
          status: "interrupted",
          endReason: "focus_failed",
        }),
      ],
    });

    expect(features.focusFailureCount).toBe(2);
    expect(features.lateFocusSegmentCount).toBe(2);
    expect(features.lateFocusFailureCount).toBe(2);
  });

  it("classifies early break endings by the next focus outcome", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:43:00.000Z",
        }),
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:43:00.000Z",
          actualEnd: "2026-06-10T10:23:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        breakSegment({
          plannedStart: "2026-06-10T10:23:00.000Z",
          plannedEnd: "2026-06-10T10:28:00.000Z",
          actualStart: "2026-06-10T10:23:00.000Z",
          actualEnd: "2026-06-10T10:25:00.000Z",
        }),
        focusSegment({
          plannedStart: "2026-06-10T10:28:00.000Z",
          plannedEnd: "2026-06-10T11:08:00.000Z",
          actualStart: "2026-06-10T10:25:00.000Z",
          actualEnd: "2026-06-10T10:40:00.000Z",
          status: "interrupted",
          endReason: "focus_failed",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "start_focus_now",
          occurredAt: "2026-06-10T09:43:00.000Z",
          phase: "short_break",
        }),
        runEvent({
          eventType: "start_focus_now",
          occurredAt: "2026-06-10T10:25:00.000Z",
          phase: "short_break",
        }),
      ],
    });

    expect(features.startFocusNowCount).toBe(2);
    expect(features.startFocusNowSuccessCount).toBe(1);
    expect(features.startFocusNowFailureCount).toBe(1);
  });

  it("infers early break endings from timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:42:00.000Z",
          status: "interrupted",
          endReason: "skipped_by_user",
        }),
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:42:00.000Z",
          actualEnd: "2026-06-10T10:22:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
      ],
    });

    expect(features.startFocusNowCount).toBe(1);
    expect(features.startFocusNowSuccessCount).toBe(1);
    expect(features.startFocusNowFailureCount).toBe(0);
  });

  it("does not infer early break endings from system interruptions", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:42:00.000Z",
          status: "interrupted",
          endReason: "reconfigured",
        }),
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:42:00.000Z",
          actualEnd: "2026-06-10T10:22:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
      ],
    });

    expect(features.startFocusNowCount).toBe(0);
    expect(features.startFocusNowSuccessCount).toBe(0);
    expect(features.startFocusNowFailureCount).toBe(0);
  });

  it("classifies skipped breaks by the next focus outcome", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:45:00.000Z",
          actualEnd: "2026-06-10T10:25:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        focusSegment({
          plannedStart: "2026-06-10T10:45:00.000Z",
          plannedEnd: "2026-06-10T11:25:00.000Z",
          actualStart: "2026-06-10T10:45:00.000Z",
          actualEnd: "2026-06-10T11:00:00.000Z",
          status: "interrupted",
          endReason: "focus_failed",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "skip_break",
          occurredAt: "2026-06-10T09:40:00.000Z",
          phase: "short_break",
        }),
        runEvent({
          eventType: "skip_break",
          occurredAt: "2026-06-10T10:25:00.000Z",
          phase: "long_break",
        }),
      ],
    });

    expect(features.breakSkippedCount).toBe(2);
    expect(features.skippedBreakNextFocusSuccessCount).toBe(1);
    expect(features.skippedBreakNextFocusFailureCount).toBe(1);
    expect(features.skippedShortBreakNextFocusFailureCount).toBe(0);
    expect(features.skippedLongBreakNextFocusFailureCount).toBe(1);
  });

  it("derives coarse context buckets", () => {
    expect(deriveAdaptiveContextBucket({
      localStartedAt: "2026-06-10T08:30:00.000Z",
      plannedEventMinutes: 120,
      sessionIndexToday: 1,
      cleanFocusMinutesToday: 45,
      energyLevel: 2,
      environmentId: "env-1",
    })).toEqual({
      timeOfDay: "morning",
      sessionPosition: "first",
      eventLength: "medium",
      workload: "low",
      energy: "low",
      environmentId: "env-1",
    });
  });
});

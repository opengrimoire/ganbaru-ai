import { describe, expect, it } from "vitest";
import {
  clampRate,
  clampVolume,
  formatRateLabel,
  formatPlaybackTime,
  formatVolumePercent,
  initialQueueSelection,
  isSpeedPreset,
  localMediaSeekTargetMs,
  nextShuffleIndex,
  normalizeLocalPlayableStartMs,
  previousQueueSelection,
  shouldPersistPlaybackState,
  shouldUseWebviewLocalVideo,
  stableStatusDuringYouTubeBuffering,
  type PersistedPlaybackState,
} from "./playback";

const previous: PersistedPlaybackState = {
  sourceIdentity: "youtube:video:abc",
  sourceKind: "youtube-video",
  positionMs: 10_000,
  durationMs: 120_000,
  status: "playing",
  updatedAt: 1_000,
};

describe("shouldPersistPlaybackState", () => {
  it("persists when status changes", () => {
    expect(shouldPersistPlaybackState({
      sourceIdentity: "youtube:video:abc",
      sourceKind: "youtube-video",
      positionMs: 10_500,
      durationMs: 120_000,
      status: "paused",
      nowMs: 1_100,
    }, previous)).toBe(true);
  });

  it("throttles small position updates", () => {
    expect(shouldPersistPlaybackState({
      sourceIdentity: "youtube:video:abc",
      sourceKind: "youtube-video",
      positionMs: 11_000,
      durationMs: 120_000,
      status: "playing",
      nowMs: 2_000,
    }, previous)).toBe(false);
  });

  it("persists after the interval", () => {
    expect(shouldPersistPlaybackState({
      sourceIdentity: "youtube:video:abc",
      sourceKind: "youtube-video",
      positionMs: 11_000,
      durationMs: 120_000,
      status: "playing",
      nowMs: 6_000,
    }, previous)).toBe(true);
  });
});

describe("formatPlaybackTime", () => {
  it("formats minute and hour durations", () => {
    expect(formatPlaybackTime(61_000)).toBe("1:01");
    expect(formatPlaybackTime(3_661_000)).toBe("1:01:01");
    expect(formatPlaybackTime(null)).toBe("0:00");
  });
});

describe("stableStatusDuringYouTubeBuffering", () => {
  it("keeps playback controls stable during normal YouTube buffering", () => {
    expect(stableStatusDuringYouTubeBuffering("playing", "loading")).toBe("playing");
    expect(stableStatusDuringYouTubeBuffering("paused", "loading")).toBe("paused");
    expect(stableStatusDuringYouTubeBuffering("loading", "loading")).toBe("loading");
  });

  it("accepts non-buffering YouTube status changes", () => {
    expect(stableStatusDuringYouTubeBuffering("playing", "paused")).toBe("paused");
    expect(stableStatusDuringYouTubeBuffering("paused", "playing")).toBe("playing");
  });
});

describe("clamp helpers", () => {
  it("keeps volume and rate in supported ranges", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
    expect(clampRate(0.1)).toBe(0.25);
    expect(clampRate(4)).toBe(2);
  });

  it("formats volume using the normal volume cap", () => {
    expect(formatVolumePercent(0.75)).toBe("75%");
    expect(formatVolumePercent(1.25)).toBe("100%");
  });

  it("mounts the WebView element for local video playback", () => {
    expect(shouldUseWebviewLocalVideo({
      backendKind: "webview",
      hasVideo: true,
    })).toBe(true);
    expect(shouldUseWebviewLocalVideo({
      backendKind: "rodio",
      hasVideo: false,
    })).toBe(false);
  });

  it("keeps local media seeks out of a non-playable prefix", () => {
    const playableStartMs = normalizeLocalPlayableStartMs(62_200);

    expect(playableStartMs).toBe(62_200);
    expect(localMediaSeekTargetMs(0, playableStartMs)).toBe(62_200);
    expect(localMediaSeekTargetMs(10_000, playableStartMs)).toBe(62_200);
    expect(localMediaSeekTargetMs(72_200, playableStartMs)).toBe(72_200);
  });

  it("formats preset and custom speed labels", () => {
    expect(isSpeedPreset(1.25)).toBe(true);
    expect(isSpeedPreset(1.33)).toBe(false);
    expect(formatRateLabel(1)).toBe("1x");
    expect(formatRateLabel(1.25)).toBe("1.25x");
    expect(formatRateLabel(4)).toBe("2x");
  });
});

describe("queue helpers", () => {
  it("selects a shuffled initial track when shuffle is enabled", () => {
    const random = () => 0;

    expect(initialQueueSelection(4, true, random)).toEqual({
      index: 1,
      remainingOrder: [2, 3, 0],
    });
    expect(initialQueueSelection(4, false, random)).toEqual({
      index: 0,
      remainingOrder: [],
    });
  });

  it("does not immediately repeat a shuffled track until the queue is exhausted", () => {
    const random = () => 0;
    const first = nextShuffleIndex(3, 0, [], random);
    expect(first.index).not.toBe(0);
    const second = nextShuffleIndex(3, first.index ?? 0, first.remainingOrder, random);
    expect(second.index).not.toBe(first.index);
    const third = nextShuffleIndex(3, second.index ?? 0, second.remainingOrder, random);
    expect(third.index).not.toBe(second.index);
  });

  it("restarts previous behavior after the threshold", () => {
    expect(previousQueueSelection(2, 3_500, 4)).toEqual({
      action: "restart",
      index: 2,
    });
    expect(previousQueueSelection(2, 2_000, 4)).toEqual({
      action: "previous",
      index: 1,
    });
  });
});

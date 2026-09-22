import { afterEach, describe, expect, it, vi } from "vitest";
import { getMusicRecentSelections, recordMusicListening } from "$lib/api/music-library";
import { localFileSourceFromPath } from "$lib/music/sources";
import { emptyMusicSkipBreakdown, type MusicSavedQueueEntry } from "$lib/music/music-playlist-playback";
import { MusicSavedPlaylistRuntime } from "./music-saved-playlist-runtime";

vi.mock("$lib/api/music-library", () => ({
  getMusicRecentSelections: vi.fn(async () => []),
  recordMusicListening: vi.fn(async () => undefined),
}));

const entry = (patch: Partial<MusicSavedQueueEntry> = {}): MusicSavedQueueEntry => ({
  membershipId: "membership-1",
  itemId: "item-1",
  identityKey: "local:item-1",
  source: localFileSourceFromPath("/music/track.flac", "Track"),
  sourceKind: "local-file",
  availability: "available",
  youtubeResolutionState: null,
  weight: "normal",
  enabled: true,
  snoozedUntil: null,
  snoozedIndefinitely: false,
  skipRanges: [],
  volume: null,
  rate: null,
  ...patch,
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("saved playlist runtime", () => {
  it("loads only the bounded recent item identities", async () => {
    vi.mocked(getMusicRecentSelections).mockResolvedValue([
      { itemId: "item-2", selectedAt: 2 },
      { itemId: "item-1", selectedAt: 1 },
    ]);
    const runtime = new MusicSavedPlaylistRuntime(vi.fn());
    await expect(runtime.recentItemIds("playlist-1")).resolves.toEqual(["item-2", "item-1"]);
    expect(getMusicRecentSelections).toHaveBeenCalledWith("playlist-1", 32);
  });

  it("serializes listening writes and keeps aggregate outcomes separate", async () => {
    const firstWrite: { release: () => void } = { release: () => {} };
    vi.mocked(recordMusicListening)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { firstWrite.release = resolve; }))
      .mockResolvedValue(undefined);
    const runtime = new MusicSavedPlaylistRuntime(vi.fn(), () => 100);
    runtime.recordSelection("playlist-1", entry(), "manual");
    runtime.recordOutcome("playlist-1", entry(), "completed");
    await vi.waitFor(() => expect(recordMusicListening).toHaveBeenCalledTimes(1));
    expect(recordMusicListening).toHaveBeenCalledTimes(1);
    firstWrite.release();
    await vi.waitFor(() => expect(recordMusicListening).toHaveBeenCalledTimes(2));
    expect(vi.mocked(recordMusicListening).mock.calls[1]?.[0].outcome).toBe("completed");
  });

  it("combines structural and live eligibility reasons", () => {
    const runtime = new MusicSavedPlaylistRuntime(vi.fn(), () => 100);
    const structural = emptyMusicSkipBreakdown();
    structural["unbound-root"] = 1;
    runtime.setStructuralSkipped(structural);
    expect(runtime.breakdown([entry({ snoozedUntil: 200 })], true))
      .toMatchObject({ snoozed: 1, "unbound-root": 1 });
  });

  it("does not seek repeatedly inside the same skip range", () => {
    const runtime = new MusicSavedPlaylistRuntime(vi.fn());
    const ranged = entry({ skipRanges: [{ id: "skip", membershipId: "membership-1", startMs: 10, endMs: 20, sortOrder: 0 }] });
    expect(runtime.skipTarget(15, ranged)).toBe(20);
    expect(runtime.skipTarget(16, ranged)).toBeNull();
    expect(runtime.skipTarget(25, ranged)).toBeNull();
    expect(runtime.skipTarget(15, ranged)).toBe(20);
  });

  it("restores playlist eligibility state after a temporary playback session", () => {
    const runtime = new MusicSavedPlaylistRuntime(vi.fn(), () => 100);
    const structural = emptyMusicSkipBreakdown();
    structural["unbound-root"] = 1;
    runtime.setStructuralSkipped(structural);
    const checkpoint = runtime.checkpoint();
    runtime.reset();

    runtime.restore(checkpoint, [entry({ snoozedUntil: 200 })]);

    expect(runtime.breakdown([entry({ snoozedUntil: 200 })], true))
      .toMatchObject({ snoozed: 1, "unbound-root": 1 });
    runtime.destroy();
  });

  it("refreshes eligibility when the nearest Snooze expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const expired = vi.fn();
    const runtime = new MusicSavedPlaylistRuntime(expired, Date.now);
    runtime.scheduleSnoozeExpiry([entry({ snoozedUntil: 150 })]);
    vi.advanceTimersByTime(76);
    expect(expired).toHaveBeenCalledOnce();
    runtime.destroy();
  });
});

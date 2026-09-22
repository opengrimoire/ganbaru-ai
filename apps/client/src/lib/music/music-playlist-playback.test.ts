import { describe, expect, it } from "vitest";
import type { MusicPlaylistPlaybackEntry } from "$lib/music/library-contracts";
import {
  buildMusicShuffleCycle,
  evaluateMusicQueueEntry,
  nextSequentialQueueIndex,
  projectMusicPlaylistPlayback,
  selectFreshMusicQueueItem,
  selectMusicMixIndex,
  skipRangeTargetMs,
} from "./music-playlist-playback";

const entry = (patch: Partial<MusicPlaylistPlaybackEntry> = {}): MusicPlaylistPlaybackEntry => ({
  membershipId: "membership-1", itemId: "item-1", identityKey: "local:item-1", sourceKind: "local-file",
  youtubeVideoId: null, youtubeResolutionState: null, title: "Track", originalArtworkIdentity: null, artworkOverride: null,
  availability: "available", rootId: "root", relativePath: "album/track.flac",
  position: 0, weight: "normal", enabled: true, startMs: null, endMs: null, volume: null, rate: null,
  snoozed: false, snoozedUntil: null, snoozedIndefinitely: false, skipRanges: [], ...patch,
});

const context = { nowMs: 1_700_000_000_000, online: true };

describe("saved playlist playback policy", () => {
  it("keeps resolvable entries while reporting one typed eligibility reason", () => {
    const projection = projectMusicPlaylistPlayback([
      entry(),
      entry({ membershipId: "disabled", itemId: "disabled", position: 1, enabled: false }),
      entry({ membershipId: "snoozed", itemId: "snoozed", position: 2, snoozed: true, snoozedIndefinitely: true }),
      entry({ membershipId: "unbound", itemId: "unbound", position: 3, rootId: "missing-root" }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], context);
    expect(projection.entries).toHaveLength(3);
    expect(projection.eligibleIndices).toEqual([0]);
    expect(projection.skipped).toMatchObject({ disabled: 1, snoozed: 1, "unbound-root": 1 });
  });

  it("resolves sidecar and override artwork for local playlist sources", () => {
    const projection = projectMusicPlaylistPlayback([
      entry({ originalArtworkIdentity: "sidecar:album/cover.jpg" }),
      entry({
        membershipId: "override",
        itemId: "override",
        position: 1,
        artworkOverride: "/custom/artwork.png",
      }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], context);

    expect(projection.sources[0]).toMatchObject({
      path: "/music/album/track.flac",
      artworkPath: "/music/album/cover.jpg",
    });
    expect(projection.sources[1]).toMatchObject({ artworkPath: "/custom/artwork.png" });
  });

  it("allows explicit play to bypass Snooze without bypassing disabled state", () => {
    const projection = projectMusicPlaylistPlayback([
      entry({ snoozed: true, snoozedIndefinitely: true }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], { ...context, explicitItemId: "item-1" });
    expect(projection.eligibleIndices).toEqual([0]);
    expect(evaluateMusicQueueEntry({ ...projection.entries[0], enabled: false }, { ...context, explicitItemId: "item-1" }).reason).toBe("disabled");
  });

  it("uses the same typed evaluator for phase-specific eligibility", () => {
    const projection = projectMusicPlaylistPlayback([
      entry(),
      entry({ itemId: "phase-item", membershipId: "phase-item", position: 1 }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], {
      ...context,
      phaseAllowedItemIds: new Set(["phase-item"]),
    });
    expect(projection.eligibleIndices).toEqual([1]);
    expect(projection.skipped["phase-constraint"]).toBe(1);
  });

  it("uses the local subset while offline and reports skipped online entries", () => {
    const projection = projectMusicPlaylistPlayback([
      entry(),
      entry({ membershipId: "online", itemId: "online", identityKey: "youtube:abc", sourceKind: "youtube-video", youtubeVideoId: "abcdefghijk", youtubeResolutionState: "ready", rootId: null, relativePath: null, position: 1 }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], { ...context, online: false });
    expect(projection.eligibleIndices).toEqual([0]);
    expect(projection.skipped.offline).toBe(1);
  });

  it("wraps sequential order only for the configured repeat mode", () => {
    expect(nextSequentialQueueIndex([0, 2, 4], 2, "off")).toBe(4);
    expect(nextSequentialQueueIndex([0, 2, 4], 4, "off")).toBeNull();
    expect(nextSequentialQueueIndex([0, 2, 4], 4, "all")).toBe(0);
    expect(nextSequentialQueueIndex([0, 2, 4], 2, "one")).toBe(2);
  });

  it("shuffles every eligible song once while avoiding the active item", () => {
    const projection = projectMusicPlaylistPlayback([
      entry({ itemId: "rare", membershipId: "rare", weight: "rarely" }),
      entry({ itemId: "normal", membershipId: "normal", position: 1 }),
      entry({ itemId: "frequent", membershipId: "frequent", position: 2, weight: "much-more-often" }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], context);
    let seed = 17;
    const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const cycle = buildMusicShuffleCycle(projection.eligibleIndices, 1, random);
    expect(cycle).toHaveLength(2);
    expect(new Set(cycle)).toEqual(new Set([0, 2]));
    expect(cycle).not.toContain(1);
  });

  it("advances sequentially at a phase boundary and wraps without resuming the interrupted item", () => {
    const projection = projectMusicPlaylistPlayback([
      entry({ itemId: "first", membershipId: "first" }),
      entry({ itemId: "second", membershipId: "second", position: 1 }),
      entry({ itemId: "third", membershipId: "third", position: 2 }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], context);
    expect(selectFreshMusicQueueItem(projection.entries, projection.eligibleIndices, {
      shuffle: false,
      avoidItemId: "second",
    }).index).toBe(2);
    expect(selectFreshMusicQueueItem(projection.entries, projection.eligibleIndices, {
      shuffle: false,
      avoidItemId: "third",
    }).index).toBe(0);
  });

  it("draws another eligible shuffle membership at a phase boundary", () => {
    const projection = projectMusicPlaylistPlayback([
      entry({ itemId: "first", membershipId: "first" }),
      entry({ itemId: "second", membershipId: "second", position: 1 }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], context);
    expect(selectFreshMusicQueueItem(projection.entries, projection.eligibleIndices, {
      shuffle: true,
      avoidItemId: "first",
      random: () => 0.5,
    }).index).toBe(1);
  });

  it("can start the only eligible Shuffle track at a phase boundary", () => {
    const projection = projectMusicPlaylistPlayback([
      entry({ itemId: "only", membershipId: "only" }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], context);
    expect(selectFreshMusicQueueItem(projection.entries, projection.eligibleIndices, {
      shuffle: true,
      avoidItemId: "only",
    }).index).toBe(0);
  });

  it("lets every eligible song lead a uniform Shuffle pass", () => {
    const first = (draws: readonly number[]) => {
      let index = 0;
      return buildMusicShuffleCycle([0, 1, 2], -1, () => draws[index++])[0];
    };
    expect(new Set([first([0, 0]), first([0, 0.9]), first([0.5, 0.9])])).toEqual(new Set([0, 1, 2]));
  });

  it("mixes by preference but keeps a small chance of replaying the most recent song", () => {
    const projection = projectMusicPlaylistPlayback([
      entry({ itemId: "rare", membershipId: "rare", weight: "rarely" }),
      entry({ itemId: "normal", membershipId: "normal", position: 1 }),
      entry({ itemId: "favorite", membershipId: "favorite", position: 2, weight: "much-more-often" }),
    ], [{ rootId: "root", folderPath: "/music", status: "available" }], context);
    expect(selectMusicMixIndex(projection.entries, projection.eligibleIndices, [], () => 0)).toBe(0);
    expect(selectMusicMixIndex(projection.entries, projection.eligibleIndices, [], () => 0.2)).toBe(1);
    expect(selectMusicMixIndex(projection.entries, projection.eligibleIndices, [], () => 0.9)).toBe(2);
    expect(selectMusicMixIndex(projection.entries, projection.eligibleIndices, ["favorite"], () => 0.9)).toBe(1);
    expect(selectMusicMixIndex(projection.entries, projection.eligibleIndices, ["favorite"], () => 0.99)).toBe(2);
    expect(selectMusicMixIndex(projection.entries, [], [], () => 0.5)).toBeNull();
  });

  it("seeks to the end of the active ordered skip range", () => {
    const ranges = [{ id: "range", membershipId: "membership-1", startMs: 10_000, endMs: 15_000, sortOrder: 0 }];
    expect(skipRangeTargetMs(12_000, ranges)).toBe(15_000);
    expect(skipRangeTargetMs(15_000, ranges)).toBeNull();
  });
});

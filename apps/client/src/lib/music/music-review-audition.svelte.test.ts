import { beforeEach, describe, expect, it, vi } from "vitest";

const player = vi.hoisted(() => ({
  contextOwner: "manual" as "manual" | "review" | "calendar-event" | "pomodoro",
  activePlaylistId: "playlist-1" as string | null,
  activePlaylistName: "Focus" as string | null,
  activePlaylistRepeatMode: "all" as "off" | "all" | "one",
  activeQueueItemIds: ["item-1", "item-2"],
  savedQueueEntries: [{ itemId: "item-1" }, { itemId: "item-2" }],
  snapshot: { positionMs: 42_000 },
}));

vi.mock("$lib/stores/music-player.svelte", () => ({
  getMusicPlayer: () => player,
}));

import { MusicReviewAuditionController } from "./music-review-audition.svelte";

describe("MusicReviewAuditionController", () => {
  beforeEach(() => {
    player.contextOwner = "manual";
    player.activePlaylistId = "playlist-1";
    player.activePlaylistName = "Focus";
    player.activePlaylistRepeatMode = "all";
    player.activeQueueItemIds = ["item-1", "item-2"];
    player.savedQueueEntries = [{ itemId: "item-1" }, { itemId: "item-2" }];
  });

  it("does not clear a playlist that superseded a stale review audition", () => {
    const audition = new MusicReviewAuditionController();
    audition.active = true;
    audition.reviewItemId = "review-item";

    audition.keep();

    expect(player.activePlaylistId).toBe("playlist-1");
    expect(player.activePlaylistName).toBe("Focus");
    expect(player.activeQueueItemIds).toEqual(["item-1", "item-2"]);
    expect(player.savedQueueEntries).toEqual([{ itemId: "item-1" }, { itemId: "item-2" }]);
    expect(audition.active).toBe(false);
  });

  it("clears queue ownership when the review audition still owns playback", () => {
    const audition = new MusicReviewAuditionController();
    audition.active = true;
    audition.reviewItemId = "review-item";
    player.contextOwner = "review";

    audition.keep();

    expect(player.contextOwner).toBe("manual");
    expect(player.activePlaylistId).toBeNull();
    expect(player.activePlaylistName).toBeNull();
    expect(player.activeQueueItemIds).toEqual([]);
    expect(player.savedQueueEntries).toEqual([]);
    expect(audition.active).toBe(false);
  });
});

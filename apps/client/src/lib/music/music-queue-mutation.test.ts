import { describe, expect, it } from "vitest";
import { planMusicQueueMutation, type MusicActiveQueueIdentity } from "./music-queue-mutation";

const active: MusicActiveQueueIdentity = {
  playlistId: "playlist-1",
  membershipId: "membership-1",
  itemId: "item-1",
};

describe("music queue mutation planning", () => {
  it("keeps an active removed membership audible until a safe transition", () => {
    expect(planMusicQueueMutation(active, {
      kind: "membership-removed",
      playlistId: "playlist-1",
      membershipId: "membership-1",
    })).toMatchObject({ action: "remove-membership", preserveCurrentMedia: true, deferActiveRemovalUntilTransition: true });
  });

  it("updates inactive removals and reorder without interrupting playback", () => {
    expect(planMusicQueueMutation(active, {
      kind: "membership-removed",
      playlistId: "playlist-1",
      membershipId: "membership-2",
    }).deferActiveRemovalUntilTransition).toBe(false);
    expect(planMusicQueueMutation(active, {
      kind: "playlist-reordered",
      playlistId: "playlist-1",
      orderedItemIds: ["item-2", "item-1"],
    })).toMatchObject({ action: "reorder", preserveCurrentMedia: true });
  });

  it("rebuilds weighted selection without restarting the active item", () => {
    expect(planMusicQueueMutation(active, {
      kind: "weight-changed",
      playlistId: "playlist-1",
      membershipId: "membership-1",
    })).toMatchObject({ action: "none", preserveCurrentMedia: true });
  });

  it("detaches a deleted playlist or switches to its chosen replacement", () => {
    expect(planMusicQueueMutation(active, {
      kind: "playlist-deleted",
      playlistId: "playlist-1",
      replacementPlaylistId: null,
    }).action).toBe("detach-playlist");
    expect(planMusicQueueMutation(active, {
      kind: "playlist-deleted",
      playlistId: "playlist-1",
      replacementPlaylistId: "playlist-2",
    }).action).toBe("switch-playlist");
  });

  it("defers an active source repair but stops and releases local hosts on vault change", () => {
    expect(planMusicQueueMutation(active, { kind: "source-repaired", itemId: "item-1" }))
      .toMatchObject({ action: "refresh-source-after-current", preserveCurrentMedia: true });
    expect(planMusicQueueMutation(active, { kind: "vault-switched" }))
      .toMatchObject({ action: "stop-and-clear", preserveCurrentMedia: false, releaseLocalHost: true });
  });

  it("ignores mutations from another playlist", () => {
    expect(planMusicQueueMutation(active, {
      kind: "playlist-reordered",
      playlistId: "playlist-2",
      orderedItemIds: [],
    }).action).toBe("none");
  });
});

export interface MusicActiveQueueIdentity {
  playlistId: string | null;
  membershipId: string | null;
  itemId: string | null;
}

export type MusicQueueMutation =
  | { kind: "membership-removed"; playlistId: string; membershipId: string }
  | { kind: "playlist-reordered"; playlistId: string; orderedItemIds: string[] }
  | { kind: "weight-changed"; playlistId: string; membershipId: string }
  | { kind: "playlist-deleted"; playlistId: string; replacementPlaylistId: string | null }
  | { kind: "source-repaired"; itemId: string }
  | { kind: "vault-switched" };

export type MusicQueueMutationAction =
  | "none"
  | "remove-membership"
  | "reorder"
  | "refresh-source-after-current"
  | "detach-playlist"
  | "switch-playlist"
  | "stop-and-clear";

export interface MusicQueueMutationPlan {
  action: MusicQueueMutationAction;
  preserveCurrentMedia: boolean;
  releaseLocalHost: boolean;
  deferActiveRemovalUntilTransition: boolean;
}

/** Plans queue changes without coupling persistence mutations to playback backends. */
export function planMusicQueueMutation(
  active: MusicActiveQueueIdentity,
  mutation: MusicQueueMutation,
): MusicQueueMutationPlan {
  const unrelatedPlaylist = "playlistId" in mutation
    && active.playlistId !== mutation.playlistId;
  if (mutation.kind !== "vault-switched" && mutation.kind !== "source-repaired" && unrelatedPlaylist) {
    return plan("none", true);
  }
  if (mutation.kind === "vault-switched") return plan("stop-and-clear", false, true);
  if (mutation.kind === "playlist-deleted") {
    return plan(mutation.replacementPlaylistId ? "switch-playlist" : "detach-playlist", true);
  }
  if (mutation.kind === "playlist-reordered") return plan("reorder", true);
  if (mutation.kind === "weight-changed") return plan("none", true);
  if (mutation.kind === "source-repaired") {
    return mutation.itemId === active.itemId
      ? plan("refresh-source-after-current", true)
      : plan("none", true);
  }
  const activeRemoval = mutation.membershipId === active.membershipId;
  return {
    ...plan("remove-membership", true),
    deferActiveRemovalUntilTransition: activeRemoval,
  };
}

function plan(
  action: MusicQueueMutationAction,
  preserveCurrentMedia: boolean,
  releaseLocalHost = false,
): MusicQueueMutationPlan {
  return { action, preserveCurrentMedia, releaseLocalHost, deferActiveRemovalUntilTransition: false };
}

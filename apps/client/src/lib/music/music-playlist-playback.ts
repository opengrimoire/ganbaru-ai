import type {
  LocalRootBinding,
  MusicItemAvailability,
  MusicMembershipSkipRange,
  MusicPlaylistPlaybackEntry,
  MusicRepeatMode,
  MusicWeight,
  MusicYouTubeResolutionState,
} from "$lib/music/library-contracts";
import { resolveLocalMusicPath } from "$lib/music/platform-paths";
import { localFileSourceFromPath, youtubeVideoSourceFromId, type MusicSource } from "$lib/music/sources";

export type MusicPlaylistSkipReason =
  | "disabled"
  | "snoozed"
  | "offline"
  | "unavailable"
  | "embedding-blocked"
  | "phase-constraint"
  | "unbound-root"
  | "invalid-source";

export interface MusicSavedQueueEntry {
  membershipId: string;
  itemId: string;
  identityKey: string;
  source: MusicSource;
  sourceKind: MusicPlaylistPlaybackEntry["sourceKind"];
  availability: MusicItemAvailability;
  youtubeResolutionState: MusicYouTubeResolutionState | null;
  weight: MusicWeight;
  enabled: boolean;
  snoozedUntil: number | null;
  snoozedIndefinitely: boolean;
  skipRanges: MusicMembershipSkipRange[];
  volume: number | null;
  rate: number | null;
}

export interface MusicEligibilityContext {
  nowMs: number;
  online: boolean;
  explicitItemId?: string | null;
  phaseAllowedItemIds?: ReadonlySet<string> | null;
}

export interface MusicQueueEligibility {
  eligible: boolean;
  reason: MusicPlaylistSkipReason | null;
}

export interface MusicPlaylistPlaybackProjection {
  entries: MusicSavedQueueEntry[];
  sources: MusicSource[];
  itemIds: string[];
  eligibleIndices: number[];
  skipped: Record<MusicPlaylistSkipReason, number>;
  structuralSkipped: Record<MusicPlaylistSkipReason, number>;
}

export interface MusicInitialQueueSelection {
  index: number | null;
  remainingShuffleOrder: number[];
}

const weightValues: Record<MusicWeight, number> = {
  rarely: 1,
  "less-often": 2,
  normal: 4,
  "more-often": 7,
  "much-more-often": 11,
};

export const emptyMusicSkipBreakdown = (): Record<MusicPlaylistSkipReason, number> => ({
  disabled: 0,
  snoozed: 0,
  offline: 0,
  unavailable: 0,
  "embedding-blocked": 0,
  "phase-constraint": 0,
  "unbound-root": 0,
  "invalid-source": 0,
});

export function evaluateMusicQueueEntry(
  entry: MusicSavedQueueEntry,
  context: MusicEligibilityContext,
): MusicQueueEligibility {
  if (!entry.enabled) return { eligible: false, reason: "disabled" };
  if (context.phaseAllowedItemIds && !context.phaseAllowedItemIds.has(entry.itemId)) {
    return { eligible: false, reason: "phase-constraint" };
  }
  const explicit = context.explicitItemId === entry.itemId;
  const activelySnoozed = entry.snoozedIndefinitely
    || (entry.snoozedUntil !== null && entry.snoozedUntil > context.nowMs);
  if (activelySnoozed && !explicit) return { eligible: false, reason: "snoozed" };
  if (entry.sourceKind === "youtube-video") {
    if (!context.online) return { eligible: false, reason: "offline" };
    if (entry.youtubeResolutionState === "embedding-blocked") {
      return { eligible: false, reason: "embedding-blocked" };
    }
    if (entry.availability !== "available" || ["unavailable", "timed-out"].includes(entry.youtubeResolutionState ?? "")) {
      return { eligible: false, reason: "unavailable" };
    }
  } else if (entry.availability !== "available") {
    return { eligible: false, reason: "unavailable" };
  }
  return { eligible: true, reason: null };
}

export function projectMusicPlaylistPlayback(
  entries: readonly MusicPlaylistPlaybackEntry[],
  bindings: readonly LocalRootBinding[],
  context: MusicEligibilityContext,
): MusicPlaylistPlaybackProjection {
  const projected: MusicSavedQueueEntry[] = [];
  const skipped = emptyMusicSkipBreakdown();
  const structuralSkipped = emptyMusicSkipBreakdown();
  const bindingPaths = new Map(bindings.map((binding) => [binding.rootId, binding.folderPath]));
  for (const entry of [...entries].sort((left, right) => left.position - right.position || left.membershipId.localeCompare(right.membershipId))) {
    const sourceResult = playbackSource(entry, bindingPaths);
    if (!sourceResult.source) {
      skipped[sourceResult.reason] += 1;
      structuralSkipped[sourceResult.reason] += 1;
      continue;
    }
    projected.push({
      membershipId: entry.membershipId,
      itemId: entry.itemId,
      identityKey: entry.identityKey,
      source: sourceResult.source,
      sourceKind: entry.sourceKind,
      availability: entry.availability,
      youtubeResolutionState: entry.youtubeResolutionState,
      weight: entry.weight,
      enabled: entry.enabled,
      snoozedUntil: entry.snoozedUntil,
      snoozedIndefinitely: entry.snoozedIndefinitely,
      skipRanges: [...entry.skipRanges].sort((left, right) => left.startMs - right.startMs),
      volume: entry.volume,
      rate: entry.rate,
    });
  }
  const eligibleIndices: number[] = [];
  for (const [index, entry] of projected.entries()) {
    const eligibility = evaluateMusicQueueEntry(entry, context);
    if (eligibility.eligible) eligibleIndices.push(index);
    else if (eligibility.reason) skipped[eligibility.reason] += 1;
  }
  return {
    entries: projected,
    sources: projected.map((entry) => entry.source),
    itemIds: projected.map((entry) => entry.itemId),
    eligibleIndices,
    skipped,
    structuralSkipped,
  };
}

export function eligibleMusicQueueIndices(
  entries: readonly MusicSavedQueueEntry[],
  context: MusicEligibilityContext,
): number[] {
  return entries.flatMap((entry, index) => evaluateMusicQueueEntry(entry, context).eligible ? [index] : []);
}

export function buildWeightedShuffleCycle(
  entries: readonly MusicSavedQueueEntry[],
  eligibleIndices: readonly number[],
  currentIndex: number,
  recentItemIds: readonly string[],
  random: () => number = Math.random,
): number[] {
  const recentRanks = new Map<string, number>();
  recentItemIds.forEach((itemId, index) => {
    if (!recentRanks.has(itemId)) recentRanks.set(itemId, index);
  });
  const candidates = eligibleIndices.filter((index) => index !== currentIndex || eligibleIndices.length === 1);
  const scored = candidates.map((index) => {
    const entry = entries[index];
    const rank = entry ? recentRanks.get(entry.itemId) : undefined;
    const recencyPenalty = rank === undefined ? 1 : Math.max(1.25, 7 - Math.min(5, rank));
    const weight = entry ? weightValues[entry.weight] / recencyPenalty : 1;
    const sample = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()));
    return { index, score: -Math.log(sample) / Math.max(Number.EPSILON, weight) };
  });
  scored.sort((left, right) => left.score - right.score || left.index - right.index);
  return scored.map(({ index }) => index);
}

/** Selects a boundary track, avoiding the interrupted item whenever another item is eligible. */
export function selectFreshMusicQueueItem(
  entries: readonly MusicSavedQueueEntry[],
  eligibleIndices: readonly number[],
  options: {
    shuffle: boolean;
    explicitItemId?: string | null;
    avoidItemId?: string | null;
    recentItemIds?: readonly string[];
    random?: () => number;
  },
): MusicInitialQueueSelection {
  const explicitIndex = options.explicitItemId
    ? entries.findIndex((entry, index) => entry.itemId === options.explicitItemId && eligibleIndices.includes(index))
    : -1;
  const avoidedIndex = options.avoidItemId
    ? entries.findIndex((entry) => entry.itemId === options.avoidItemId)
    : -1;
  if (explicitIndex >= 0) {
    return {
      index: explicitIndex,
      remainingShuffleOrder: options.shuffle
        ? buildWeightedShuffleCycle(entries, eligibleIndices, explicitIndex, options.recentItemIds ?? [], options.random)
        : [],
    };
  }
  if (options.shuffle) {
    const cycle = buildWeightedShuffleCycle(
      entries,
      eligibleIndices,
      avoidedIndex,
      options.recentItemIds ?? [],
      options.random,
    );
    return { index: cycle.shift() ?? null, remainingShuffleOrder: cycle };
  }
  return {
    index: eligibleIndices.find((index) => index > avoidedIndex)
      ?? eligibleIndices.find((index) => index !== avoidedIndex)
      ?? eligibleIndices[0]
      ?? null,
    remainingShuffleOrder: [],
  };
}

export function nextSequentialQueueIndex(
  eligibleIndices: readonly number[],
  currentIndex: number,
  repeatMode: MusicRepeatMode,
): number | null {
  if (eligibleIndices.length === 0) return null;
  if (repeatMode === "one" && eligibleIndices.includes(currentIndex)) return currentIndex;
  const next = eligibleIndices.find((index) => index > currentIndex);
  if (next !== undefined) return next;
  return repeatMode === "all" ? eligibleIndices[0] ?? null : null;
}

export function previousSequentialQueueIndex(
  eligibleIndices: readonly number[],
  currentIndex: number,
  repeatMode: MusicRepeatMode,
): number | null {
  if (eligibleIndices.length === 0) return null;
  if (repeatMode === "one" && eligibleIndices.includes(currentIndex)) return currentIndex;
  const previous = [...eligibleIndices].reverse().find((index) => index < currentIndex);
  if (previous !== undefined) return previous;
  return repeatMode === "all" ? eligibleIndices.at(-1) ?? null : null;
}

export function skipRangeTargetMs(
  positionMs: number,
  ranges: readonly MusicMembershipSkipRange[],
): number | null {
  const range = ranges.find((candidate) => positionMs >= candidate.startMs && positionMs < candidate.endMs);
  return range?.endMs ?? null;
}

function playbackSource(
  entry: MusicPlaylistPlaybackEntry,
  bindingPaths: ReadonlyMap<string, string | null>,
): { source: MusicSource | null; reason: "unbound-root" | "invalid-source" } {
  if (entry.sourceKind === "youtube-video") {
    if (!entry.youtubeVideoId) return { source: null, reason: "invalid-source" };
    return {
      source: {
        ...youtubeVideoSourceFromId(entry.youtubeVideoId, { startMs: entry.startMs, endMs: entry.endMs }),
        title: entry.title,
      },
      reason: "invalid-source",
    };
  }
  if (!entry.rootId || !entry.relativePath) return { source: null, reason: "unbound-root" };
  const folder = bindingPaths.get(entry.rootId);
  if (!folder) return { source: null, reason: "unbound-root" };
  const path = resolveLocalMusicPath(folder, entry.relativePath);
  const originalSidecar = entry.originalArtworkIdentity?.startsWith("sidecar:")
    ? entry.originalArtworkIdentity.slice("sidecar:".length)
    : null;
  const artworkPath = entry.artworkOverride
    ?? (originalSidecar ? resolveLocalMusicPath(folder, originalSidecar) : null);
  return {
    source: {
      ...localFileSourceFromPath(path, entry.title, artworkPath),
      startMs: entry.startMs,
      endMs: entry.endMs,
    },
    reason: "invalid-source",
  };
}

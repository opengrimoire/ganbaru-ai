import { getMusicRecentSelections, recordMusicListening } from "$lib/api/music-library";
import type { MusicSelectionKind } from "$lib/music/library-contracts";
import {
  emptyMusicSkipBreakdown,
  evaluateMusicQueueEntry,
  skipRangeTargetMs,
  type MusicPlaylistSkipReason,
  type MusicSavedQueueEntry,
} from "$lib/music/music-playlist-playback";

type SkipBreakdown = Record<MusicPlaylistSkipReason, number>;

export interface MusicSavedPlaylistRuntimeCheckpoint {
  selectionStartedAt: number;
  lastSkipRangeTarget: number | null;
  structuralSkipped: SkipBreakdown;
}

/** Owns bounded listening writes, eligibility projection, and timed Snooze recovery. */
export class MusicSavedPlaylistRuntime {
  private writeTail: Promise<void> = Promise.resolve();
  private selectionStartedAt = 0;
  private lastSkipRangeTarget: number | null = null;
  private structuralSkipped: SkipBreakdown = emptyMusicSkipBreakdown();
  private snoozeExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onSnoozeExpiry: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  async recentItemIds(playlistId: string, limit = 32): Promise<string[]> {
    return getMusicRecentSelections(playlistId, limit)
      .then((recent) => recent.map((entry) => entry.itemId))
      .catch(() => []);
  }

  setStructuralSkipped(skipped: SkipBreakdown): void {
    this.structuralSkipped = { ...skipped };
  }

  breakdown(entries: readonly MusicSavedQueueEntry[], online: boolean): SkipBreakdown {
    const skipped = { ...this.structuralSkipped };
    for (const entry of entries) {
      const eligibility = evaluateMusicQueueEntry(entry, { nowMs: this.now(), online });
      if (eligibility.reason) skipped[eligibility.reason] += 1;
    }
    return skipped;
  }

  scheduleSnoozeExpiry(entries: readonly MusicSavedQueueEntry[]): void {
    this.clearSnoozeExpiry();
    const now = this.now();
    const nextExpiry = entries
      .map((entry) => entry.snoozedUntil)
      .filter((expiry): expiry is number => expiry !== null && expiry > now)
      .sort((left, right) => left - right)[0];
    if (nextExpiry === undefined) return;
    this.snoozeExpiryTimer = setTimeout(() => {
      this.snoozeExpiryTimer = null;
      this.onSnoozeExpiry();
      this.scheduleSnoozeExpiry(entries);
    }, Math.min(2_147_000_000, Math.max(1, nextExpiry - now + 25)));
  }

  recordSelection(
    playlistId: string,
    entry: MusicSavedQueueEntry,
    selectionKind: MusicSelectionKind,
  ): void {
    this.selectionStartedAt = this.now();
    this.enqueue({
      playlistId,
      itemId: entry.itemId,
      selectionKind,
      outcome: "started",
      occurredAt: this.selectionStartedAt,
    });
  }

  recordOutcome(
    playlistId: string,
    entry: MusicSavedQueueEntry,
    outcome: "completed" | "skipped",
  ): void {
    if (this.selectionStartedAt === 0) return;
    this.enqueue({
      playlistId,
      itemId: entry.itemId,
      selectionKind: "automatic",
      outcome,
      occurredAt: this.now(),
    });
    this.selectionStartedAt = 0;
  }

  skipTarget(positionMs: number, entry: MusicSavedQueueEntry | null): number | null {
    if (!entry) return null;
    const target = skipRangeTargetMs(positionMs, entry.skipRanges);
    if (target === null) {
      this.lastSkipRangeTarget = null;
      return null;
    }
    if (target === this.lastSkipRangeTarget) return null;
    this.lastSkipRangeTarget = target;
    return target;
  }

  resetSkipRange(): void {
    this.lastSkipRangeTarget = null;
  }

  checkpoint(): MusicSavedPlaylistRuntimeCheckpoint {
    return {
      selectionStartedAt: this.selectionStartedAt,
      lastSkipRangeTarget: this.lastSkipRangeTarget,
      structuralSkipped: { ...this.structuralSkipped },
    };
  }

  restore(
    checkpoint: MusicSavedPlaylistRuntimeCheckpoint,
    entries: readonly MusicSavedQueueEntry[],
  ): void {
    this.selectionStartedAt = checkpoint.selectionStartedAt;
    this.lastSkipRangeTarget = checkpoint.lastSkipRangeTarget;
    this.structuralSkipped = { ...checkpoint.structuralSkipped };
    this.scheduleSnoozeExpiry(entries);
  }

  reset(): void {
    this.selectionStartedAt = 0;
    this.lastSkipRangeTarget = null;
    this.structuralSkipped = emptyMusicSkipBreakdown();
    this.clearSnoozeExpiry();
  }

  destroy(): void {
    this.clearSnoozeExpiry();
  }

  private enqueue(request: Parameters<typeof recordMusicListening>[0]): void {
    this.writeTail = this.writeTail
      .catch(() => undefined)
      .then(() => recordMusicListening(request))
      .catch((error: unknown) => {
        console.error("Unable to update local music listening history.", error);
      });
  }

  private clearSnoozeExpiry(): void {
    if (this.snoozeExpiryTimer === null) return;
    clearTimeout(this.snoozeExpiryTimer);
    this.snoozeExpiryTimer = null;
  }
}

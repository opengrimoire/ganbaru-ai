import type { LocalRootBinding, MusicInspectorDetail } from "$lib/music/library-contracts";
import { musicReviewSource } from "$lib/music/music-review";
import { getMusicPlayer } from "$lib/stores/music-player.svelte";

export const MUSIC_CONTEXT_BOUNDARY_EVENT = "ganbaru-ai-music-context-boundary";

export class MusicReviewAuditionController {
  active = $state(false);
  reviewItemId = $state<string | null>(null);
  error = $state<string | null>(null);
  private reviewPositions: Record<string, number> = {};
  private readonly player = getMusicPlayer();

  get musicPlayer(): ReturnType<typeof getMusicPlayer> {
    return this.player;
  }

  get ownsPlayback(): boolean {
    return this.active && this.player.contextOwner === "review";
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
  }

  async preview(
    detail: MusicInspectorDetail,
    bindings: readonly LocalRootBinding[],
    autoplay: boolean,
  ): Promise<boolean> {
    if (this.ownsPlayback && this.reviewItemId === detail.item.id) return true;
    this.enter();
    const source = musicReviewSource(detail, bindings);
    if (!source) {
      this.error = "No playable location is available for this item.";
      return false;
    }
    this.error = null;
    try {
      this.player.activePlaylistId = null;
      this.player.activePlaylistName = null;
      this.player.activePlaylistRepeatMode = "off";
      this.player.activeQueueItemIds = [];
      this.player.savedQueueEntries = [];
      await this.player.loadSource(source, { autoplay, resume: false, preserveQueue: true });
      this.player.contextOwner = "review";
      this.reviewItemId = detail.item.id;
      const retainedPosition = this.reviewPositions[detail.item.id] ?? 0;
      if (retainedPosition > 0) await this.player.seekToMs(retainedPosition);
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  keep(): void {
    if (this.ownsPlayback) {
      this.player.contextOwner = "manual";
      this.player.activePlaylistId = null;
      this.player.activePlaylistName = null;
      this.player.activePlaylistRepeatMode = "off";
      this.player.activeQueueItemIds = [];
      this.player.savedQueueEntries = [];
    }
    this.clearOwnership();
  }

  supersedeForBoundary(owner: "calendar-event" | "pomodoro"): void {
    if (this.ownsPlayback) {
      if (this.reviewItemId) this.reviewPositions[this.reviewItemId] = this.player.snapshot.positionMs;
      this.player.contextOwner = owner;
    }
    this.clearOwnership();
  }

  private clearOwnership(): void {
    this.active = false;
    this.reviewItemId = null;
    this.error = null;
  }
}

export function createMusicReviewAuditionController(): MusicReviewAuditionController {
  return new MusicReviewAuditionController();
}

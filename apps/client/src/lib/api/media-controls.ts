import { invoke } from "@tauri-apps/api/core";
import type { PlaybackStatus } from "$lib/music/playback";

export interface MediaControlsUpdate {
  status: PlaybackStatus;
  title: string | null;
  sourceKindLabel: string | null;
  artworkUrl: string | null;
  canPlayPause: boolean;
  canPrevious: boolean;
  canNext: boolean;
  canSeek: boolean;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  muted: boolean;
  rate: number;
  shuffleEnabled: boolean;
}

export async function updateMediaControls(update: MediaControlsUpdate): Promise<void> {
  await invoke("update_media_controls", { update });
}

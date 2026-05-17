import { invoke } from "@tauri-apps/api/core";
import { dbUrl } from "$lib/api/db";
import type { PlaybackStatus } from "$lib/music/playback";
import type { MusicSourceKind } from "$lib/music/sources";

export interface PlaybackStateRow {
  sourceIdentity: string;
  sourceKind: MusicSourceKind;
  positionMs: number;
  durationMs: number | null;
  status: PlaybackStatus;
  updatedAt: number;
}

export interface MediaFolderTrack {
  path: string;
  title: string;
  artworkPath: string | null;
}

export interface MediaFolderSelection {
  folderPath: string;
  tracks: MediaFolderTrack[];
  truncated: boolean;
}

export async function getPlaybackState(sourceIdentity: string): Promise<PlaybackStateRow | null> {
  return invoke("music_get_playback_state", {
    dbUrl: dbUrl(),
    sourceIdentity,
  });
}

export async function pickMediaFolder(): Promise<MediaFolderSelection | null> {
  return invoke("music_pick_media_folder");
}

export async function registerMediaFile(path: string): Promise<string> {
  return invoke("music_register_media_file", { path });
}

export async function registerEmbeddedArtwork(path: string): Promise<string | null> {
  return invoke("music_register_embedded_artwork", { path });
}

export async function getYouTubeHostUrl(): Promise<string> {
  return invoke("music_youtube_host_url");
}

export async function savePlaybackState(state: PlaybackStateRow): Promise<void> {
  await invoke("music_save_playback_state", {
    dbUrl: dbUrl(),
    state,
  });
}

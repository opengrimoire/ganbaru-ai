import {
  getLocalRootBindings,
  getMusicPlaylistPlaybackEntries,
} from "$lib/api/music-library";
import type { MusicPlaylistSummary } from "./library-contracts";
import {
  projectMusicPlaylistPlayback,
  type MusicPlaylistPlaybackProjection,
} from "./music-playlist-playback";
import {
  getMusicPlayer,
  type MusicContextPlayback,
} from "$lib/stores/music-player.svelte";
import { requireActiveVaultIdentity } from "$lib/vault/active-vault";

export interface ContextPlaylistLoadResult {
  loaded: boolean;
  projection: MusicPlaylistPlaybackProjection;
}

/** Loads one saved playlist through the canonical mixed local and YouTube queue. */
export async function loadContextMusicPlaylist(
  playlist: MusicPlaylistSummary,
  context: MusicContextPlayback,
  autoplay: boolean,
  avoidItemId: string | null,
): Promise<ContextPlaylistLoadResult> {
  const player = getMusicPlayer();
  const entries = await getMusicPlaylistPlaybackEntries(playlist.id, Date.now());
  const rootIds = [...new Set(entries.flatMap((entry) => entry.rootId ? [entry.rootId] : []))];
  const bindings = rootIds.length > 0
    ? await getLocalRootBindings(requireActiveVaultIdentity(), rootIds)
    : [];
  const projection = projectMusicPlaylistPlayback(entries, bindings, {
    nowMs: Date.now(),
    online: player.online,
  });
  const loaded = await player.loadSavedPlaylist(
    playlist.id,
    playlist.name,
    projection.entries,
    playlist.shuffleEnabled,
    playlist.repeatMode,
    playlist.mixEnabled,
    {
      structuralSkipped: projection.structuralSkipped,
      autoplay: false,
      autoRecovery: autoplay,
      avoidItemId,
      context,
    },
  );
  return { loaded, projection };
}

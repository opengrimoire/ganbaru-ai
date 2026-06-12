import {
  clampRate,
  clampVolume,
  DEFAULT_PLAYBACK_SNAPSHOT,
  type PlaybackSnapshot,
  type PlaybackStatus,
} from "$lib/music/playback";

const SETTINGS_KEY = "ganbaru-ai-music-player";

export interface MusicPlayerSettings {
  volume: number;
  rate: number;
  shuffleEnabled: boolean;
  shuffleExplicit: boolean;
  muted: boolean;
}

function defaultSettings(): MusicPlayerSettings {
  return {
    volume: DEFAULT_PLAYBACK_SNAPSHOT.volume,
    rate: DEFAULT_PLAYBACK_SNAPSHOT.rate,
    shuffleEnabled: true,
    shuffleExplicit: false,
    muted: false,
  };
}

export function loadMusicPlayerSettings(): MusicPlayerSettings {
  if (typeof localStorage === "undefined") {
    return defaultSettings();
  }
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings();

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      throw new Error("Music settings must be an object.");
    }
    const record = value as Record<string, unknown>;
    const shuffleExplicit = record.shuffleExplicit === true;
    return {
      volume: typeof record.volume === "number"
        ? clampVolume(record.volume)
        : DEFAULT_PLAYBACK_SNAPSHOT.volume,
      rate: typeof record.rate === "number"
        ? clampRate(record.rate)
        : DEFAULT_PLAYBACK_SNAPSHOT.rate,
      shuffleEnabled: shuffleExplicit && typeof record.shuffleEnabled === "boolean"
        ? record.shuffleEnabled
        : true,
      shuffleExplicit,
      muted: record.muted === true,
    };
  } catch {
    return defaultSettings();
  }
}

export function persistMusicPlayerSettings(settings: MusicPlayerSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function isPlaybackStatus(value: unknown): value is PlaybackStatus {
  return value === "idle"
    || value === "loading"
    || value === "ready"
    || value === "playing"
    || value === "paused"
    || value === "ended"
    || value === "error";
}

export function initialMusicSnapshot(settings: MusicPlayerSettings): PlaybackSnapshot {
  return {
    ...DEFAULT_PLAYBACK_SNAPSHOT,
    volume: settings.volume,
    rate: settings.rate,
  };
}

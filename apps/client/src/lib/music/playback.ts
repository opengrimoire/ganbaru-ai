import type { MusicSourceKind } from "$lib/music/sources";

export type PlaybackStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

export interface PlaybackSnapshot {
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  rate: number;
  error: string | null;
}

export interface PlaybackPersistenceInput {
  sourceIdentity: string;
  sourceKind: string;
  positionMs: number;
  durationMs: number | null;
  status: PlaybackStatus;
  nowMs: number;
}

export interface PersistedPlaybackState {
  sourceIdentity: string;
  sourceKind: MusicSourceKind;
  positionMs: number;
  durationMs: number | null;
  status: PlaybackStatus;
  updatedAt: number;
}

export type LocalPlaybackBackendKind = "none" | "rodio" | "gstreamer" | "webview";

export interface LocalPlaybackBackendSnapshot {
  backendKind: LocalPlaybackBackendKind;
  hasVideo: boolean;
  nativeVideo: boolean;
}

export const DEFAULT_PLAYBACK_SNAPSHOT: PlaybackSnapshot = Object.freeze({
  status: "idle",
  positionMs: 0,
  durationMs: null,
  volume: 0.8,
  rate: 1,
  error: null,
});

const POSITION_SAVE_INTERVAL_MS = 5_000;
const POSITION_SAVE_DELTA_MS = 10_000;
export const NORMAL_VOLUME = 1;
export const MAX_VOLUME = 1.5;
export const MIN_RATE = 0.25;
export const MAX_RATE = 2;
export const PREVIOUS_RESTART_THRESHOLD_MS = 3_000;
export const SPEED_PRESETS: readonly number[] = Object.freeze([0.5, 1, 1.25, 1.5, 2]);

export interface ShuffleSelection {
  index: number | null;
  remainingOrder: number[];
}

export interface PreviousQueueSelection {
  action: "none" | "restart" | "previous";
  index: number | null;
}

export function shouldPersistPlaybackState(
  next: PlaybackPersistenceInput,
  previous: PersistedPlaybackState | null,
): boolean {
  if (!previous) return true;
  if (previous.sourceIdentity !== next.sourceIdentity) return true;
  if (previous.status !== next.status) return true;
  if (previous.durationMs !== next.durationMs) return true;
  if (next.nowMs - previous.updatedAt >= POSITION_SAVE_INTERVAL_MS) return true;
  return Math.abs(next.positionMs - previous.positionMs) >= POSITION_SAVE_DELTA_MS;
}

export function stableStatusDuringYouTubeBuffering(
  current: PlaybackStatus,
  incoming: PlaybackStatus,
): PlaybackStatus {
  if (incoming === "loading" && current !== "loading") {
    return current;
  }
  return incoming;
}

export function formatPlaybackTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYBACK_SNAPSHOT.volume;
  return Math.min(MAX_VOLUME, Math.max(0, value));
}

export function clampRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYBACK_SNAPSHOT.rate;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, value));
}

export function clampYouTubeVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYBACK_SNAPSHOT.volume;
  return Math.min(NORMAL_VOLUME, Math.max(0, value));
}

export function maxPlaybackVolume(supportsBoost: boolean): number {
  return supportsBoost ? MAX_VOLUME : NORMAL_VOLUME;
}

export function clampPlaybackVolume(value: number, supportsBoost: boolean): number {
  return supportsBoost ? clampVolume(value) : clampYouTubeVolume(value);
}

export function playbackVolumeControlValue(value: number, supportsBoost: boolean): number {
  return Math.min(clampVolume(value), maxPlaybackVolume(supportsBoost));
}

export function isVolumeBoosted(value: number): boolean {
  return clampVolume(value) > NORMAL_VOLUME;
}

export function supportsLocalBackendVolumeBoost(backendKind: LocalPlaybackBackendKind): boolean {
  return backendKind === "rodio" || backendKind === "gstreamer";
}

export function shouldUseWebviewLocalVideo(snapshot: LocalPlaybackBackendSnapshot): boolean {
  return snapshot.backendKind === "webview" || (snapshot.hasVideo && !snapshot.nativeVideo);
}

export function normalizeLocalPlayableStartMs(startMs: number | null): number {
  if (startMs === null || !Number.isFinite(startMs) || startMs <= 0) return 0;
  return Math.round(startMs);
}

export function localMediaSeekTargetMs(positionMs: number, playableStartMs: number): number {
  const position = Number.isFinite(positionMs) && positionMs > 0 ? Math.round(positionMs) : 0;
  return Math.max(position, normalizeLocalPlayableStartMs(playableStartMs));
}

export function formatVolumePercent(value: number): string {
  return `${Math.round(clampVolume(value) * 100)}%`;
}

export function formatRateLabel(value: number): string {
  const rate = clampRate(value);
  return `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toString()}x`;
}

export function isSpeedPreset(value: number): boolean {
  const rate = clampRate(value);
  return SPEED_PRESETS.some((preset) => Math.abs(preset - rate) < 0.001);
}

export function shuffledQueueOrder(
  queueLength: number,
  currentIndex: number,
  random: () => number = Math.random,
): number[] {
  if (queueLength <= 0) return [];
  const indexes = Array.from({ length: queueLength }, (_, index) => index)
    .filter((index) => queueLength === 1 || index !== currentIndex);
  for (let index = indexes.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }
  return indexes;
}

export function nextShuffleIndex(
  queueLength: number,
  currentIndex: number,
  remainingOrder: readonly number[],
  random: () => number = Math.random,
): ShuffleSelection {
  if (queueLength <= 0) return { index: null, remainingOrder: [] };
  if (queueLength === 1) return { index: 0, remainingOrder: [] };

  const validRemaining = remainingOrder.filter(
    (index) => index >= 0 && index < queueLength && index !== currentIndex,
  );
  const order = validRemaining.length > 0
    ? [...validRemaining]
    : shuffledQueueOrder(queueLength, currentIndex, random);
  const [index, ...nextRemaining] = order;
  return { index: index ?? null, remainingOrder: nextRemaining };
}

export function initialQueueSelection(
  queueLength: number,
  shuffleEnabled: boolean,
  random: () => number = Math.random,
): ShuffleSelection {
  if (queueLength <= 0) return { index: null, remainingOrder: [] };
  if (!shuffleEnabled) return { index: 0, remainingOrder: [] };
  return nextShuffleIndex(queueLength, -1, [], random);
}

export function previousQueueSelection(
  currentIndex: number,
  positionMs: number,
  queueLength: number,
  thresholdMs = PREVIOUS_RESTART_THRESHOLD_MS,
): PreviousQueueSelection {
  if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) {
    return { action: "none", index: null };
  }
  if (positionMs > thresholdMs || currentIndex === 0) {
    return { action: "restart", index: currentIndex };
  }
  return { action: "previous", index: currentIndex - 1 };
}

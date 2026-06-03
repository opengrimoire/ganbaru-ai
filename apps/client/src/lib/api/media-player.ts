import { invoke } from "@tauri-apps/api/core";

export type LocalPlayerStatus = "idle" | "ready" | "playing" | "paused" | "ended" | "error";
export type LocalBackendKind = "none" | "rodio" | "webview";

export interface LocalMediaSource {
  kind: "local-file";
  path: string;
  identity: string;
  title?: string | null;
}

export interface LocalLoadRequest {
  source: LocalMediaSource;
  startMs?: number | null;
  volume?: number | null;
  rate?: number | null;
}

export interface MediaProbe {
  path: string;
  title: string;
  fileSizeBytes: number;
  extension: string | null;
  mediaKind: "audio" | "video" | "unknown";
  playableStartMs: number | null;
}

export interface LocalPlayerSnapshot {
  status: LocalPlayerStatus;
  sourceIdentity: string | null;
  title: string | null;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  muted: boolean;
  rate: number;
  hasVideo: boolean;
  backendKind: LocalBackendKind;
  playableStartMs: number | null;
  error: string | null;
}

export interface MediaPlayerErrorPayload {
  code: string;
  message: string;
}

export function probeLocalMedia(path: string): Promise<MediaProbe> {
  return invoke("media_player_probe", { path });
}

export function loadLocalMedia(request: LocalLoadRequest): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_load", { request });
}

export function playLocalMedia(): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_play");
}

export function pauseLocalMedia(): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_pause");
}

export function stopLocalMedia(): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_stop");
}

export function seekLocalMedia(positionMs: number): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_seek", { positionMs });
}

export function setLocalVolume(volume: number): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_set_volume", { volume });
}

export function setLocalMuted(muted: boolean): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_set_muted", { muted });
}

export function setLocalRate(rate: number): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_set_rate", { rate });
}

export function getLocalSnapshot(): Promise<LocalPlayerSnapshot> {
  return invoke("media_player_snapshot");
}

export function mediaPlayerErrorMessage(error: unknown): string {
  if (isMediaPlayerErrorPayload(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isMediaPlayerErrorPayload(value: unknown): value is MediaPlayerErrorPayload {
  return typeof value === "object"
    && value !== null
    && "code" in value
    && "message" in value
    && typeof value.code === "string"
    && typeof value.message === "string";
}

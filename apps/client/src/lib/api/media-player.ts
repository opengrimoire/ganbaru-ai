import { invoke } from "@tauri-apps/api/core";

export type LocalPlayerStatus = "idle" | "ready" | "playing" | "paused" | "ended" | "error";

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

export interface SurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface MediaProbe {
  path: string;
  title: string;
  fileSizeBytes: number;
  extension: string | null;
  mediaKind: "audio" | "video" | "unknown";
}

export interface LocalPlayerSnapshot {
  status: LocalPlayerStatus;
  sourceIdentity: string | null;
  title: string | null;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  rate: number;
  hasVideo: boolean;
  error: string | null;
}

export interface MediaPlayerErrorPayload {
  code: string;
  message: string;
}

export function probeLocalMedia(path: string): Promise<MediaProbe> {
  return invoke("plugin:media-player|probe", { path });
}

export function loadLocalMedia(request: LocalLoadRequest): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|load", { request });
}

export function playLocalMedia(): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|play");
}

export function pauseLocalMedia(): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|pause");
}

export function stopLocalMedia(): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|stop");
}

export function seekLocalMedia(positionMs: number): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|seek", { positionMs });
}

export function setLocalVolume(volume: number): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|set_volume", { volume });
}

export function setLocalRate(rate: number): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|set_rate", { rate });
}

export function setLocalSurfaceRect(rect: SurfaceRect): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|set_surface_rect", { rect });
}

export function clearLocalSurface(): Promise<LocalPlayerSnapshot> {
  return invoke("plugin:media-player|clear_surface");
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

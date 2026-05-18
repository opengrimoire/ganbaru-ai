import { invoke } from "@tauri-apps/api/core";

export type MediaPlayerStatus = "idle" | "ready" | "playing" | "paused" | "ended" | "error";
export type BackendKind = "none" | "rodio" | "webview";

export interface LocalMediaSource {
  kind: "local-file";
  path: string;
  identity: string;
  title?: string | null;
}

export interface LoadRequest {
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

export interface PlayerSnapshot {
  status: MediaPlayerStatus;
  sourceIdentity: string | null;
  title: string | null;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  muted: boolean;
  rate: number;
  hasVideo: boolean;
  backendKind: BackendKind;
  playableStartMs: number | null;
  error: string | null;
}

export function probe(path: string): Promise<MediaProbe> {
  return invoke("plugin:media-player|probe", { path });
}

export function load(request: LoadRequest): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|load", { request });
}

export function play(): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|play");
}

export function pause(): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|pause");
}

export function stop(): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|stop");
}

export function seek(positionMs: number): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|seek", { positionMs });
}

export function setVolume(volume: number): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|set_volume", { volume });
}

export function setMuted(muted: boolean): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|set_muted", { muted });
}

export function setRate(rate: number): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|set_rate", { rate });
}

export function snapshot(): Promise<PlayerSnapshot> {
  return invoke("plugin:media-player|snapshot");
}

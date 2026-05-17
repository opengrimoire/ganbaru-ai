import type { PlaybackStatus } from "$lib/music/playback";

export const enum YouTubePlayerStateCode {
  Unstarted = -1,
  Ended = 0,
  Playing = 1,
  Paused = 2,
  Buffering = 3,
  Cued = 5,
}

export interface YouTubePlayerEvent<TTarget = YouTubePlayer> {
  target: TTarget;
  data: number;
}

export interface YouTubePlayerOptions {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void;
    onStateChange?: (event: YouTubePlayerEvent) => void;
    onError?: (event: YouTubePlayerEvent) => void;
    onPlaybackRateChange?: (event: YouTubePlayerEvent) => void;
  };
}

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

export interface YouTubeNamespace {
  Player: new (element: HTMLElement | string, options: YouTubePlayerOptions) => YouTubePlayer;
  PlayerState: {
    ENDED: YouTubePlayerStateCode.Ended;
    PLAYING: YouTubePlayerStateCode.Playing;
    PAUSED: YouTubePlayerStateCode.Paused;
    BUFFERING: YouTubePlayerStateCode.Buffering;
    CUED: YouTubePlayerStateCode.Cued;
  };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("YouTube playback requires a browser window."));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      reject(new Error("Timed out while loading the YouTube player API."));
    }, 15_000);

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (!window.YT?.Player) {
        window.clearTimeout(timeout);
        reject(new Error("The YouTube player API loaded without a Player constructor."));
        return;
      }
      window.clearTimeout(timeout);
      resolve(window.YT);
    };

    if (!document.querySelector("script[data-ganbaruai-youtube-api='true']")) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.ganbaruaiYoutubeApi = "true";
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Failed to load the YouTube player API."));
      };
      document.head.append(script);
    }
  });

  apiPromise.catch(() => {
    apiPromise = null;
  });
  return apiPromise;
}

export function youtubeStateToPlaybackStatus(state: number): PlaybackStatus {
  switch (state) {
    case YouTubePlayerStateCode.Ended:
      return "ended";
    case YouTubePlayerStateCode.Playing:
      return "playing";
    case YouTubePlayerStateCode.Paused:
      return "paused";
    case YouTubePlayerStateCode.Buffering:
      return "loading";
    case YouTubePlayerStateCode.Cued:
      return "ready";
    default:
      return "ready";
  }
}

export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return "The YouTube video ID is invalid.";
    case 5:
      return "This YouTube video cannot be played in the embedded player.";
    case 100:
      return "This YouTube video is unavailable.";
    case 101:
    case 150:
      return "The owner does not allow this YouTube video to play in embedded players.";
    case 153:
      return "YouTube rejected the embedded player request because it could not identify GanbaruAI as the embedding client.";
    default:
      return `YouTube playback failed with error ${code}.`;
  }
}

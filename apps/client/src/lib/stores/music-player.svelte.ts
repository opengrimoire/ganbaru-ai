import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { tick } from "svelte";
import {
  getLocalSnapshot,
  loadLocalMedia,
  mediaPlayerErrorMessage,
  pauseLocalMedia,
  playLocalMedia,
  seekLocalMedia,
  setLocalMuted,
  setLocalRate,
  setLocalVolume,
  stopLocalMedia,
  type LocalPlayerSnapshot,
} from "$lib/api/media-player";
import {
  getPlaybackState,
  getYouTubeHostUrl,
  pickMediaFolder,
  registerEmbeddedArtwork,
  registerMediaFile,
  savePlaybackState,
} from "$lib/api/music";
import {
  clampRate,
  clampVolume,
  clampYouTubeVolume,
  DEFAULT_PLAYBACK_SNAPSHOT,
  formatRateLabel,
  formatVolumePercent,
  initialQueueSelection,
  isVolumeBoosted,
  localMediaSeekTargetMs,
  nextShuffleIndex,
  normalizeLocalPlayableStartMs,
  stableStatusDuringYouTubeBuffering,
  shouldPersistPlaybackState,
  shouldRouteLocalMediaThroughWebAudio,
  type PersistedPlaybackState,
  type PlaybackSnapshot,
  type PlaybackStatus,
} from "$lib/music/playback";
import {
  formatSourceKind,
  isYouTubeSource,
  localFileSourceFromPath,
  parseMusicSourceInput,
  sourceDisplayLabel,
  youtubeVideoSourceFromId,
  type LocalFileSource,
  type MusicSource,
  type YouTubePlaylistSource,
  type YouTubeVideoSource,
} from "$lib/music/sources";
import { youtubeErrorMessage } from "$lib/music/youtube-player";
import { getNavigation } from "$lib/stores/navigation.svelte";

type YouTubeSource = YouTubeVideoSource | YouTubePlaylistSource;
type YouTubeCommandAction = "play" | "pause" | "stop" | "seek" | "volume" | "rate";

interface ResolvingYouTubePlaylist {
  playlistId: string;
  preferredVideoId: string | null;
  startMs: number | null;
  endMs: number | null;
  autoplay: boolean;
  generation: number;
}

interface LoadSourceOptions {
  autoplay?: boolean;
  resume?: boolean;
  preserveQueue?: boolean;
}

interface YouTubeHostStateMessage {
  token: string;
  load: string;
  type: "ganbaruai-youtube-state";
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number | null;
  videoId: string | null;
  title: string | null;
}

interface YouTubeHostReadyMessage {
  token: string;
  load: string;
  type: "ganbaruai-youtube-ready";
}

interface YouTubeHostErrorMessage {
  token: string;
  load: string;
  type: "ganbaruai-youtube-error";
  code: number;
}

interface YouTubeHostPlaylistMessage {
  token: string;
  load: string;
  type: "ganbaruai-youtube-playlist";
  playlistId: string;
  videoIds: string[];
  index: number | null;
}

interface YouTubeHostPlaylistErrorMessage {
  token: string;
  load: string;
  type: "ganbaruai-youtube-playlist-error";
  playlistId: string;
}

type YouTubeHostMessage =
  | YouTubeHostReadyMessage
  | YouTubeHostStateMessage
  | YouTubeHostErrorMessage
  | YouTubeHostPlaylistMessage
  | YouTubeHostPlaylistErrorMessage;

interface MusicPlayerSettings {
  volume: number;
  rate: number;
  shuffleEnabled: boolean;
  shuffleExplicit: boolean;
  muted: boolean;
}

interface LocalAudioNodes {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

interface WindowWithWebkitAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const SETTINGS_KEY = "ganbaruai-music-player";
const progressMaxFallback = 1;
const YOUTUBE_OPTIMISTIC_PAUSE_MS = 1_500;
const YOUTUBE_PLAYLIST_RESOLVE_TIMEOUT_MS = 18_000;
const LOCAL_PLAYABLE_START_KICK_MS = 650;
const LOCAL_PLAYABLE_START_NUDGE_MS = 1_000;
const LOCAL_PLAYABLE_START_MAX_NUDGES = 12;
const MEDIA_HAVE_CURRENT_DATA_READY_STATE = 2;
const audioFileExtensions = new Set([
  "aac",
  "aif",
  "aiff",
  "alac",
  "ape",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "opus",
  "wav",
  "wma",
]);

function loadSettings(): MusicPlayerSettings {
  if (typeof localStorage === "undefined") {
    return {
      volume: DEFAULT_PLAYBACK_SNAPSHOT.volume,
      rate: DEFAULT_PLAYBACK_SNAPSHOT.rate,
      shuffleEnabled: true,
      shuffleExplicit: false,
      muted: false,
    };
  }
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return {
      volume: DEFAULT_PLAYBACK_SNAPSHOT.volume,
      rate: DEFAULT_PLAYBACK_SNAPSHOT.rate,
      shuffleEnabled: true,
      shuffleExplicit: false,
      muted: false,
    };
  }
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
    return {
      volume: DEFAULT_PLAYBACK_SNAPSHOT.volume,
      rate: DEFAULT_PLAYBACK_SNAPSHOT.rate,
      shuffleEnabled: true,
      shuffleExplicit: false,
      muted: false,
    };
  }
}

function persistSettings(settings: MusicPlayerSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function isPlaybackStatus(value: unknown): value is PlaybackStatus {
  return value === "idle"
    || value === "loading"
    || value === "ready"
    || value === "playing"
    || value === "paused"
    || value === "ended"
    || value === "error";
}

function initialSnapshot(settings: MusicPlayerSettings): PlaybackSnapshot {
  return {
    ...DEFAULT_PLAYBACK_SNAPSHOT,
    volume: settings.volume,
    rate: settings.rate,
  };
}

const initialPlayerSettings = loadSettings();

class MusicPlayerStore {
  sourceInput = $state("");
  currentSource = $state<MusicSource | null>(null);
  parseError = $state<string | null>(null);
  playerError = $state<string | null>(null);
  snapshot = $state<PlaybackSnapshot>(initialSnapshot(initialPlayerSettings));
  queue = $state<MusicSource[]>([]);
  folderScanTruncated = $state(false);
  shuffleEnabled = $state(initialPlayerSettings.shuffleEnabled);
  shuffleExplicit = $state(initialPlayerSettings.shuffleExplicit);
  muted = $state(initialPlayerSettings.muted);
  shuffleOrder = $state<number[]>([]);
  queueHistory = $state<number[]>([]);
  youtubeHostUrl = $state<string | null>(null);
  youtubeFrame = $state<HTMLIFrameElement | null>(null);
  private youtubeHostBaseUrl: string | null = null;
  private youtubeHostLoadId: string | null = null;
  youtubeHostToken = $state<string | null>(null);
  youtubeHostReady = $state(false);
  localMediaElement = $state<HTMLMediaElement | null>(null);
  localMediaSrc = $state<string | null>(null);
  localHasVideo = $state(false);
  localVideoReady = $state(false);
  currentArtworkUrl = $state<string | null>(null);
  surfaceElement = $state<HTMLElement | null>(null);
  sourceActionBusy = $state(false);

  private pendingLocalResumeMs = 0;
  private localMediaPlayableStartMs = 0;
  private localPlayableStartKickTimeoutId: number | null = null;
  private localPlayableStartKickCount = 0;
  private ignoreNextLocalPause = false;
  private loadGeneration = 0;
  private lastPersisted: PersistedPlaybackState | null = null;
  private listenersInitialized = false;
  private youtubeSnapshotIntervalId: number | null = null;
  private localSnapshotIntervalId: number | null = null;
  private unlisteners: UnlistenFn[] = [];
  private audioNodes = new WeakMap<HTMLMediaElement, LocalAudioNodes>();
  private lastTraySignature = "";
  private localPauseSilenced = false;
  private youtubeOptimisticPauseUntil = 0;
  private handlingNativeLocalEnded = false;
  private handlingYouTubeEnded = false;
  private resolvingYouTubePlaylist: ResolvingYouTubePlaylist | null = null;
  private youtubePlaylistTimeoutId: number | null = null;

  get isBusy(): boolean {
    return this.snapshot.status === "loading";
  }

  get isPlaying(): boolean {
    return this.snapshot.status === "playing";
  }

  get durationMs(): number {
    return this.snapshot.durationMs ?? 0;
  }

  get progressMax(): number {
    return this.durationMs > 0 ? this.durationMs : progressMaxFallback;
  }

  get progressValue(): number {
    if (this.durationMs <= 0) return 0;
    return Math.min(this.snapshot.positionMs, this.progressMax);
  }

  get loadedTitle(): string {
    return this.currentSource ? sourceDisplayLabel(this.currentSource) : "Nothing loaded";
  }

  get sourceKindLabel(): string {
    return this.currentSource ? formatSourceKind(this.currentSource.kind) : "No source";
  }

  get queuePositionLabel(): string {
    const index = this.currentQueueIndex;
    if (index < 0 || this.queue.length === 0) return "No queue";
    return `${index + 1} of ${this.queue.length}`;
  }

  get currentQueueIndex(): number {
    const source = this.currentSource;
    if (!source) return -1;
    return this.queue.findIndex((item) => item.identity === source.identity);
  }

  get canPlayPreviousTrack(): boolean {
    if (!this.currentSource) return false;
    return this.queueHistory.length > 0 || this.currentQueueIndex > 0;
  }

  get canPlayNextTrack(): boolean {
    if (!this.currentSource) return false;
    if (this.shuffleEnabled) return this.queue.length > 1;
    const index = this.currentQueueIndex;
    return index >= 0 && index < this.queue.length - 1;
  }

  get volumePercentLabel(): string {
    return formatVolumePercent(this.snapshot.volume);
  }

  get volumeBoosted(): boolean {
    return !this.muted && !this.isYouTubeActive && isVolumeBoosted(this.snapshot.volume);
  }

  get boostUnavailable(): boolean {
    return this.isYouTubeActive;
  }

  get speedLabel(): string {
    return formatRateLabel(this.snapshot.rate);
  }

  get isYouTubeActive(): boolean {
    return this.currentSource ? isYouTubeSource(this.currentSource) : false;
  }

  init(): void {
    if (this.listenersInitialized) return;
    this.listenersInitialized = true;
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.handleWindowMessage);
      this.youtubeSnapshotIntervalId = window.setInterval(() => {
        if (!this.currentSource || !isYouTubeSource(this.currentSource)) return;
        this.postYouTubeCommand({ action: "snapshot" });
        void this.persistCurrentPlaybackState();
      }, 1_000);
      this.localSnapshotIntervalId = window.setInterval(() => {
        if (!this.usesNativeLocalAudio() || this.snapshot.status === "loading") return;
        void this.refreshNativeLocalSnapshot();
      }, 500);
    }
    this.listenToTrayEvents();
    this.updateMusicTray();
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.handleWindowMessage);
      if (this.youtubeSnapshotIntervalId !== null) {
        window.clearInterval(this.youtubeSnapshotIntervalId);
        this.youtubeSnapshotIntervalId = null;
      }
      if (this.localSnapshotIntervalId !== null) {
        window.clearInterval(this.localSnapshotIntervalId);
        this.localSnapshotIntervalId = null;
      }
      this.clearYouTubePlaylistTimeout();
    }
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    this.listenersInitialized = false;
  }

  setSurfaceElement(element: HTMLElement | null): void {
    this.surfaceElement = element;
  }

  registerYouTubeFrame(frame: HTMLIFrameElement | null): void {
    this.youtubeFrame = frame;
  }

  registerLocalMedia(element: HTMLMediaElement | null): void {
    if (this.localMediaElement === element) return;
    this.localMediaElement = element;
    if (element) {
      this.configureLocalMediaElement();
    }
  }

  async loadFromInput(): Promise<void> {
    const result = parseMusicSourceInput(this.sourceInput);
    this.parseError = result.error;
    this.playerError = null;
    if (!result.source) return;
    this.sourceActionBusy = true;
    try {
      await this.loadSource(result.source, { autoplay: true });
    } finally {
      this.sourceActionBusy = false;
    }
  }

  async loadFolder(): Promise<void> {
    this.parseError = null;
    this.playerError = null;
    this.sourceActionBusy = true;
    try {
      const folderSelection = await pickMediaFolder();
      if (!folderSelection) return;
      this.folderScanTruncated = folderSelection.truncated;
      this.queue = folderSelection.tracks.map((track) =>
        localFileSourceFromPath(track.path, track.title, track.artworkPath)
      );
      this.shuffleOrder = [];
      this.queueHistory = [];
      if (this.queue.length === 0) {
        this.playerError = "No supported audio or video files were found in that folder.";
        this.updateMusicTray();
        return;
      }
      const queueSelection = initialQueueSelection(this.queue.length, this.shuffleEnabled);
      const initialIndex = queueSelection.index ?? 0;
      this.shuffleOrder = queueSelection.remainingOrder;
      await this.loadSource(this.queue[initialIndex] ?? this.queue[0], {
        autoplay: true,
        resume: false,
        preserveQueue: true,
      });
    } catch (error) {
      this.playerError = error instanceof Error ? error.message : String(error);
      this.updateMusicTray();
    } finally {
      this.sourceActionBusy = false;
    }
  }

  async loadSource(source: MusicSource, options: LoadSourceOptions = {}): Promise<void> {
    const generation = ++this.loadGeneration;
    const nextVolume = isYouTubeSource(source)
      ? clampYouTubeVolume(this.snapshot.volume)
      : clampVolume(this.snapshot.volume);
    this.destroyYouTubePlayer();
    await this.resetLocalPlayback();
    this.currentArtworkUrl = null;
    if (!options.preserveQueue) {
      this.queue = [source];
      this.shuffleOrder = [];
      this.queueHistory = [];
    }
    this.currentSource = source;
    this.sourceInput = "";
    this.parseError = null;
    this.playerError = null;
    if (!isYouTubeSource(source)) {
      this.clearYouTubePlaylistResolution();
    }
    this.snapshot = {
      ...DEFAULT_PLAYBACK_SNAPSHOT,
      status: "loading",
      volume: nextVolume,
      rate: this.snapshot.rate,
    };
    this.persistPlayerSettings();
    this.updateMusicTray();

    const persisted = options.resume === false
      ? null
      : await getPlaybackState(source.identity).catch(() => null);
    if (generation !== this.loadGeneration) return;
    this.lastPersisted = persisted;

    if (source.kind === "local-file") {
      await this.loadLocalSource(source, persisted, generation, options);
      return;
    }

    await this.loadYouTubeSource(source, persisted, generation, options);
  }

  async togglePlay(): Promise<void> {
    if (!this.currentSource || this.snapshot.status === "loading") return;
    if (this.snapshot.status === "playing") {
      await this.pausePlayback();
      return;
    }
    await this.playPlayback();
  }

  async playPlayback(): Promise<void> {
    if (!this.currentSource) return;
    this.playerError = null;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalAudio()) {
        await this.playNativeLocalAudio();
      } else {
        await this.playLocalMediaElement();
      }
      await this.persistCurrentPlaybackState();
      this.updateMusicTray();
      return;
    }
    this.youtubeOptimisticPauseUntil = 0;
    this.postYouTubeCommand({ action: "play", volume: this.effectiveYouTubeVolume() });
    this.snapshot = { ...this.snapshot, status: "playing" };
    this.updateMediaSession();
    void this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  async pausePlayback(): Promise<void> {
    if (!this.currentSource) return;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalAudio()) {
        await this.pauseNativeLocalAudio();
      } else {
        this.pauseLocalMediaElement();
      }
    } else {
      this.youtubeOptimisticPauseUntil = Date.now() + YOUTUBE_OPTIMISTIC_PAUSE_MS;
      this.postYouTubeCommand({ action: "pause", volume: this.effectiveYouTubeVolume() });
      this.snapshot = { ...this.snapshot, status: "paused" };
      this.updateMediaSession();
    }
    void this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  async stopPlayback(): Promise<void> {
    if (!this.currentSource) return;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalAudio()) {
        await this.stopNativeLocalAudio();
      } else {
        this.stopLocalMediaElement();
      }
    } else {
      this.postYouTubeCommand({ action: "stop" });
      this.snapshot = { ...this.snapshot, status: "idle", positionMs: 0 };
    }
    await this.persistCurrentPlaybackState(true);
    this.updateMusicTray();
  }

  async seekToMs(positionMs: number): Promise<void> {
    if (!this.currentSource) return;
    const bounded = Math.max(0, Math.min(positionMs, this.progressMax));
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalAudio()) {
        await this.seekNativeLocalAudio(bounded);
      } else {
        this.seekLocalMediaElement(bounded);
      }
    } else {
      this.postYouTubeCommand({ action: "seek", positionMs: bounded });
      this.snapshot = { ...this.snapshot, positionMs: bounded };
    }
    await this.persistCurrentPlaybackState(true);
  }

  async setVolume(value: number): Promise<void> {
    const volume = this.isYouTubeActive
      ? clampYouTubeVolume(value)
      : clampVolume(value);
    this.snapshot = { ...this.snapshot, volume };
    this.muted = false;
    this.persistPlayerSettings();
    if (!this.currentSource) return;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalAudio()) {
        await this.applyNativeLocalVolume();
      } else {
        this.applyLocalVolume();
      }
    } else {
      this.postYouTubeCommand({ action: "volume", volume: clampYouTubeVolume(volume) });
    }
    await this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  async toggleMute(): Promise<void> {
    this.muted = !this.muted;
    this.persistPlayerSettings();
    if (!this.currentSource) return;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalAudio()) {
        await this.applyNativeLocalMute();
      } else {
        this.applyLocalVolume();
      }
    } else {
      this.postYouTubeCommand({ action: "volume", volume: this.effectiveYouTubeVolume() });
    }
    await this.persistCurrentPlaybackState();
  }

  async adjustVolume(delta: number): Promise<void> {
    await this.setVolume(this.snapshot.volume + delta);
  }

  async seekByMs(deltaMs: number): Promise<void> {
    await this.seekToMs(this.snapshot.positionMs + deltaMs);
  }

  handleVolumeWheel(event: WheelEvent): void {
    if (event.ctrlKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest("[data-music-scrollable='true']")) return;
      const editable = target.closest("input, textarea, [contenteditable='true']");
      if (editable && !target.closest("[data-music-volume-control='true']")) return;
    }
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY === 0 ? -event.deltaX : event.deltaY;
    if (delta === 0) return;
    const step = event.shiftKey ? 0.01 : 0.05;
    const direction = delta > 0 ? -1 : 1;
    void this.setVolume(this.snapshot.volume + direction * step);
  }

  async setRate(value: number): Promise<void> {
    const rate = clampRate(value);
    this.snapshot = { ...this.snapshot, rate };
    this.persistPlayerSettings();
    if (!this.currentSource) return;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalAudio()) {
        const localSnapshot = await setLocalRate(rate);
        this.applyLocalSnapshot(localSnapshot);
      } else if (this.localMediaElement) {
        this.localMediaElement.playbackRate = rate;
      }
    } else {
      this.postYouTubeCommand({ action: "rate", rate });
    }
    await this.persistCurrentPlaybackState();
  }

  async resetPlayer(): Promise<void> {
    this.destroyYouTubePlayer();
    await this.resetLocalPlayback();
    this.currentSource = null;
    this.parseError = null;
    this.playerError = null;
    this.lastPersisted = null;
    this.snapshot = {
      ...DEFAULT_PLAYBACK_SNAPSHOT,
      volume: this.snapshot.volume,
      rate: this.snapshot.rate,
    };
    this.sourceInput = "";
    this.clearYouTubePlaylistResolution();
    this.queue = [];
    this.folderScanTruncated = false;
    this.shuffleOrder = [];
    this.queueHistory = [];
    this.currentArtworkUrl = null;
    this.updateMusicTray();
  }

  toggleShuffle(): void {
    this.shuffleEnabled = !this.shuffleEnabled;
    this.shuffleExplicit = true;
    this.shuffleOrder = [];
    this.queueHistory = [];
    this.persistPlayerSettings();
    this.updateMusicTray();
  }

  async playQueueItem(index: number): Promise<void> {
    if (this.isBusy) return;
    const source = this.queue[index];
    if (!source) return;
    const currentIndex = this.currentQueueIndex;
    if (currentIndex === index) return;
    if (currentIndex >= 0 && currentIndex !== index) {
      this.queueHistory = [...this.queueHistory, currentIndex];
    }
    this.shuffleOrder = this.shuffleOrder.filter((item) => item !== index);
    await this.loadSource(source, {
      autoplay: true,
      resume: false,
      preserveQueue: true,
    });
  }

  async playNextTrack(): Promise<void> {
    if (this.isBusy) return;
    if (this.queue.length === 0) return;
    const currentIndex = this.currentQueueIndex;
    let nextIndex: number | null = null;
    if (this.shuffleEnabled) {
      const selection = nextShuffleIndex(
        this.queue.length,
        currentIndex,
        this.shuffleOrder,
      );
      nextIndex = selection.index;
      this.shuffleOrder = selection.remainingOrder;
    } else if (currentIndex < 0) {
      nextIndex = 0;
    } else if (currentIndex < this.queue.length - 1) {
      nextIndex = currentIndex + 1;
    }
    if (nextIndex === null || nextIndex < 0 || nextIndex >= this.queue.length) return;
    if (currentIndex >= 0 && currentIndex !== nextIndex) {
      this.queueHistory = [...this.queueHistory, currentIndex];
    }
    await this.loadSource(this.queue[nextIndex], {
      autoplay: true,
      resume: false,
      preserveQueue: true,
    });
  }

  async playPreviousTrack(): Promise<void> {
    if (this.isBusy) return;
    if (!this.currentSource) return;
    const currentIndex = this.currentQueueIndex;
    if (this.queueHistory.length > 0) {
      const history = [...this.queueHistory];
      const previousIndex = history.pop();
      this.queueHistory = history;
      if (previousIndex !== undefined && this.queue[previousIndex]) {
        await this.loadSource(this.queue[previousIndex], {
          autoplay: true,
          resume: false,
          preserveQueue: true,
        });
      }
      return;
    }

    if (currentIndex > 0 && this.queue[currentIndex - 1]) {
      await this.loadSource(this.queue[currentIndex - 1], {
        autoplay: true,
        resume: false,
        preserveQueue: true,
      });
    }
  }

  handleLocalLoadedMetadata(event: Event): void {
    const element = this.localMediaElementFromEvent(event);
    if (!element || this.currentSource?.kind !== "local-file") return;
    this.updateLocalPlayableStart(element);
    const resumeMs = this.pendingLocalResumePositionMs(element);
    this.pendingLocalResumeMs = 0;
    if (resumeMs > 0 || this.localMediaPlayableStartMs > 0) {
      this.seekMediaElement(element, resumeMs);
    }
    this.snapshot = this.localSnapshotFromElement(
      element,
      this.snapshot.status === "loading" ? "ready" : this.snapshot.status,
    );
    this.playerError = null;
    this.updateMediaSession();
    void this.persistCurrentPlaybackState(true);
    this.updateMusicTray();
  }

  handleLocalLoadedData(event: Event): void {
    const element = this.localMediaElementFromEvent(event);
    if (!element || this.currentSource?.kind !== "local-file") return;
    this.updateLocalPlayableStart(element);
    this.alignLocalMediaToPlayableStart(element);
    this.localPlayableStartKickCount = 0;
    this.localVideoReady = true;
  }

  handleLocalTimeUpdate(event: Event): void {
    const element = this.localMediaElementFromEvent(event);
    if (!element || this.currentSource?.kind !== "local-file") return;
    this.snapshot = this.localSnapshotFromElement(element, this.snapshot.status);
    void this.persistCurrentPlaybackState();
  }

  handleLocalPlay(event: Event): void {
    const element = this.localMediaElementFromEvent(event);
    if (!element || this.currentSource?.kind !== "local-file") return;
    this.scheduleLocalPlayableStartKick(element);
    this.restoreLocalMediaElementVolume(element);
    this.scheduleLocalVolumeRestore(element);
    this.snapshot = this.localSnapshotFromElement(element, "playing");
    this.playerError = null;
    this.updateMediaSession();
    void this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  handleLocalPause(event: Event): void {
    const element = this.localMediaElementFromEvent(event);
    if (!element || this.currentSource?.kind !== "local-file") return;
    if (this.ignoreNextLocalPause) {
      this.ignoreNextLocalPause = false;
      return;
    }
    if (this.snapshot.status === "idle" || element.ended) return;
    this.snapshot = this.localSnapshotFromElement(element, "paused");
    this.updateMediaSession();
    void this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  async handleLocalEnded(event: Event): Promise<void> {
    const element = this.localMediaElementFromEvent(event);
    if (!element || this.currentSource?.kind !== "local-file") return;
    this.snapshot = this.localSnapshotFromElement(element, "ended");
    this.updateMediaSession();
    await this.persistCurrentPlaybackState(true);
    this.updateMusicTray();
    await this.playNextTrack();
  }

  handleLocalError(event: Event): void {
    const element = this.localMediaElementFromEvent(event);
    if (!element || this.currentSource?.kind !== "local-file") return;
    this.playerError = this.localMediaErrorMessage(element);
    this.snapshot = { ...this.localSnapshotFromElement(element, "error"), error: this.playerError };
    this.updateMediaSession();
    void this.persistCurrentPlaybackState(true);
    this.updateMusicTray();
  }

  handleArtworkError(): void {
    this.currentArtworkUrl = null;
  }

  private async loadLocalSource(
    source: LocalFileSource,
    persisted: PersistedPlaybackState | null,
    generation: number,
    options: LoadSourceOptions,
  ): Promise<void> {
    try {
      const localSnapshot = await loadLocalMedia({
        source: {
          kind: "local-file",
          path: source.path,
          identity: source.identity,
          title: source.title,
        },
        startMs: persisted?.positionMs ?? source.startMs ?? 0,
        volume: clampVolume(this.snapshot.volume),
        rate: this.snapshot.rate,
      });
      if (generation !== this.loadGeneration) return;
      await setLocalMuted(this.muted);
      if (generation !== this.loadGeneration) return;
      const useVideoElement = this.shouldUseVideoElement(source.path, localSnapshot.hasVideo);
      const mediaUrl = useVideoElement
        ? await registerMediaFile(source.path)
        : null;
      if (generation !== this.loadGeneration) return;
      let artworkUrl = source.artworkPath
        ? await registerMediaFile(source.artworkPath).catch(() => null)
        : null;
      artworkUrl ??= await registerEmbeddedArtwork(source.path).catch(() => null);
      if (generation !== this.loadGeneration) return;
      this.pendingLocalResumeMs = persisted?.positionMs ?? source.startMs ?? 0;
      this.localMediaPlayableStartMs = useVideoElement
        ? normalizeLocalPlayableStartMs(localSnapshot.playableStartMs)
        : 0;
      this.localHasVideo = useVideoElement;
      this.localVideoReady = !useVideoElement;
      this.localMediaSrc = mediaUrl;
      this.currentArtworkUrl = artworkUrl;
      this.applyLocalSnapshot(localSnapshot);
      await tick();
      if (generation !== this.loadGeneration) return;
      if (options.autoplay) {
        if (useVideoElement) {
          this.configureLocalMediaElement();
          await this.playLocalMediaElement();
        } else {
          await this.playNativeLocalAudio();
        }
      } else if (useVideoElement) {
        this.configureLocalMediaElement();
      }
      this.updateMediaSession();
      await this.persistCurrentPlaybackState();
      this.updateMusicTray();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.playerError = mediaPlayerErrorMessage(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
      this.updateMusicTray();
    }
  }

  private async loadYouTubeSource(
    source: YouTubeSource,
    persisted: PersistedPlaybackState | null,
    generation: number,
    options: LoadSourceOptions,
  ): Promise<void> {
    const autoplay = options.autoplay === true;
    const resolvingPlaylist = source.kind === "youtube-playlist"
      ? {
          playlistId: source.playlistId,
          preferredVideoId: source.videoId,
          startMs: source.startMs,
          endMs: source.endMs,
          autoplay,
          generation,
        }
      : null;
    this.resolvingYouTubePlaylist = resolvingPlaylist;
    if (resolvingPlaylist) {
      this.startYouTubePlaylistTimeout(resolvingPlaylist);
    } else {
      this.clearYouTubePlaylistTimeout();
    }
    try {
      await this.ensureYouTubeHostFrame(generation, source, persisted, autoplay);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.clearYouTubePlaylistResolution();
      this.playerError = error instanceof Error ? error.message : String(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
      this.updateMusicTray();
      return;
    }
  }

  private applyLocalSnapshot(localSnapshot: LocalPlayerSnapshot): void {
    this.snapshot = {
      status: localSnapshot.status,
      positionMs: localSnapshot.positionMs,
      durationMs: localSnapshot.durationMs,
      volume: this.snapshot.volume,
      rate: this.snapshot.rate,
      error: localSnapshot.error,
    };
    this.playerError = localSnapshot.error;
  }

  private async playNativeLocalAudio(): Promise<void> {
    try {
      const localSnapshot = await playLocalMedia();
      this.applyLocalSnapshot(localSnapshot);
      this.playerError = null;
      this.updateMediaSession();
    } catch (error) {
      this.playerError = mediaPlayerErrorMessage(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
    }
    this.updateMusicTray();
  }

  private async pauseNativeLocalAudio(): Promise<void> {
    this.snapshot = { ...this.snapshot, status: "paused" };
    this.updateMediaSession();
    try {
      const localSnapshot = await pauseLocalMedia();
      this.applyLocalSnapshot(localSnapshot);
      this.updateMediaSession();
    } catch (error) {
      this.playerError = mediaPlayerErrorMessage(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
    }
  }

  private async stopNativeLocalAudio(): Promise<void> {
    try {
      const localSnapshot = await stopLocalMedia();
      this.applyLocalSnapshot(localSnapshot);
      this.snapshot = { ...this.snapshot, status: "idle", positionMs: 0 };
      this.updateMediaSession();
    } catch {
      this.snapshot = { ...this.snapshot, status: "idle", positionMs: 0 };
    }
  }

  private async seekNativeLocalAudio(positionMs: number): Promise<void> {
    try {
      const localSnapshot = await seekLocalMedia(positionMs);
      this.applyLocalSnapshot(localSnapshot);
    } catch (error) {
      this.playerError = mediaPlayerErrorMessage(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
    }
  }

  private async applyNativeLocalVolume(): Promise<void> {
    try {
      const volumeSnapshot = await setLocalVolume(this.snapshot.volume);
      this.applyLocalSnapshot(volumeSnapshot);
      const muteSnapshot = await setLocalMuted(false);
      this.applyLocalSnapshot(muteSnapshot);
    } catch (error) {
      this.playerError = mediaPlayerErrorMessage(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
    }
  }

  private async applyNativeLocalMute(): Promise<void> {
    try {
      const localSnapshot = await setLocalMuted(this.muted);
      this.applyLocalSnapshot(localSnapshot);
    } catch (error) {
      this.playerError = mediaPlayerErrorMessage(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
    }
  }

  private async refreshNativeLocalSnapshot(): Promise<void> {
    if (this.handlingNativeLocalEnded) return;
    const wasEnded = this.snapshot.status === "ended";
    try {
      const localSnapshot = await getLocalSnapshot();
      if (!this.usesNativeLocalAudio()) return;
      this.applyLocalSnapshot(localSnapshot);
      if (localSnapshot.status === "ended" && !wasEnded) {
        this.handlingNativeLocalEnded = true;
        this.updateMediaSession();
        await this.persistCurrentPlaybackState(true);
        this.updateMusicTray();
        try {
          await this.playNextTrack();
        } finally {
          this.handlingNativeLocalEnded = false;
        }
        return;
      }
      this.updateMediaSession();
      void this.persistCurrentPlaybackState();
      this.updateMusicTray();
    } catch {
      this.handlingNativeLocalEnded = false;
    }
  }

  private configureLocalMediaElement(): void {
    if (!this.localMediaElement) return;
    this.ignoreNextLocalPause = false;
    this.applyLocalVolume();
    this.localMediaElement.playbackRate = this.snapshot.rate;
    this.localMediaElement.load();
  }

  private async playLocalMediaElement(): Promise<void> {
    if (!this.localMediaElement) {
      this.playerError = "Media is still loading.";
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
      this.updateMusicTray();
      return;
    }
    try {
      this.restoreLocalMediaElementVolume(this.localMediaElement);
      this.localMediaElement.playbackRate = this.snapshot.rate;
      this.alignLocalMediaToPlayableStart(this.localMediaElement);
      await this.resumeAudioContext(this.localMediaElement);
      await this.localMediaElement.play();
      this.scheduleLocalPlayableStartKick(this.localMediaElement);
      this.restoreLocalMediaElementVolume(this.localMediaElement);
      this.scheduleLocalVolumeRestore(this.localMediaElement);
      this.snapshot = this.localSnapshotFromElement(this.localMediaElement, "playing");
      this.playerError = null;
      this.updateMediaSession();
    } catch (error) {
      this.playerError = error instanceof Error ? error.message : String(error);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
    }
    this.updateMusicTray();
  }

  private pauseLocalMediaElement(): void {
    if (!this.localMediaElement) return;
    this.silenceLocalMediaElement(this.localMediaElement);
    this.localMediaElement.pause();
    this.snapshot = this.localSnapshotFromElement(this.localMediaElement, "paused");
    this.updateMediaSession();
  }

  private stopLocalMediaElement(): void {
    if (!this.localMediaElement) {
      this.snapshot = { ...this.snapshot, status: "idle", positionMs: 0 };
      return;
    }
    this.ignoreNextLocalPause = true;
    this.silenceLocalMediaElement(this.localMediaElement);
    this.localMediaElement.pause();
    this.seekMediaElement(this.localMediaElement, 0);
    this.snapshot = this.localSnapshotFromElement(this.localMediaElement, "idle");
    this.updateMediaSession();
  }

  private seekLocalMediaElement(positionMs: number): void {
    if (!this.localMediaElement) {
      this.snapshot = { ...this.snapshot, positionMs };
      return;
    }
    this.seekMediaElement(this.localMediaElement, positionMs);
    this.snapshot = this.localSnapshotFromElement(this.localMediaElement, this.snapshot.status);
  }

  private seekMediaElement(element: HTMLMediaElement, positionMs: number): void {
    try {
      element.currentTime = localMediaSeekTargetMs(positionMs, this.localMediaPlayableStartMs) / 1000;
    } catch {
      this.pendingLocalResumeMs = positionMs;
    }
  }

  private localMediaElementFromEvent(event: Event): HTMLMediaElement | null {
    if (!(event.currentTarget instanceof HTMLMediaElement)) return null;
    return event.currentTarget === this.localMediaElement ? event.currentTarget : null;
  }

  private localSnapshotFromElement(element: HTMLMediaElement, status: PlaybackStatus): PlaybackSnapshot {
    return {
      ...this.snapshot,
      status,
      positionMs: this.mediaPositionMs(element),
      durationMs: this.mediaDurationMs(element),
      volume: this.snapshot.volume,
      rate: element.playbackRate,
      error: status === "error" ? this.snapshot.error : null,
    };
  }

  private mediaPositionMs(element: HTMLMediaElement): number {
    return Number.isFinite(element.currentTime) && element.currentTime > 0
      ? Math.round(element.currentTime * 1000)
      : 0;
  }

  private mediaDurationMs(element: HTMLMediaElement): number | null {
    return this.rawMediaDurationMs(element);
  }

  private updateLocalPlayableStart(element: HTMLMediaElement): void {
    const startMs = normalizeLocalPlayableStartMs(this.mediaSeekableStartMs(element));
    if (startMs > 0 || this.localMediaPlayableStartMs === 0) {
      this.localMediaPlayableStartMs = startMs;
    }
  }

  private alignLocalMediaToPlayableStart(element: HTMLMediaElement): void {
    this.updateLocalPlayableStart(element);
    if (this.localMediaPlayableStartMs <= 0 || element.currentTime * 1000 >= this.localMediaPlayableStartMs) return;
    this.seekMediaElement(element, 0);
  }

  private pendingLocalResumePositionMs(element: HTMLMediaElement): number {
    const positionMs = this.pendingLocalResumeMs;
    const durationMs = this.mediaDurationMs(element);
    return durationMs === null ? positionMs : Math.min(positionMs, durationMs);
  }

  private rawMediaDurationMs(element: HTMLMediaElement): number | null {
    return Number.isFinite(element.duration) && element.duration > 0
      ? Math.round(element.duration * 1000)
      : null;
  }

  private scheduleLocalPlayableStartKick(element: HTMLMediaElement, resetCount = true): void {
    this.clearLocalPlayableStartKick();
    if (resetCount) {
      this.localPlayableStartKickCount = 0;
    }
    if (typeof window === "undefined") return;
    this.localPlayableStartKickTimeoutId = window.setTimeout(() => {
      this.localPlayableStartKickTimeoutId = null;
      this.kickLocalMediaToPlayableStart(element);
    }, LOCAL_PLAYABLE_START_KICK_MS);
  }

  private clearLocalPlayableStartKick(): void {
    if (this.localPlayableStartKickTimeoutId === null || typeof window === "undefined") return;
    window.clearTimeout(this.localPlayableStartKickTimeoutId);
    this.localPlayableStartKickTimeoutId = null;
  }

  private kickLocalMediaToPlayableStart(element: HTMLMediaElement): void {
    if (element !== this.localMediaElement || element.paused) return;
    if (element.readyState >= MEDIA_HAVE_CURRENT_DATA_READY_STATE) return;
    const startMs = this.nextLocalPlayableStartCandidateMs(element);
    if (startMs <= 0 || this.localPlayableStartKickCount >= LOCAL_PLAYABLE_START_MAX_NUDGES) return;
    this.localPlayableStartKickCount += 1;
    this.localMediaPlayableStartMs = startMs;
    this.seekMediaElement(element, startMs);
    void element.play().catch(() => null);
    this.snapshot = this.localSnapshotFromElement(element, "playing");
    this.scheduleLocalPlayableStartKick(element, false);
  }

  private nextLocalPlayableStartCandidateMs(element: HTMLMediaElement): number {
    const currentMs = Number.isFinite(element.currentTime) && element.currentTime > 0
      ? Math.round(element.currentTime * 1000)
      : 0;
    const seekableStartMs = normalizeLocalPlayableStartMs(this.mediaSeekableStartMs(element));
    if (seekableStartMs > currentMs + 100) return seekableStartMs;
    const seekableEndMs = this.mediaSeekableEndStartCandidateMs(element);
    if (seekableEndMs > currentMs + 100) return seekableEndMs;
    return currentMs + LOCAL_PLAYABLE_START_NUDGE_MS;
  }

  private mediaSeekableEndStartCandidateMs(element: HTMLMediaElement): number {
    const rawDurationMs = this.rawMediaDurationMs(element);
    const seekableEndMs = this.mediaSeekableEndMs(element);
    if (rawDurationMs === null || seekableEndMs === null) return 0;
    if (seekableEndMs <= 1_000 || seekableEndMs >= rawDurationMs - 1_000) return 0;
    return normalizeLocalPlayableStartMs(seekableEndMs);
  }

  private mediaSeekableStartMs(element: HTMLMediaElement): number | null {
    const range = element.seekable;
    if (range.length === 0) return null;
    try {
      const start = range.start(0);
      return Number.isFinite(start) ? Math.round(start * 1000) : null;
    } catch {
      return null;
    }
  }

  private mediaSeekableEndMs(element: HTMLMediaElement): number | null {
    const range = element.seekable;
    if (range.length === 0) return null;
    try {
      const end = range.end(range.length - 1);
      return Number.isFinite(end) ? Math.round(end * 1000) : null;
    } catch {
      return null;
    }
  }

  private localMediaErrorMessage(element: HTMLMediaElement): string {
    switch (element.error?.code) {
      case 1:
        return "Local playback was interrupted.";
      case 2:
        return "The local media file could not be read.";
      case 3:
        return "The WebView could not decode this media file.";
      case 4:
        return "This file or codec is not supported by the current WebView player.";
      default:
        return "Local playback failed.";
    }
  }

  private shouldUseVideoElement(path: string, hasVideo: boolean): boolean {
    if (hasVideo) return true;
    const extension = path.split(".").pop()?.toLowerCase();
    return extension ? !audioFileExtensions.has(extension) : true;
  }

  private usesNativeLocalAudio(): boolean {
    return this.currentSource?.kind === "local-file" && !this.localHasVideo;
  }

  private async resetLocalPlayback(): Promise<void> {
    if (this.usesNativeLocalAudio()) {
      await stopLocalMedia().catch(() => null);
    }
    this.resetLocalMediaElement();
  }

  private resetLocalMediaElement(): void {
    if (this.localMediaElement) {
      this.ignoreNextLocalPause = true;
      this.silenceLocalMediaElement(this.localMediaElement);
      this.localMediaElement.pause();
      this.localMediaElement.removeAttribute("src");
      this.localMediaElement.load();
    }
    this.localPauseSilenced = false;
    this.localMediaSrc = null;
    this.localHasVideo = false;
    this.localVideoReady = false;
    this.clearLocalPlayableStartKick();
    this.localPlayableStartKickCount = 0;
    this.pendingLocalResumeMs = 0;
    this.localMediaPlayableStartMs = 0;
  }

  private async ensureYouTubeHostFrame(
    generation: number,
    source: YouTubeSource,
    persisted: PersistedPlaybackState | null,
    autoplay: boolean,
  ): Promise<void> {
    if (!this.youtubeHostBaseUrl) {
      this.youtubeHostBaseUrl = await getYouTubeHostUrl();
    }
    const url = this.youtubeHostUrlForLoad(generation, source, persisted, autoplay);
    const loadId = url.searchParams.get("load");
    this.youtubeHostUrl = url.toString();
    this.youtubeHostToken = url.searchParams.get("token");
    this.youtubeHostLoadId = loadId;
    this.youtubeHostReady = false;
    await tick();
  }

  private youtubeHostUrlForLoad(
    generation: number,
    source: YouTubeSource,
    persisted: PersistedPlaybackState | null,
    autoplay: boolean,
  ): URL {
    if (!this.youtubeHostBaseUrl) {
      throw new Error("YouTube host URL is not initialized.");
    }
    const url = new URL(this.youtubeHostBaseUrl);
    url.searchParams.set("load", String(generation));
    url.searchParams.set("sourceKind", source.kind);
    if (source.kind === "youtube-video") {
      url.searchParams.set("videoId", source.videoId);
    } else {
      url.searchParams.set("playlistId", source.playlistId);
      if (source.videoId) {
        url.searchParams.set("videoId", source.videoId);
      }
    }
    if (source.startMs !== null) {
      url.searchParams.set("startMs", String(source.startMs));
    }
    if (source.endMs !== null) {
      url.searchParams.set("endMs", String(source.endMs));
    }
    url.searchParams.set("resumeMs", String(persisted?.positionMs ?? source.startMs ?? 0));
    url.searchParams.set("volume", String(source.kind === "youtube-playlist" ? 0 : this.effectiveYouTubeVolume()));
    url.searchParams.set("rate", String(this.snapshot.rate));
    url.searchParams.set("autoplay", String(autoplay));
    return url;
  }

  private handleWindowMessage = (event: MessageEvent<unknown>): void => {
    this.handleYouTubeHostMessage(event);
  };

  private handleYouTubeHostMessage(event: MessageEvent<unknown>): void {
    if (!this.youtubeFrame?.contentWindow || event.source !== this.youtubeFrame.contentWindow) return;
    const message = this.parseYouTubeHostMessage(event.data);
    if (!message || message.token !== this.youtubeHostToken || message.load !== this.youtubeHostLoadId) return;
    if (message.type === "ganbaruai-youtube-ready") {
      this.youtubeHostReady = true;
      return;
    }
    if (message.type === "ganbaruai-youtube-error") {
      this.clearYouTubePlaylistResolution();
      this.playerError = youtubeErrorMessage(message.code);
      this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
      void this.persistCurrentPlaybackState();
      this.updateMusicTray();
      return;
    }
    if (message.type === "ganbaruai-youtube-playlist") {
      void this.applyYouTubePlaylist(message);
      return;
    }
    if (message.type === "ganbaruai-youtube-playlist-error") {
      this.failYouTubePlaylistResolution(message.playlistId);
      return;
    }
    if (this.currentSource?.kind === "youtube-playlist" && !this.resolvingYouTubePlaylist) {
      return;
    }
    this.applyYouTubeMetadataTitle(message.videoId, message.title);
    if (message.status === "playing" && Date.now() < this.youtubeOptimisticPauseUntil) {
      return;
    }
    if (message.status !== "playing") {
      this.youtubeOptimisticPauseUntil = 0;
    }
    const wasEnded = this.snapshot.status === "ended";
    const status = stableStatusDuringYouTubeBuffering(this.snapshot.status, message.status);
    this.snapshot = {
      ...this.snapshot,
      status,
      positionMs: message.positionMs,
      durationMs: message.durationMs,
      error: null,
    };
    this.updateMediaSession();
    void this.persistCurrentPlaybackState();
    this.updateMusicTray();
    if (status === "ended" && !wasEnded) {
      void this.advanceEndedYouTubeTrack();
    }
  }

  private parseYouTubeHostMessage(value: unknown): YouTubeHostMessage | null {
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.token !== "string"
      || typeof record.load !== "string"
      || typeof record.type !== "string"
    ) return null;
    if (record.type === "ganbaruai-youtube-ready") {
      return { token: record.token, load: record.load, type: "ganbaruai-youtube-ready" };
    }
    if (record.type === "ganbaruai-youtube-error" && typeof record.code === "number") {
      return { token: record.token, load: record.load, type: "ganbaruai-youtube-error", code: record.code };
    }
    if (
      record.type === "ganbaruai-youtube-playlist"
      && typeof record.playlistId === "string"
      && Array.isArray(record.videoIds)
      && record.videoIds.every((id) => typeof id === "string" && id.length > 0)
      && (typeof record.index === "number" || record.index === null)
    ) {
      return {
        token: record.token,
        load: record.load,
        type: "ganbaruai-youtube-playlist",
        playlistId: record.playlistId,
        videoIds: record.videoIds,
        index: record.index,
      };
    }
    if (
      record.type === "ganbaruai-youtube-playlist-error"
      && typeof record.playlistId === "string"
    ) {
      return {
        token: record.token,
        load: record.load,
        type: "ganbaruai-youtube-playlist-error",
        playlistId: record.playlistId,
      };
    }
    if (
      record.type === "ganbaruai-youtube-state"
      && isPlaybackStatus(record.status)
      && typeof record.positionMs === "number"
      && (typeof record.durationMs === "number" || record.durationMs === null)
      && (typeof record.videoId === "string" || record.videoId === null)
      && (typeof record.title === "string" || record.title === null)
    ) {
      return {
        token: record.token,
        load: record.load,
        type: "ganbaruai-youtube-state",
        status: record.status,
        positionMs: record.positionMs,
        durationMs: record.durationMs,
        videoId: record.videoId,
        title: record.title,
      };
    }
    return null;
  }

  private applyYouTubeMetadataTitle(videoId: string | null, title: string | null): void {
    const resolvedTitle = title?.trim();
    if (!resolvedTitle) return;

    const matchesVideo = (source: MusicSource): boolean => {
      if (source.kind === "youtube-video") {
        return videoId ? source.videoId === videoId : true;
      }
      if (source.kind === "youtube-playlist") {
        return source.videoId !== null && (videoId ? source.videoId === videoId : true);
      }
      return false;
    };

    if (this.currentSource && matchesVideo(this.currentSource) && this.currentSource.title !== resolvedTitle) {
      this.currentSource = { ...this.currentSource, title: resolvedTitle };
    }

    let queueChanged = false;
    const queue = this.queue.map((source) => {
      if (!matchesVideo(source) || source.title === resolvedTitle) return source;
      queueChanged = true;
      return { ...source, title: resolvedTitle };
    });
    if (queueChanged) {
      this.queue = queue;
    }
  }

  private async applyYouTubePlaylist(message: YouTubeHostPlaylistMessage): Promise<void> {
    const resolving = this.resolvingYouTubePlaylist;
    if (
      !resolving
      || resolving.generation !== this.loadGeneration
      || resolving.playlistId !== message.playlistId
      || message.videoIds.length === 0
    ) {
      return;
    }

    const preferredIndex = resolving.preferredVideoId
      ? message.videoIds.findIndex((videoId) => videoId === resolving.preferredVideoId)
      : -1;
    const queueSelection = preferredIndex >= 0
      ? { index: preferredIndex, remainingOrder: [] }
      : initialQueueSelection(message.videoIds.length, this.shuffleEnabled);
    const selectedIndex = queueSelection.index ?? 0;
    const queue = message.videoIds.map((videoId, index) =>
      youtubeVideoSourceFromId(videoId, {
        startMs: index === selectedIndex ? resolving.startMs : null,
        endMs: index === selectedIndex ? resolving.endMs : null,
      })
    );

    const initialIndex = queueSelection.index ?? selectedIndex;
    this.queue = queue;
    this.queueHistory = [];
    this.shuffleOrder = queueSelection.remainingOrder.filter((index) => index !== initialIndex);
    this.clearYouTubePlaylistResolution();
    await this.loadSource(queue[initialIndex] ?? queue[0], {
      autoplay: resolving.autoplay,
      resume: false,
      preserveQueue: true,
    });
  }

  private startYouTubePlaylistTimeout(resolving: ResolvingYouTubePlaylist): void {
    this.clearYouTubePlaylistTimeout();
    if (typeof window === "undefined") return;
    this.youtubePlaylistTimeoutId = window.setTimeout(() => {
      if (
        this.resolvingYouTubePlaylist
        && this.resolvingYouTubePlaylist.generation === resolving.generation
        && this.resolvingYouTubePlaylist.playlistId === resolving.playlistId
      ) {
        this.failYouTubePlaylistResolution(resolving.playlistId);
      }
    }, YOUTUBE_PLAYLIST_RESOLVE_TIMEOUT_MS);
  }

  private clearYouTubePlaylistTimeout(): void {
    if (this.youtubePlaylistTimeoutId === null) return;
    if (typeof window !== "undefined") {
      window.clearTimeout(this.youtubePlaylistTimeoutId);
    }
    this.youtubePlaylistTimeoutId = null;
  }

  private clearYouTubePlaylistResolution(): void {
    this.resolvingYouTubePlaylist = null;
    this.clearYouTubePlaylistTimeout();
  }

  private failYouTubePlaylistResolution(playlistId: string): void {
    const resolving = this.resolvingYouTubePlaylist;
    if (!resolving || resolving.playlistId !== playlistId) return;
    this.clearYouTubePlaylistResolution();
    this.playerError = "The YouTube playlist did not return playable videos. Check that it is public and supports embedded playback.";
    this.snapshot = { ...this.snapshot, status: "error", error: this.playerError };
    this.updateMusicTray();
    void this.persistCurrentPlaybackState();
  }

  private async advanceEndedYouTubeTrack(): Promise<void> {
    if (this.handlingYouTubeEnded || !this.canPlayNextTrack) return;
    this.handlingYouTubeEnded = true;
    try {
      await this.persistCurrentPlaybackState(true);
      await this.playNextTrack();
    } finally {
      this.handlingYouTubeEnded = false;
    }
  }

  private postYouTubeCommand(payload: Record<string, unknown> & { action: YouTubeCommandAction | "snapshot" }): void {
    if (!this.youtubeFrame?.contentWindow || !this.youtubeHostToken) return;
    this.youtubeFrame.contentWindow.postMessage({
      type: "ganbaruai-youtube-command",
      token: this.youtubeHostToken,
      ...payload,
    }, this.youtubeHostUrl ? new URL(this.youtubeHostUrl).origin : "*");
  }

  private async persistCurrentPlaybackState(force = false): Promise<void> {
    if (!this.currentSource) return;
    const next: PersistedPlaybackState = {
      sourceIdentity: this.currentSource.identity,
      sourceKind: this.currentSource.kind,
      positionMs: Math.max(0, Math.round(this.snapshot.positionMs)),
      durationMs: this.snapshot.durationMs === null
        ? null
        : Math.max(0, Math.round(this.snapshot.durationMs)),
      status: this.snapshot.status,
      updatedAt: Date.now(),
    };
    if (!force && !shouldPersistPlaybackState({
      ...next,
      nowMs: next.updatedAt,
    }, this.lastPersisted)) {
      return;
    }
    await savePlaybackState(next);
    this.lastPersisted = next;
  }

  private destroyYouTubePlayer(): void {
    this.clearYouTubePlaylistResolution();
    if (this.currentSource && isYouTubeSource(this.currentSource)) {
      this.postYouTubeCommand({ action: "stop" });
    }
  }

  private persistPlayerSettings(): void {
    persistSettings({
      volume: this.snapshot.volume,
      rate: this.snapshot.rate,
      shuffleEnabled: this.shuffleEnabled,
      shuffleExplicit: this.shuffleExplicit,
      muted: this.muted,
    });
  }

  private applyLocalVolume(): void {
    const element = this.localMediaElement;
    if (!element) return;
    const volume = this.localPauseSilenced ? 0 : this.effectiveVolume();
    const existingNodes = this.audioNodes.get(element);
    // Keep ordinary local video audio on the browser media path. Web Audio is only needed for boost
    // and can choose a different system sink on some Linux Bluetooth setups.
    const nodes = shouldRouteLocalMediaThroughWebAudio(volume, existingNodes !== undefined)
      ? existingNodes ?? this.ensureLocalAudioNodes(element)
      : null;
    if (nodes) {
      element.muted = volume === 0;
      element.volume = 1;
      nodes.gain.gain.value = volume;
      return;
    }
    element.muted = volume === 0;
    element.volume = volume > 1 ? 1 : volume;
  }

  private silenceLocalMediaElement(element: HTMLMediaElement): void {
    this.localPauseSilenced = true;
    element.muted = true;
    element.volume = 0;
    const nodes = this.audioNodes.get(element);
    if (nodes) {
      nodes.gain.gain.value = 0;
    }
  }

  private restoreLocalMediaElementVolume(element: HTMLMediaElement): void {
    if (element !== this.localMediaElement) return;
    this.localPauseSilenced = false;
    this.applyLocalVolume();
  }

  private scheduleLocalVolumeRestore(element: HTMLMediaElement): void {
    if (typeof window === "undefined") return;
    const restoreIfPlaying = () => {
      if (!element.paused) {
        this.restoreLocalMediaElementVolume(element);
      }
    };
    window.setTimeout(restoreIfPlaying, 0);
    window.setTimeout(restoreIfPlaying, 150);
  }

  private effectiveVolume(): number {
    return this.muted ? 0 : clampVolume(this.snapshot.volume);
  }

  private effectiveYouTubeVolume(): number {
    return this.muted ? 0 : clampYouTubeVolume(this.snapshot.volume);
  }

  private ensureLocalAudioNodes(element: HTMLMediaElement): LocalAudioNodes | null {
    if (typeof window === "undefined") return null;
    const existing = this.audioNodes.get(element);
    if (existing) return existing;
    const contextConstructor =
      window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!contextConstructor) return null;
    try {
      const context = new contextConstructor();
      const source = context.createMediaElementSource(element);
      const gain = context.createGain();
      source.connect(gain);
      gain.connect(context.destination);
      const nodes = { context, source, gain };
      this.audioNodes.set(element, nodes);
      return nodes;
    } catch {
      return null;
    }
  }

  private async resumeAudioContext(element: HTMLMediaElement): Promise<void> {
    const existingNodes = this.audioNodes.get(element);
    const nodes = shouldRouteLocalMediaThroughWebAudio(this.effectiveVolume(), existingNodes !== undefined)
      ? existingNodes ?? this.ensureLocalAudioNodes(element)
      : null;
    if (!nodes || nodes.context.state !== "suspended") return;
    await nodes.context.resume();
  }

  private updateMediaSession(): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !this.currentSource) {
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.loadedTitle,
      artist: this.sourceKindLabel,
    });
    navigator.mediaSession.playbackState = this.snapshot.status === "playing"
      ? "playing"
      : this.snapshot.status === "paused"
        ? "paused"
        : "none";
    navigator.mediaSession.setActionHandler("play", () => {
      void this.playPlayback();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      void this.pausePlayback();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      void this.playPreviousTrack();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      void this.playNextTrack();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      void this.stopPlayback();
    });
  }

  private listenToTrayEvents(): void {
    listen("tray-music-play-pause", () => {
      void this.togglePlay();
    }).then((unlisten) => {
      this.unlisteners.push(unlisten);
    }).catch((error) => console.warn("Failed to listen for tray-music-play-pause:", error));

    listen("tray-music-previous", () => {
      void this.playPreviousTrack();
    }).then((unlisten) => {
      this.unlisteners.push(unlisten);
    }).catch((error) => console.warn("Failed to listen for tray-music-previous:", error));

    listen("tray-music-next", () => {
      void this.playNextTrack();
    }).then((unlisten) => {
      this.unlisteners.push(unlisten);
    }).catch((error) => console.warn("Failed to listen for tray-music-next:", error));

    listen("tray-music-shuffle", () => {
      this.toggleShuffle();
    }).then((unlisten) => {
      this.unlisteners.push(unlisten);
    }).catch((error) => console.warn("Failed to listen for tray-music-shuffle:", error));

    listen("tray-music-open", () => {
      getNavigation().navigate("music");
    }).then((unlisten) => {
      this.unlisteners.push(unlisten);
    }).catch((error) => console.warn("Failed to listen for tray-music-open:", error));
  }

  private updateMusicTray(): void {
    const signature = [
      this.currentSource?.identity ?? "none",
      this.snapshot.status,
      this.shuffleEnabled ? "shuffle" : "ordered",
      this.canPlayPreviousTrack ? "prev" : "no-prev",
      this.canPlayNextTrack ? "next" : "no-next",
    ].join("|");
    if (signature === this.lastTraySignature) return;
    this.lastTraySignature = signature;
    invoke("update_music_tray", {
      update: {
        status: this.snapshot.status,
        canPlayPause: Boolean(this.currentSource) && !this.isBusy,
        canPrevious: this.canPlayPreviousTrack,
        canNext: this.canPlayNextTrack,
        shuffleEnabled: this.shuffleEnabled,
        hasQueue: this.queue.length > 1,
      },
    }).catch(() => {});
  }
}

let store: MusicPlayerStore | null = null;

export function getMusicPlayer(): MusicPlayerStore {
  if (!store) store = new MusicPlayerStore();
  return store;
}

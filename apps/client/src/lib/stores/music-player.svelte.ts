import type { MusicPlaybackMode, MusicRepeatMode, MusicSelectionKind, MusicWeight } from "$lib/music/library-contracts";
import type {
  MusicActivityPhase,
  MusicAssignmentBehavior,
  MusicAssignmentSource,
} from "$lib/music/music-context-assignment";
import {
  buildMusicShuffleCycle,
  eligibleMusicQueueIndices,
  emptyMusicSkipBreakdown,
  selectFreshMusicQueueItem,
  selectMusicMixIndex,
  type MusicPlaylistSkipReason,
  type MusicSavedQueueEntry,
} from "$lib/music/music-playlist-playback";
import {
  type LocalBackendKind,
} from "$lib/api/media-player";
import {
  clampRate,
  clampVolume,
  formatVolumePercent,
  shouldUseWebviewLocalVideo,
  MAX_VOLUME,
  type PlaybackSnapshot,
} from "$lib/music/playback";
import {
  formatSourceKind,
  isYouTubeSource,
  sourceDisplayLabel,
  type MusicSource,
} from "$lib/music/sources";
import { onActiveVaultIdentityChange } from "$lib/vault/active-vault";
import { planMusicQueueMutation } from "$lib/music/music-queue-mutation";
import { musicContextStateAfterAction } from "$lib/music/music-automation-ownership";
import { focusMusicWindow, publishMusicTray } from "$lib/music/music-platform-controls";
import {
  MusicSavedPlaylistRuntime,
  type MusicSavedPlaylistRuntimeCheckpoint,
} from "./music-saved-playlist-runtime";
import { MusicSurfaceClaims } from "./music-surface-claims";
import {
  initialMusicSnapshot,
  loadMusicPlayerSettings,
  persistMusicPlayerSettings,
} from "./music-player-settings";
import {
  type YouTubeCommandAction,
} from "./music-player-youtube-host";
import { MusicLoadRuntime } from "./music-load-runtime";
import { createMusicQueueController } from "./music-queue-controller";
import {
  createMusicHostedMediaController,
  type MusicStaleVisual,
} from "./music-hosted-media-controller";
import { createMusicExternalControls } from "$lib/stores/music-external-controls";
import { createMusicPlaybackRuntime } from "./music-playback-runtime";
import { createMusicYouTubeAdapter } from "./music-youtube-adapter";
import { createMusicNativeLocalAdapter } from "./music-native-local-adapter";
import { createMusicWebviewLocalAdapter } from "./music-webview-local-adapter";
import {
  createMusicSourceController,
  type LoadSourceOptions,
} from "./music-source-controller";

export type { MusicStaleVisual } from "./music-hosted-media-controller";
export type MusicPlaybackContextOwner = "manual" | "review" | "calendar-event" | "pomodoro" | "soundscape";

export type MusicPlaybackActionOrigin = "manual" | "context" | "pomodoro-pause" | "system";
export type MusicContextPlaybackState = "playing" | "prepared" | "paused" | "kept" | "unavailable" | "overridden";
export type MusicContextPlaybackIssue = "missing-playlist" | "no-eligible-items" | "offline-only" | "deleted-soundscape" | "activation-failed" | null;

export interface MusicContextPlayback {
  owner: "calendar-event" | "pomodoro";
  activationKey: string;
  eventId: string;
  eventTitle: string;
  displayLabel: string;
  phase: MusicActivityPhase;
  behavior: MusicAssignmentBehavior;
  assignmentSource: MusicAssignmentSource;
  playlistId: string | null;
  playlistName: string | null;
  state: MusicContextPlaybackState;
  issue: MusicContextPlaybackIssue;
}

export interface MusicSavedPlaylistLoadOptions {
  explicitItemId?: string | null;
  structuralSkipped?: Record<MusicPlaylistSkipReason, number>;
  autoplay?: boolean;
  autoRecovery?: boolean;
  avoidItemId?: string | null;
  context?: MusicContextPlayback | null;
}

export interface MusicSourceQueueEntry {
  itemId: string;
  source: MusicSource;
  snoozed: boolean;
}

export interface MusicReviewPlaybackCheckpoint {
  source: MusicSource | null;
  snapshot: PlaybackSnapshot;
  queue: MusicSource[];
  shuffleEnabled: boolean;
  mixEnabled: boolean;
  shuffleOrder: number[];
  queueHistory: number[];
  pendingQueueIndex: number | null;
  contextOwner: MusicPlaybackContextOwner;
  contextPlayback: MusicContextPlayback | null;
  activePlaylistId: string | null;
  activePlaylistName: string | null;
  activeSourceQueueId: string | null;
  activeQueueItemIds: string[];
  sourceQueueSnoozedItemIds: string[];
  activePlaylistRepeatMode: MusicRepeatMode;
  savedQueueEntries: MusicSavedQueueEntry[];
  savedQueueRecentItemIds: string[];
  savedQueueSkipBreakdown: Record<MusicPlaylistSkipReason, number>;
  playlistVolumeIntent: number;
  playlistRateIntent: number;
  savedQueueAutoplay: boolean;
  savedQueueAutoRecoveryEnabled: boolean;
  savedPlaylistRuntime: MusicSavedPlaylistRuntimeCheckpoint;
}

const progressMaxFallback = 1;
const YOUTUBE_START_FEEDBACK_TIMEOUT_MS = 15_000;

const initialPlayerSettings = loadMusicPlayerSettings();

class MusicPlayerStore {
  sourceInput = $state("");
  currentSource = $state<MusicSource | null>(null);
  parseError = $state<string | null>(null);
  playerError = $state<string | null>(null);
  snapshot = $state<PlaybackSnapshot>(initialMusicSnapshot(initialPlayerSettings));
  queue = $state<MusicSource[]>([]);
  folderScanTruncated = $state(false);
  shuffleEnabled = $state(initialPlayerSettings.shuffleEnabled);
  mixEnabled = $state(initialPlayerSettings.mixEnabled);
  get playbackMode(): MusicPlaybackMode {
    return this.shuffleEnabled ? this.mixEnabled ? "mix" : "shuffle" : "in-order";
  }
  muted = $state(initialPlayerSettings.muted);
  playlistVisible = $state(initialPlayerSettings.playlistVisible);
  shuffleOrder = $state<number[]>([]);
  queueHistory = $state<number[]>([]);
  pendingQueueIndex = $state<number | null>(null);
  youtubeHostUrl = $state<string | null>(null);
  youtubeFrame = $state<HTMLIFrameElement | null>(null);
  youtubeHostToken = $state<string | null>(null);
  youtubeHostReady = $state(false);
  youtubePlaybackStarting = $state(false);
  youtubeKnownDurations = $state<Record<string, number>>({});
  localMediaElement = $state<HTMLMediaElement | null>(null);
  localMediaSrc = $state<string | null>(null);
  localHasVideo = $state(false);
  localBackendKind = $state<LocalBackendKind>("none");
  localVideoReady = $state(false);
  currentArtworkUrl = $state<string | null>(null);
  staleVisual = $state<MusicStaleVisual | null>(null);
  surfaceElement = $state<HTMLElement | null>(null);
  sourceActionBusy = $state(false);
  volumeFeedbackId = $state(0);
  contextOwner = $state<MusicPlaybackContextOwner>("manual");
  contextPlayback = $state<MusicContextPlayback | null>(null);
  contextRetryRequest = $state(0);
  manualPlaybackActionVersion = $state(0);
  activePlaylistId = $state<string | null>(null);
  activePlaylistName = $state<string | null>(null);
  activeSourceQueueId = $state<string | null>(null);
  activeQueueItemIds = $state<string[]>([]);
  sourceQueueSnoozedItemIds = $state<string[]>([]);
  activePlaylistRepeatMode = $state<MusicRepeatMode>("off");
  savedQueueEntries = $state<MusicSavedQueueEntry[]>([]);
  savedQueueRecentItemIds = $state<string[]>([]);
  savedQueueSkipBreakdown = $state<Record<MusicPlaylistSkipReason, number>>(emptyMusicSkipBreakdown());
  online = $state(typeof navigator === "undefined" || navigator.onLine);

  private playlistVolumeIntent = initialMusicSnapshot(initialPlayerSettings).volume;
  private playlistRateIntent = initialMusicSnapshot(initialPlayerSettings).rate;
  private savedQueueAutoplay = true;
  private savedQueueAutoRecoveryEnabled = true;
  private unsubscribeVaultIdentity: (() => void) | null = null;

  private readonly savedPlaylistRuntime = new MusicSavedPlaylistRuntime(() => {
    this.refreshSavedQueueBreakdown();
    if (this.savedQueueAutoRecoveryEnabled && this.activePlaylistId && !this.currentSource) {
      this.recoverSavedPlaylist();
    }
  });

  private readonly loadRuntime = new MusicLoadRuntime();
  private readonly surfaceClaims = new MusicSurfaceClaims((element) => { this.surfaceElement = element; });
  private lastTraySignature = "";
  private readonly queueController = createMusicQueueController({
    state: this,
    isBusy: () => this.isBusy,
    loadSource: (source, index) => this.loadQueueEntry(source, index),
    persistSettings: () => this.persistPlayerSettings(),
    updateExternalControls: () => this.updateNativeMediaControls(),
    updateTray: () => this.updateMusicTray(),
    online: () => this.online,
    onSelection: (index, automatic) => this.recordQueueSelection(index, automatic ? "automatic" : "manual"),
    onBeforeNavigation: (index, automatic) => {
      if (!automatic) this.recordQueueOutcome(index, "skipped");
    },
  });
  private readonly hostedMediaController = createMusicHostedMediaController({
    state: this,
    loadedTitle: () => this.loadedTitle,
  });
  private readonly youtubeAdapter = createMusicYouTubeAdapter({
    state: this,
    loadRuntime: this.loadRuntime,
    effectiveVolume: () => this.effectiveYouTubeVolume(),
    loadSource: (source, autoplay) => this.loadSource(source, {
      autoplay,
      resume: false,
      preserveQueue: true,
    }),
    persist: (force) => this.persistCurrentPlaybackState(force),
    updateExternalControls: () => this.updateSystemMediaControls(),
    updateTray: () => this.updateMusicTray(),
    canPlayNext: () => this.canPlayNextTrack,
    playNext: () => this.handleTrackCompleted(),
    handlePosition: (positionMs) => this.enforceSkipRanges(positionMs),
    onDurationKnown: (videoId, durationMs) => this.rememberYouTubeDuration(videoId, durationMs),
    setPlaybackStarting: (starting) => this.setYouTubePlaybackStarting(starting),
  });
  private readonly nativeLocalAdapter = createMusicNativeLocalAdapter({
    state: this,
    updateExternalControls: () => this.updateSystemMediaControls(),
    updateTray: () => this.updateMusicTray(),
    persist: (force) => this.persistCurrentPlaybackState(force),
    playNext: () => this.handleTrackCompleted(),
    handlePosition: (positionMs) => this.enforceSkipRanges(positionMs),
  });
  private readonly webviewLocalAdapter = createMusicWebviewLocalAdapter({
    state: this,
    effectiveVolume: () => this.effectiveVolume(),
    updateExternalControls: () => this.updateSystemMediaControls(),
    updateNativeControls: () => this.updateNativeMediaControls(),
    updateTray: () => this.updateMusicTray(),
    persist: (force) => this.persistCurrentPlaybackState(force),
    playNext: () => this.handleTrackCompleted(),
    handlePosition: (positionMs) => this.enforceSkipRanges(positionMs),
  });
  private readonly externalControls = createMusicExternalControls({
    currentSource: () => this.currentSource,
    snapshot: () => this.snapshot,
    title: () => this.loadedTitle,
    sourceKindLabel: () => this.sourceKindLabel,
    artworkUrl: () => this.currentArtworkUrl,
    isBusy: () => this.isBusy,
    canPrevious: () => this.canPlayPreviousTrack,
    canNext: () => this.canPlayNextTrack,
    volume: () => this.volumeControlValue,
    muted: () => this.muted,
    shuffleEnabled: () => this.shuffleEnabled,
    play: () => this.playPlayback(),
    pause: () => this.pausePlayback(),
    togglePlay: () => this.togglePlay(),
    stop: () => this.stopPlayback(),
    previous: () => this.playPreviousTrack(),
    next: () => this.playNextTrack(),
    seekBy: (deltaMs) => this.seekByMs(deltaMs),
    seekTo: (positionMs) => this.seekToMs(positionMs),
    setVolume: (volume) => this.setVolume(volume),
    setRate: (rate) => this.setRate(rate),
    toggleShuffle: () => this.toggleShuffle(),
    inspectAssignment: () => this.inspectContextAssignment(),
    handleWindowMessage: this.youtubeAdapter.handleMessage,
  });
  private readonly playbackRuntime = createMusicPlaybackRuntime({
    loadRuntime: this.loadRuntime,
    currentSource: () => this.currentSource,
    snapshot: () => this.snapshot,
    isInitialized: this.externalControls.isInitialized,
    usesNativeLocalBackend: () => this.usesNativeLocalBackend(),
    postYouTubeSnapshot: () => this.postYouTubeCommand({ action: "snapshot" }),
    refreshNativeLocalSnapshot: (context) => this.nativeLocalAdapter.refresh(context),
  });
  private readonly sourceController = createMusicSourceController({
    state: this,
    loadRuntime: this.loadRuntime,
    hostedMedia: this.hostedMediaController,
    destroyYouTube: this.youtubeAdapter.destroy,
    clearYouTubePlaylist: this.youtubeAdapter.clearPlaylistResolution,
    resetLocalPlayback: async () => {
      await this.nativeLocalAdapter.reset();
      this.webviewLocalAdapter.reset();
    },
    shouldUseVideoElement: shouldUseWebviewLocalVideo,
    prepareWebview: this.webviewLocalAdapter.prepare,
    configureWebview: this.webviewLocalAdapter.configure,
    playWebview: this.webviewLocalAdapter.play,
    playNative: this.nativeLocalAdapter.play,
    applyNativeSnapshot: this.nativeLocalAdapter.applySnapshot,
    loadYouTube: this.youtubeAdapter.load,
    setLoadedPlaybackState: this.playbackRuntime.setLoadedState,
    persistPlayback: () => this.persistCurrentPlaybackState(),
    persistSettings: () => this.persistPlayerSettings(),
    updateExternalControls: () => this.updateSystemMediaControls(),
    updateTray: () => this.updateMusicTray(),
  });

  private youtubeStartTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Keeps newly reported durations visible while library views retain older item snapshots. */
  private rememberYouTubeDuration(videoId: string, durationMs: number): void {
    if (this.youtubeKnownDurations[videoId] === durationMs) return;
    this.youtubeKnownDurations = { ...this.youtubeKnownDurations, [videoId]: durationMs };
  }

  /** Shows start feedback until the YouTube host confirms playback or the attempt expires. */
  private setYouTubePlaybackStarting(starting: boolean): void {
    if (this.youtubeStartTimeout) clearTimeout(this.youtubeStartTimeout);
    this.youtubeStartTimeout = null;
    this.youtubePlaybackStarting = starting;
    if (starting) {
      this.youtubeStartTimeout = setTimeout(() => {
        this.youtubePlaybackStarting = false;
        this.youtubeStartTimeout = null;
      }, YOUTUBE_START_FEEDBACK_TIMEOUT_MS);
    }
  }

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
    if (index < 0 || this.queue.length === 0) return "No playlist";
    return `${index + 1} of ${this.queue.length}`;
  }

  get currentQueueIndex(): number {
    return this.queueController.currentIndex();
  }

  get currentSavedItemId(): string | null {
    return this.currentSavedQueueEntry()?.itemId ?? null;
  }

  get highlightedQueueIndex(): number {
    return this.queueController.highlightedIndex();
  }

  get canPlayPreviousTrack(): boolean {
    return this.queueController.canPlayPrevious();
  }

  get canPlayNextTrack(): boolean {
    return this.queueController.canPlayNext();
  }

  get isLocalVideoActive(): boolean {
    return this.currentSource?.kind === "local-file" && this.localHasVideo;
  }

  get volumeMax(): number {
    return MAX_VOLUME;
  }

  get volumeControlValue(): number {
    return clampVolume(this.snapshot.volume);
  }

  get volumePercentLabel(): string {
    return formatVolumePercent(this.volumeControlValue);
  }

  get volumeFeedbackLabel(): string {
    return `Sound ${formatVolumePercent(this.muted ? 0 : this.volumeControlValue)}`;
  }

  get isYouTubeActive(): boolean {
    return this.currentSource ? isYouTubeSource(this.currentSource) : false;
  }

  init(): void {
    this.externalControls.init();
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleConnectivityChange);
      window.addEventListener("offline", this.handleConnectivityChange);
    }
    this.unsubscribeVaultIdentity = onActiveVaultIdentityChange((previous, next) => {
      if (previous && previous !== next) {
        this.youtubeKnownDurations = {};
        void this.resetPlayer();
      }
    });
    this.updateMusicTray();
  }

  destroy(): void {
    this.externalControls.destroy();
    this.youtubeAdapter.destroy();
    this.playbackRuntime.stopScheduler();
    this.hostedMediaController.destroy();
    this.savedPlaylistRuntime.destroy();
    this.unsubscribeVaultIdentity?.();
    this.unsubscribeVaultIdentity = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleConnectivityChange);
      window.removeEventListener("offline", this.handleConnectivityChange);
    }
  }

  applyLibraryMetadata(itemId: string, identityKey: string, title: string, artworkUrl?: string | null): void {
    const queueIndex = this.activeQueueItemIds.indexOf(itemId);
    if (queueIndex >= 0 && this.queue[queueIndex]) this.queue[queueIndex] = { ...this.queue[queueIndex], title };
    if (!this.currentSource || (queueIndex !== this.currentQueueIndex && this.currentSource.identity !== identityKey)) return;
    this.currentSource = { ...this.currentSource, title };
    if (artworkUrl !== undefined) this.currentArtworkUrl = artworkUrl;
    this.updateSystemMediaControls();
    this.updateMusicTray();
  }

  claimSurface(owner: string, element: HTMLElement, priority = 0): () => void {
    return this.surfaceClaims.claim(owner, element, priority);
  }

  registerYouTubeFrame(frame: HTMLIFrameElement | null): void {
    this.youtubeAdapter.registerFrame(frame);
  }

  resumeSnapshotScheduler(): void {
    this.playbackRuntime.resumeScheduler();
  }

  registerLocalMedia(element: HTMLMediaElement | null): void {
    this.webviewLocalAdapter.register(element);
  }

  async loadFromInput(): Promise<void> {
    this.prepareTemporaryQueue();
    await this.sourceController.loadFromInput();
  }
  async loadFolder(): Promise<void> {
    this.prepareTemporaryQueue();
    await this.sourceController.loadFolder();
  }
  async loadSource(
    source: MusicSource,
    options: LoadSourceOptions = {},
  ): Promise<void> {
    if (!options.preserveQueue) this.prepareTemporaryQueue();
    await this.sourceController.loadSource(source, options);
  }

  async suspendForReview(): Promise<MusicReviewPlaybackCheckpoint> {
    const originalStatus = this.snapshot.status;
    if (this.currentSource && originalStatus === "playing") {
      await this.pausePlayback("system");
    }
    const checkpoint: MusicReviewPlaybackCheckpoint = {
      source: this.currentSource ? { ...this.currentSource } : null,
      snapshot: { ...this.snapshot, status: originalStatus },
      queue: this.queue.map((source) => ({ ...source })),
      shuffleEnabled: this.shuffleEnabled,
      mixEnabled: this.mixEnabled,
      shuffleOrder: [...this.shuffleOrder],
      queueHistory: [...this.queueHistory],
      pendingQueueIndex: this.pendingQueueIndex,
      contextOwner: this.contextOwner,
      contextPlayback: this.contextPlayback ? { ...this.contextPlayback } : null,
      activePlaylistId: this.activePlaylistId,
      activePlaylistName: this.activePlaylistName,
      activeSourceQueueId: this.activeSourceQueueId,
      activeQueueItemIds: [...this.activeQueueItemIds],
      sourceQueueSnoozedItemIds: [...this.sourceQueueSnoozedItemIds],
      activePlaylistRepeatMode: this.activePlaylistRepeatMode,
      savedQueueEntries: this.savedQueueEntries.map((entry) => ({
        ...entry,
        source: { ...entry.source },
        skipRanges: entry.skipRanges.map((range) => ({ ...range })),
      })),
      savedQueueRecentItemIds: [...this.savedQueueRecentItemIds],
      savedQueueSkipBreakdown: { ...this.savedQueueSkipBreakdown },
      playlistVolumeIntent: this.playlistVolumeIntent,
      playlistRateIntent: this.playlistRateIntent,
      savedQueueAutoplay: this.savedQueueAutoplay,
      savedQueueAutoRecoveryEnabled: this.savedQueueAutoRecoveryEnabled,
      savedPlaylistRuntime: this.savedPlaylistRuntime.checkpoint(),
    };
    this.queue = [];
    this.shuffleOrder = [];
    this.queueHistory = [];
    this.pendingQueueIndex = null;
    this.activePlaylistId = null;
    this.activePlaylistName = null;
    this.activeSourceQueueId = null;
    this.activeQueueItemIds = [];
    this.sourceQueueSnoozedItemIds = [];
    this.activePlaylistRepeatMode = "off";
    this.savedQueueEntries = [];
    this.savedQueueRecentItemIds = [];
    this.savedQueueSkipBreakdown = emptyMusicSkipBreakdown();
    this.savedPlaylistRuntime.reset();
    this.contextPlayback = null;
    this.contextOwner = "review";
    this.updateSystemMediaControls();
    this.updateMusicTray();
    return checkpoint;
  }

  async restoreAfterReview(checkpoint: MusicReviewPlaybackCheckpoint): Promise<void> {
    if (!checkpoint.source) await this.sourceController.resetPlayer();
    this.queue = checkpoint.queue.map((source) => ({ ...source }));
    this.shuffleEnabled = checkpoint.shuffleEnabled;
    this.mixEnabled = checkpoint.mixEnabled;
    this.shuffleOrder = [...checkpoint.shuffleOrder];
    this.queueHistory = [...checkpoint.queueHistory];
    this.pendingQueueIndex = checkpoint.pendingQueueIndex;
    this.activePlaylistId = checkpoint.activePlaylistId;
    this.activePlaylistName = checkpoint.activePlaylistName;
    this.activeSourceQueueId = checkpoint.activeSourceQueueId;
    this.activeQueueItemIds = [...checkpoint.activeQueueItemIds];
    this.sourceQueueSnoozedItemIds = [...checkpoint.sourceQueueSnoozedItemIds];
    this.activePlaylistRepeatMode = checkpoint.activePlaylistRepeatMode;
    this.savedQueueEntries = checkpoint.savedQueueEntries.map((entry) => ({
      ...entry,
      source: { ...entry.source },
      skipRanges: entry.skipRanges.map((range) => ({ ...range })),
    }));
    this.savedQueueRecentItemIds = [...checkpoint.savedQueueRecentItemIds];
    this.savedQueueSkipBreakdown = { ...checkpoint.savedQueueSkipBreakdown };
    this.playlistVolumeIntent = checkpoint.playlistVolumeIntent;
    this.playlistRateIntent = checkpoint.playlistRateIntent;
    this.savedQueueAutoplay = checkpoint.savedQueueAutoplay;
    this.savedQueueAutoRecoveryEnabled = checkpoint.savedQueueAutoRecoveryEnabled;
    this.contextPlayback = checkpoint.contextPlayback ? { ...checkpoint.contextPlayback } : null;
    this.contextOwner = checkpoint.contextOwner;
    this.savedPlaylistRuntime.restore(checkpoint.savedPlaylistRuntime, this.savedQueueEntries);
    this.snapshot = { ...checkpoint.snapshot };
    if (!checkpoint.source) {
      this.updateSystemMediaControls();
      this.updateMusicTray();
      return;
    }
    const source = { ...checkpoint.source, startMs: checkpoint.snapshot.positionMs };
    await this.sourceController.loadSource(source, {
      autoplay: checkpoint.snapshot.status === "playing",
      resume: false,
      preserveQueue: true,
    });
    this.currentSource = { ...checkpoint.source };
    this.pendingQueueIndex = checkpoint.pendingQueueIndex;
    this.contextPlayback = checkpoint.contextPlayback ? { ...checkpoint.contextPlayback } : null;
    this.contextOwner = checkpoint.contextOwner;
    if (checkpoint.snapshot.status !== "playing") {
      this.snapshot = { ...this.snapshot, status: checkpoint.snapshot.status };
    }
    this.updateSystemMediaControls();
    await this.persistCurrentPlaybackState(true);
    this.updateMusicTray();
  }
  async loadSavedPlaylist(
    playlistId: string,
    playlistName: string,
    entries: MusicSavedQueueEntry[],
    shuffleEnabled: boolean,
    repeatMode: MusicRepeatMode,
    mixEnabled = false,
    options: MusicSavedPlaylistLoadOptions = {},
  ): Promise<boolean> {
    const explicitItemId = options.explicitItemId ?? null;
    const structuralSkipped = options.structuralSkipped ?? emptyMusicSkipBreakdown();
    if (!options.context) this.manualPlaybackActionVersion += 1;
    const priorIndex = this.currentQueueIndex;
    if (priorIndex >= 0 && this.activePlaylistId) this.recordQueueOutcome(priorIndex, "skipped");
    this.playlistVolumeIntent = this.activePlaylistId ? this.playlistVolumeIntent : this.snapshot.volume;
    this.playlistRateIntent = this.activePlaylistId ? this.playlistRateIntent : this.snapshot.rate;
    this.savedQueueEntries = [...entries];
    this.queue = entries.map((entry) => entry.source);
    this.activeQueueItemIds = entries.map((entry) => entry.itemId);
    this.sourceQueueSnoozedItemIds = [];
    this.activePlaylistId = playlistId;
    this.activePlaylistName = playlistName;
    this.activeSourceQueueId = null;
    this.activePlaylistRepeatMode = repeatMode;
    this.savedPlaylistRuntime.setStructuralSkipped(structuralSkipped);
    this.contextPlayback = options.context ?? null;
    this.contextOwner = options.context?.owner ?? "manual";
    this.savedQueueAutoRecoveryEnabled = options.autoRecovery ?? options.autoplay ?? true;
    this.shuffleEnabled = shuffleEnabled;
    this.mixEnabled = shuffleEnabled && mixEnabled;
    this.queueHistory = [];
    this.savedQueueRecentItemIds = await this.savedPlaylistRuntime.recentItemIds(playlistId);
    const eligibilityContext = {
      nowMs: Date.now(),
      online: this.online,
      explicitItemId,
    };
    const eligibleIndices = eligibleMusicQueueIndices(entries, eligibilityContext);
    this.refreshSavedQueueBreakdown();
    this.savedPlaylistRuntime.scheduleSnoozeExpiry(entries);
    if (eligibleIndices.length === 0) {
      if (this.currentSource) await this.stopPlayback(options.context ? "context" : "manual");
      this.currentSource = null;
      this.pendingQueueIndex = null;
      this.snapshot = { ...this.snapshot, status: "idle", positionMs: 0, error: null };
      this.hostedMediaController.clearStaleVisual();
      this.hostedMediaController.releaseAll();
      this.updateSystemMediaControls();
      this.updateMusicTray();
      return false;
    }
    const selection = selectFreshMusicQueueItem(entries, eligibleIndices, {
      shuffle: shuffleEnabled && !mixEnabled,
      explicitItemId,
      avoidItemId: options.avoidItemId,
    });
    if (this.mixEnabled && !explicitItemId) {
      const recentItemIds = options.avoidItemId
        ? [options.avoidItemId, ...this.savedQueueRecentItemIds.filter((itemId) => itemId !== options.avoidItemId)]
        : this.savedQueueRecentItemIds;
      selection.index = selectMusicMixIndex(entries, eligibleIndices, recentItemIds);
    }
    const initialIndex = selection.index ?? -1;
    this.shuffleOrder = selection.remainingShuffleOrder;
    const first = this.queue[initialIndex];
    if (!first || initialIndex < 0) return false;
    this.pendingQueueIndex = initialIndex;
    this.persistPlayerSettings();
    this.savedQueueAutoplay = options.autoplay ?? true;
    try {
      await this.loadSavedQueueEntry(first, initialIndex);
    } finally {
      this.savedQueueAutoplay = true;
    }
    this.recordQueueSelection(initialIndex, options.context ? "automatic" : "manual");
    return true;
  }

  async loadSourceQueue(
    queueId: string,
    queueName: string,
    entries: readonly MusicSourceQueueEntry[],
    explicitItemId?: string,
  ): Promise<boolean> {
    this.prepareTemporaryQueue();
    if (entries.length === 0) return false;
    this.queue = entries.map((entry) => entry.source);
    this.activeQueueItemIds = entries.map((entry) => entry.itemId);
    this.sourceQueueSnoozedItemIds = entries.filter((entry) => entry.snoozed).map((entry) => entry.itemId);
    this.activeSourceQueueId = queueId;
    this.activePlaylistName = queueName;
    this.queueHistory = [];
    this.shuffleOrder = [];
    const explicitIndex = explicitItemId
      ? entries.findIndex((entry) => entry.itemId === explicitItemId)
      : -1;
    const initialIndex = explicitIndex >= 0 ? explicitIndex : 0;
    const first = this.queue[initialIndex];
    if (!first) return false;
    this.pendingQueueIndex = initialIndex;
    await this.loadQueueEntry(first, initialIndex);
    return true;
  }

  setContextPlayback(context: MusicContextPlayback): void {
    this.contextPlayback = context;
    this.contextOwner = context.owner;
    if (context.behavior !== "play-automatically") this.savedQueueAutoRecoveryEnabled = false;
    this.updateMusicTray();
  }

  clearContextPlayback(): void {
    if (this.contextPlayback) this.savedQueueAutoRecoveryEnabled = false;
    this.contextPlayback = null;
    this.contextOwner = "manual";
    this.updateMusicTray();
  }

  requestContextRetry(): void {
    this.contextRetryRequest += 1;
  }

  inspectContextAssignment(): void {
    const context = this.contextPlayback;
    if (!context || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("ganbaru-ai:inspect-music-assignment", {
      detail: { eventId: context.eventId },
    }));
    focusMusicWindow();
  }

  private registerManualContextAction(origin: MusicPlaybackActionOrigin): void {
    if (origin !== "manual") return;
    this.manualPlaybackActionVersion += 1;
    if (!this.contextPlayback) return;
    const state = musicContextStateAfterAction(this.contextPlayback.state, origin);
    if (!state || state === this.contextPlayback.state) return;
    this.contextPlayback = { ...this.contextPlayback, state };
    this.contextOwner = "manual";
    this.updateMusicTray();
  }
  async retrySavedPlaylist(): Promise<void> {
    if (!this.activePlaylistId) return;
    this.refreshSavedQueueBreakdown();
    await this.queueController.playNext(true);
  }
  reconcileSavedPlaylist(
    entries: MusicSavedQueueEntry[],
    structuralSkipped: Record<MusicPlaylistSkipReason, number> = emptyMusicSkipBreakdown(),
  ): void {
    if (!this.activePlaylistId) return;
    const currentEntry = this.currentSavedQueueEntry();
    const historyMembershipIds = this.queueHistory
      .map((index) => this.savedQueueEntries[index]?.membershipId)
      .filter((membershipId): membershipId is string => Boolean(membershipId));
    const plan = planMusicQueueMutation({
      playlistId: this.activePlaylistId,
      membershipId: currentEntry?.membershipId ?? null,
      itemId: currentEntry?.itemId ?? null,
    }, {
      kind: "playlist-reordered",
      playlistId: this.activePlaylistId,
      orderedItemIds: entries.map((entry) => entry.itemId),
    });
    if (plan.action !== "reorder") return;
    if (currentEntry && !entries.some((entry) => entry.membershipId === currentEntry.membershipId)) {
      this.recordQueueOutcome(this.currentQueueIndex, "skipped");
    }
    this.savedQueueEntries = [...entries];
    this.queue = entries.map((entry) => entry.source);
    this.activeQueueItemIds = entries.map((entry) => entry.itemId);
    this.sourceQueueSnoozedItemIds = [];
    this.savedPlaylistRuntime.setStructuralSkipped(structuralSkipped);
    const activeIndex = this.currentQueueIndex;
    this.shuffleOrder = this.shuffleEnabled && !this.mixEnabled
      ? buildMusicShuffleCycle(eligibleMusicQueueIndices(entries, { nowMs: Date.now(), online: this.online }), activeIndex)
      : [];
    this.queueHistory = historyMembershipIds.flatMap((membershipId) => {
      const index = entries.findIndex((entry) => entry.membershipId === membershipId);
      return index >= 0 ? [index] : [];
    });
    this.refreshSavedQueueBreakdown();
    this.savedPlaylistRuntime.scheduleSnoozeExpiry(entries);
    this.updateSystemMediaControls();
    this.updateMusicTray();
    if (!this.currentSource && eligibleMusicQueueIndices(entries, {
      nowMs: Date.now(),
      online: this.online,
    }).length > 0) void this.queueController.playNext(true);
  }

  detachDeletedPlaylist(playlistId: string): void {
    if (this.contextPlayback?.playlistId === playlistId) {
      this.setContextPlayback({
        ...this.contextPlayback,
        playlistId: null,
        playlistName: null,
        state: "unavailable",
        issue: "missing-playlist",
      });
    }
    const currentEntry = this.currentSavedQueueEntry();
    const plan = planMusicQueueMutation({
      playlistId: this.activePlaylistId,
      membershipId: currentEntry?.membershipId ?? null,
      itemId: currentEntry?.itemId ?? null,
    }, { kind: "playlist-deleted", playlistId, replacementPlaylistId: null });
    if (plan.action !== "detach-playlist") return;
    this.activePlaylistId = null;
    this.activePlaylistName = null;
    this.activeSourceQueueId = null;
    this.activePlaylistRepeatMode = "off";
    this.activeQueueItemIds = [];
    this.sourceQueueSnoozedItemIds = [];
    this.savedQueueEntries = [];
    this.savedQueueRecentItemIds = [];
    this.savedQueueSkipBreakdown = emptyMusicSkipBreakdown();
    this.savedPlaylistRuntime.reset();
    this.queueHistory = [];
    this.shuffleOrder = [];
    this.updateSystemMediaControls();
    this.updateMusicTray();
  }
  async togglePlay(origin: MusicPlaybackActionOrigin = "manual"): Promise<void> {
    if (!this.currentSource) return;
    if (this.youtubePlaybackStarting) return;
    if (this.snapshot.status === "loading" && !this.usesNativeLocalBackend()) return;
    if (this.snapshot.status === "playing") {
      await this.pausePlayback(origin);
      return;
    }
    await this.playPlayback(origin);
  }

  async playPlayback(origin: MusicPlaybackActionOrigin = "manual"): Promise<void> {
    if (!this.currentSource) return;
    this.registerManualContextAction(origin);
    this.playerError = null;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.play();
      } else {
        await this.webviewLocalAdapter.play();
      }
      await this.persistCurrentPlaybackState();
      this.updateMusicTray();
      return;
    }
    this.youtubeAdapter.clearOptimisticPause();
    this.setYouTubePlaybackStarting(true);
    this.postYouTubeCommand({ action: "play", volume: this.effectiveYouTubeVolume() });
    this.snapshot = { ...this.snapshot, status: "playing" };
    this.updateSystemMediaControls();
    void this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  async pausePlayback(origin: MusicPlaybackActionOrigin = "manual"): Promise<void> {
    if (!this.currentSource) return;
    this.registerManualContextAction(origin);
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.pause();
      } else {
        this.webviewLocalAdapter.pause();
      }
    } else {
      this.setYouTubePlaybackStarting(false);
      this.youtubeAdapter.beginOptimisticPause();
      this.postYouTubeCommand({ action: "pause", volume: this.effectiveYouTubeVolume() });
      this.snapshot = { ...this.snapshot, status: "paused" };
      this.updateSystemMediaControls();
    }
    void this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  async stopPlayback(origin: MusicPlaybackActionOrigin = "manual"): Promise<void> {
    if (!this.currentSource) return;
    this.registerManualContextAction(origin);
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.stop();
      } else {
        this.webviewLocalAdapter.stop();
      }
    } else {
      this.setYouTubePlaybackStarting(false);
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
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.seek(bounded);
      } else {
        this.webviewLocalAdapter.seek(bounded);
      }
    } else {
      this.postYouTubeCommand({ action: "seek", positionMs: bounded });
      this.snapshot = { ...this.snapshot, positionMs: bounded };
    }
    this.updateSystemMediaControls();
    await this.persistCurrentPlaybackState(true);
  }

  async setVolume(value: number): Promise<void> {
    const volume = clampVolume(value);
    if (this.activePlaylistId) this.playlistVolumeIntent = volume;
    this.snapshot = { ...this.snapshot, volume };
    this.muted = false;
    this.announceVolumeFeedback();
    this.persistPlayerSettings();
    if (!this.currentSource) {
      this.updateNativeMediaControls();
      return;
    }
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.applyVolume(true);
      } else {
        this.applyLocalVolume();
      }
    } else {
      this.postYouTubeCommand({ action: "volume", volume: clampVolume(volume) });
    }
    this.updateNativeMediaControls();
    await this.persistCurrentPlaybackState();
    this.updateMusicTray();
  }

  async setTransientVolume(value: number): Promise<void> {
    const volume = clampVolume(value);
    this.snapshot = { ...this.snapshot, volume };
    if (!this.currentSource) {
      this.updateNativeMediaControls();
      return;
    }
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.applyVolume(false);
      } else {
        this.applyLocalVolume();
      }
    } else {
      this.postYouTubeCommand({ action: "volume", volume: this.effectiveYouTubeVolume() });
    }
    this.updateNativeMediaControls();
    this.updateMusicTray();
  }

  async toggleMute(): Promise<void> {
    this.muted = !this.muted;
    this.announceVolumeFeedback();
    this.persistPlayerSettings();
    if (!this.currentSource) {
      this.updateNativeMediaControls();
      return;
    }
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.applyMute();
      } else {
        this.applyLocalVolume();
      }
    } else {
      this.postYouTubeCommand({ action: "volume", volume: this.effectiveYouTubeVolume() });
    }
    this.updateNativeMediaControls();
    await this.persistCurrentPlaybackState();
  }

  async adjustVolume(delta: number): Promise<void> {
    await this.setVolume(this.snappedVolume(this.volumeControlValue + delta, Math.abs(delta)));
  }

  private snappedVolume(value: number, step: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return this.volumeControlValue;
    return Number((Math.round(value / step) * step).toFixed(2));
  }

  private announceVolumeFeedback(): void {
    this.volumeFeedbackId += 1;
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
    const step = 0.05;
    const direction = delta > 0 ? -1 : 1;
    void this.setVolume(this.snappedVolume(this.volumeControlValue + direction * step, step));
  }

  async setRate(value: number): Promise<void> {
    const rate = clampRate(value);
    if (this.activePlaylistId) this.playlistRateIntent = rate;
    this.snapshot = { ...this.snapshot, rate };
    this.persistPlayerSettings();
    if (!this.currentSource) {
      this.updateNativeMediaControls();
      return;
    }
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) {
        await this.nativeLocalAdapter.applyRate(rate);
      } else if (this.localMediaElement) {
        this.localMediaElement.playbackRate = rate;
      }
    } else {
      this.postYouTubeCommand({ action: "rate", rate });
    }
    this.updateSystemMediaControls();
    await this.persistCurrentPlaybackState();
  }

  async resetPlayer(): Promise<void> {
    this.prepareTemporaryQueue();
    await this.sourceController.resetPlayer();
  }
  toggleShuffle(): void {
    this.queueController.toggleShuffle();
  }

  /** Switches between ordered, shuffled, and weighted Mix navigation. */
  setPlaybackMode(mode: MusicPlaybackMode): void {
    if (this.playbackMode === mode) return;
    this.shuffleEnabled = mode !== "in-order";
    this.mixEnabled = mode === "mix";
    this.shuffleOrder = mode === "shuffle" && this.savedQueueEntries.length === this.queue.length
      ? buildMusicShuffleCycle(
        eligibleMusicQueueIndices(this.savedQueueEntries, { nowMs: Date.now(), online: this.online }),
        this.currentQueueIndex,
      )
      : [];
    this.persistPlayerSettings();
    this.updateSystemMediaControls();
    this.updateMusicTray();
  }

  setPlaylistVisible(visible: boolean): void {
    if (this.playlistVisible === visible) return;
    this.playlistVisible = visible;
    this.persistPlayerSettings();
  }

  async playQueueItem(index: number): Promise<void> {
    this.registerManualContextAction("manual");
    await this.queueController.playItem(index);
  }

  async playNextTrack(): Promise<void> {
    this.registerManualContextAction("manual");
    await this.queueController.playNext(false);
  }

  async playPreviousTrack(): Promise<void> {
    this.registerManualContextAction("manual");
    await this.queueController.playPrevious();
  }

  handleLocalLoadedMetadata(event: Event): void {
    this.webviewLocalAdapter.handleLoadedMetadata(event);
  }

  handleLocalLoadedData(event: Event): void {
    this.webviewLocalAdapter.handleLoadedData(event);
  }

  handleLocalTimeUpdate(event: Event): void {
    this.webviewLocalAdapter.handleTimeUpdate(event);
  }

  handleLocalPlay(event: Event): void {
    this.webviewLocalAdapter.handlePlay(event);
  }

  handleLocalPause(event: Event): void {
    this.webviewLocalAdapter.handlePause(event);
  }

  async handleLocalEnded(event: Event): Promise<void> {
    await this.webviewLocalAdapter.handleEnded(event);
  }

  handleLocalError(event: Event): void {
    this.webviewLocalAdapter.handleError(event);
  }

  handleArtworkLoaded(): void {
    this.hostedMediaController.finishVisualTransitionAfterPaint();
  }

  handleArtworkError(): void {
    this.currentArtworkUrl = null;
    this.hostedMediaController.syncRetention();
  }

  private usesNativeLocalBackend(): boolean {
    return this.nativeLocalAdapter.isActive();
  }

  private readonly handleConnectivityChange = (): void => {
    this.online = typeof navigator === "undefined" || navigator.onLine;
    this.refreshSavedQueueBreakdown();
    if (this.savedQueueAutoRecoveryEnabled && this.activePlaylistId && !this.currentSource && this.online) {
      this.recoverSavedPlaylist();
    }
  };

  private recoverSavedPlaylist(): void {
    void this.queueController.playNext(true).then(() => {
      const context = this.contextPlayback;
      if (!this.currentSource || context?.behavior !== "play-automatically" || context.state === "overridden") return;
      this.setContextPlayback({
        ...context,
        state: "playing",
        issue: context.issue === "deleted-soundscape" ? context.issue : null,
      });
    });
  }

  private prepareTemporaryQueue(): void {
    this.manualPlaybackActionVersion += 1;
    const priorIndex = this.currentQueueIndex;
    if (priorIndex >= 0 && this.activePlaylistId) this.recordQueueOutcome(priorIndex, "skipped");
    if (this.activePlaylistId) {
      this.snapshot = {
        ...this.snapshot,
        volume: this.playlistVolumeIntent,
        rate: this.playlistRateIntent,
      };
    }
    this.activePlaylistId = null;
    this.activePlaylistName = null;
    this.activeSourceQueueId = null;
    this.activePlaylistRepeatMode = "off";
    this.savedQueueEntries = [];
    this.savedQueueRecentItemIds = [];
    this.savedQueueSkipBreakdown = emptyMusicSkipBreakdown();
    this.savedPlaylistRuntime.reset();
    this.activeQueueItemIds = [];
    this.sourceQueueSnoozedItemIds = [];
    this.clearContextPlayback();
  }

  private async loadSavedQueueEntry(source: MusicSource, index: number): Promise<void> {
    const entry = this.savedQueueEntries[index];
    if (!entry) return;
    const volume = entry.volume ?? this.playlistVolumeIntent;
    const rate = entry.rate ?? this.playlistRateIntent;
    this.snapshot = { ...this.snapshot, volume: clampVolume(volume), rate: clampRate(rate) };
    this.savedPlaylistRuntime.resetSkipRange();
    await this.sourceController.loadSource(source, {
      autoplay: this.savedQueueAutoplay,
      resume: false,
      preserveQueue: true,
    });
    await this.setTransientVolume(volume);
    await this.setTransientRate(rate);
  }

  private async loadQueueEntry(source: MusicSource, index: number): Promise<void> {
    if (this.savedQueueEntries[index]) {
      await this.loadSavedQueueEntry(source, index);
      return;
    }
    await this.sourceController.loadSource(source, {
      autoplay: true,
      resume: false,
      preserveQueue: true,
    });
  }

  async setTransientRate(value: number): Promise<void> {
    const rate = clampRate(value);
    this.snapshot = { ...this.snapshot, rate };
    if (!this.currentSource) return;
    if (this.currentSource.kind === "local-file") {
      if (this.usesNativeLocalBackend()) await this.nativeLocalAdapter.applyRate(rate);
      else if (this.localMediaElement) this.localMediaElement.playbackRate = rate;
    } else {
      this.postYouTubeCommand({ action: "rate", rate });
    }
    this.updateSystemMediaControls();
  }

  applyCurrentQueueSnooze(endsAt: number | null): void {
    this.applyQueueItemSnooze(this.currentQueueIndex, endsAt);
  }

  /** Updates the active queue after a persisted Snooze changes. */
  applyQueueItemSnooze(index: number, endsAt: number | null): void {
    const entry = this.currentSavedQueueEntry(index);
    if (!entry) {
      const itemId = this.activeQueueItemIds[index];
      if (itemId && this.activeSourceQueueId && !this.sourceQueueSnoozedItemIds.includes(itemId)) {
        this.sourceQueueSnoozedItemIds = [...this.sourceQueueSnoozedItemIds, itemId];
      }
      return;
    }
    this.savedQueueEntries[index] = {
      ...entry,
      snoozedUntil: endsAt,
      snoozedIndefinitely: endsAt === null,
    };
    this.refreshSavedQueueBreakdown();
    this.savedPlaylistRuntime.scheduleSnoozeExpiry(this.savedQueueEntries);
  }

  /** Applies a membership weight without interrupting the current playlist track. */
  applyCurrentQueueWeight(weight: MusicWeight): void {
    const index = this.currentQueueIndex;
    const entry = this.currentSavedQueueEntry(index);
    if (!entry || !this.activePlaylistId) return;
    const entries = [...this.savedQueueEntries];
    entries[index] = { ...entry, weight };
    this.savedQueueEntries = entries;
  }

  clearCurrentQueueSnooze(): void {
    this.clearQueueItemSnooze(this.currentQueueIndex);
  }

  /** Removes a queue row's Snooze indicator after the persisted Snooze is removed. */
  clearQueueItemSnooze(index: number): void {
    const itemId = this.activeQueueItemIds[index];
    if (itemId && this.activeSourceQueueId) {
      this.sourceQueueSnoozedItemIds = this.sourceQueueSnoozedItemIds.filter((id) => id !== itemId);
    }
    const entry = this.currentSavedQueueEntry(index);
    if (!entry) return;
    this.savedQueueEntries[index] = {
      ...entry,
      snoozedUntil: null,
      snoozedIndefinitely: false,
    };
    this.refreshSavedQueueBreakdown();
    this.savedPlaylistRuntime.scheduleSnoozeExpiry(this.savedQueueEntries);
  }

  private currentSavedQueueEntry(index = this.currentQueueIndex): MusicSavedQueueEntry | null {
    return index >= 0 ? this.savedQueueEntries[index] ?? null : null;
  }

  private recordQueueSelection(index: number, selectionKind: MusicSelectionKind): void {
    const entry = this.currentSavedQueueEntry(index);
    if (!entry || !this.activePlaylistId) return;
    this.savedQueueRecentItemIds = [entry.itemId, ...this.savedQueueRecentItemIds.filter((itemId) => itemId !== entry.itemId)].slice(0, 32);
    this.savedPlaylistRuntime.recordSelection(this.activePlaylistId, entry, selectionKind);
  }

  private recordQueueOutcome(index: number, outcome: "completed" | "skipped"): void {
    const entry = this.currentSavedQueueEntry(index);
    if (!entry || !this.activePlaylistId) return;
    this.savedPlaylistRuntime.recordOutcome(this.activePlaylistId, entry, outcome);
  }

  private async handleTrackCompleted(): Promise<void> {
    const index = this.currentQueueIndex;
    if (index >= 0) this.recordQueueOutcome(index, "completed");
    await this.queueController.playNext(true);
  }

  private enforceSkipRanges(positionMs: number): void {
    const target = this.savedPlaylistRuntime.skipTarget(positionMs, this.currentSavedQueueEntry());
    if (target !== null) void this.seekToMs(target);
  }

  private refreshSavedQueueBreakdown(): void {
    this.savedQueueSkipBreakdown = this.savedPlaylistRuntime.breakdown(
      this.savedQueueEntries,
      this.online,
    );
  }

  private postYouTubeCommand(payload: Record<string, unknown> & { action: YouTubeCommandAction | "snapshot" }): void {
    this.youtubeAdapter.post(payload);
  }

  private async persistCurrentPlaybackState(force = false): Promise<void> {
    await this.playbackRuntime.persist(force);
  }

  private persistPlayerSettings(): void {
    persistMusicPlayerSettings({
      volume: this.snapshot.volume,
      rate: this.snapshot.rate,
      shuffleEnabled: this.shuffleEnabled,
      mixEnabled: this.mixEnabled,
      muted: this.muted,
      playlistVisible: this.playlistVisible,
    });
  }

  private applyLocalVolume(): void {
    this.webviewLocalAdapter.applyVolume();
  }

  private effectiveVolume(): number {
    return this.muted ? 0 : this.volumeControlValue;
  }

  private effectiveYouTubeVolume(): number {
    return this.muted ? 0 : clampVolume(this.snapshot.volume);
  }

  private updateSystemMediaControls(): void {
    this.externalControls.update();
  }

  private updateNativeMediaControls(): void {
    this.externalControls.updateNative();
  }

  private updateMusicTray(): void {
    this.playbackRuntime.syncScheduler();
    const signature = [
      this.currentSource?.identity ?? "none",
      this.currentSource ? this.loadedTitle : "none",
      this.snapshot.status,
      this.canPlayPreviousTrack ? "prev" : "no-prev",
      this.canPlayNextTrack ? "next" : "no-next",
      this.contextPlayback?.state !== "overridden" ? this.contextPlayback?.displayLabel ?? "manual" : "manual",
    ].join("|");
    if (signature === this.lastTraySignature) return;
    this.lastTraySignature = signature;
    void publishMusicTray({
      status: this.snapshot.status,
      title: this.currentSource ? this.loadedTitle : null,
      canPlayPause: Boolean(this.currentSource) && !this.isBusy,
      canPrevious: this.canPlayPreviousTrack,
      canNext: this.canPlayNextTrack,
      contextLabel: this.contextPlayback?.state !== "overridden"
        ? this.contextPlayback?.displayLabel ?? null
        : null,
    }).catch(() => undefined);
  }
}

let store: MusicPlayerStore | null = null;

export function getMusicPlayer(): MusicPlayerStore {
  if (!store) store = new MusicPlayerStore();
  return store;
}

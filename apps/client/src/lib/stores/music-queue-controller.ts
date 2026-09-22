import { nextShuffleIndex } from "$lib/music/playback";
import type { MusicRepeatMode } from "$lib/music/library-contracts";
import {
  buildMusicShuffleCycle,
  eligibleMusicQueueIndices,
  nextSequentialQueueIndex,
  previousSequentialQueueIndex,
  selectMusicMixIndex,
  selectUniformMusicMixIndex,
  type MusicSavedQueueEntry,
} from "$lib/music/music-playlist-playback";
import type { MusicSource } from "$lib/music/sources";

export interface MusicQueueState {
  currentSource: MusicSource | null;
  queue: MusicSource[];
  shuffleEnabled: boolean;
  mixEnabled: boolean;
  shuffleOrder: number[];
  queueHistory: number[];
  pendingQueueIndex: number | null;
  savedQueueEntries: MusicSavedQueueEntry[];
  savedQueueRecentItemIds: string[];
  activePlaylistRepeatMode: MusicRepeatMode;
}

interface MusicQueueControllerContext {
  state: MusicQueueState;
  isBusy(): boolean;
  loadSource(source: MusicSource, index: number): Promise<void>;
  persistSettings(): void;
  updateExternalControls(): void;
  updateTray(): void;
  now?(): number;
  online?(): boolean;
  random?(): number;
  onSelection?(index: number, automatic: boolean): void;
  onBeforeNavigation?(index: number, automatic: boolean): void;
}

export interface MusicQueueController {
  currentIndex(): number;
  highlightedIndex(): number;
  canPlayPrevious(): boolean;
  canPlayNext(): boolean;
  reset(): void;
  toggleShuffle(): void;
  playItem(index: number): Promise<void>;
  playNext(automatic?: boolean): Promise<void>;
  playPrevious(): Promise<void>;
}

/** Owns queue history, shuffle selection, and track navigation. */
export function createMusicQueueController(
  context: MusicQueueControllerContext,
): MusicQueueController {
  const state = context.state;
  const currentTime = context.now ?? Date.now;
  const isOnline = context.online ?? (() => typeof navigator === "undefined" || navigator.onLine);
  const random = context.random ?? Math.random;

  function hasSavedQueue(): boolean {
    return state.savedQueueEntries.length > 0 && state.savedQueueEntries.length === state.queue.length;
  }

  function eligibleIndices(explicitIndex: number | null = null): number[] {
    if (!hasSavedQueue()) return state.queue.map((_, index) => index);
    return eligibleMusicQueueIndices(state.savedQueueEntries, {
      nowMs: currentTime(),
      online: isOnline(),
      explicitItemId: explicitIndex === null ? null : state.savedQueueEntries[explicitIndex]?.itemId ?? null,
    });
  }

  function currentIndex(): number {
    const source = state.currentSource;
    if (!source) return -1;
    return state.queue.findIndex((item) => item.identity === source.identity);
  }

  function highlightedIndex(): number {
    if (
      state.pendingQueueIndex !== null
      && state.queue[state.pendingQueueIndex]
    ) return state.pendingQueueIndex;
    return currentIndex();
  }

  function canPlayPrevious(): boolean {
    if (!state.currentSource) return false;
    if (state.queueHistory.length > 0) return true;
    if (state.shuffleEnabled) return false;
    if (!hasSavedQueue()) return currentIndex() > 0;
    return previousSequentialQueueIndex(eligibleIndices(), currentIndex(), state.activePlaylistRepeatMode) !== null;
  }

  function canPlayNext(): boolean {
    if (!state.currentSource) return false;
    if (hasSavedQueue()) {
      if (state.mixEnabled) return eligibleIndices().length > 0;
      if (state.shuffleEnabled) return state.shuffleOrder.some((index) => eligibleIndices().includes(index))
        || (state.activePlaylistRepeatMode !== "off" && eligibleIndices().length > 0);
      return nextSequentialQueueIndex(eligibleIndices(), currentIndex(), state.activePlaylistRepeatMode) !== null;
    }
    if (state.mixEnabled) return state.queue.length > 0;
    if (state.shuffleEnabled) return state.queue.length > 1;
    const index = currentIndex();
    return index >= 0 && index < state.queue.length - 1;
  }

  function reset(): void {
    state.queue = [];
    state.shuffleOrder = [];
    state.queueHistory = [];
    state.pendingQueueIndex = null;
    state.savedQueueEntries = [];
    state.savedQueueRecentItemIds = [];
    state.activePlaylistRepeatMode = "off";
  }

  function toggleShuffle(): void {
    state.shuffleEnabled = !state.shuffleEnabled;
    state.mixEnabled = false;
    state.shuffleOrder = state.shuffleEnabled && hasSavedQueue()
      ? rebuildSavedShuffle(currentIndex())
      : [];
    context.persistSettings();
    context.updateExternalControls();
    context.updateTray();
  }

  function rebuildSavedShuffle(activeIndex: number): number[] {
    return buildMusicShuffleCycle(
      eligibleIndices(),
      activeIndex,
      random,
    );
  }

  async function loadIndex(index: number, rememberCurrent: boolean, automatic: boolean): Promise<void> {
    const source = state.queue[index];
    if (!source) return;
    const activeIndex = currentIndex();
    if (!eligibleIndices(index).includes(index)) return;
    if (activeIndex >= 0 && activeIndex !== index) context.onBeforeNavigation?.(activeIndex, automatic);
    if (rememberCurrent && activeIndex >= 0 && activeIndex !== index) {
      state.queueHistory = [...state.queueHistory, activeIndex];
    }
    state.shuffleOrder = state.shuffleOrder.filter((item) => item !== index);
    state.pendingQueueIndex = index;
    await context.loadSource(source, index);
    context.onSelection?.(index, automatic);
  }

  async function playItem(index: number): Promise<void> {
    if (context.isBusy() || currentIndex() === index) return;
    await loadIndex(index, true, false);
  }

  async function playNext(automatic = false): Promise<void> {
    if (context.isBusy() || state.queue.length === 0) return;
    const activeIndex = currentIndex();
    let nextIndex: number | null = null;
    if (hasSavedQueue() && state.activePlaylistRepeatMode === "one" && automatic && activeIndex >= 0 && !state.mixEnabled) {
      nextIndex = activeIndex;
    } else if (hasSavedQueue() && state.mixEnabled) {
      nextIndex = selectMusicMixIndex(state.savedQueueEntries, eligibleIndices(), state.savedQueueRecentItemIds, random);
    } else if (hasSavedQueue() && state.shuffleEnabled) {
      state.shuffleOrder = state.shuffleOrder.filter((index) => eligibleIndices().includes(index) && index !== activeIndex);
      if (
        state.shuffleOrder.length === 0
        && (activeIndex < 0 || state.activePlaylistRepeatMode !== "off")
      ) {
        state.shuffleOrder = rebuildSavedShuffle(activeIndex);
      }
      nextIndex = state.shuffleOrder[0]
        ?? (state.activePlaylistRepeatMode !== "off" && eligibleIndices().includes(activeIndex) ? activeIndex : null);
    } else if (hasSavedQueue()) {
      const repeatMode = automatic
        ? state.activePlaylistRepeatMode
        : state.activePlaylistRepeatMode === "off" ? "off" : "all";
      nextIndex = nextSequentialQueueIndex(eligibleIndices(), activeIndex, repeatMode);
    } else if (state.mixEnabled) {
      nextIndex = selectUniformMusicMixIndex(
        state.queue.length,
        [activeIndex, ...state.queueHistory.slice(-5).reverse()],
        random,
      );
    } else if (state.shuffleEnabled) {
      const selection = nextShuffleIndex(
        state.queue.length,
        activeIndex,
        state.shuffleOrder,
      );
      nextIndex = selection.index;
      state.shuffleOrder = selection.remainingOrder;
    } else if (activeIndex < 0) {
      nextIndex = 0;
    } else if (activeIndex < state.queue.length - 1) {
      nextIndex = activeIndex + 1;
    }
    if (nextIndex === null || !state.queue[nextIndex]) return;
    await loadIndex(nextIndex, true, automatic);
  }

  async function playPrevious(): Promise<void> {
    if (context.isBusy() || !state.currentSource) return;
    const activeIndex = currentIndex();
    if (state.queueHistory.length > 0) {
      const history = [...state.queueHistory];
      const eligible = new Set(eligibleIndices());
      let previousIndex = history.pop();
      while (previousIndex !== undefined && !eligible.has(previousIndex)) previousIndex = history.pop();
      state.queueHistory = history;
      if (previousIndex !== undefined && state.queue[previousIndex]) {
        state.pendingQueueIndex = previousIndex;
        context.onBeforeNavigation?.(activeIndex, false);
        await context.loadSource(state.queue[previousIndex], previousIndex);
        context.onSelection?.(previousIndex, false);
      }
      return;
    }
    const previousIndex = hasSavedQueue()
      ? previousSequentialQueueIndex(eligibleIndices(), activeIndex, state.activePlaylistRepeatMode)
      : activeIndex - 1;
    if (previousIndex !== null && previousIndex >= 0 && state.queue[previousIndex]) {
      state.pendingQueueIndex = previousIndex;
      context.onBeforeNavigation?.(activeIndex, false);
      await context.loadSource(state.queue[previousIndex], previousIndex);
      context.onSelection?.(previousIndex, false);
    }
  }

  return {
    currentIndex,
    highlightedIndex,
    canPlayPrevious,
    canPlayNext,
    reset,
    toggleShuffle,
    playItem,
    playNext,
    playPrevious,
  };
}

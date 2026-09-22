import { describe, expect, it, vi } from "vitest";
import type { MusicSavedQueueEntry } from "$lib/music/music-playlist-playback";
import { localFileSourceFromPath, youtubeVideoSourceFromId } from "$lib/music/sources";
import { createMusicQueueController, type MusicQueueState } from "./music-queue-controller";

function createState(): MusicQueueState {
  const queue = [
    localFileSourceFromPath("/music/a.mp3", "a"),
    localFileSourceFromPath("/music/b.mp3", "b"),
    localFileSourceFromPath("/music/c.mp3", "c"),
  ];
  return {
    currentSource: queue[0],
    queue,
    shuffleEnabled: false,
    mixEnabled: false,
    shuffleOrder: [],
    queueHistory: [],
    pendingQueueIndex: null,
    savedQueueEntries: [],
    savedQueueRecentItemIds: [],
    activePlaylistRepeatMode: "off",
  };
}

function savedEntry(
  state: MusicQueueState,
  index: number,
  overrides: Partial<MusicSavedQueueEntry> = {},
): MusicSavedQueueEntry {
  return {
    membershipId: `membership-${index}`,
    itemId: `item-${index}`,
    identityKey: `local:item-${index}`,
    source: state.queue[index]!,
    sourceKind: "local-file",
    availability: "available",
    youtubeResolutionState: null,
    weight: "normal",
    enabled: true,
    snoozedUntil: null,
    snoozedIndefinitely: false,
    skipRanges: [],
    volume: null,
    rate: null,
    ...overrides,
  };
}

describe("Music queue controller", () => {
  it("records navigation history before loading the next source", async () => {
    const state = createState();
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
    });

    await controller.playNext();
    expect(state.queueHistory).toEqual([0]);
    expect(state.pendingQueueIndex).toBe(1);
    expect(loadSource).toHaveBeenCalledWith(state.queue[1], 1);
  });

  it("keeps previous-track history when changing Shuffle through external controls", () => {
    const state = createState();
    state.queueHistory = [1];
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource: vi.fn(async () => undefined),
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
    });

    controller.toggleShuffle();
    expect(state.shuffleEnabled).toBe(true);
    expect(state.queueHistory).toEqual([1]);
  });

  it("uses history before linear previous navigation", async () => {
    const state = createState();
    state.currentSource = state.queue[2];
    state.queueHistory = [0];
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
    });

    await controller.playPrevious();
    expect(state.queueHistory).toEqual([]);
    expect(loadSource).toHaveBeenCalledWith(state.queue[0], 0);
  });

  it("skips queue history entries that became ineligible", async () => {
    const state = createState();
    state.currentSource = state.queue[2];
    state.queueHistory = [0, 1];
    state.savedQueueEntries = state.queue.map((_, index) => savedEntry(state, index));
    state.savedQueueEntries[1]!.enabled = false;
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
    });

    await controller.playPrevious();
    expect(state.queueHistory).toEqual([]);
    expect(loadSource).toHaveBeenCalledWith(state.queue[0], 0);
  });

  it("uses the eligible local subset while offline", async () => {
    const state = createState();
    const youtube = youtubeVideoSourceFromId("dQw4w9WgXcQ");
    state.queue[1] = youtube;
    state.savedQueueEntries = state.queue.map((_, index) => savedEntry(state, index));
    state.savedQueueEntries[1] = savedEntry(state, 1, {
      source: youtube,
      sourceKind: "youtube-video",
      identityKey: "youtube:dQw4w9WgXcQ",
    });
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
      online: () => false,
    });

    await controller.playNext();
    expect(loadSource).toHaveBeenCalledWith(state.queue[2], 2);
  });

  it("restarts repeat-one automatically but advances on an explicit next action", async () => {
    const state = createState();
    state.savedQueueEntries = state.queue.map((_, index) => savedEntry(state, index));
    state.activePlaylistRepeatMode = "one";
    const loadSource = vi.fn(async () => undefined);
    const onSelection = vi.fn();
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
      onSelection,
    });

    await controller.playNext(true);
    expect(loadSource).toHaveBeenLastCalledWith(state.queue[0], 0);
    expect(onSelection).toHaveBeenLastCalledWith(0, true);
    await controller.playNext(false);
    expect(loadSource).toHaveBeenLastCalledWith(state.queue[1], 1);
  });

  it("lets an explicit item bypass Snooze without making automatic navigation select it", async () => {
    const state = createState();
    state.savedQueueEntries = state.queue.map((_, index) => savedEntry(state, index));
    state.savedQueueEntries[1]!.snoozedIndefinitely = true;
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
    });

    await controller.playItem(1);
    expect(loadSource).toHaveBeenCalledWith(state.queue[1], 1);
    state.currentSource = state.queue[0];
    loadSource.mockClear();
    await controller.playNext();
    expect(loadSource).toHaveBeenCalledWith(state.queue[2], 2);
  });

  it("recovers a shuffle playlist when an item becomes eligible before anything is loaded", async () => {
    const state = createState();
    state.currentSource = null;
    state.shuffleEnabled = true;
    state.savedQueueEntries = state.queue.map((_, index) => savedEntry(state, index));
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
      random: () => 0.5,
    });

    await controller.playNext(true);
    expect(loadSource).toHaveBeenCalledOnce();
  });

  it("ends a one-track Shuffle pass unless playlist repeat is enabled", async () => {
    const state = createState();
    state.queue = state.queue.slice(0, 1);
    state.shuffleEnabled = true;
    state.savedQueueEntries = [savedEntry(state, 0)];
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
    });

    expect(controller.canPlayNext()).toBe(false);
    await controller.playNext(true);
    expect(loadSource).not.toHaveBeenCalled();
    state.activePlaylistRepeatMode = "all";
    expect(controller.canPlayNext()).toBe(true);
    await controller.playNext(true);
    expect(loadSource).toHaveBeenCalledWith(state.queue[0], 0);
  });

  it("uses Mix preferences without consuming a shuffle cycle", async () => {
    const state = createState();
    state.shuffleEnabled = true;
    state.mixEnabled = true;
    state.savedQueueEntries = state.queue.map((_, index) => savedEntry(state, index, {
      weight: index === 2 ? "much-more-often" : "rarely",
    }));
    state.savedQueueRecentItemIds = ["item-0"];
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
      random: () => 0.8,
    });

    await controller.playNext(true);
    expect(loadSource).toHaveBeenCalledWith(state.queue[2], 2);
    expect(state.shuffleOrder).toEqual([]);
    expect(controller.canPlayNext()).toBe(true);
  });

  it("keeps a source Mix queue playable at its final index", async () => {
    const state = createState();
    state.currentSource = state.queue[2];
    state.shuffleEnabled = true;
    state.mixEnabled = true;
    const loadSource = vi.fn(async () => undefined);
    const controller = createMusicQueueController({
      state,
      isBusy: () => false,
      loadSource,
      persistSettings: vi.fn(),
      updateExternalControls: vi.fn(),
      updateTray: vi.fn(),
      random: () => 0,
    });

    expect(controller.canPlayNext()).toBe(true);
    await controller.playNext();
    expect(loadSource).toHaveBeenCalledWith(state.queue[0], 0);
  });
});

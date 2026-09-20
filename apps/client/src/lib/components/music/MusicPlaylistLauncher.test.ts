// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLocalRootBindings,
  getMusicPlaylistPlaybackEntries,
  getMusicPlaylistSummaries,
} from "$lib/api/music-library";
import { setActiveVaultIdentity } from "$lib/vault/active-vault";
import { getMusicPlayer } from "$lib/stores/music-player.svelte";
import { getMusicPlaylistSummaryCache } from "$lib/music/music-playlist-summary-cache.svelte";
import type { MusicPlaylistPlaybackEntry, MusicPlaylistSummary } from "$lib/music/library-contracts";

vi.mock("$lib/api/music-library", async (importOriginal) => {
  const original = await importOriginal<typeof import("$lib/api/music-library")>();
  return {
    ...original,
    getMusicPlaylistSummaries: vi.fn(),
    getMusicPlaylistPlaybackEntries: vi.fn(),
    getLocalRootBindings: vi.fn(),
  };
});

const summary = (id: string, name: string): MusicPlaylistSummary => ({
  id,
  sortOrder: 0,
  name,
  icon: "emoji:♪",
  shuffleEnabled: false,
  repeatMode: "all",
  intendedUses: [],
  totalCount: 2,
  eligibleCount: 2,
  unavailableCount: 0,
  snoozedCount: 0,
  localCount: 2,
  onlineCount: 0,
  version: 1,
});

const playbackEntry: MusicPlaylistPlaybackEntry = {
  membershipId: "membership-1",
  itemId: "item-1",
  identityKey: "local:item-1",
  sourceKind: "local-file",
  youtubeVideoId: null,
  youtubeResolutionState: null,
  title: "Track",
  availability: "available",
  rootId: "root-1",
  relativePath: "track.flac",
  position: 0,
  weight: "normal",
  enabled: true,
  startMs: null,
  endMs: null,
  volume: null,
  rate: null,
  snoozed: false,
  snoozedUntil: null,
  snoozedIndefinitely: false,
  skipRanges: [],
};

describe("Music playlist launcher", () => {
  let target: HTMLDivElement | null = null;
  let component: ReturnType<typeof mount> | null = null;

  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
    component = null;
    target = null;
    vi.restoreAllMocks();
    getMusicPlaylistSummaryCache().setVault(null);
    setActiveVaultIdentity(null);
  });

  it("searches saved playlists and starts one without opening the builder", async () => {
    vi.mocked(getMusicPlaylistSummaries).mockResolvedValue([
      summary("focus", "Deep focus"),
      summary("morning", "Morning start"),
    ]);
    vi.mocked(getMusicPlaylistPlaybackEntries).mockResolvedValue([playbackEntry]);
    vi.mocked(getLocalRootBindings).mockResolvedValue([
      { rootId: "root-1", folderPath: "/music", status: "available" },
    ]);
    setActiveVaultIdentity("vault-1");
    const player = getMusicPlayer();
    const load = vi.spyOn(player, "loadSavedPlaylist").mockResolvedValue(true);
    const openBuilder = vi.fn();
    const newPlaylist = vi.fn();
    const { default: MusicPlaylistLauncher } = await import("./MusicPlaylistLauncher.svelte");
    target = document.createElement("div");
    document.body.append(target);
    component = mount(MusicPlaylistLauncher, {
      target,
      props: { onOpenBuilder: openBuilder, onOpenIssues: vi.fn(), onNewPlaylist: newPlaylist },
    });

    target.querySelector<HTMLButtonElement>("[data-music-playlist-launcher]")?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Deep focus"));
    const popover = document.body.querySelector<HTMLElement>(".playlist-launcher-popover");
    expect(popover?.parentElement).toBe(document.body);
    expect(popover?.textContent).toContain("♪");
    expect(popover?.textContent).not.toContain("playable of");
    const search = popover?.querySelector<HTMLInputElement>('input[placeholder="Search playlists"]');
    if (!search) throw new Error("Expected playlist search input");
    search.value = "Morning";
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await tick();
    expect(popover.textContent).not.toContain("Deep focus");
    const morning = [...popover.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Morning start"));
    morning?.click();
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(
      "morning",
      "Morning start",
      expect.any(Array),
      false,
      "all",
      { structuralSkipped: expect.any(Object) },
    ));
    expect(openBuilder).not.toHaveBeenCalled();
    expect(newPlaylist).not.toHaveBeenCalled();
  });

  it("opens Review attention when a playlist has nothing playable", async () => {
    vi.mocked(getMusicPlaylistSummaries).mockResolvedValue([summary("focus", "Deep focus")]);
    vi.mocked(getMusicPlaylistPlaybackEntries).mockResolvedValue([playbackEntry]);
    vi.mocked(getLocalRootBindings).mockResolvedValue([]);
    setActiveVaultIdentity("vault-1");
    vi.spyOn(getMusicPlayer(), "loadSavedPlaylist").mockResolvedValue(false);
    const onOpenIssues = vi.fn();
    const { default: MusicPlaylistLauncher } = await import("./MusicPlaylistLauncher.svelte");
    target = document.createElement("div");
    document.body.append(target);
    component = mount(MusicPlaylistLauncher, {
      target,
      props: { onOpenBuilder: vi.fn(), onOpenIssues, onNewPlaylist: vi.fn() },
    });

    target.querySelector<HTMLButtonElement>("[data-music-playlist-launcher]")?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Deep focus"));
    [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Deep focus"))?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Open issues"));
    [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Open issues")?.click();

    expect(onOpenIssues).toHaveBeenCalledOnce();
  });
});

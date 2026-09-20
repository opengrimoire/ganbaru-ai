<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import Check from "@lucide/svelte/icons/check";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import { revealLocalFile } from "$lib/api/music";
  import { bulkEditMusicMemberships, bulkSnoozeMusicItems, reorderMusicPlaylists } from "$lib/api/music-library";
  import { createMusicBuilderInspectorController } from "$lib/music/music-builder-inspector.svelte";
  import { projectMusicBuilderLayout } from "$lib/music/music-builder-layout";
  import {
    backMusicBuilderRoute,
    initialMusicBuilderRoute,
    musicBuilderDestinationForKey,
    pushMusicBuilderRoute,
    type MusicBuilderDestination,
    type MusicBuilderHistory,
  } from "$lib/music/music-builder-routing";
  import { createMusicLibraryController, type MusicDestinationState } from "$lib/music/music-library-controller.svelte";
  import { getMusicSourcesController } from "$lib/music/music-sources-controller.svelte";
  import { createMusicReviewAuditionController, MUSIC_CONTEXT_BOUNDARY_EVENT } from "$lib/music/music-review-audition.svelte";
  import { createMusicReviewController } from "$lib/music/music-review-controller.svelte";
  import { createMusicPlaylistController } from "$lib/music/music-playlist-controller.svelte";
  import { createMusicBulkEditController } from "$lib/music/music-bulk-edit-controller.svelte";
  import { createMusicInterchangeController } from "$lib/music/music-interchange-controller.svelte";
  import {
    musicReviewArtworkDataUrl,
    parseMusicReviewAutoplay,
  } from "$lib/music/music-review";
  import {
    firstMusicReviewTreeItemId,
    musicReviewTreeItemIds,
  } from "$lib/music/music-review-tree";
  import type { MusicItemListEntry, MusicWeight } from "$lib/music/library-contracts";
  import type { MusicIssue, MusicSourceCollection } from "$lib/music/library-contracts";
  import type { MusicSourceRefreshPlan } from "$lib/music/music-source-refresh";
  import { musicBuilderPlaybackDecision } from "$lib/music/music-builder-playback-transition";
  import { musicSnoozeEndsAt, type MusicSnoozeDuration } from "$lib/music/music-snooze";
  import {
    createMusicBuilderContextViewState,
    createMusicReviewTreeViewState,
    createMusicReviewWorkspaceViewState,
  } from "$lib/music/music-builder-view-state";
  import { onMusicLibraryChanged } from "$lib/music/music-library-events";
  import { onActiveVaultIdentityChange, requireActiveVaultIdentity } from "$lib/vault/active-vault";
  import { getConfigKey, setConfigKey } from "$lib/vault/config";
  import MusicBuilderAsyncState from "./builder/MusicBuilderAsyncState.svelte";
  import MusicBuilderFilterBar from "./builder/MusicBuilderFilterBar.svelte";
  import MusicPreparationActivity from "./builder/MusicPreparationActivity.svelte";
  import MusicBuilderOverview from "./builder/MusicBuilderOverview.svelte";
  import MusicDetectedFolderCard from "./builder/MusicDetectedFolderCard.svelte";
  import MusicVirtualItemList from "./builder/MusicVirtualItemList.svelte";
  import MusicAddSourceDialog from "./builder/MusicAddSourceDialog.svelte";
  import MusicReviewIssuesPanel from "./builder/MusicReviewIssuesPanel.svelte";
  import MusicItemRepairDialog from "$lib/components/music/builder/MusicItemRepairDialog.svelte";
  import MusicNetworkRefreshDialog from "./builder/MusicNetworkRefreshDialog.svelte";
  import MusicRelinkWizard from "$lib/components/music/builder/MusicRelinkWizard.svelte";
  import MusicSourceRemovalDialog from "./builder/MusicSourceRemovalDialog.svelte";
  import MusicSourcesDashboard from "./builder/MusicSourcesDashboard.svelte";
  import MusicReviewWorkspace from "./builder/MusicReviewWorkspace.svelte";
  import MusicReviewTree from "./builder/MusicReviewTree.svelte";
  import MusicBuilderContextPanel from "./builder/MusicBuilderContextPanel.svelte";
  import MusicBuilderDock from "./builder/MusicBuilderDock.svelte";
  import MusicBuilderToolbar from "./builder/MusicBuilderToolbar.svelte";
  import MusicPlaylistManager from "./builder/MusicPlaylistManager.svelte";
  import MusicSoundscapeBuilder from "$lib/components/music/MusicSoundscapeBuilder.svelte";
  import MusicPlaylistDialog from "./builder/MusicPlaylistDialog.svelte";
  import MusicInterchangeDialog from "./builder/MusicInterchangeDialog.svelte";
  import type { MusicBuilderInitialAction } from "$lib/music/music-builder-loader";
  import { musicIssueGroup } from "$lib/music/music-issue-presentation";
  import { isSystemMusicPlaylistId, orderMusicPlaylists, systemMusicPlaylistName } from "$lib/music/music-system-playlists";

  let {
    onOpenPlayer,
    presentation = "desktop",
    active = true,
    initialAction = null,
    onInitialActionHandled = () => undefined,
  }: {
    onOpenPlayer: () => void;
    presentation?: "desktop" | "mobile";
    active?: boolean;
    initialAction?: MusicBuilderInitialAction | null;
    onInitialActionHandled?: () => void;
  } = $props();
  const { t } = getLocalization();
  const library = createMusicLibraryController();
  const inspector = createMusicBuilderInspectorController();
  const sources = getMusicSourcesController();
  const audition = createMusicReviewAuditionController();
  const review = createMusicReviewController(library, inspector);
  const playlist = createMusicPlaylistController(library);
  const bulk = createMusicBulkEditController(library);
  const interchange = createMusicInterchangeController(() => library.playlistSummaries, () => sources.bindings, () => library.vaultId);
  const supportsSoundscapes = platformHasCapability(BUILD_PLATFORM_PROFILE, "music.soundscapes");
  const supportsLocalFileReveal = platformHasCapability(BUILD_PLATFORM_PROFILE, "music.local-file-reveal");
  const supportsItemRepair = platformHasCapability(BUILD_PLATFORM_PROFILE, "music.local-item-repair");
  const supportsRelinkPlans = platformHasCapability(BUILD_PLATFORM_PROFILE, "music.local-root-relink-plans");
  const supportsRootReselection = platformHasCapability(BUILD_PLATFORM_PROFILE, "music.local-root-reselection");
  const mobilePresentation = $derived(presentation === "mobile");
  let root = $state<HTMLElement | null>(null);
  let width = $state(1000);
  let height = $state(680);
  let history = $state<MusicBuilderHistory>(initialMusicBuilderRoute(1, null, { playlistIds: new Set() }));
  let unsubscribeVault: (() => void) | null = null;
  let unsubscribeLibraryChanges: (() => void) | null = null;
  let sourceSurface = $state<"add" | "relink" | "remove" | "item-repair" | null>(null);
  let sourceSurfaceCollection = $state<MusicSourceCollection | null>(null);
  let repairItemId = $state<string | null>(null);
  let pendingRefreshPlan = $state<MusicSourceRefreshPlan | null>(null);
  let playlistSurface = $state<"create" | "edit" | "duplicate" | "delete" | null>(null);
  let playlistSurfaceReturnsToCurrentView = $state(false);
  let playlistSurfaceTargetId = $state<string | null>(null);
  let reviewAutoplay = $state(parseMusicReviewAutoplay(getConfigKey<unknown>("music.review.autoplay", undefined)));
  let choosingFirstUseFolder = $state(false);
  let firstUseFolderError = $state<string | null>(null);
  let builderInitializing = $state(true);
  let firstUsePreparationActive = $state(false);
  let firstUseFinalizing = $state(false);
  let firstUseFinalizationGeneration = 0;
  let playlistManagementOpen = $state(false);
  let soundscapeAddRequest = $state(0);
  let toolbarMenuOpen = $state(false);
  let reviewSelectionClearRequest = $state(0);
  let previouslyActive = false;
  const contextViewState = $state(createMusicBuilderContextViewState());
  const reviewTreeViewState = $state(createMusicReviewTreeViewState());
  const reviewWorkspaceViewState = $state(createMusicReviewWorkspaceViewState());
  const layout = $derived(projectMusicBuilderLayout({ width, height }));
  const destination = $derived(history.current.destination);
  const hasList = $derived(destination.kind === "playlist");
  const issueCount = $derived(library.issues.length);
  const reviewCount = $derived(library.sourceSummaries.reduce((total, source) => total + source.unreviewedCount, 0));
  const reviewIssueItemIds = $derived(new Set(library.issues.flatMap((issue) => issue.itemId ? [issue.itemId] : [])));
  const activeReviewItemId = $derived(library.selectedItem?.id ?? firstMusicReviewTreeItemId(library.currentWindow.items));
  const activeReviewIssue = $derived(activeReviewItemId
    ? library.issues.find((issue) => issue.itemId === activeReviewItemId && issue.actionRequired)
      ?? library.issues.find((issue) => issue.itemId === activeReviewItemId)
      ?? null
    : null);
  const routeContext = $derived({ playlistIds: new Set(library.playlistSummaries.map((playlist) => playlist.id)), itemIds: new Set(library.currentWindow.items.map((item) => item.id)) });
  const playingItemId = $derived(audition.musicPlayer.activeQueueItemIds[audition.musicPlayer.currentQueueIndex] ?? null);
  const activePlaylistSummary = $derived(destination.kind === "playlist" ? library.playlistSummaries.find((entry) => entry.id === destination.playlistId) ?? null : null);
  const activePlaylistInPlayer = $derived(Boolean(activePlaylistSummary && audition.musicPlayer.activePlaylistId === activePlaylistSummary.id && audition.musicPlayer.currentSource));
  const activePlaylistPlaying = $derived(activePlaylistInPlayer && audition.musicPlayer.isPlaying);
  const firstUseProjectionPending = $derived(
    sources.firstUseSession && sources.roots.length > 0,
  );
  const builderPreparation = $derived(
    builderInitializing
      || sources.preparingDefaultFolder
      || firstUsePreparationActive
      || firstUseProjectionPending,
  );
  const firstUseNeedsFolder = $derived(
    destination.kind === "review"
      && sources.loaded
      && !sources.busy
      && !sources.preparingDefaultFolder
      && sources.roots.length === 0
      && library.currentWindow.items.length === 0,
  );
  const firstUseRefreshProgress = $derived(Object.values(sources.refreshStatuses).find((status) => status.kind === "local-root"));
  const localSourceCollectionIds = $derived(sources.collections.filter((collection) => collection.kind === "local-root").map((collection) => collection.id));
  const sourceRefreshActive = $derived(Object.values(sources.refreshStatuses).some((status) => status.state === "queued" || status.state === "running"));
  const localSourceRefreshActive = $derived(Object.values(sources.refreshStatuses).some((status) => status.kind === "local-root" && (status.state === "queued" || status.state === "running")));

  $effect(() => {
    if (!firstUseProjectionPending
      || sources.preparingDefaultFolder
      || !sources.loaded
      || firstUseFinalizing
      || library.busy
      || library.loadingMore
      || !library.vaultId) return;
    beginFirstUsePreparation();
    void finalizeFirstUsePreparation();
  });

  $effect(() => {
    const selectedSourceId = contextViewState.selectedSourceId;
    if (selectedSourceId && !library.sourceSummaries.some((source) => source.id === selectedSourceId)) contextViewState.selectedSourceId = null;
  });

  $effect(() => {
    if (contextViewState.reviewPanel !== "issues") return;
    if (library.issues.length === 0) {
      contextViewState.reviewPanel = "folders";
      contextViewState.reviewIssueGroup = null;
      return;
    }
    const selectedGroup = contextViewState.reviewIssueGroup;
    if (selectedGroup && !library.issues.some((issue) => musicIssueGroup(issue) === selectedGroup)) contextViewState.reviewIssueGroup = null;
  });

  function beginFirstUsePreparation(): void {
    builderInitializing = true;
    if (firstUsePreparationActive) return;
    firstUsePreparationActive = true;
    firstUseFinalizationGeneration += 1;
  }

  async function finalizeFirstUsePreparation(): Promise<void> {
    if (!firstUsePreparationActive || sources.preparingDefaultFolder || firstUseFinalizing) return;
    const generation = firstUseFinalizationGeneration;
    const vaultId = library.vaultId;
    firstUseFinalizing = true;
    try {
      const refreshed = await library.refreshAfterMutation();
      if (generation !== firstUseFinalizationGeneration || vaultId !== library.vaultId) return;
      if (!refreshed) throw library.error ?? new Error("The prepared music library could not be loaded.");
      const fullyLoaded = await library.loadAllCurrentItems();
      if (generation !== firstUseFinalizationGeneration || vaultId !== library.vaultId) return;
      if (!fullyLoaded) throw library.loadMoreError ?? new Error("The prepared review list could not be completed.");
      const itemId = firstMusicReviewTreeItemId(library.currentWindow.items);
      if (itemId) {
        library.selectItem(itemId);
        const selected = await inspector.select(itemId);
        if (!selected || generation !== firstUseFinalizationGeneration || vaultId !== library.vaultId) return;
        const orderedIds = musicReviewTreeItemIds(library.currentWindow.items);
        const itemIndex = orderedIds.indexOf(itemId);
        const nearbyIds = orderedIds.slice(Math.max(0, itemIndex - 1), itemIndex + 4);
        const details = await inspector.prefetch(nearbyIds);
        await Promise.all(details.map(async (detail) => {
          const url = await musicReviewArtworkDataUrl(detail, sources.bindings).catch(() => null);
          if (!url || typeof Image === "undefined") return;
          const image = new Image();
          image.src = url;
          await image.decode().catch(() => undefined);
        }));
        const detail = inspector.detail;
        if (active && reviewAutoplay && detail?.item.id === itemId) {
          await audition.preview(detail, sources.bindings, true);
        }
      }
      if (generation !== firstUseFinalizationGeneration || vaultId !== library.vaultId) return;
      sources.completeFirstUseSession();
      builderInitializing = false;
      firstUsePreparationActive = false;
    } catch (error) {
      if (generation === firstUseFinalizationGeneration && vaultId === library.vaultId) {
        library.error = error instanceof Error ? error : new Error(String(error));
        builderInitializing = false;
        firstUsePreparationActive = false;
      }
    } finally {
      firstUseFinalizing = false;
    }
  }

  $effect(() => {
    const action = initialAction;
    if (!action || !library.vaultId || builderInitializing) return;
    if (action === "new-playlist") playlistSurface = "create";
    else if (action === "open-playlists") void navigateNow({ kind: "playlists" });
    else if (action.kind === "open-issues") void openReviewIssues();
    else if (action.kind === "open-soundscapes") {
      if (supportsSoundscapes) void navigateNow({ kind: "soundscapes" });
    }
    else void openInitialItem(action.itemId);
    onInitialActionHandled();
  });

  $effect(() => {
    if (!active && previouslyActive && audition.active) void audition.restore();
    previouslyActive = active;
  });

  function observeRoot(node: HTMLElement): { destroy: () => void } {
    root = node;
    const update = () => { width = node.clientWidth; height = node.clientHeight; };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return { destroy: () => { observer.disconnect(); root = null; } };
  }

  async function loadVault(vaultId: string): Promise<void> {
    const generation = ++firstUseFinalizationGeneration;
    builderInitializing = true;
    firstUsePreparationActive = false;
    Object.assign(contextViewState, createMusicBuilderContextViewState());
    Object.assign(reviewTreeViewState, createMusicReviewTreeViewState());
    Object.assign(reviewWorkspaceViewState, createMusicReviewWorkspaceViewState());
    bulk.clear();
    reviewSelectionClearRequest += 1;
    playlistManagementOpen = false;
    inspector.reset();
    library.setVault(vaultId);
    sources.setVault(vaultId);
    try {
      const [libraryLoaded, sourcesLoaded] = await Promise.all([
        library.preloadCoreDestinations(),
        sources.load(),
      ]);
      if (generation !== firstUseFinalizationGeneration
        || vaultId !== library.vaultId || vaultId !== sources.vaultId) return;
      if (!libraryLoaded) throw library.error ?? new Error("The music library could not be loaded.");
      if (!sourcesLoaded) throw new Error(sources.error ?? "The music sources could not be loaded.");
      const recoveryPlan = sources.prepareUninitializedLocalRefresh();
      if (recoveryPlan.targets.length > 0) {
        await sources.runRefresh(recoveryPlan, false);
        if (!await library.refreshAfterMutation()) {
          throw library.error ?? new Error("The refreshed music library could not be loaded.");
        }
      }
      const remembered = history.current.destination;
      history = initialMusicBuilderRoute(reviewCount, remembered, routeContext);
      library.navigate(history.current.destination);
      if (!await library.ensureCurrentDestination()) {
        throw library.error ?? new Error("The music workspace could not be loaded.");
      }
      if (history.current.destination.kind === "playlist") {
        await playlist.load(history.current.destination.playlistId);
      }
      if (sources.firstUseSession && sources.roots.length > 0) {
        beginFirstUsePreparation();
        await finalizeFirstUsePreparation();
      } else {
        const fullyLoaded = await library.loadAllCurrentItems();
        if (generation !== firstUseFinalizationGeneration || vaultId !== library.vaultId) return;
        if (!fullyLoaded) {
          throw library.loadMoreError ?? new Error("The music workspace could not be completed.");
        }
        builderInitializing = false;
      }
    } catch (error) {
      if (generation !== firstUseFinalizationGeneration || vaultId !== library.vaultId) return;
      library.error = error instanceof Error ? error : new Error(String(error));
      builderInitializing = false;
      firstUsePreparationActive = false;
    }
  }

  function primaryAction(): void {
    if (destination.kind === "playlists") { playlist.clear(); playlistSurfaceReturnsToCurrentView = false; playlistSurfaceTargetId = null; playlistSurface = "create"; return; }
    if (destination.kind === "sources") sourceSurface = "add";
  }

  function createPlaylistFromWorkspace(): void {
    playlist.clear();
    playlistSurfaceReturnsToCurrentView = true;
    playlistSurfaceTargetId = null;
    playlistSurface = "create";
  }

  function workspaceStatus(): string {
    if (destination.kind === "playlists") return t("music.builder.playlistCount", library.playlistSummaries.length);
    if (destination.kind === "playlist") {
      const summary = library.playlistSummaries.find((entry) => entry.id === destination.playlistId);
      return summary ? `${systemMusicPlaylistName(summary.id, summary.name, t)} · ${t("music.tracks", summary.totalCount)}` : t("music.builder.playlists");
    }
    if (destination.kind === "sources") return t("music.builder.sourceCount", library.sourceSummaries.length);
    return t("music.builder.soundscapes");
  }

  function closeSourceSurface(): void {
    sources.cancelResolution();
    if (sourceSurface === "relink" && sources.relinkPlan?.state === "ready") {
      void sources.cancelRelink();
    }
    sourceSurface = null;
    sourceSurfaceCollection = null;
    repairItemId = null;
    sources.clearItemRepair();
  }

  function requestSourceRefresh(collectionIds?: string[]): void {
    const plan = sources.prepareRefresh(collectionIds);
    if (plan.requiresNetworkConfirmation) pendingRefreshPlan = plan;
    else void runSourceRefresh(plan, false);
  }

  function refreshReviewFolders(): void {
    requestSourceRefresh(localSourceCollectionIds);
  }

  async function runSourceRefresh(plan: MusicSourceRefreshPlan, allowNetwork: boolean): Promise<void> {
    pendingRefreshPlan = null;
    await sources.runRefresh(plan, allowNetwork);
    await library.refreshAfterMutation();
  }

  function detectedFolderAdded(): void {
    void library.refreshAfterMutation();
    if (destination.kind !== "sources") navigate({ kind: "sources" });
  }

  function collectionById(collectionId: string): MusicSourceCollection | null {
    return sources.collections.find((collection) => collection.id === collectionId) ?? null;
  }

  async function openRemoval(collectionId: string): Promise<void> {
    const collection = collectionById(collectionId);
    if (!collection) return;
    sourceSurfaceCollection = collection;
    await sources.inspectRemoval(collectionId);
    sourceSurface = "remove";
  }

  async function openRelink(collectionId: string): Promise<void> {
    const collection = collectionById(collectionId);
    if (!collection?.localRootId) return;
    if (supportsRootReselection) {
      try {
        if (await sources.reselectLocalRoot(collection)) await library.refreshAfterMutation();
      } catch (error) {
        sources.error = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    if (!supportsRelinkPlans) return;
    sourceSurfaceCollection = collection;
    sourceSurface = "relink";
  }

  function repairIssue(issue: MusicIssue): void {
    if (issue.rootId) {
      const collection = sources.collections.find((entry) => entry.localRootId === issue.rootId);
      if (collection) void openRelink(collection.id);
      return;
    }
    if (issue.itemId && supportsItemRepair) { openItemRepair(issue.itemId); return; }
    if (issue.collectionId) requestSourceRefresh([issue.collectionId]);
  }

  function canRepairIssue(issue: MusicIssue): boolean {
    if (issue.rootId) return supportsRelinkPlans || supportsRootReselection;
    if (issue.itemId) return supportsItemRepair;
    return Boolean(issue.collectionId);
  }

  function openItemRepair(itemId: string): void {
    if (!supportsItemRepair) return;
    repairItemId = itemId;
    sources.clearItemRepair();
    sourceSurface = "item-repair";
  }

  async function navigateNow(next: MusicBuilderDestination): Promise<void> {
    if (next.kind === "soundscapes" && !supportsSoundscapes) return;
    history = pushMusicBuilderRoute(history, { destination: next, inspectorItemId: null }, routeContext);
    library.navigate(next);
    inspector.clear();
    await library.ensureCurrentDestination();
    if (next.kind === "playlist") await playlist.load(next.playlistId);
    else playlist.clear();
  }

  async function openInitialItem(_itemId: string): Promise<void> {
    const activePlaylistId = audition.musicPlayer.activePlaylistId;
    const next: MusicBuilderDestination = activePlaylistId
      && library.playlistSummaries.some((entry) => entry.id === activePlaylistId)
      ? { kind: "playlist", playlistId: activePlaylistId }
      : { kind: "playlists" };
    await navigateNow(next);
  }

  function navigate(next: MusicBuilderDestination): void {
    if (next.kind === "soundscapes" && !supportsSoundscapes) return;
    contextViewState.contextPanelOpen = false;
    toolbarMenuOpen = false;
    if (next.kind !== "playlists" && next.kind !== "playlist") playlistManagementOpen = false;
    if (next.kind === destination.kind && next.kind !== "playlist") return;
    if (next.kind === "playlist" && destination.kind === "playlist" && next.playlistId === destination.playlistId) return;
    void navigateNow(next);
  }

  async function openReviewIssues(): Promise<void> {
    if (destination.kind !== "review") await navigateNow({ kind: "review" });
    contextViewState.reviewPanel = "issues";
    contextViewState.reviewIssueGroup = null;
    if (layout.contextPanelPresentation === "sheet") contextViewState.contextPanelOpen = true;
  }

  async function selectReviewIssue(issue: MusicIssue): Promise<void> {
    if (!issue.itemId) return;
    while (!library.currentWindow.items.some((item) => item.id === issue.itemId)
      && library.currentWindow.items.length < library.currentWindow.totalCount) {
      if (!await library.loadMore()) break;
    }
    if (library.currentWindow.items.some((item) => item.id === issue.itemId)) {
      clearReviewSelection();
      library.selectItem(issue.itemId);
    }
  }

  async function openPlayerFromBuilder(): Promise<void> {
    if (audition.active) await audition.restore();
    onOpenPlayer();
  }

  function takePlaybackOwnership(): void {
    if (musicBuilderPlaybackDecision(audition.ownsPlayback, "explicit-playback") === "release-review") audition.discard();
  }

  function setReviewAutoplay(value: boolean): void {
    reviewAutoplay = value;
    setConfigKey("music.review.autoplay", value);
  }

  async function handleBack(): Promise<void> {
    const previous = backMusicBuilderRoute(history, routeContext);
    if (!previous) { void openPlayerFromBuilder(); return; }
    history = previous;
    library.navigate(history.current.destination);
    await library.ensureCurrentDestination();
    if (history.current.destination.kind === "playlist") await playlist.load(history.current.destination.playlistId);
    else playlist.clear();
  }

  function patchFilters(patch: Partial<MusicDestinationState>): void {
    library.patchCurrentState({ ...patch, offset: 0 });
    void library.refresh();
  }

  function updateSearch(search: string): void {
    library.patchCurrentState({ search, offset: 0 });
    if (destination.kind !== "playlists") void library.refresh();
  }

  async function openPlaylistManagementSurface(playlistId: string, mode: "edit" | "delete"): Promise<void> {
    if (!await playlist.load(playlistId)) return;
    if (mode === "delete" && !await playlist.inspectDelete()) return;
    playlistSurfaceReturnsToCurrentView = true;
    playlistSurfaceTargetId = playlistId;
    playlistSurface = mode;
  }

  async function reorderPlaylistSummaries(playlistIds: string[]): Promise<boolean> {
    const previous = orderMusicPlaylists(library.playlistSummaries).map((entry) => ({ ...entry, intendedUses: [...entry.intendedUses] }));
    const byId = new Map(previous.map((entry) => [entry.id, entry]));
    if (playlistIds.length !== previous.length || playlistIds.some((id) => !byId.has(id))) return false;
    const next = playlistIds.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder }));
    library.playlistSummaries = next;
    try {
      const receipts = await reorderMusicPlaylists({
        playlists: next.map((entry) => ({ playlistId: entry.id, expectedVersion: entry.version })),
        updatedAt: Date.now(),
      });
      const versions = new Map(receipts.map((receipt) => [receipt.id, receipt.version]));
      library.playlistSummaries = next.map((entry) => ({ ...entry, version: versions.get(entry.id) ?? entry.version }));
      playlist.clear();
      return true;
    } catch {
      library.playlistSummaries = previous;
      await library.refreshAfterMutation();
      return false;
    }
  }

  async function playCurrentPlaylist(itemId?: string): Promise<void> {
    takePlaybackOwnership();
    await playlist.play(sources.bindings, itemId);
  }

  async function playReplacementPlaylist(playlistId: string, navigateToPlaylist: boolean): Promise<void> {
    if (navigateToPlaylist) await navigateNow({ kind: "playlist", playlistId });
    else await playlist.load(playlistId);
    await playCurrentPlaylist();
  }

  async function toggleCurrentPlaylist(): Promise<void> {
    if (activePlaylistInPlayer) {
      await audition.musicPlayer.togglePlay();
      return;
    }
    await playCurrentPlaylist();
  }

  async function togglePlaylistItem(item: MusicItemListEntry): Promise<void> {
    const currentItemId = audition.musicPlayer.activeQueueItemIds[audition.musicPlayer.currentQueueIndex] ?? null;
    if (activePlaylistInPlayer && currentItemId === item.id) {
      await audition.musicPlayer.togglePlay();
      return;
    }
    await playCurrentPlaylist(item.id);
  }

  function clearReviewSelection(): void {
    reviewTreeViewState.selectedItemIds = [];
    reviewTreeViewState.selectedFolderIds = [];
    reviewSelectionClearRequest += 1;
    bulk.clear();
  }

  function activateReviewItem(itemId: string): void {
    if (reviewTreeViewState.selectedItemIds.length > 0) clearReviewSelection();
    library.selectItem(itemId);
  }

  async function chooseFirstUseFolder(): Promise<void> {
    if (choosingFirstUseFolder) return;
    choosingFirstUseFolder = true;
    firstUseFolderError = null;
    beginFirstUsePreparation();
    try {
      const draft = await sources.chooseLocalFolder();
      if (!draft) {
        builderInitializing = false;
        firstUsePreparationActive = false;
        return;
      }
      await sources.addLocalFolder(draft.selection, draft.name, true);
      await finalizeFirstUsePreparation();
    } catch (error) {
      firstUseFolderError = error instanceof Error ? error.message : String(error);
      builderInitializing = false;
      firstUsePreparationActive = false;
    } finally {
      choosingFirstUseFolder = false;
    }
  }

  async function removePlaylistItem(item: MusicItemListEntry): Promise<void> {
    if (destination.kind !== "playlist") return;
    await bulkEditMusicMemberships({
      actionId: crypto.randomUUID(),
      itemIds: [item.id],
      addPlaylistIds: [],
      removePlaylistIds: [destination.playlistId],
      weightPlaylistIds: [],
      weight: null,
      updatedAt: Date.now(),
    });
    await library.refreshAfterMutation();
    await playlist.refreshActivePlayback(sources.bindings);
  }

  async function setPlaylistItemWeight(item: MusicItemListEntry, weight: MusicWeight): Promise<void> {
    if (destination.kind !== "playlist") return;
    await bulkEditMusicMemberships({
      actionId: crypto.randomUUID(),
      itemIds: [item.id],
      addPlaylistIds: [],
      removePlaylistIds: [],
      weightPlaylistIds: [destination.playlistId],
      weight,
      updatedAt: Date.now(),
    });
    await library.refreshAfterMutation();
    await playlist.refreshActivePlayback(sources.bindings);
  }

  async function snoozePlaylistItem(item: MusicItemListEntry, duration: MusicSnoozeDuration, everywhere: boolean): Promise<void> {
    if (destination.kind !== "playlist") return;
    const now = Date.now();
    const endsAt = musicSnoozeEndsAt(duration, now, Intl.DateTimeFormat().resolvedOptions().timeZone);
    await bulkSnoozeMusicItems({
      actionId: crypto.randomUUID(),
      itemIds: [item.id],
      scope: everywhere ? "all-playlists" : "playlist",
      playlistId: everywhere ? null : destination.playlistId,
      startsAt: now,
      endsAt,
      reason: "",
      createdAt: now,
    });
    const currentItemId = audition.musicPlayer.activeQueueItemIds[audition.musicPlayer.currentQueueIndex] ?? null;
    if (currentItemId === item.id) audition.musicPlayer.applyCurrentQueueSnooze(endsAt);
    await library.refreshAfterMutation();
    await playlist.refreshActivePlayback(sources.bindings);
  }

  async function showItemLocation(item: MusicItemListEntry): Promise<void> {
    if (!supportsLocalFileReveal) return;
    if (inspector.itemId !== item.id) await inspector.select(item.id);
    const location = inspector.detail?.locations.find((entry) => entry.availability === "available");
    if (!location) { openItemRepair(item.id); return; }
    const folder = sources.bindings.find((binding) => binding.rootId === location.rootId)?.folderPath;
    if (!folder) { openItemRepair(item.id); return; }
    const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
    const path = `${folder.replace(/[\\/]+$/, "")}${separator}${location.relativePath.replace(/[\\/]+/g, separator)}`;
    await revealLocalFile(path);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!active) return;
    if (event.key === "Escape") {
      if (contextViewState.contextPanelOpen) { event.preventDefault(); event.stopPropagation(); contextViewState.contextPanelOpen = false; return; }
      if (toolbarMenuOpen) { event.preventDefault(); event.stopPropagation(); toolbarMenuOpen = false; return; }
      if (sourceSurface || pendingRefreshPlan) { event.stopPropagation(); closeSourceSurface(); pendingRefreshPlan = null; return; }
      if (destination.kind === "review" && reviewTreeViewState.selectedItemIds.length > 0) { event.preventDefault(); event.stopPropagation(); clearReviewSelection(); return; }
      event.stopPropagation();
      void handleBack();
    }
    const target = event.target instanceof Element ? event.target : null;
    const shortcutDestination = musicBuilderDestinationForKey(event.key);
    const shortcutBlocked = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || Boolean(target?.closest("input, textarea, [contenteditable='true'], [role='dialog']"))
      || Boolean(sourceSurface || pendingRefreshPlan || playlistSurface || interchange.open);
    if (shortcutDestination && !shortcutBlocked && (shortcutDestination.kind !== "soundscapes" || supportsSoundscapes)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate(shortcutDestination);
      return;
    }
    if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      if (destination.kind === "review") return;
      if (!hasList) return;
      event.preventDefault();
      if (layout.contextPanelPresentation === "sheet") contextViewState.contextPanelOpen = true;
      void tick().then(() => root?.querySelector<HTMLInputElement>("[data-builder-context-search]")?.focus());
    }
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    if (!active) return;
    if (!toolbarMenuOpen || !(event.target instanceof Element)) return;
    if (event.target.closest(".toolbar-menu, .toolbar-icon")) return;
    toolbarMenuOpen = false;
  }

  onMount(() => {
    const handleBoundary = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const owner = event.detail?.owner;
      if ((owner === "calendar-event" || owner === "pomodoro") && musicBuilderPlaybackDecision(audition.ownsPlayback, "automation-boundary") === "supersede-review") audition.supersedeForBoundary(owner);
    };
    window.addEventListener(MUSIC_CONTEXT_BOUNDARY_EVENT, handleBoundary);
    try { void loadVault(requireActiveVaultIdentity()); }
    catch (error) { library.error = error instanceof Error ? error : new Error(String(error)); }
    unsubscribeVault = onActiveVaultIdentityChange((_previous, next) => {
      if (audition.active) audition.discard();
      if (next) void loadVault(next);
      else { library.setVault(null); sources.setVault(null); }
    });
    unsubscribeLibraryChanges = onMusicLibraryChanged(() => { void library.refreshAfterMutation(); });
    return () => window.removeEventListener(MUSIC_CONTEXT_BOUNDARY_EVENT, handleBoundary);
  });

  onDestroy(() => {
    firstUseFinalizationGeneration += 1;
    unsubscribeVault?.();
    unsubscribeLibraryChanges?.();
    if (audition.active) void audition.restore();
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} onpointerdown={handleWindowPointerDown} />

<section bind:this={root} use:observeRoot class="builder-root flex h-full min-h-0 select-none flex-col overflow-hidden text-foreground" style="background-color: var(--cal-bg);">
  <div class="builder-shell relative grid min-h-0 flex-1" class:builder-wide={layout.mode === "wide"} class:builder-medium={layout.mode === "medium"} class:builder-narrow={layout.mode === "narrow"} class:builder-contextless={builderPreparation || firstUseNeedsFolder}>
    {#if !builderPreparation && !firstUseNeedsFolder}
      <aside class:context-open={contextViewState.contextPanelOpen} class="builder-context-panel relative z-20 flex min-h-0 flex-col overflow-hidden bg-background/20">
        {#if layout.contextPanelPresentation === "sheet"}
          <div class="flex h-11 shrink-0 items-center px-2">
            <button
              type="button"
              onclick={() => contextViewState.contextPanelOpen = false}
              class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[0.7rem] font-medium text-foreground active:bg-secondary"
              aria-label={t("music.builder.closeContextPanel")}
            ><ArrowLeft size={15} />{t("music.builder.back")}</button>
          </div>
        {/if}
        {#if destination.kind === "review"}
          {#if contextViewState.reviewPanel === "issues" && issueCount > 0}
            <MusicReviewIssuesPanel
              issues={library.issues}
              items={library.currentWindow.items}
              sources={library.sourceSummaries}
              selectedGroup={contextViewState.reviewIssueGroup}
              activeItemId={activeReviewItemId}
              refreshing={sourceRefreshActive}
              onSelectGroup={(group) => contextViewState.reviewIssueGroup = group}
              onBack={() => { contextViewState.reviewPanel = "folders"; contextViewState.reviewIssueGroup = null; }}
              onSelectIssue={(issue) => { void selectReviewIssue(issue); }}
              onRepair={repairIssue}
              {canRepairIssue}
              onRefresh={() => requestSourceRefresh()}
            />
          {:else}
            <MusicReviewTree
              items={library.currentWindow.items}
              totalCount={library.currentWindow.totalCount}
              activeItemId={reviewTreeViewState.selectedItemIds.length > 0 ? null : library.selectedItem?.id ?? null}
              onActivate={activateReviewItem}
              issueCount={issueCount}
              issueItemIds={reviewIssueItemIds}
              onOpenIssues={() => { void openReviewIssues(); }}
              selectionClearRequest={reviewSelectionClearRequest}
              selectionDisabled={bulk.saving}
              canRefresh={localSourceCollectionIds.length > 0}
              refreshing={localSourceRefreshActive}
              onRefresh={refreshReviewFolders}
              viewState={reviewTreeViewState}
              onViewStateChange={(state) => Object.assign(reviewTreeViewState, state)}
            />
          {/if}
        {:else}
          <MusicBuilderContextPanel
            {destination}
            state={library.currentState}
            playlists={library.playlistSummaries}
            sources={library.sourceSummaries}
            selectedSourceId={contextViewState.selectedSourceId}
            soundscapeFilter={contextViewState.soundscapeFilter}
            onSearch={updateSearch}
            onNavigate={navigate}
            onCreatePlaylist={createPlaylistFromWorkspace}
            onManagePlaylists={() => playlistManagementOpen = true}
            onSelectSource={(sourceId) => contextViewState.selectedSourceId = sourceId}
            onSoundscapeFilter={(filter) => contextViewState.soundscapeFilter = filter}
          />
        {/if}
        {#if layout.dockPresentation === "sidebar"}<MusicBuilderDock {destination} {reviewCount} showAllLabels={mobilePresentation} includeSoundscapes={supportsSoundscapes} onNavigate={navigate} />{/if}
      </aside>
    {/if}
    <main class="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/30">
      {#if destination.kind !== "review"}
        <MusicBuilderToolbar status={workspaceStatus()} showPanelButton={layout.contextPanelPresentation === "sheet"} onOpenPanel={() => contextViewState.contextPanelOpen = true} onOpenPlayer={openPlayerFromBuilder} compactPlayerLabel={mobilePresentation}>
          {#snippet actions()}
            {#if destination.kind === "playlists"}
              <button type="button" onclick={createPlaylistFromWorkspace} class="toolbar-primary"><Plus size={13} />{t("music.builder.newPlaylist")}</button>
              <div class="relative"><button type="button" onclick={() => toolbarMenuOpen = !toolbarMenuOpen} class="toolbar-icon" aria-label={t("music.builder.moreActions")}><MoreHorizontal size={15} /></button>{#if toolbarMenuOpen}<div class="toolbar-menu"><button type="button" onclick={() => { toolbarMenuOpen = false; interchange.show("import"); }}>{t("music.builder.importPlaylists")}</button><button type="button" disabled={library.playlistSummaries.length === 0} onclick={() => { toolbarMenuOpen = false; interchange.show("export", null); }}>{t("music.builder.exportPlaylists")}</button></div>{/if}</div>
            {:else if destination.kind === "playlist"}
              {#if library.undoCount > 0}<button type="button" onclick={() => { void library.undoLast(); }} class="toolbar-icon" aria-label={t("music.builder.undo")}><Undo2 size={14} /></button>{/if}
              <button type="button" onclick={() => { void toggleCurrentPlaylist(); }} class="toolbar-icon" aria-label={activePlaylistPlaying ? t("music.pause") : t("music.play")}>
                {#if activePlaylistPlaying}<Pause size={14} fill="currentColor" />{:else}<Play size={14} />{/if}
              </button>
              <div class="relative"><button type="button" onclick={() => toolbarMenuOpen = !toolbarMenuOpen} class="toolbar-icon" aria-label={t("music.builder.moreActions")}><MoreHorizontal size={15} /></button>{#if toolbarMenuOpen}<div class="toolbar-menu"><button type="button" onclick={() => { toolbarMenuOpen = false; playlistSurface = "edit"; }}>{t("music.builder.editPlaylist")}</button><button type="button" onclick={() => { toolbarMenuOpen = false; playlistSurface = "duplicate"; }}>{t("music.builder.duplicatePlaylist")}</button><button type="button" onclick={() => { toolbarMenuOpen = false; interchange.show("export", destination.playlistId); }}>{t("music.builder.exportPlaylists")}</button><button type="button" class="text-destructive" disabled={isSystemMusicPlaylistId(destination.playlistId)} title={isSystemMusicPlaylistId(destination.playlistId) ? t("music.builder.defaultPlaylistDeleteProtected") : undefined} onclick={() => { toolbarMenuOpen = false; void playlist.inspectDelete().then((loaded) => { if (loaded) playlistSurface = "delete"; }); }}>{t("music.builder.deletePlaylist")}</button></div>{/if}</div>
            {:else if destination.kind === "sources"}
              <button type="button" onclick={() => requestSourceRefresh()} disabled={sources.collections.length === 0} class="toolbar-secondary"><RefreshCw size={13} />{t("music.builder.refreshAll")}</button>
              <button type="button" onclick={() => sourceSurface = "add"} class="toolbar-primary"><Plus size={13} />{t("music.builder.addSource")}</button>
            {:else if destination.kind === "soundscapes"}
              <button type="button" onclick={() => soundscapeAddRequest += 1} class="toolbar-primary"><Plus size={13} />{t("music.soundscape.addLoop")}</button>
            {/if}
          {/snippet}
        </MusicBuilderToolbar>
      {/if}
      {#if destination.kind === "review"}
        {#if builderPreparation}
          <div class="relative grid h-full min-h-40 place-items-center overflow-hidden p-5">
            <div class="w-full max-w-lg text-center">
              <MusicPreparationActivity />
              <h1 class="mt-3 text-lg font-semibold tracking-tight">
                {sources.firstUseSession || sources.preparingDefaultFolder
                  ? t("music.builder.preparingMusicFolder")
                  : t("music.builder.loading")}
              </h1>
              {#if sources.preparingDefaultFolderPath}<p class="mx-auto mt-2 max-w-md truncate text-xs text-muted-foreground" title={sources.preparingDefaultFolderPath}>{sources.preparingDefaultFolderPath}</p>{/if}
              {#if firstUseRefreshProgress}
                <div class="mx-auto mt-5 max-w-sm">
                  <div class="h-1 overflow-hidden rounded-full bg-secondary"><div class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={`width: ${firstUseRefreshProgress.progress && firstUseRefreshProgress.progress.discoveredCount > 0 ? Math.min(96, Math.max(8, firstUseRefreshProgress.progress.processedCount / firstUseRefreshProgress.progress.discoveredCount * 100)) : 8}%`}></div></div>
                  <p class="mt-2 text-[0.68rem] tabular-nums text-muted-foreground">{t("music.builder.preparingMusicFolderProgress", firstUseRefreshProgress.progress?.processedCount ?? 0, firstUseRefreshProgress.progress?.discoveredCount ?? 0)}</p>
                </div>
              {/if}
            </div>
          </div>
        {:else if firstUseNeedsFolder}
          <div class="relative grid h-full min-h-40 place-items-center overflow-hidden p-5">
            <button type="button" onclick={openPlayerFromBuilder} class="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-secondary/75 text-secondary-foreground hover:bg-accent" aria-label={t("music.backToPlayer")}><ArrowLeft size={17} /></button>
            <div class="w-full max-w-sm text-center">
              <button type="button" onclick={() => { void chooseFirstUseFolder(); }} disabled={choosingFirstUseFolder} class="group mx-auto grid h-24 w-24 place-items-center rounded-3xl bg-primary/10 text-primary transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 motion-reduce:transform-none">
                {#if choosingFirstUseFolder}<LoaderCircle class="animate-spin motion-reduce:animate-none" size={32} />{:else}<FolderSearch size={34} strokeWidth={1.35} />{/if}
              </button>
              <h1 class="mt-5 text-lg font-semibold tracking-tight">{t("music.builder.chooseMusicFolder")}</h1>
              {#if firstUseFolderError || sources.defaultFolderPreparationError}<p class="mt-3 text-xs text-destructive" role="alert">{firstUseFolderError ?? sources.defaultFolderPreparationError}</p>{/if}
            </div>
          </div>
        {:else if library.error && library.currentWindow.items.length === 0}
          <MusicBuilderAsyncState kind="error" title={library.error.message} onRetry={() => { void library.refresh(); }} />
        {:else if library.busy && library.currentWindow.items.length === 0}
          <MusicBuilderAsyncState kind="loading" />
        {:else if library.currentWindow.items.length === 0}
          <div class="grid h-full min-h-40 place-items-center p-5 text-center">
            {#if sources.detectedDefaultFolder}
              <MusicDetectedFolderCard controller={sources} onAdded={detectedFolderAdded} />
            {:else}
              <div class="max-w-sm rounded-2xl border border-border/60 bg-card/55 p-5 shadow-sm">
                <div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success/12 text-success"><Check size={21} strokeWidth={1.8} aria-hidden="true" /></div>
                <h2 class="mt-3 text-sm font-semibold">{t("music.builder.emptyReviewTitle")}</h2>
                <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("music.builder.emptyReviewDescription")}</p>
                <div class="mt-4 flex flex-wrap justify-center gap-2">
                  {#if library.currentState.reviewState !== null}
                    <button type="button" onclick={() => { library.patchCurrentState({ reviewState: null }); void library.refresh(); }} class="h-8 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground">{t("music.builder.reviewDeferred")}</button>
                  {/if}
                  <button type="button" onclick={() => navigate({ kind: "sources" })} class="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">{t("music.builder.sources")}</button>
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <MusicReviewWorkspace {library} {inspector} {sources} {audition} {review} {bulk} {active} selectedItemIds={reviewTreeViewState.selectedItemIds} selectedFolderIds={reviewTreeViewState.selectedFolderIds} onClearSelection={clearReviewSelection} autoplay={reviewAutoplay} onAutoplayChange={setReviewAutoplay} onOpenPlayer={openPlayerFromBuilder} compactPlayerLabel={mobilePresentation} showPanelButton={layout.contextPanelPresentation === "sheet"} onOpenPanel={() => contextViewState.contextPanelOpen = true} onEditPlaylist={(playlistId) => { void openPlaylistManagementSurface(playlistId, "edit"); }} onDeletePlaylist={(playlistId) => { void openPlaylistManagementSurface(playlistId, "delete"); }} onReorderPlaylists={reorderPlaylistSummaries} issue={activeReviewIssue} repairAvailable={activeReviewIssue ? canRepairIssue(activeReviewIssue) : false} onRepairIssue={repairIssue} viewState={reviewWorkspaceViewState} />
        {/if}
      {:else if playlistManagementOpen && (destination.kind === "playlists" || destination.kind === "playlist")}
        <div class="min-h-0 flex-1 overflow-y-auto p-3" data-music-scrollable="true"><MusicPlaylistManager playlists={library.playlistSummaries} onEdit={(playlistId) => { void openPlaylistManagementSurface(playlistId, "edit"); }} onDelete={(playlistId) => { void openPlaylistManagementSurface(playlistId, "delete"); }} onReorder={reorderPlaylistSummaries} onDone={() => playlistManagementOpen = false} /></div>
      {:else if hasList}
        {#if destination.kind === "playlist" && playlist.detail && playlist.playbackIssue === "no-eligible-items"}
              <div class="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[0.68rem] text-warning" role="status">
                <span class="min-w-0 flex-1">{t("music.builder.noEligiblePlaylistItems")}</span>
                {#if issueCount > 0}<button type="button" onclick={() => { void openReviewIssues(); }} class="h-7 rounded-md bg-secondary px-2.5 font-medium text-secondary-foreground">{t("music.builder.openIssues")}</button>{/if}
              </div>
        {/if}
        {#if destination.kind === "playlist"}
        <MusicBuilderFilterBar
          sourceKind={library.currentState.sourceKind}
          availability={library.currentState.availability}
          sort={library.currentState.sort}
          direction={library.currentState.direction}
          resultCount={library.currentWindow.totalCount}
          snoozed={library.currentState.snoozed}
          onChange={patchFilters}
        />
        {/if}
        {#if library.error && library.currentWindow.items.length === 0}
          <MusicBuilderAsyncState kind="error" title={library.error.message} onRetry={() => { void library.refresh(); }} />
        {:else if library.busy && library.currentWindow.items.length === 0}
          <MusicBuilderAsyncState kind="loading" />
        {:else if library.currentWindow.items.length === 0}
          {#if destination.kind === "playlist" && (library.playlistSummaries.find((entry) => entry.id === destination.playlistId)?.totalCount ?? 0) === 0}
            <div class="grid min-h-0 flex-1 place-items-center p-4 text-center">
              <div class="max-w-sm rounded-2xl border border-border/60 bg-card/55 p-5 shadow-sm">
                <h2 class="text-sm font-semibold">{t("music.builder.emptyPlaylistActionTitle")}</h2>
                <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("music.builder.emptyPlaylistActionDescription")}</p>
                <div class="mt-4 flex flex-wrap justify-center gap-2"><button type="button" onclick={() => { void navigate({ kind: "review" }); }} class="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground">{t("music.builder.startReview")}</button></div>
              </div>
            </div>
          {:else}
            <MusicBuilderAsyncState
              kind="empty"
              title={t("music.builder.noPlaylistFilterResults")}
              description={t("music.builder.adjustPlaylistFilters")}
            />
          {/if}
        {:else}
          {#if library.busy}<div class="absolute inset-x-0 top-10 z-10 bg-secondary/90 px-3 py-1 text-center text-[0.62rem] text-muted-foreground backdrop-blur-sm">{t("music.builder.staleData")}</div>{/if}
          <MusicVirtualItemList
            items={library.currentWindow.items}
            bindings={sources.bindings}
            playlistName={activePlaylistSummary ? systemMusicPlaylistName(activePlaylistSummary.id, activePlaylistSummary.name, t) : playlist.detail?.name ?? ""}
            playingItemId={activePlaylistInPlayer ? playingItemId : null}
            playbackActive={activePlaylistPlaying}
            initialScrollTop={library.currentState.scrollTop}
            onScrollTop={(scrollTop) => library.setScrollTop(scrollTop)}
            onTogglePlayback={(item) => { void togglePlaylistItem(item); }}
            onShowLocation={showItemLocation}
            showLocationAction={supportsLocalFileReveal}
            onSnooze={snoozePlaylistItem}
            onWeight={setPlaylistItemWeight}
            onRemove={removePlaylistItem}
            hasMore={library.currentWindow.items.length < library.currentWindow.totalCount}
            loadingMore={library.loadingMore}
            onLoadMore={() => { void library.loadMore(); }}
          />
        {/if}
      {:else if destination.kind === "sources"}
        <MusicSourcesDashboard
          controller={sources}
          summaries={library.sourceSummaries}
          selectedCollectionId={contextViewState.selectedSourceId}
          compact
          onAdd={() => sourceSurface = "add"}
          onRefreshAll={() => requestSourceRefresh()}
          onRefreshSource={(collectionId) => requestSourceRefresh([collectionId])}
          onRelink={(collectionId) => { void openRelink(collectionId); }}
          onRemove={(collectionId) => { void openRemoval(collectionId); }}
          onDetectedFolderAdded={detectedFolderAdded}
        />
      {:else if destination.kind === "soundscapes"}
        <MusicSoundscapeBuilder filter={contextViewState.soundscapeFilter} compact addRequest={soundscapeAddRequest} onPlaybackStart={takePlaybackOwnership} />
      {:else}
        <MusicBuilderOverview {destination} search={library.currentState.search} playlists={library.playlistSummaries} sources={library.sourceSummaries} onNavigate={(next) => { void navigate(next); }} onPrimary={primaryAction} onImport={() => interchange.show("import")} onExport={() => interchange.show("export", destination.kind === "playlist" ? destination.playlistId : null)} compact />
      {/if}
    </main>

    {#if layout.dockPresentation === "bottom" && !builderPreparation && !firstUseNeedsFolder}
      <div class="builder-mobile-dock"><MusicBuilderDock {destination} {reviewCount} compact showAllLabels={mobilePresentation} includeSoundscapes={supportsSoundscapes} onNavigate={navigate} /></div>
    {/if}

    {#if sourceSurface === "add"}
      <MusicAddSourceDialog controller={sources} onClose={closeSourceSurface} onSaved={() => { closeSourceSurface(); void library.refreshAfterMutation(); }} />
    {:else if sourceSurface === "relink" && sourceSurfaceCollection}
      <MusicRelinkWizard controller={sources} collection={sourceSurfaceCollection} onClose={closeSourceSurface} onApplied={() => { sourceSurface = null; sourceSurfaceCollection = null; void library.refreshAfterMutation(); }} />
    {:else if sourceSurface === "remove" && sourceSurfaceCollection}
      <MusicSourceRemovalDialog controller={sources} collection={sourceSurfaceCollection} onClose={closeSourceSurface} onRemoved={() => { sourceSurface = null; sourceSurfaceCollection = null; void library.refreshAfterMutation(); }} />
    {:else if sourceSurface === "item-repair" && repairItemId}
      <MusicItemRepairDialog controller={sources} itemId={repairItemId} onClose={closeSourceSurface} onRepaired={() => { void library.refreshAfterMutation(); void inspector.select(repairItemId); void playlist.refreshActivePlayback(sources.bindings); }} />
    {/if}
    {#if pendingRefreshPlan}
      <MusicNetworkRefreshDialog onlineCount={pendingRefreshPlan.onlineCount} onClose={() => pendingRefreshPlan = null} onLocalOnly={() => { void runSourceRefresh(pendingRefreshPlan!, false); }} onContinue={() => { void runSourceRefresh(pendingRefreshPlan!, true); }} />
    {/if}
    {#if playlistSurface}
      <MusicPlaylistDialog
        controller={playlist}
        mode={playlistSurface}
        playlists={library.playlistSummaries}
        activeInPlayer={Boolean(playlist.detail && audition.musicPlayer.activePlaylistId === playlist.detail.id)}
        onClose={() => { playlistSurface = null; playlistSurfaceReturnsToCurrentView = false; playlistSurfaceTargetId = null; }}
        onSaved={(playlistId) => {
          const returnToCurrentView = playlistSurfaceReturnsToCurrentView;
          playlistSurface = null;
          playlistSurfaceReturnsToCurrentView = false;
          playlistSurfaceTargetId = null;
          if (!returnToCurrentView) void navigateNow({ kind: "playlist", playlistId });
        }}
        onDeleted={(replacementPlaylistId) => {
          const returnToCurrentView = playlistSurfaceReturnsToCurrentView;
          const deletedPlaylistId = playlistSurfaceTargetId ?? (destination.kind === "playlist" ? destination.playlistId : null);
          playlistSurface = null;
          playlistSurfaceReturnsToCurrentView = false;
          playlistSurfaceTargetId = null;
          if (deletedPlaylistId && audition.musicPlayer.activePlaylistId === deletedPlaylistId) {
            audition.musicPlayer.detachDeletedPlaylist(deletedPlaylistId);
            if (replacementPlaylistId) {
              void playReplacementPlaylist(replacementPlaylistId, !returnToCurrentView);
              return;
            }
          }
          if (returnToCurrentView) return;
          const neighboringPlaylistId = replacementPlaylistId ?? library.playlistSummaries[0]?.id ?? null;
          if (neighboringPlaylistId) void navigateNow({ kind: "playlist", playlistId: neighboringPlaylistId });
          else void navigateNow({ kind: "playlists" });
        }}
      />
    {/if}
    {#if interchange.open}<MusicInterchangeDialog controller={interchange} playlists={library.playlistSummaries} onClose={() => interchange.close()} onImported={() => { void library.refreshAfterMutation(); void sources.load(); }} />{/if}
  </div>
</section>

<style>
  .builder-root { container-type: size; }
  .builder-root :global(input),
  .builder-root :global(textarea),
  .builder-root :global([contenteditable="true"]) { user-select: text; }
  .builder-context-panel { grid-column: 1; border-right: 1px solid color-mix(in srgb, var(--border) 46%, transparent); }
  .builder-shell > main { grid-column: 2; }
  .builder-wide, .builder-medium { grid-template-columns: minmax(14rem, 0.72fr) minmax(22rem, 2fr); }
  .builder-contextless { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .builder-contextless > main { grid-column: 1; grid-row: 1; }
  .builder-narrow { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .builder-narrow > main { grid-column: 1; grid-row: 1; }
  .builder-narrow .builder-context-panel { position: absolute; inset: 0 0 2.75rem; grid-column: 1; border-right: 0; background: var(--background); transform: translateX(-102%); transition: transform 150ms ease; }
  .builder-narrow .builder-context-panel.context-open { transform: translateX(0); }
  .builder-mobile-dock { z-index: 25; grid-column: 1; grid-row: 2; background: color-mix(in srgb, var(--background) 94%, transparent); }
  :global(.toolbar-primary), :global(.toolbar-secondary) { display: inline-flex; height: 2rem; flex: none; align-items: center; justify-content: center; gap: 0.35rem; border-radius: 999px; padding-inline: 0.75rem; font-size: calc(0.65rem * var(--type-scale)); font-weight: 600; white-space: nowrap; }
  :global(.toolbar-primary) { background: var(--primary); color: var(--primary-foreground); }
  :global(.toolbar-secondary) { background: var(--secondary); color: var(--secondary-foreground); }
  :global(.toolbar-primary:disabled), :global(.toolbar-secondary:disabled) { opacity: 0.4; }
  :global(.toolbar-icon) { display: grid; height: 2rem; width: 2rem; flex: none; place-items: center; border-radius: 999px; color: var(--foreground); }
  :global(.toolbar-icon:hover) { background: var(--secondary); }
  :global(.toolbar-menu) { position: absolute; right: 0; top: calc(100% + 0.3rem); z-index: 55; min-width: 10rem; border: 1px solid color-mix(in srgb, var(--border) 80%, transparent); border-radius: 0.7rem; background: var(--popover); padding: 0.3rem; }
  :global(.toolbar-menu button) { display: flex; min-height: 1.9rem; width: 100%; align-items: center; border-radius: 0.45rem; padding-inline: 0.6rem; font-size: calc(0.68rem * var(--type-scale)); text-align: left; }
  :global(.toolbar-menu button:hover) { background: var(--accent); }
  :global(.toolbar-menu button:disabled) { opacity: 0.4; }
  @container (width < 520px) { :global(.toolbar-primary), :global(.toolbar-secondary) { width: 2rem; gap: 0; padding-inline: 0; font-size: 0; } }
  @media (prefers-reduced-motion: reduce) { :global(.builder-root *) { scroll-behavior: auto; } }
  @media (prefers-reduced-motion: reduce) { .builder-narrow .builder-context-panel { transition: none; } }
</style>

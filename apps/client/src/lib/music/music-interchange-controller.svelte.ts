import { pickAndReadMusicInterchangeFile, pickAndWriteMusicInterchangeFile, pickMusicRootBindingFolder } from "$lib/api/music";
import {
  getMusicContextAssignmentsForPlaylists,
  getMusicInspectorDetail,
  getMusicItemWindow,
  getMusicLocalRoots,
  getMusicPlaylist,
  importMusicInterchange,
  setLocalRootBinding,
} from "$lib/api/music-library";
import type { LocalRootBinding, MusicItemListEntry, MusicItemWindowRequest, MusicPlaylistSummary } from "./library-contracts";
import { mapMusicWithConcurrency } from "./music-bounded-work";
import {
  MUSIC_INTERCHANGE_FORMAT,
  MUSIC_INTERCHANGE_VERSION,
  inspectorToInterchangeMembership,
  musicImportedLocalIdentitySeed,
  parseMusicM3u8,
  playlistToInterchange,
  previewMusicInterchange,
  rootsToInterchange,
  serializeMusicInterchange,
  serializeMusicM3u8,
  type M3u8Entry,
  type MusicImportPreview,
  type MusicInterchangeDocument,
  type MusicInterchangeMembership,
} from "./music-interchange";

export type MusicInterchangeFormat = "json" | "m3u8";
export type MusicInterchangeMode = "import" | "export";
const MUSIC_EXPORT_DETAIL_CONCURRENCY = 8;

export interface MusicM3u8Preview {
  entries: M3u8Entry[];
  localCount: number;
  youtubeCount: number;
  unsupportedCount: number;
  unresolvedLocalCount: number;
}

function windowRequest(destination: "library" | "playlist", playlistId: string | null, offset: number): MusicItemWindowRequest {
  return {
    destination, playlistId, search: "", sourceKind: null, availability: null, reviewState: null,
    sourceCollectionId: null, membershipPlaylistId: null, snoozed: null, sort: destination === "playlist" ? "manual-position" : "title",
    direction: "ascending", groupBy: "none", nowMs: Date.now(), offset, limit: 200,
  };
}

async function loadAllItems(destination: "library" | "playlist", playlistId: string | null): Promise<MusicItemListEntry[]> {
  const items: MusicItemListEntry[] = [];
  for (let offset = 0; ; offset += 200) {
    const window = await getMusicItemWindow(windowRequest(destination, playlistId, offset));
    items.push(...window.items);
    if (items.length >= window.totalCount || window.items.length === 0) return items;
  }
}

async function importedLocalIdentity(rootId: string, relativePath: string): Promise<string> {
  const bytes = new TextEncoder().encode(musicImportedLocalIdentitySeed(rootId, relativePath));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `local-import:${[...digest].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export class MusicInterchangeController {
  open = $state(false);
  mode = $state<MusicInterchangeMode>("export");
  format = $state<MusicInterchangeFormat>("json");
  selectedPlaylistIds = $state<Set<string>>(new Set());
  busy = $state(false);
  error = $state<string | null>(null);
  jsonPreview = $state<MusicImportPreview | null>(null);
  m3u8Preview = $state<MusicM3u8Preview | null>(null);
  importedContents = $state<string | null>(null);
  playlistConflict = $state<"keep-existing" | "import-copy" | "replace-existing">("import-copy");
  replaceItemDescriptions = $state(false);
  importContextAssignments = $state(false);
  importPlaylistName = $state("Imported playlist");
  m3u8RootId = $state<string>("");
  mappedRootIds = $state<Set<string>>(new Set());
  importResult = $state<import("./library-contracts").MusicInterchangeImportResult | null>(null);
  availableRoots = $state<Array<{ id: string; name: string }>>([]);

  constructor(
    private readonly playlists: () => readonly MusicPlaylistSummary[],
    private readonly bindings: () => readonly LocalRootBinding[],
    private readonly vaultId: () => string | null,
    private readonly now: () => number = Date.now,
  ) {}

  show(mode: MusicInterchangeMode, preferredPlaylistId: string | null = null): void {
    this.mode = mode;
    this.format = "json";
    this.error = null;
    this.jsonPreview = null;
    this.m3u8Preview = null;
    this.importedContents = null;
    this.importResult = null;
    this.mappedRootIds = new Set();
    this.selectedPlaylistIds = new Set(preferredPlaylistId ? [preferredPlaylistId] : this.playlists().map((playlist) => playlist.id));
    this.open = true;
  }

  close(): void {
    if (this.busy) return;
    this.open = false;
  }

  togglePlaylist(playlistId: string): void {
    const next = new Set(this.selectedPlaylistIds);
    if (next.has(playlistId)) next.delete(playlistId); else next.add(playlistId);
    this.selectedPlaylistIds = next;
  }

  isRootMapped(rootId: string): boolean {
    return this.mappedRootIds.has(rootId) || this.bindings().some((binding) => binding.rootId === rootId && binding.status === "available");
  }

  unresolvedM3uCount(): number {
    return this.m3u8Preview?.entries.filter((entry) => entry.kind === "local" && !this.resolveM3uLocalEntry(entry.value, this.bindings())).length ?? 0;
  }

  async readImport(): Promise<boolean> {
    this.busy = true;
    this.error = null;
    try {
      const contents = await pickAndReadMusicInterchangeFile();
      if (contents === null) return false;
      this.importedContents = contents;
      const trimmed = contents.trimStart();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        this.format = "json";
        const allItems = await loadAllItems("library", null);
        this.jsonPreview = previewMusicInterchange(
          contents,
          new Set(this.playlists().map((playlist) => playlist.id)),
          new Set(allItems.map((item) => item.identityKey)),
          new Set(this.bindings().filter((binding) => binding.status === "available").map((binding) => binding.rootId)),
        );
        this.m3u8Preview = null;
      } else {
        this.format = "m3u8";
        this.availableRoots = rootsToInterchange(await getMusicLocalRoots(0, 500));
        const entries = parseMusicM3u8(contents);
        this.m3u8Preview = {
          entries,
          localCount: entries.filter((entry) => entry.kind === "local").length,
          youtubeCount: entries.filter((entry) => entry.kind === "youtube").length,
          unsupportedCount: entries.filter((entry) => entry.kind === "unsupported").length,
          unresolvedLocalCount: entries.filter((entry) => entry.kind === "local" && !this.resolveM3uLocalEntry(entry.value, this.bindings())).length,
        };
        this.jsonPreview = null;
      }
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  async exportSelected(): Promise<boolean> {
    const playlistIds = [...this.selectedPlaylistIds];
    if (playlistIds.length === 0) return false;
    this.busy = true;
    this.error = null;
    try {
      if (this.format === "m3u8") return await this.exportM3u8(playlistIds);
      const roots = await getMusicLocalRoots(0, 500);
      const assignments = await getMusicContextAssignmentsForPlaylists(playlistIds);
      const playlists = [];
      const warnings = new Set<string>();
      const unavailableRootIds = new Set(this.bindings().filter((binding) => binding.status !== "available").map((binding) => binding.rootId));
      for (const playlistId of playlistIds) {
        const [playlist, items] = await Promise.all([getMusicPlaylist(playlistId), loadAllItems("playlist", playlistId)]);
        const memberships = [];
        const details = await mapMusicWithConcurrency(items, MUSIC_EXPORT_DETAIL_CONCURRENCY, (item) => getMusicInspectorDetail(item.id));
        for (const detail of details) {
          const membership = inspectorToInterchangeMembership(detail, playlistId);
          if (membership) memberships.push(membership);
          if (detail.locations.some((location) => unavailableRootIds.has(location.rootId))) warnings.add(`Playlist "${playlist.name}" contains local media whose root is unavailable on this device.`);
        }
        playlists.push(playlistToInterchange(playlist, memberships));
      }
      const document: MusicInterchangeDocument = {
        format: MUSIC_INTERCHANGE_FORMAT, version: MUSIC_INTERCHANGE_VERSION, exportedAt: this.now(),
        roots: rootsToInterchange(roots), playlists, contextAssignments: assignments, warnings: [...warnings],
      };
      return await pickAndWriteMusicInterchangeFile("ganbaru-music-playlists", serializeMusicInterchange(document), "json");
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  async mapImportedRoot(rootId: string): Promise<boolean> {
    const vaultId = this.vaultId();
    if (!vaultId) return false;
    this.error = null;
    try {
      const folderPath = await pickMusicRootBindingFolder();
      if (!folderPath) return false;
      await setLocalRootBinding(vaultId, rootId, folderPath);
      this.mappedRootIds = new Set([...this.mappedRootIds, rootId]);
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async commitImport(): Promise<boolean> {
    if (!this.importedContents) return false;
    this.busy = true;
    this.error = null;
    try {
      const document = this.jsonPreview?.document ?? await this.m3u8Document();
      const result = await importMusicInterchange({
        document,
        playlistConflict: this.playlistConflict,
        replaceItemDescriptions: this.replaceItemDescriptions,
        importContextAssignments: this.importContextAssignments,
        importedAt: this.now(),
      });
      this.importResult = result;
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private async m3u8Document(): Promise<MusicInterchangeDocument> {
    const preview = this.m3u8Preview;
    if (!preview || !this.importPlaylistName.trim()) throw new Error("Choose a name for the imported playlist.");
    const roots = await getMusicLocalRoots(0, 500);
    const rootNames = new Map(roots.map((root) => [root.id, root.name]));
    const bindings = this.bindings().filter((binding) => binding.folderPath);
    const allItems = await loadAllItems("library", null);
    const hydratedDetails = await mapMusicWithConcurrency(allItems, MUSIC_EXPORT_DETAIL_CONCURRENCY, (item) => getMusicInspectorDetail(item.id));
    const youtubeItems = new Map(hydratedDetails.flatMap((detail) => detail.item.youtubeVideoId ? [[detail.item.youtubeVideoId, detail.item] as const] : []));
    const windowsRoots = new Set(bindings.filter((binding) => this.isWindowsBinding(binding)).map((binding) => binding.rootId));
    const localItems = new Map(hydratedDetails.flatMap((detail) => detail.locations.map((location) => [
      this.localLookupKey(location.rootId, location.relativePath, windowsRoots.has(location.rootId)),
      detail,
    ] as const)));
    const memberships: MusicInterchangeMembership[] = [];
    const usedRootIds = new Set<string>();
    for (const [position, entry] of preview.entries.entries()) {
      if (entry.kind === "unsupported") continue;
      if (entry.kind === "youtube") {
        const videoId = entry.value.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/)?.[1];
        if (!videoId) continue;
        const existing = youtubeItems.get(videoId);
        memberships.push(this.basicMembership(position, {
          identityKey: existing?.identityKey ?? `youtube:${videoId}`, sourceKind: "youtube-video", youtubeVideoId: videoId,
          title: entry.title ?? existing?.originalTitle ?? videoId, artist: existing?.originalArtist ?? "", album: existing?.originalAlbum ?? "",
          durationMs: existing?.durationMs ?? null, signals: [], locations: [],
        }));
        continue;
      }
      const resolved = this.resolveM3uLocalEntry(entry.value, bindings);
      if (!resolved) continue;
      usedRootIds.add(resolved.rootId);
      const existingDetail = localItems.get(this.localLookupKey(resolved.rootId, resolved.relativePath, windowsRoots.has(resolved.rootId)));
      memberships.push(this.basicMembership(position, {
        identityKey: existingDetail?.item.identityKey ?? await importedLocalIdentity(resolved.rootId, resolved.relativePath),
        sourceKind: "local-file", youtubeVideoId: null, title: entry.title ?? existingDetail?.item.originalTitle ?? resolved.relativePath.split("/").pop() ?? resolved.relativePath,
        artist: existingDetail?.item.originalArtist ?? "", album: existingDetail?.item.originalAlbum ?? "", durationMs: existingDetail?.item.durationMs ?? null,
        signals: existingDetail?.signals ?? [], locations: [{ rootId: resolved.rootId, relativePath: resolved.relativePath, availability: "missing" }],
      }));
    }
    return {
      format: MUSIC_INTERCHANGE_FORMAT, version: MUSIC_INTERCHANGE_VERSION, exportedAt: this.now(),
      roots: [...usedRootIds].map((id) => ({ id, name: rootNames.get(id) ?? id })),
      playlists: [{ id: crypto.randomUUID(), name: this.importPlaylistName.trim(), icon: "lucide:list-music", shuffleEnabled: false, mixEnabled: false, repeatMode: "all", intendedUses: [], memberships }],
      contextAssignments: [], warnings: ["M3U8 does not preserve weights, snoozes, assignments, logical-root identity, signals, or focus guidance."],
    };
  }

  private resolveM3uLocalEntry(value: string, bindings: readonly LocalRootBinding[]): { rootId: string; relativePath: string } | null {
    const normalized = value.replaceAll("\\", "/");
    for (const binding of bindings) {
      const root = binding.folderPath?.replaceAll("\\", "/").replace(/\/+$/, "");
      if (!root) continue;
      const comparableValue = this.isWindowsBinding(binding) ? normalized.toLocaleLowerCase() : normalized;
      const comparableRoot = this.isWindowsBinding(binding) ? root.toLocaleLowerCase() : root;
      if (comparableValue.startsWith(`${comparableRoot}/`)) return { rootId: binding.rootId, relativePath: normalized.slice(root.length + 1) };
    }
    if (!/^(?:\/|[A-Za-z]:\/)/.test(normalized) && this.m3u8RootId) return { rootId: this.m3u8RootId, relativePath: normalized.replace(/^\.\//, "") };
    return null;
  }

  private isWindowsBinding(binding: LocalRootBinding): boolean {
    return /^[A-Za-z]:[\\/]/.test(binding.folderPath ?? "") || Boolean(binding.folderPath?.includes("\\"));
  }

  private localLookupKey(rootId: string, relativePath: string, caseInsensitive: boolean): string {
    const normalized = relativePath.replaceAll("\\", "/");
    return `${rootId}\0${caseInsensitive ? normalized.toLocaleLowerCase() : normalized}`;
  }

  private basicMembership(position: number, item: MusicInterchangeMembership["item"]): MusicInterchangeMembership {
    return { item, position, weight: "normal", enabled: true, startMs: null, endMs: null, volume: null, rate: null, skipRanges: [], snoozes: [] };
  }

  private async exportM3u8(playlistIds: string[]): Promise<boolean> {
    const entries: M3u8Entry[] = [];
    const bindingPaths = new Map(this.bindings().filter((binding) => binding.folderPath).map((binding) => [binding.rootId, binding.folderPath as string]));
    for (const playlistId of playlistIds) {
      const items = await loadAllItems("playlist", playlistId);
      const details = await mapMusicWithConcurrency(items, MUSIC_EXPORT_DETAIL_CONCURRENCY, (item) => getMusicInspectorDetail(item.id));
      for (const [index, detail] of details.entries()) {
        const item = items[index];
        if (!item) continue;
        if (detail.item.sourceKind === "youtube-video" && detail.item.youtubeVideoId) {
          entries.push({ value: `https://www.youtube.com/watch?v=${detail.item.youtubeVideoId}`, title: item.title, kind: "youtube" });
          continue;
        }
        const location = detail.locations.find((entry) => entry.availability === "available" && bindingPaths.has(entry.rootId));
        if (!location) continue;
        const root = bindingPaths.get(location.rootId) as string;
        const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
        entries.push({ value: `${root.replace(/[\\/]+$/, "")}${separator}${location.relativePath.replace(/[\\/]+/g, separator)}`, title: item.title, kind: "local" });
      }
    }
    return pickAndWriteMusicInterchangeFile("ganbaru-music-playlist", serializeMusicM3u8(entries), "m3u8");
  }
}

export function createMusicInterchangeController(
  playlists: () => readonly MusicPlaylistSummary[],
  bindings: () => readonly LocalRootBinding[],
  vaultId: () => string | null,
): MusicInterchangeController {
  return new MusicInterchangeController(playlists, bindings, vaultId);
}

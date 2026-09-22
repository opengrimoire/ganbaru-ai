import type {
  MusicInspectorDetail,
  MusicItemSignal,
  MusicLocalRoot,
  MusicPlaylist,
} from "./library-contracts";
import { parseMusicContextAssignments, type MusicContextAssignment } from "./music-context-assignment";

export const MUSIC_INTERCHANGE_FORMAT = "ganbaru-ai/music-playlists";
export const MUSIC_INTERCHANGE_VERSION = 1;
export const MUSIC_INTERCHANGE_MAX_BYTES = 8 * 1024 * 1024;

export function musicImportedLocalIdentitySeed(rootId: string, relativePath: string): string {
  return `${rootId}\0${relativePath.replaceAll("\\", "/")}`;
}

export interface MusicInterchangeLocation {
  rootId: string;
  relativePath: string;
  availability: string;
}

export interface MusicInterchangeItem {
  identityKey: string;
  sourceKind: "local-file" | "youtube-video";
  youtubeVideoId: string | null;
  title: string;
  artist: string;
  album: string;
  durationMs: number | null;
  signals: MusicItemSignal[];
  locations: MusicInterchangeLocation[];
}

export interface MusicInterchangeMembership {
  item: MusicInterchangeItem;
  position: number;
  weight: string;
  enabled: boolean;
  startMs: number | null;
  endMs: number | null;
  volume: number | null;
  rate: number | null;
  skipRanges: Array<{ startMs: number; endMs: number }>;
  snoozes: Array<{ scope: string; startsAt: number; endsAt: number | null; reason: string }>;
}

export interface MusicInterchangePlaylist {
  id: string;
  name: string;
  icon: string;
  shuffleEnabled: boolean;
  mixEnabled: boolean;
  repeatMode: string;
  intendedUses: string[];
  memberships: MusicInterchangeMembership[];
}

export interface MusicInterchangeDocument {
  format: typeof MUSIC_INTERCHANGE_FORMAT;
  version: typeof MUSIC_INTERCHANGE_VERSION;
  exportedAt: number;
  roots: Array<{ id: string; name: string }>;
  playlists: MusicInterchangePlaylist[];
  contextAssignments: MusicContextAssignment[];
  warnings: string[];
}

export interface MusicImportPreview {
  document: MusicInterchangeDocument;
  newPlaylists: number;
  matchedPlaylists: number;
  newItems: number;
  matchedItems: number;
  duplicateItems: number;
  missingLocalBindings: number;
  conflicts: string[];
  unsupported: string[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 4_096): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${label} must be a string no longer than ${maximum} characters.`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  const result = text(value, label) as T;
  if (!values.includes(result)) throw new Error(`${label} is unsupported.`);
  return result;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number or null.`);
  return value;
}

function list<T>(value: unknown, label: string, parse: (entry: unknown, label: string) => T, maximum = 10_000): T[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be an array with at most ${maximum} entries.`);
  return value.map((entry, index) => parse(entry, `${label}[${index}]`));
}

function safeRelativePath(value: unknown, label: string): string {
  const path = text(value, label);
  const segments = path.split(/[\\/]/);
  if (!path.trim() || path.startsWith("/") || path.startsWith("\\") || path.includes(":") || /[\u0000-\u001F\u007F]/.test(path) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return path.replaceAll("\\", "/");
}

function parseItem(value: unknown, label: string): MusicInterchangeItem {
  const row = record(value, label);
  const sourceKind = text(row.sourceKind, `${label}.sourceKind`);
  if (sourceKind !== "local-file" && sourceKind !== "youtube-video") throw new Error(`${label}.sourceKind is unsupported.`);
  const youtubeVideoId = row.youtubeVideoId === null ? null : text(row.youtubeVideoId, `${label}.youtubeVideoId`, 64);
  if ((sourceKind === "youtube-video") !== Boolean(youtubeVideoId)) throw new Error(`${label}.youtubeVideoId does not match its source kind.`);
  const allowedSignals = new Set<MusicItemSignal>(["lyrics", "sudden-changes", "high-intensity", "calm", "repetitive", "energizing"]);
  const signals = list(row.signals, `${label}.signals`, (entry, entryLabel) => {
    const signal = text(entry, entryLabel) as MusicItemSignal;
    if (!allowedSignals.has(signal)) throw new Error(`${entryLabel} is unsupported.`);
    return signal;
  }, 6);
  return {
    identityKey: text(row.identityKey, `${label}.identityKey`, 500), sourceKind, youtubeVideoId,
    title: text(row.title, `${label}.title`, 500), artist: text(row.artist, `${label}.artist`, 500), album: text(row.album, `${label}.album`, 500),
    durationMs: nullableNumber(row.durationMs, `${label}.durationMs`), signals,
    locations: list(row.locations, `${label}.locations`, (entry, entryLabel) => {
      const location = record(entry, entryLabel);
      return { rootId: text(location.rootId, `${entryLabel}.rootId`, 200), relativePath: safeRelativePath(location.relativePath, `${entryLabel}.relativePath`), availability: choice(location.availability, ["available", "missing", "ambiguous", "unsupported", "unknown"] as const, `${entryLabel}.availability`) };
    }, 32),
  };
}

function parseMembership(value: unknown, label: string): MusicInterchangeMembership {
  const row = record(value, label);
  return {
    item: parseItem(row.item, `${label}.item`), position: integer(row.position, `${label}.position`),
    weight: choice(row.weight, ["rarely", "less-often", "normal", "more-often", "much-more-often"] as const, `${label}.weight`), enabled: flag(row.enabled, `${label}.enabled`),
    startMs: nullableNumber(row.startMs, `${label}.startMs`), endMs: nullableNumber(row.endMs, `${label}.endMs`),
    volume: nullableNumber(row.volume, `${label}.volume`), rate: nullableNumber(row.rate, `${label}.rate`),
    skipRanges: list(row.skipRanges, `${label}.skipRanges`, (entry, entryLabel) => { const range = record(entry, entryLabel); return { startMs: integer(range.startMs, `${entryLabel}.startMs`), endMs: integer(range.endMs, `${entryLabel}.endMs`) }; }, 100),
    snoozes: list(row.snoozes, `${label}.snoozes`, (entry, entryLabel) => { const snooze = record(entry, entryLabel); return { scope: choice(snooze.scope, ["playlist", "all-playlists"] as const, `${entryLabel}.scope`), startsAt: integer(snooze.startsAt, `${entryLabel}.startsAt`), endsAt: nullableNumber(snooze.endsAt, `${entryLabel}.endsAt`), reason: text(snooze.reason, `${entryLabel}.reason`, 500) }; }, 100),
  };
}

export function parseMusicInterchangeJson(json: string): MusicInterchangeDocument {
  if (new TextEncoder().encode(json).byteLength > MUSIC_INTERCHANGE_MAX_BYTES) throw new Error("The music import exceeds the 8 MB safety limit.");
  let value: unknown;
  try { value = JSON.parse(json) as unknown; } catch { throw new Error("The selected file is not valid JSON."); }
  const row = record(value, "music import");
  if (row.format !== MUSIC_INTERCHANGE_FORMAT) throw new Error("The selected JSON file is not a Ganbaru AI music export.");
  if (row.version !== MUSIC_INTERCHANGE_VERSION) throw new Error(`Music export version ${String(row.version)} is not supported.`);
  const roots = list(row.roots, "music import.roots", (entry, label) => { const root = record(entry, label); return { id: text(root.id, `${label}.id`, 200), name: text(root.name, `${label}.name`, 200) }; }, 500);
  const unsupportedRecords: string[] = [];
  const playlists = list(row.playlists, "music import.playlists", (entry, label) => {
    const playlist = record(entry, label);
    if (!Array.isArray(playlist.memberships) || playlist.memberships.length > 10_000) throw new Error(`${label}.memberships must contain at most 10000 entries.`);
    const memberships = playlist.memberships.flatMap((membership, index) => {
      try { return [parseMembership(membership, `${label}.memberships[${index}]`)]; }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("is unsupported")) throw error;
        unsupportedRecords.push(`${label}.memberships[${index}]: ${message}`);
        return [];
      }
    });
    return {
      id: text(playlist.id, `${label}.id`, 200), name: text(playlist.name, `${label}.name`, 200), icon: text(playlist.icon, `${label}.icon`, 500),
      shuffleEnabled: flag(playlist.shuffleEnabled, `${label}.shuffleEnabled`), mixEnabled: playlist.mixEnabled === undefined ? false : flag(playlist.mixEnabled, `${label}.mixEnabled`), repeatMode: choice(playlist.repeatMode, ["off", "all", "one"] as const, `${label}.repeatMode`),
      intendedUses: list(playlist.intendedUses, `${label}.intendedUses`, (use, useLabel) => choice(use, ["general", "focus", "reading", "relaxation", "energizing"] as const, useLabel), 5),
      memberships,
    };
  }, 500);
  if (!Array.isArray(row.contextAssignments) || row.contextAssignments.length > 10_000) throw new Error("music import.contextAssignments must contain at most 10000 entries.");
  const contextAssignments = parseMusicContextAssignments(row.contextAssignments);
  const warnings = [...list(row.warnings, "music import.warnings", (entry, label) => text(entry, label, 1_000), 1_000), ...unsupportedRecords.map((entry) => `Unsupported record skipped: ${entry}`)];
  return { format: MUSIC_INTERCHANGE_FORMAT, version: MUSIC_INTERCHANGE_VERSION, exportedAt: integer(row.exportedAt, "music import.exportedAt"), roots, playlists, contextAssignments, warnings };
}

export function previewMusicInterchange(
  json: string,
  existingPlaylistIds: ReadonlySet<string>,
  existingIdentityKeys: ReadonlySet<string>,
  boundRootIds: ReadonlySet<string>,
): MusicImportPreview {
  const document = parseMusicInterchangeJson(json);
  const seenIdentities = new Set<string>();
  let duplicateItems = 0;
  let newItems = 0;
  let matchedItems = 0;
  for (const membership of document.playlists.flatMap((playlist) => playlist.memberships)) {
    if (seenIdentities.has(membership.item.identityKey)) duplicateItems += 1;
    else if (existingIdentityKeys.has(membership.item.identityKey)) matchedItems += 1;
    else newItems += 1;
    seenIdentities.add(membership.item.identityKey);
  }
  const missingLocalBindings = document.roots.filter((root) => !boundRootIds.has(root.id)).length;
  const conflicts = document.playlists.filter((playlist) => existingPlaylistIds.has(playlist.id)).map((playlist) => playlist.name);
  return {
    document,
    newPlaylists: document.playlists.length - conflicts.length,
    matchedPlaylists: conflicts.length,
    newItems, matchedItems, duplicateItems, missingLocalBindings, conflicts, unsupported: document.warnings.filter((warning) => warning.startsWith("Unsupported record skipped:")),
  };
}

export function serializeMusicInterchange(document: MusicInterchangeDocument): string {
  const normalized: MusicInterchangeDocument = {
    ...document,
    roots: [...document.roots].sort((a, b) => a.id.localeCompare(b.id)),
    playlists: [...document.playlists].sort((a, b) => a.id.localeCompare(b.id)).map((playlist) => ({
      ...playlist,
      intendedUses: [...playlist.intendedUses].sort(),
      memberships: [...playlist.memberships].sort((a, b) => a.position - b.position || a.item.identityKey.localeCompare(b.item.identityKey)),
    })),
    contextAssignments: [...document.contextAssignments].sort((a, b) => `${a.ownerKind}:${a.ownerId}:${a.phase}`.localeCompare(`${b.ownerKind}:${b.ownerId}:${b.phase}`)),
    warnings: [...document.warnings].sort(),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export interface M3u8Entry { value: string; title: string | null; kind: "local" | "youtube" | "unsupported" }

export function parseMusicM3u8(content: string): M3u8Entry[] {
  if (new TextEncoder().encode(content).byteLength > MUSIC_INTERCHANGE_MAX_BYTES) throw new Error("The M3U8 file exceeds the 8 MB safety limit.");
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: M3u8Entry[] = [];
  let title: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) { title = line.includes(",") ? line.slice(line.indexOf(",") + 1).trim() || null : null; continue; }
    if (line.startsWith("#")) continue;
    const youtube = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/.test(line);
    const otherUrl = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(line);
    entries.push({ value: line, title, kind: youtube ? "youtube" : otherUrl ? "unsupported" : "local" });
    title = null;
  }
  return entries;
}

export function serializeMusicM3u8(entries: readonly M3u8Entry[]): string {
  const lines = ["#EXTM3U"];
  for (const entry of entries) {
    if (entry.kind === "unsupported") continue;
    if (entry.title) lines.push(`#EXTINF:-1,${entry.title.replace(/[\r\n]/g, " ")}`);
    lines.push(entry.value);
  }
  return `${lines.join("\n")}\n`;
}

export function inspectorToInterchangeMembership(detail: MusicInspectorDetail, playlistId: string): MusicInterchangeMembership | null {
  const membership = detail.memberships.find((entry) => entry.playlistId === playlistId);
  if (!membership) return null;
  return {
    item: {
      identityKey: detail.item.identityKey, sourceKind: detail.item.sourceKind, youtubeVideoId: detail.item.youtubeVideoId,
      title: detail.item.titleOverride ?? detail.item.originalTitle, artist: detail.item.artistOverride ?? detail.item.originalArtist,
      album: detail.item.albumOverride ?? detail.item.originalAlbum, durationMs: detail.item.durationMs, signals: [...detail.signals],
      locations: detail.locations.map((location) => ({ rootId: location.rootId, relativePath: location.relativePath, availability: location.availability })),
    },
    position: membership.position, weight: membership.weight, enabled: membership.enabled,
    startMs: membership.startMs, endMs: membership.endMs, volume: membership.volume, rate: membership.rate,
    skipRanges: detail.membershipSkipRanges.filter((range) => range.membershipId === membership.id).map(({ startMs, endMs }) => ({ startMs, endMs })),
    snoozes: detail.snoozes.filter((snooze) => snooze.scope === "all-playlists" || snooze.playlistId === playlistId).map(({ scope, startsAt, endsAt, reason }) => ({ scope, startsAt, endsAt, reason })),
  };
}

export function playlistToInterchange(playlist: MusicPlaylist, memberships: MusicInterchangeMembership[]): MusicInterchangePlaylist {
  return { id: playlist.id, name: playlist.name, icon: playlist.icon, shuffleEnabled: playlist.shuffleEnabled, mixEnabled: playlist.mixEnabled, repeatMode: playlist.repeatMode, intendedUses: [...playlist.intendedUses], memberships };
}

export function rootsToInterchange(roots: readonly MusicLocalRoot[]): Array<{ id: string; name: string }> {
  return roots.map(({ id, name }) => ({ id, name }));
}

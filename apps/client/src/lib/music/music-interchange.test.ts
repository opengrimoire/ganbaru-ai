import { describe, expect, it } from "vitest";
import { MUSIC_INTERCHANGE_FORMAT, MUSIC_INTERCHANGE_VERSION, musicImportedLocalIdentitySeed, parseMusicInterchangeJson, parseMusicM3u8, previewMusicInterchange, serializeMusicInterchange, serializeMusicM3u8, type MusicInterchangeDocument } from "./music-interchange";

const document: MusicInterchangeDocument = {
  format: MUSIC_INTERCHANGE_FORMAT, version: MUSIC_INTERCHANGE_VERSION, exportedAt: 1_700_000_000_000,
  roots: [{ id: "root-b", name: "Songs" }, { id: "root-a", name: "Soundtracks" }],
  playlists: [{ id: "playlist-1", name: "Focus", icon: "lucide:laptop", shuffleEnabled: true, mixEnabled: false, repeatMode: "all", intendedUses: ["focus"], memberships: [{ item: { identityKey: "youtube:abc123", sourceKind: "youtube-video", youtubeVideoId: "abc123", title: "Track", artist: "", album: "", durationMs: null, signals: ["lyrics"], locations: [] }, position: 0, weight: "normal", enabled: true, startMs: null, endMs: null, volume: null, rate: null, skipRanges: [], snoozes: [] }] }],
  contextAssignments: [], warnings: ["One local root is not bound on this device."],
};

describe("Ganbaru AI music interchange", () => {
  it("serializes deterministically and round trips", () => {
    const first = serializeMusicInterchange(document);
    const second = serializeMusicInterchange({ ...document, roots: [...document.roots].reverse() });
    expect(first).toBe(second);
    expect(parseMusicInterchangeJson(first)).toEqual({ ...document, roots: [...document.roots].reverse() });
  });

  it("defaults older exports without Mix to Shuffle", () => {
    const legacy = structuredClone(document) as unknown as Record<string, unknown>;
    const playlists = legacy.playlists as Array<Record<string, unknown>>;
    delete playlists[0]!.mixEnabled;
    expect(parseMusicInterchangeJson(JSON.stringify(legacy)).playlists[0]?.mixEnabled).toBe(false);
  });

  it("rejects corrupt, oversized, stale, unsafe-path, and invalid-source payloads", () => {
    expect(() => parseMusicInterchangeJson("{" )).toThrow("not valid JSON");
    expect(() => parseMusicInterchangeJson("x".repeat(8 * 1024 * 1024 + 1))).toThrow("8 MB");
    expect(() => parseMusicInterchangeJson(JSON.stringify({ ...document, version: 99 }))).toThrow("not supported");
    const unsafe = structuredClone(document); unsafe.playlists[0]!.memberships[0]!.item = { ...unsafe.playlists[0]!.memberships[0]!.item, sourceKind: "local-file", youtubeVideoId: null, locations: [{ rootId: "root-a", relativePath: "../secret.mp3", availability: "available" }] };
    expect(() => parseMusicInterchangeJson(JSON.stringify(unsafe))).toThrow("safe relative path");
    for (const path of ["folder\\..\\secret.mp3", "folder//track.mp3", "track:stream.mp3"]) {
      unsafe.playlists[0]!.memberships[0]!.item.locations[0]!.relativePath = path;
      expect(() => parseMusicInterchangeJson(JSON.stringify(unsafe))).toThrow("safe relative path");
    }
  });

  it("previews matches, duplicates, conflicts, and missing root mappings", () => {
    const duplicated = structuredClone(document); duplicated.playlists[0]!.memberships.push(structuredClone(duplicated.playlists[0]!.memberships[0]!));
    const preview = previewMusicInterchange(serializeMusicInterchange(duplicated), new Set(["playlist-1"]), new Set(["youtube:abc123"]), new Set());
    expect(preview).toMatchObject({ newPlaylists: 0, matchedPlaylists: 1, newItems: 0, matchedItems: 1, duplicateItems: 1, missingLocalBindings: 2 });
  });

  it("previews unsupported records without admitting them into the commit document", () => {
    const unsupported = structuredClone(document) as unknown as Record<string, unknown>;
    const playlists = unsupported.playlists as Array<Record<string, unknown>>;
    const memberships = playlists[0]?.memberships as Array<Record<string, unknown>>;
    memberships[0]!.item = { ...(memberships[0]!.item as Record<string, unknown>), sourceKind: "spotify-track" };
    const preview = previewMusicInterchange(JSON.stringify(unsupported), new Set(), new Set(), new Set());
    expect(preview.unsupported).toHaveLength(1);
    expect(preview.document.playlists[0]?.memberships).toEqual([]);
  });

  it("preserves case when deriving portable local identities", () => {
    expect(musicImportedLocalIdentitySeed("root", "Album/Track.flac")).not.toBe(
      musicImportedLocalIdentitySeed("root", "Album/track.flac"),
    );
    expect(musicImportedLocalIdentitySeed("root", "Album\\Track.flac")).toBe(
      musicImportedLocalIdentitySeed("root", "Album/Track.flac"),
    );
  });
});

describe("M3U8 music interchange", () => {
  it("parses UTF-8 local, mixed URL, relative, and Windows entries", () => {
    const entries = parseMusicM3u8("\uFEFF#EXTM3U\r\n#EXTINF:-1,Café\r\nMusic/Café.ogg\r\nC:\\Music\\rain.flac\r\nhttps://youtu.be/abc123\r\nhttps://example.com/file.mp3\r\n");
    expect(entries.map((entry) => entry.kind)).toEqual(["local", "local", "youtube", "unsupported"]);
    expect(entries[0]?.title).toBe("Café");
  });

  it("ignores malformed metadata and round trips supported entries", () => {
    const parsed = parseMusicM3u8("#EXTM3U\n#EXTINF:no-comma\ntrack.mp3\n# comment\nhttps://youtube.com/watch?v=abcdef\n");
    expect(parseMusicM3u8(serializeMusicM3u8(parsed))).toEqual(parsed);
  });
});

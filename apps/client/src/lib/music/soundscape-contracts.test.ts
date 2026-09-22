import { describe, expect, it } from "vitest";
import { parseMusicSoundscapeGroups, parseMusicSoundscapeSnapshot, parseMusicSoundscapes, parseMusicSoundscapeState } from "./soundscape-contracts";
import { orderedGeneratedSounds } from "./soundscape-presentation";

describe("soundscape boundary contracts", () => {
  it("parses generated and device-local definitions", () => {
    expect(parseMusicSoundscapes([{
      id: "generated-pink-noise",
      sourceKind: "generated-noise",
      generatedKind: "pink",
      bundledIdentity: null,
      name: "Pink noise",
      groupId: null,
      availability: "available",
      localPath: null,
      createdAt: 1,
      updatedAt: 1,
      version: 1,
    }])).toHaveLength(1);
  });

  it("rejects unknown sources and nonfinite volume", () => {
    const definition = { id: "x", sourceKind: "youtube", generatedKind: null, bundledIdentity: null, name: "X", groupId: null, availability: "available", localPath: null, createdAt: 1, updatedAt: 1, version: 1 };
    expect(() => parseMusicSoundscapes([definition])).toThrow("sourceKind");
    const state = { activeSoundscapeId: null, activeIds: [], multipleEnabled: false, generatedLevel: null, localLevel: null, desiredPlaying: false, volume: 0.1, updatedAt: 1, version: 1 };
    expect(() => parseMusicSoundscapeState({ ...state, volume: Number.NaN })).toThrow("volume");
    expect(parseMusicSoundscapeState({ ...state, generatedLevel: 1.25 }).generatedLevel).toBe(1.25);
    expect(() => parseMusicSoundscapeState({ ...state, localLevel: 2.1 })).toThrow("section level");
  });

  it("parses native snapshots without exposing local paths", () => {
    expect(parseMusicSoundscapeSnapshot({ status: "playing", sourceId: "rain", volume: 0.4, errorCode: null })).toEqual({ status: "playing", sourceId: "rain", volume: 0.4, errorCode: null });
  });

  it("validates group icons and keeps generated rain-like sounds in intensity order", () => {
    const group = { id: "rain", name: "Rain", icon: "cloud-rain", createdAt: 1, updatedAt: 1, version: 1 };
    expect(parseMusicSoundscapeGroups([group])[0].name).toBe("Rain");
    expect(() => parseMusicSoundscapeGroups([{ ...group, icon: "unknown" }])).toThrow("icon");
    const definitions = ["white", "brown", "pink"].map((generatedKind) => ({
      id: generatedKind, sourceKind: "generated-noise", generatedKind, bundledIdentity: null,
      name: generatedKind, groupId: null, availability: "available", localPath: null,
      createdAt: 1, updatedAt: 1, version: 1,
    }));
    expect(orderedGeneratedSounds(parseMusicSoundscapes(definitions)).map((entry) => entry.generatedKind)).toEqual(["brown", "pink", "white"]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_DOOMSCROLLING_CONFIG, type DoomscrollingConfig } from "$lib/doomscrolling";
import { buildMobileDoomscrollingSnapshot } from "./mobile-doomscrolling";

function config(): DoomscrollingConfig {
  return {
    ...DEFAULT_DOOMSCROLLING_CONFIG,
    mobile: {
      ...DEFAULT_DOOMSCROLLING_CONFIG.mobile,
      blockDuringShortBreaks: false,
      blockedApps: [{
        name: "YouTube",
        packageName: "com.google.android.youtube",
        enabled: true,
      }],
    },
    limits: {
      enabled: true,
      items: [{
        id: "video",
        name: "Video",
        enabled: true,
        minutesPerDay: 20,
        minutesPerWeek: 120,
        entries: [
          {
            id: "youtube",
            name: "YouTube",
            websiteHost: "youtube.com",
            mobileAppName: "YouTube",
            mobileAppPackage: "com.google.android.youtube",
            desktopAppName: null,
            desktopAppMatchNames: [],
          },
          {
            id: "youtube-duplicate",
            name: "YouTube duplicate",
            websiteHost: null,
            mobileAppName: "YouTube",
            mobileAppPackage: "com.google.android.youtube",
            desktopAppName: null,
            desktopAppMatchNames: [],
          },
        ],
      }, {
        id: "needs-android-selection",
        name: "Needs Android selection",
        enabled: true,
        minutesPerDay: 10,
        entries: [{
          id: "needs-selection",
          name: "Needs selection",
          websiteHost: null,
          mobileAppName: "Prepared app",
          desktopAppName: null,
          desktopAppMatchNames: [],
        }],
      }],
    },
  };
}

describe("mobile Doomscrolling rule projection", () => {
  it("projects stable packages, vault identity, schedules, and limits", () => {
    const snapshot = buildMobileDoomscrollingSnapshot(
      config(),
      "vault-android",
      1_788_041_200_000,
    );

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      vaultId: "vault-android",
      generatedAtEpochMs: 1_788_041_200_000,
      mobile: {
        enabled: true,
        blockDuringShortBreaks: false,
        blockedApps: [{
          name: "YouTube",
          packageName: "com.google.android.youtube",
          enabled: true,
        }],
      },
      limits: {
        enabled: true,
        items: [{
          id: "video",
          name: "Video",
          enabled: true,
          minutesPerDay: 20,
          minutesPerWeek: 120,
          packages: ["com.google.android.youtube"],
        }],
      },
    });
    expect(snapshot.revision).toMatch(/^1788041200000-/);
  });

  it("does not send name-only mobile entries to native enforcement", () => {
    const snapshot = buildMobileDoomscrollingSnapshot(config(), "vault-android", 1);

    expect(snapshot.limits.items.map((limit) => limit.id)).toEqual(["video"]);
  });

  it("projects accepted combined counters for offline native enforcement", () => {
    const snapshot = buildMobileDoomscrollingSnapshot(config(), "vault-android", 1, [{
      limitId: "video",
      period: "day",
      windowStartLocalDate: "2026-09-13",
      windowEndLocalDate: "2026-09-13",
      usedSeconds: 900,
      limitSeconds: 1_200,
      remainingSeconds: 300,
      exhausted: false,
    }]);

    expect(snapshot.limits.items[0]?.acceptedUsage).toEqual({
      day: {
        windowStartLocalDate: "2026-09-13",
        windowEndLocalDate: "2026-09-13",
        usedSeconds: 900,
      },
      week: null,
    });
  });
});

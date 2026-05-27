import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROCRASTINATION_STOPPER_CONFIG,
  evaluateStopperUrl,
  normalizeProcrastinationStopperConfig,
  normalizeStopperHost,
  parseStopperHosts,
} from "./procrastination-stopper";

describe("normalizeStopperHost", () => {
  it("accepts copied URLs and lowercases hosts", () => {
    expect(normalizeStopperHost("https://WWW.Reddit.com/r/all?x=1")).toBe("www.reddit.com");
  });

  it("accepts wildcard-style host input by storing the base host", () => {
    expect(normalizeStopperHost("*.youtube.com")).toBe("youtube.com");
  });

  it("rejects unsafe or unsupported host rules", () => {
    expect(normalizeStopperHost("")).toBeNull();
    expect(normalizeStopperHost("*")).toBeNull();
    expect(normalizeStopperHost("https://user@example.com")).toBeNull();
  });
});

describe("parseStopperHosts", () => {
  it("deduplicates normalized hosts while keeping first-seen order", () => {
    expect(parseStopperHosts("reddit.com, https://reddit.com/r/all\nnews.ycombinator.com")).toEqual([
      "reddit.com",
      "news.ycombinator.com",
    ]);
  });
});

describe("normalizeProcrastinationStopperConfig", () => {
  it("defaults all blocking toggles to enabled", () => {
    expect(normalizeProcrastinationStopperConfig(null)).toEqual(DEFAULT_PROCRASTINATION_STOPPER_CONFIG);
  });

  it("normalizes malformed config without throwing", () => {
    expect(normalizeProcrastinationStopperConfig({
      enabled: true,
      blockDuringBreaks: "yes",
      blockedHosts: ["Reddit.com", "*", "youtube.com"],
      allowedHosts: "docs.example.com",
    })).toEqual({
      mode: "blacklist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: ["reddit.com", "youtube.com"],
      exceptionHosts: [],
      allowedHosts: [],
    });
  });

  it("migrates legacy allowed hosts into blacklist exceptions", () => {
    expect(normalizeProcrastinationStopperConfig({
      allowedHosts: ["music.youtube.com"],
    })).toMatchObject({
      mode: "blacklist",
      exceptionHosts: ["music.youtube.com"],
      allowedHosts: [],
    });
  });

  it("keeps whitelist allowed hosts separate from blacklist exceptions", () => {
    expect(normalizeProcrastinationStopperConfig({
      mode: "whitelist",
      exceptionHosts: ["music.youtube.com"],
      allowedHosts: ["github.com"],
    })).toMatchObject({
      mode: "whitelist",
      exceptionHosts: ["music.youtube.com"],
      allowedHosts: ["github.com"],
    });
  });

  it("uses the legacy break toggle for both break types", () => {
    expect(normalizeProcrastinationStopperConfig({
      blockDuringBreaks: false,
    })).toMatchObject({
      blockDuringShortBreaks: false,
      blockDuringLongBreaks: false,
    });
  });
});

describe("evaluateStopperUrl", () => {
  it("blocks subdomains of blocked hosts", () => {
    const decision = evaluateStopperUrl("https://old.reddit.com/r/all", {
      mode: "blacklist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: ["reddit.com"],
      exceptionHosts: [],
      allowedHosts: [],
    });
    expect(decision).toEqual({
      blocked: true,
      host: "old.reddit.com",
      matchedRule: "blocked host: reddit.com",
    });
  });

  it("lets exceptions override blocked parent domains", () => {
    const decision = evaluateStopperUrl("https://music.youtube.com/playlist?list=1", {
      mode: "blacklist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: ["youtube.com"],
      exceptionHosts: ["music.youtube.com"],
      allowedHosts: [],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("exception: music.youtube.com");
  });

  it("blocks domains outside whitelist mode", () => {
    const decision = evaluateStopperUrl("https://reddit.com/r/all", {
      mode: "whitelist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [],
      exceptionHosts: [],
      allowedHosts: ["github.com"],
    });
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("not in whitelist");
  });

  it("allows domains inside whitelist mode", () => {
    const decision = evaluateStopperUrl("https://docs.github.com/en", {
      mode: "whitelist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [],
      exceptionHosts: [],
      allowedHosts: ["github.com"],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("whitelist: github.com");
  });
});

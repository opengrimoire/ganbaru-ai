import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOOMSCROLLING_CONFIG,
  evaluateDoomscrollingUrl,
  normalizeDoomscrollingConfig,
  normalizeDoomscrollingHost,
  parseDoomscrollingHosts,
  type DoomscrollingHostRule,
} from "./doomscrolling";

function hostRule(host: string, enabled = true): DoomscrollingHostRule {
  return { host, enabled };
}

describe("normalizeDoomscrollingHost", () => {
  it("accepts copied URLs and lowercases hosts", () => {
    expect(normalizeDoomscrollingHost("https://WWW.Reddit.com/r/all?x=1")).toBe("www.reddit.com");
  });

  it("accepts wildcard-style host input by storing the base host", () => {
    expect(normalizeDoomscrollingHost("*.youtube.com")).toBe("youtube.com");
  });

  it("rejects unsafe or unsupported host rules", () => {
    expect(normalizeDoomscrollingHost("")).toBeNull();
    expect(normalizeDoomscrollingHost("*")).toBeNull();
    expect(normalizeDoomscrollingHost("https://user@example.com")).toBeNull();
  });
});

describe("parseDoomscrollingHosts", () => {
  it("deduplicates normalized hosts while keeping first-seen order", () => {
    expect(parseDoomscrollingHosts("reddit.com, https://reddit.com/r/all\nnews.ycombinator.com")).toEqual([
      "reddit.com",
      "news.ycombinator.com",
    ]);
  });
});

describe("normalizeDoomscrollingConfig", () => {
  it("defaults all blocking toggles to enabled", () => {
    expect(normalizeDoomscrollingConfig(null)).toEqual(DEFAULT_DOOMSCROLLING_CONFIG);
  });

  it("normalizes malformed config without throwing", () => {
    expect(normalizeDoomscrollingConfig({
      enabled: true,
      blockDuringBreaks: "yes",
      blockedHosts: ["Reddit.com", "*", "youtube.com"],
      allowedHosts: "docs.example.com",
    })).toEqual({
      mode: "blacklist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [hostRule("reddit.com"), hostRule("youtube.com")],
      exceptionHosts: [],
      allowedHosts: [],
    });
  });

  it("normalizes disabled host rules without dropping them", () => {
    expect(normalizeDoomscrollingConfig({
      blockedHosts: [
        { host: "Reddit.com", enabled: false },
        { host: "https://youtube.com/watch?v=1" },
      ],
    })).toMatchObject({
      blockedHosts: [hostRule("reddit.com", false), hostRule("youtube.com")],
    });
  });

  it("migrates legacy allowed hosts into blacklist exceptions", () => {
    expect(normalizeDoomscrollingConfig({
      allowedHosts: ["music.youtube.com"],
    })).toMatchObject({
      mode: "blacklist",
      exceptionHosts: [hostRule("music.youtube.com")],
      allowedHosts: [],
    });
  });

  it("keeps whitelist allowed hosts separate from blacklist exceptions", () => {
    expect(normalizeDoomscrollingConfig({
      mode: "whitelist",
      exceptionHosts: ["music.youtube.com"],
      allowedHosts: ["github.com"],
    })).toMatchObject({
      mode: "whitelist",
      exceptionHosts: [hostRule("music.youtube.com")],
      allowedHosts: [hostRule("github.com")],
    });
  });

  it("uses the legacy break toggle for both break types", () => {
    expect(normalizeDoomscrollingConfig({
      blockDuringBreaks: false,
    })).toMatchObject({
      blockDuringShortBreaks: false,
      blockDuringLongBreaks: false,
    });
  });
});

describe("evaluateDoomscrollingUrl", () => {
  it("blocks subdomains of blocked hosts", () => {
    const decision = evaluateDoomscrollingUrl("https://old.reddit.com/r/all", {
      mode: "blacklist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [hostRule("reddit.com")],
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
    const decision = evaluateDoomscrollingUrl("https://music.youtube.com/playlist?list=1", {
      mode: "blacklist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [hostRule("youtube.com")],
      exceptionHosts: [hostRule("music.youtube.com")],
      allowedHosts: [],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("exception: music.youtube.com");
  });

  it("blocks domains outside whitelist mode", () => {
    const decision = evaluateDoomscrollingUrl("https://reddit.com/r/all", {
      mode: "whitelist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [],
      exceptionHosts: [],
      allowedHosts: [hostRule("github.com")],
    });
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("not in whitelist");
  });

  it("allows domains inside whitelist mode", () => {
    const decision = evaluateDoomscrollingUrl("https://docs.github.com/en", {
      mode: "whitelist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [],
      exceptionHosts: [],
      allowedHosts: [hostRule("github.com")],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("whitelist: github.com");
  });

  it("ignores disabled blacklist rules", () => {
    const decision = evaluateDoomscrollingUrl("https://reddit.com/r/all", {
      mode: "blacklist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [hostRule("reddit.com", false)],
      exceptionHosts: [],
      allowedHosts: [],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBeNull();
  });

  it("ignores disabled whitelist rules", () => {
    const decision = evaluateDoomscrollingUrl("https://docs.github.com/en", {
      mode: "whitelist",
      enabled: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedHosts: [],
      exceptionHosts: [],
      allowedHosts: [hostRule("github.com", false)],
    });
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("not in whitelist");
  });
});

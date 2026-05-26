import { describe, expect, it } from "vitest";
import {
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
  it("normalizes malformed config without throwing", () => {
    expect(normalizeProcrastinationStopperConfig({
      enabled: true,
      blockDuringBreaks: "yes",
      blockedHosts: ["Reddit.com", "*", "youtube.com"],
      allowedHosts: "docs.example.com",
    })).toEqual({
      enabled: true,
      blockDuringBreaks: false,
      blockedHosts: ["reddit.com", "youtube.com"],
      allowedHosts: [],
    });
  });
});

describe("evaluateStopperUrl", () => {
  it("blocks subdomains of blocked hosts", () => {
    const decision = evaluateStopperUrl("https://old.reddit.com/r/all", {
      enabled: true,
      blockDuringBreaks: false,
      blockedHosts: ["reddit.com"],
      allowedHosts: [],
    });
    expect(decision).toEqual({
      blocked: true,
      host: "old.reddit.com",
      matchedRule: "blocked host: reddit.com",
    });
  });

  it("lets allowed hosts override blocked parent domains", () => {
    const decision = evaluateStopperUrl("https://music.youtube.com/playlist?list=1", {
      enabled: true,
      blockDuringBreaks: false,
      blockedHosts: ["youtube.com"],
      allowedHosts: ["music.youtube.com"],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("allowed host: music.youtube.com");
  });
});

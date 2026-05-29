import { describe, expect, it } from "vitest";
import {
  computeDoomscrollingLimitDailyTotals,
  DEFAULT_DOOMSCROLLING_CONFIG,
  doomscrollingWebsiteUsageSampleFromUrl,
  evaluateDoomscrollingWebsiteLimit,
  evaluateDoomscrollingUrl,
  isProtectedDoomscrollingDesktopAppName,
  matchesDoomscrollingLimitEntry,
  normalizeDoomscrollingAppName,
  normalizeDoomscrollingConfig,
  normalizeDoomscrollingHost,
  parseDoomscrollingHosts,
  type DoomscrollingAppRule,
  type DoomscrollingCategoryId,
  type DoomscrollingConfig,
  type DoomscrollingHostRule,
  type DoomscrollingUsageLimit,
  type DoomscrollingUsageSample,
} from "./rules";

function appRule(name: string, enabled = true): DoomscrollingAppRule {
  return { name, enabled, matchNames: [name] };
}

function hostRule(host: string, enabled = true): DoomscrollingHostRule {
  return { host, enabled };
}

function categoryRule(id: DoomscrollingCategoryId, enabled = true) {
  return { id, enabled };
}

function disabledCategoryRules(): DoomscrollingConfig["blockedCategories"] {
  return DEFAULT_DOOMSCROLLING_CONFIG.blockedCategories.map((rule) => ({
    ...rule,
    enabled: false,
  }));
}

function categoryRulesWith(
  id: DoomscrollingCategoryId,
  enabled = true,
): DoomscrollingConfig["blockedCategories"] {
  return disabledCategoryRules().map((rule) => ({
    ...rule,
    enabled: rule.id === id ? enabled : rule.enabled,
  }));
}

function config(partial: Partial<DoomscrollingConfig>): DoomscrollingConfig {
  return {
    ...DEFAULT_DOOMSCROLLING_CONFIG,
    blockedCategories: disabledCategoryRules(),
    customCategoryStacks: [],
    blockedHosts: [],
    exceptionHosts: [],
    allowedHosts: [],
    limits: { enabled: true, items: [] },
    ...partial,
  };
}

function limit(partial: Partial<DoomscrollingUsageLimit>): DoomscrollingUsageLimit {
  return {
    id: "limit-1",
    name: "Daily limit",
    enabled: true,
    minutesPerDay: 30,
    entries: [{
      id: "entry-1",
      name: null,
      websiteHost: "youtube.com",
      mobileAppName: null,
      desktopAppName: null,
    }],
    ...partial,
  };
}

function websiteSample(host: string, elapsedSeconds: number, localDate = "2026-05-28"): DoomscrollingUsageSample {
  return {
    sourceType: "website",
    sourceKey: host,
    displayName: host,
    elapsedSeconds,
    startedAt: 1_779_923_600_000,
    localDate,
  };
}

function desktopSample(appName: string, elapsedSeconds: number, localDate = "2026-05-28"): DoomscrollingUsageSample {
  return {
    sourceType: "desktop-app",
    sourceKey: appName,
    displayName: appName,
    elapsedSeconds,
    startedAt: 1_779_923_600_000,
    localDate,
  };
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

describe("normalizeDoomscrollingAppName", () => {
  it("keeps user-facing app names while trimming whitespace", () => {
    expect(normalizeDoomscrollingAppName("  Visual   Studio Code  ")).toBe("Visual Studio Code");
  });

  it("rejects empty app names", () => {
    expect(normalizeDoomscrollingAppName("   ")).toBeNull();
  });

  it("recognizes protected Ganbaru AI app names", () => {
    expect(isProtectedDoomscrollingDesktopAppName("Ganbaru AI")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("ganbaru-ai")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("org.opengrimoire.ganbaru-ai")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("org.opengrimoire.ganbaru-ai.dev")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("Steam")).toBe(false);
  });

  it("recognizes protected system app and runtime names", () => {
    expect(isProtectedDoomscrollingDesktopAppName("Terminal")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("System Monitor")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("gnome-shell")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("python3.12")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("explorer.exe")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("Discord")).toBe(false);
  });
});

describe("normalizeDoomscrollingConfig", () => {
  it("defaults all blocking toggles and built-in categories to enabled", () => {
    const normalized = normalizeDoomscrollingConfig(null);
    expect(normalized).toEqual(DEFAULT_DOOMSCROLLING_CONFIG);
    expect(normalized.blockedCategories.every((rule) => rule.enabled)).toBe(true);
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
      blockDuringFocus: true,
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedCategories: DEFAULT_DOOMSCROLLING_CONFIG.blockedCategories,
      customCategoryStacks: [],
      blockedHosts: [hostRule("reddit.com"), hostRule("youtube.com")],
      exceptionHosts: [],
      allowedHosts: [],
      desktop: DEFAULT_DOOMSCROLLING_CONFIG.desktop,
      limits: DEFAULT_DOOMSCROLLING_CONFIG.limits,
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
      blockDuringFocus: true,
      blockDuringShortBreaks: false,
      blockDuringLongBreaks: false,
    });
  });

  it("normalizes focus blocking independently from global enablement", () => {
    expect(normalizeDoomscrollingConfig({
      enabled: true,
      blockDuringFocus: false,
      blockDuringShortBreaks: true,
    })).toMatchObject({
      enabled: true,
      blockDuringFocus: false,
      blockDuringShortBreaks: true,
    });
  });

  it("normalizes built-in categories and custom category stacks", () => {
    const normalized = normalizeDoomscrollingConfig({
      blockedCategories: [
        "social-media",
        { id: "streaming", enabled: false },
        { id: "news", enabled: true },
        { id: "unknown", enabled: true },
      ],
      customCategoryStacks: [
        {
          id: "research-traps",
          name: "  Research traps  ",
          enabled: false,
          hosts: ["news.ycombinator.com", "https://reddit.com/r/programming", "*"],
        },
        {
          id: "bad id",
          name: "Invalid",
          hosts: ["example.com"],
        },
      ],
    });
    expect(normalized.blockedCategories.find((rule) => rule.id === "social-media")).toEqual(
      categoryRule("social-media"),
    );
    expect(normalized.blockedCategories.find((rule) => rule.id === "streaming")).toEqual(
      categoryRule("streaming", false),
    );
    expect(normalized.blockedCategories.find((rule) => rule.id === "news")).toEqual(
      categoryRule("news"),
    );
    expect(normalized.customCategoryStacks).toEqual([
      {
        id: "research-traps",
        name: "Research traps",
        enabled: false,
        hosts: [hostRule("news.ycombinator.com"), hostRule("reddit.com")],
      },
    ]);
  });

  it("normalizes desktop app rules as a blocklist separate from browser rules", () => {
    expect(normalizeDoomscrollingConfig({
      desktop: {
        mode: "whitelist",
        enabled: false,
        blockDuringFocus: false,
        blockDuringBreaks: false,
        blockedApps: [
          "Steam",
          "Ganbaru AI",
          { name: " steam ", enabled: false },
          { name: "Discord", enabled: false },
          { name: "Calculator", matchNames: ["gnome-calculator"] },
          { name: "Terminal", matchNames: ["gnome-terminal"] },
        ],
        allowedApps: [
          "ganbaru-ai",
          "Visual Studio Code",
          { name: "Firefox", enabled: false },
        ],
      },
    })).toMatchObject({
      desktop: {
        enabled: false,
        blockDuringFocus: false,
        blockDuringShortBreaks: false,
        blockDuringLongBreaks: false,
        blockedApps: [
          appRule("Steam"),
          appRule("Discord", false),
        ],
      },
    });
  });

  it("normalizes valid daily usage limits", () => {
    const normalized = normalizeDoomscrollingConfig({
      limits: {
        enabled: true,
        items: [
          {
            id: "youtube",
            name: "  YouTube  ",
            enabled: false,
            minutesPerDay: 45.8,
            entries: [
              {
                id: "youtube-main",
                name: "  YouTube main  ",
                websiteHost: "https://youtube.com/watch?v=1",
                desktopAppName: "FreeTube",
                mobileAppName: "YouTube",
              },
            ],
          },
        ],
      },
    });

    expect(normalized.limits.items).toEqual([
      {
        id: "youtube",
        name: "YouTube",
        enabled: false,
        minutesPerDay: 45,
        entries: [
          {
            id: "youtube-main",
            name: "YouTube main",
            websiteHost: "youtube.com",
            mobileAppName: "YouTube",
            desktopAppName: "FreeTube",
          },
        ],
      },
    ]);
  });

  it("rejects invalid daily usage limits", () => {
    const normalized = normalizeDoomscrollingConfig({
      limits: {
        items: [
          {
            id: "bad-minutes",
            name: "Bad",
            minutesPerDay: 0,
            entries: [{ id: "entry-1", websiteHost: "youtube.com" }],
          },
          {
            id: "bad-name",
            name: "   ",
            minutesPerDay: 30,
            entries: [{ id: "entry-1", websiteHost: "youtube.com" }],
          },
          {
            id: "duplicate-sources",
            name: "Duplicate sources",
            minutesPerDay: 30,
            entries: [
              { id: "entry-1", websiteHost: "youtube.com" },
              { id: "entry-2", websiteHost: "https://youtube.com/watch?v=1" },
            ],
          },
          {
            id: "protected-app",
            name: "Protected app",
            minutesPerDay: 30,
            entries: [{ id: "entry-1", desktopAppName: "Terminal" }],
          },
        ],
      },
    });

    expect(normalized.limits.items).toEqual([]);
  });
});

describe("Doomscrolling usage limit matching", () => {
  it("matches website hosts, subdomains, mobile apps, and desktop app names", () => {
    expect(matchesDoomscrollingLimitEntry(
      {
        id: "youtube",
        name: null,
        websiteHost: "youtube.com",
        mobileAppName: null,
        desktopAppName: null,
      },
      websiteSample("music.youtube.com", 60),
    )).toBe(true);
    expect(matchesDoomscrollingLimitEntry(
      {
        id: "youtube",
        name: null,
        websiteHost: null,
        mobileAppName: "YouTube",
        desktopAppName: null,
      },
      {
        sourceType: "mobile-app",
        sourceKey: "youtube",
        displayName: "YouTube",
        elapsedSeconds: 60,
        startedAt: 1_779_923_600_000,
        localDate: "2026-05-28",
      },
    )).toBe(true);
    expect(matchesDoomscrollingLimitEntry(
      {
        id: "youtube",
        name: null,
        websiteHost: null,
        mobileAppName: null,
        desktopAppName: "FreeTube",
      },
      desktopSample("freetube", 60),
    )).toBe(true);
  });

  it("sums linked sources into one daily limit", () => {
    const cfg = config({
      limits: {
        enabled: true,
        items: [
          limit({
            id: "youtube",
            name: "YouTube",
            minutesPerDay: 10,
            entries: [
              {
                id: "youtube-main",
                name: null,
                websiteHost: "youtube.com",
                mobileAppName: null,
                desktopAppName: "FreeTube",
              },
            ],
          }),
        ],
      },
    });

    const totals = computeDoomscrollingLimitDailyTotals(cfg, [
      websiteSample("youtube.com", 120),
      websiteSample("music.youtube.com", 60),
      desktopSample("freetube", 180),
    ], "2026-05-28");

    expect(totals).toMatchObject([{ limitId: "youtube", usedSeconds: 360 }]);
  });

  it("sums several sources into one daily limit", () => {
    const cfg = config({
      limits: {
        enabled: true,
        items: [
          limit({
            id: "social",
            name: "Social media",
            minutesPerDay: 60,
            entries: [
              {
                id: "reddit",
                name: "Reddit",
                websiteHost: "reddit.com",
                mobileAppName: null,
                desktopAppName: null,
              },
              {
                id: "discord",
                name: "Discord",
                websiteHost: "discord.com",
                mobileAppName: null,
                desktopAppName: null,
              },
            ],
          }),
        ],
      },
    });

    const totals = computeDoomscrollingLimitDailyTotals(cfg, [
      websiteSample("old.reddit.com", 300),
      websiteSample("discord.com", 120),
    ], "2026-05-28");

    expect(totals).toMatchObject([{ limitId: "social", usedSeconds: 420 }]);
  });

  it("resets totals by local date", () => {
    const cfg = config({
      limits: {
        enabled: true,
        items: [limit({ id: "youtube", minutesPerDay: 10 })],
      },
    });

    const totals = computeDoomscrollingLimitDailyTotals(cfg, [
      websiteSample("youtube.com", 600, "2026-05-27"),
      websiteSample("youtube.com", 120, "2026-05-28"),
    ], "2026-05-28");

    expect(totals).toMatchObject([{ limitId: "youtube", usedSeconds: 120 }]);
  });

  it("blocks websites whose matching limit is exhausted", () => {
    const cfg = config({
      limits: {
        enabled: true,
        items: [limit({ id: "youtube", name: "YouTube", minutesPerDay: 10 })],
      },
    });

    const decision = evaluateDoomscrollingWebsiteLimit("https://music.youtube.com/watch", cfg, [
      {
        limitId: "youtube",
        usedSeconds: 600,
        limitSeconds: 600,
        remainingSeconds: 0,
        exhausted: true,
      },
    ]);

    expect(decision).toEqual({
      blocked: true,
      host: "music.youtube.com",
      limitId: "youtube",
      limitName: "YouTube",
      matchedRule: "daily limit: YouTube",
    });
  });

  it("does not count blocked extension pages as website usage", () => {
    expect(doomscrollingWebsiteUsageSampleFromUrl(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/blocked.html",
      30,
      1_779_923_600_000,
      "2026-05-28",
    )).toBeNull();
  });
});

describe("evaluateDoomscrollingUrl", () => {
  it("blocks subdomains of blocked hosts", () => {
    const decision = evaluateDoomscrollingUrl("https://old.reddit.com/r/all", config({
      mode: "blacklist",
      blockedHosts: [hostRule("reddit.com")],
    }));
    expect(decision).toEqual({
      blocked: true,
      host: "old.reddit.com",
      matchedRule: "blocked host: reddit.com",
    });
  });

  it("lets exceptions override blocked parent domains", () => {
    const decision = evaluateDoomscrollingUrl("https://music.youtube.com/playlist?list=1", config({
      mode: "blacklist",
      blockedHosts: [hostRule("youtube.com")],
      exceptionHosts: [hostRule("music.youtube.com")],
    }));
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("exception: music.youtube.com");
  });

  it("blocks domains outside whitelist mode", () => {
    const decision = evaluateDoomscrollingUrl("https://reddit.com/r/all", config({
      mode: "whitelist",
      allowedHosts: [hostRule("github.com")],
    }));
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("not in whitelist");
  });

  it("allows domains inside whitelist mode", () => {
    const decision = evaluateDoomscrollingUrl("https://docs.github.com/en", config({
      mode: "whitelist",
      allowedHosts: [hostRule("github.com")],
    }));
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("whitelist: github.com");
  });

  it("ignores disabled blacklist rules", () => {
    const decision = evaluateDoomscrollingUrl("https://reddit.com/r/all", config({
      mode: "blacklist",
      blockedHosts: [hostRule("reddit.com", false)],
    }));
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBeNull();
  });

  it("ignores disabled whitelist rules", () => {
    const decision = evaluateDoomscrollingUrl("https://docs.github.com/en", config({
      mode: "whitelist",
      allowedHosts: [hostRule("github.com", false)],
    }));
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("not in whitelist");
  });

  it("blocks enabled built-in categories in blacklist mode", () => {
    const decision = evaluateDoomscrollingUrl("https://old.reddit.com/r/all", config({
      mode: "blacklist",
      blockedCategories: categoryRulesWith("social-media"),
    }));
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("category: Social media");
  });

  it("blocks streaming category keyword matches in domains", () => {
    const decision = evaluateDoomscrollingUrl("https://watch-anime.example/episode/1", config({
      mode: "blacklist",
      blockedCategories: categoryRulesWith("streaming"),
    }));
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("category: Streaming");
  });

  it.each([
    ["https://local-news.example/story", "news", "category: News"],
    ["https://live-scores.example/game", "sports", "category: Sports"],
    ["https://online-casino.example/table", "gambling", "category: Gambling"],
    ["https://mini-game.example/play", "gaming", "category: Gaming"],
    ["https://shopee.example/deals", "shopping", "category: Shopping"],
    ["https://best-hookup.example/profile", "dating", "category: Dating"],
    ["https://crypto-watch.example/chart", "trading", "category: Trading"],
  ] satisfies Array<[string, DoomscrollingCategoryId, string]>)(
    "blocks built-in category keyword matches in domains for %s",
    (url, categoryId, matchedRule) => {
      const decision = evaluateDoomscrollingUrl(url, config({
        mode: "blacklist",
        blockedCategories: categoryRulesWith(categoryId),
      }));
      expect(decision.blocked).toBe(true);
      expect(decision.matchedRule).toBe(matchedRule);
    },
  );

  it("blocks porn category keyword matches in domains", () => {
    const decision = evaluateDoomscrollingUrl("https://example-porn-site.test/watch", config({
      mode: "blacklist",
      blockedCategories: categoryRulesWith("porn"),
    }));
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("category: Porn");
  });

  it("blocks porn category keyword matches in reddit subreddit names", () => {
    const decision = evaluateDoomscrollingUrl("https://old.reddit.com/r/gwstories/comments/123/title", config({
      mode: "blacklist",
      blockedCategories: categoryRulesWith("porn"),
    }));
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("category: Porn");
  });

  it("ignores reddit post titles for porn category keyword matching", () => {
    const decision = evaluateDoomscrollingUrl("https://reddit.com/r/productivity/comments/123/nsfw_post_title", config({
      mode: "blacklist",
      blockedCategories: categoryRulesWith("porn"),
    }));
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBeNull();
  });

  it("blocks enabled custom category stacks in blacklist mode", () => {
    const decision = evaluateDoomscrollingUrl("https://news.ycombinator.com/item?id=1", config({
      mode: "blacklist",
      customCategoryStacks: [
        {
          id: "research-traps",
          name: "Research traps",
          enabled: true,
          hosts: [hostRule("news.ycombinator.com")],
        },
      ],
    }));
    expect(decision.blocked).toBe(true);
    expect(decision.matchedRule).toBe("custom stack: Research traps");
  });

  it("ignores blacklist categories while in whitelist mode", () => {
    const decision = evaluateDoomscrollingUrl("https://old.reddit.com/r/all", config({
      mode: "whitelist",
      blockedCategories: categoryRulesWith("social-media"),
      allowedHosts: [hostRule("reddit.com")],
    }));
    expect(decision.blocked).toBe(false);
    expect(decision.matchedRule).toBe("whitelist: reddit.com");
  });
});

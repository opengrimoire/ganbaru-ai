import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOOMSCROLLING_CONFIG,
  evaluateDoomscrollingUrl,
  isProtectedDoomscrollingDesktopAppName,
  normalizeDoomscrollingAppName,
  normalizeDoomscrollingConfig,
  normalizeDoomscrollingHost,
  parseDoomscrollingHosts,
  type DoomscrollingAppRule,
  type DoomscrollingCategoryId,
  type DoomscrollingConfig,
  type DoomscrollingHostRule,
} from "./doomscrolling";

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
    ...partial,
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

  it("recognizes protected GanbaruAI app names", () => {
    expect(isProtectedDoomscrollingDesktopAppName("GanbaruAI")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("ganbaruai")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("org.opengrimoire.ganbaruai")).toBe(true);
    expect(isProtectedDoomscrollingDesktopAppName("org.opengrimoire.ganbaruai.dev")).toBe(true);
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
      blockDuringShortBreaks: true,
      blockDuringLongBreaks: true,
      blockedCategories: DEFAULT_DOOMSCROLLING_CONFIG.blockedCategories,
      customCategoryStacks: [],
      blockedHosts: [hostRule("reddit.com"), hostRule("youtube.com")],
      exceptionHosts: [],
      allowedHosts: [],
      desktop: DEFAULT_DOOMSCROLLING_CONFIG.desktop,
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
        blockDuringBreaks: false,
        blockedApps: [
          "Steam",
          "GanbaruAI",
          { name: " steam ", enabled: false },
          { name: "Discord", enabled: false },
          { name: "Calculator", matchNames: ["gnome-calculator"] },
          { name: "Terminal", matchNames: ["gnome-terminal"] },
        ],
        allowedApps: [
          "ganbaruai",
          "Visual Studio Code",
          { name: "Firefox", enabled: false },
        ],
      },
    })).toMatchObject({
      desktop: {
        enabled: false,
        blockDuringShortBreaks: false,
        blockDuringLongBreaks: false,
        blockedApps: [
          appRule("Steam"),
          appRule("Discord", false),
        ],
      },
    });
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

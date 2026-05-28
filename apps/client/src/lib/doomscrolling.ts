export type DoomscrollingMode = "blacklist" | "whitelist";

export const DOOMSCROLLING_PROTECTED_DESKTOP_APP_NAMES = [
  "GanbaruAI",
  "ganbaruai",
  "ganbaruai-dev",
  "GanbaruAI Dev",
  "GanbaruAI (dev)",
  "org.opengrimoire.ganbaruai",
  "org.opengrimoire.ganbaruai.dev",
  "Activity Monitor",
  "Advanced Network Configuration",
  "Calculator",
  "Characters",
  "Clocks",
  "Command Prompt",
  "Console",
  "Control Panel",
  "Disk Utility",
  "Disk Usage Analyzer",
  "Disks",
  "Event Viewer",
  "Extension Manager",
  "Extensions",
  "File Explorer",
  "Files",
  "Finder",
  "Fonts",
  "GDebi Package Installer",
  "GNOME System Monitor",
  "Help",
  "Htop",
  "IBus Preferences",
  "Input Method",
  "Keychain Access",
  "Language Support",
  "Logs",
  "Notepad",
  "Passwords and Keys",
  "Power Statistics",
  "PowerShell",
  "Settings",
  "Startup Applications",
  "System Monitor",
  "System Preferences",
  "System Settings",
  "Task Manager",
  "Terminal",
  "Text Editor",
  "UXTerm",
  "Windows Explorer",
  "Windows PowerShell",
  "XTerm",
] as const;

export const DOOMSCROLLING_PROTECTED_DESKTOP_PROCESS_NAMES = [
  "Activity Monitor",
  "bash",
  "cmd",
  "cmd.exe",
  "conhost.exe",
  "ControlCenter",
  "csrss.exe",
  "dash",
  "dbus-broker",
  "dbus-daemon",
  "dllhost.exe",
  "Dock",
  "dwm.exe",
  "electron",
  "explorer.exe",
  "Finder",
  "fish",
  "flatpak",
  "gnome-control-center",
  "gnome-keyring-daemon",
  "gnome-shell",
  "gnome-terminal",
  "gnome-terminal-server",
  "ibus-daemon",
  "java",
  "javaw",
  "javaw.exe",
  "kitty",
  "konsole",
  "kwin_wayland",
  "kwin_x11",
  "launchd",
  "loginwindow",
  "mmc.exe",
  "mutter",
  "node",
  "plasmashell",
  "PowerShell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "python",
  "python3",
  "python3.11",
  "python3.12",
  "pythonw.exe",
  "regedit.exe",
  "rundll32.exe",
  "services.exe",
  "sh",
  "ShellExperienceHost.exe",
  "sihost.exe",
  "snap",
  "StartMenuExperienceHost.exe",
  "svchost.exe",
  "System Settings",
  "SystemUIServer",
  "taskmgr.exe",
  "Terminal",
  "wezterm",
  "winlogon.exe",
  "WindowsTerminal.exe",
  "WindowServer",
  "wt.exe",
  "wscript.exe",
  "xdg-desktop-portal",
  "xdg-desktop-portal-gnome",
  "xdg-desktop-portal-gtk",
  "Xorg",
  "XTerm",
  "Xwayland",
  "zsh",
] as const;

export const DOOMSCROLLING_CATEGORY_DEFINITIONS = [
  {
    id: "social-media",
    label: "Social media",
    description: "Repeated checking for updates, reactions, comments, and novelty",
    hosts: [
      "facebook.com",
      "instagram.com",
      "x.com",
      "twitter.com",
      "tiktok.com",
      "reddit.com",
      "threads.net",
      "bsky.app",
      "snapchat.com",
      "pinterest.com",
      "linkedin.com",
    ],
  },
  {
    id: "streaming",
    label: "Streaming",
    description: "Passive continuation turns short breaks into long sessions",
    hosts: [
      "youtube.com",
      "netflix.com",
      "hulu.com",
      "disneyplus.com",
      "primevideo.com",
      "twitch.tv",
      "max.com",
      "peacocktv.com",
      "crunchyroll.com",
    ],
  },
  {
    id: "news",
    label: "News",
    description: "Repeated checking without any immediate action needed",
    hosts: [
      "cnn.com",
      "bbc.com",
      "nytimes.com",
      "washingtonpost.com",
      "theguardian.com",
      "reuters.com",
      "apnews.com",
      "nbcnews.com",
      "foxnews.com",
    ],
  },
  {
    id: "sports",
    label: "Sports",
    description: "Scores and rumors encourage frequent checking",
    hosts: [
      "espn.com",
      "bleacherreport.com",
      "cbssports.com",
      "foxsports.com",
      "skysports.com",
      "nba.com",
      "nfl.com",
      "mlb.com",
      "nhl.com",
      "fifa.com",
    ],
  },
  {
    id: "porn",
    label: "Porn",
    description: "High-intensity instant reward quickly overrides task intent",
    hosts: [
      "pornhub.com",
      "xvideos.com",
      "xnxx.com",
      "xhamster.com",
      "redtube.com",
      "youporn.com",
      "spankbang.com",
    ],
  },
  {
    id: "gambling",
    label: "Gambling",
    description: "Variable rewards encourage one more try behavior",
    hosts: [
      "stake.com",
      "draftkings.com",
      "fanduel.com",
      "bet365.com",
      "betmgm.com",
      "caesars.com",
      "bovada.lv",
      "pokerstars.com",
    ],
  },
  {
    id: "gaming",
    label: "Gaming",
    description: "In-game goals chain together and delay returning to work",
    hosts: [
      "steampowered.com",
      "epicgames.com",
      "roblox.com",
      "battle.net",
      "xbox.com",
      "playstation.com",
      "itch.io",
      "speedrun.com",
    ],
  },
  {
    id: "shopping",
    label: "Shopping",
    description: "Browsing, comparing, and wishlisting can replace actual work",
    hosts: [
      "amazon.com",
      "ebay.com",
      "aliexpress.com",
      "temu.com",
      "walmart.com",
      "target.com",
      "etsy.com",
      "shein.com",
      "bestbuy.com",
    ],
  },
  {
    id: "dating",
    label: "Dating",
    description: "Match and message checking creates validation loops",
    hosts: [
      "tinder.com",
      "bumble.com",
      "hinge.co",
      "okcupid.com",
      "match.com",
      "pof.com",
      "grindr.com",
      "happn.com",
    ],
  },
  {
    id: "trading",
    label: "Trading",
    description: "Constantly changing prices encourage compulsive monitoring",
    hosts: [
      "robinhood.com",
      "coinbase.com",
      "binance.com",
      "tradingview.com",
      "etoro.com",
      "kraken.com",
      "marketwatch.com",
      "seekingalpha.com",
      "coinmarketcap.com",
      "coingecko.com",
    ],
  },
] as const;

export type DoomscrollingCategoryId = (typeof DOOMSCROLLING_CATEGORY_DEFINITIONS)[number]["id"];

export interface DoomscrollingHostRule {
  host: string;
  enabled: boolean;
}

export interface DoomscrollingAppRule {
  name: string;
  enabled: boolean;
  matchNames: string[];
}

export interface DoomscrollingCategoryRule {
  id: DoomscrollingCategoryId;
  enabled: boolean;
}

export interface DoomscrollingCustomCategoryStack {
  id: string;
  name: string;
  enabled: boolean;
  hosts: DoomscrollingHostRule[];
}

export interface DoomscrollingDesktopConfig {
  enabled: boolean;
  blockDuringFocus: boolean;
  blockDuringShortBreaks: boolean;
  blockDuringLongBreaks: boolean;
  blockedApps: DoomscrollingAppRule[];
}

export interface DoomscrollingConfig {
  mode: DoomscrollingMode;
  enabled: boolean;
  blockDuringFocus: boolean;
  blockDuringShortBreaks: boolean;
  blockDuringLongBreaks: boolean;
  blockedCategories: DoomscrollingCategoryRule[];
  customCategoryStacks: DoomscrollingCustomCategoryStack[];
  blockedHosts: DoomscrollingHostRule[];
  exceptionHosts: DoomscrollingHostRule[];
  allowedHosts: DoomscrollingHostRule[];
  desktop: DoomscrollingDesktopConfig;
}

export interface DoomscrollingDecision {
  blocked: boolean;
  host: string | null;
  matchedRule: string | null;
}

const DOOMSCROLLING_CATEGORY_IDS = new Set<string>(
  DOOMSCROLLING_CATEGORY_DEFINITIONS.map((category) => category.id),
);

function defaultCategoryRules(): DoomscrollingCategoryRule[] {
  return DOOMSCROLLING_CATEGORY_DEFINITIONS.map((category) => ({
    id: category.id,
    enabled: true,
  }));
}

function defaultDesktopConfig(): DoomscrollingDesktopConfig {
  return {
    enabled: true,
    blockDuringFocus: true,
    blockDuringShortBreaks: true,
    blockDuringLongBreaks: true,
    blockedApps: [],
  };
}

function protectedDesktopAppKeys(): Set<string> {
  const keys = new Set<string>();
  for (const name of DOOMSCROLLING_PROTECTED_DESKTOP_APP_NAMES) {
    keys.add(appRuleKey(name));
  }
  for (const name of DOOMSCROLLING_PROTECTED_DESKTOP_PROCESS_NAMES) {
    keys.add(appRuleKey(name));
  }
  return keys;
}

export const DEFAULT_DOOMSCROLLING_CONFIG: DoomscrollingConfig = Object.freeze({
  mode: "blacklist",
  enabled: true,
  blockDuringFocus: true,
  blockDuringShortBreaks: true,
  blockDuringLongBreaks: true,
  blockedCategories: defaultCategoryRules(),
  customCategoryStacks: [],
  blockedHosts: [],
  exceptionHosts: [],
  allowedHosts: [],
  desktop: defaultDesktopConfig(),
});

export function isDoomscrollingCategoryId(value: string): value is DoomscrollingCategoryId {
  return DOOMSCROLLING_CATEGORY_IDS.has(value);
}

export function getDoomscrollingCategoryDefinition(id: DoomscrollingCategoryId) {
  return DOOMSCROLLING_CATEGORY_DEFINITIONS.find((category) => category.id === id);
}

function stripUrlParts(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "";
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withScheme).hostname;
  } catch {
    return trimmed.split(/[/?#]/, 1)[0] ?? "";
  }
}

/**
 * Normalize user-entered host rules into lowercase domain names.
 *
 * @param input - A domain, host, or URL copied from the browser.
 * @returns The normalized host, or null when the input is not a valid host rule.
 */
export function normalizeDoomscrollingHost(input: string): string | null {
  if (input.includes("@")) return null;
  const withoutProtocol = stripUrlParts(input).toLowerCase();
  const withoutWildcard = withoutProtocol.startsWith("*.") ? withoutProtocol.slice(2) : withoutProtocol;
  const withoutPort = withoutWildcard.replace(/:\d+$/, "");
  const host = withoutPort.replace(/\.+$/, "");
  if (host.length === 0) return null;
  if (host.includes("*") || host.includes(" ") || host.includes("@")) return null;
  if (host === "localhost") return host;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) {
    return null;
  }
  return host;
}

/**
 * Parse a textarea-style list of host rules.
 *
 * @param input - Hosts separated by newlines, commas, semicolons, or spaces.
 * @returns Deduplicated normalized hosts in first-seen order.
 */
export function parseDoomscrollingHosts(input: string): string[] {
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const part of input.split(/[\s,;]+/)) {
    const host = normalizeDoomscrollingHost(part);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

/**
 * Normalize user-entered desktop app names.
 *
 * @param input - A visible app name or executable name entered by the user.
 * @returns The normalized app name, or null when the input is empty.
 */
export function normalizeDoomscrollingAppName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ").slice(0, 80);
  if (name.length === 0) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export function isProtectedDoomscrollingDesktopAppName(input: string): boolean {
  const name = normalizeDoomscrollingAppName(input);
  return name ? protectedDesktopAppKeys().has(appRuleKey(name)) : false;
}

function normalizeHostRuleValue(value: unknown): DoomscrollingHostRule | null {
  if (typeof value === "string") {
    const host = normalizeDoomscrollingHost(value);
    return host ? { host, enabled: true } : null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.host !== "string") return null;
  const host = normalizeDoomscrollingHost(record.host);
  if (!host) return null;
  return {
    host,
    enabled: record.enabled !== false,
  };
}

function normalizeHostRules(value: unknown): DoomscrollingHostRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: DoomscrollingHostRule[] = [];
  for (const item of value) {
    const rule = normalizeHostRuleValue(item);
    if (!rule || seen.has(rule.host)) continue;
    seen.add(rule.host);
    rules.push(rule);
  }
  return rules;
}

function appRuleKey(name: string): string {
  return name.toLowerCase();
}

function normalizeAppRuleValue(value: unknown): DoomscrollingAppRule | null {
  if (typeof value === "string") {
    const name = normalizeDoomscrollingAppName(value);
    return name ? { name, enabled: true, matchNames: [name] } : null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") return null;
  const name = normalizeDoomscrollingAppName(record.name);
  if (!name) return null;
  const matchNames = normalizeAppRuleMatchNames(name, record.matchNames);
  return {
    name,
    enabled: record.enabled !== false,
    matchNames,
  };
}

function normalizeAppRuleMatchNames(name: string, value: unknown): string[] {
  const seen = new Set<string>();
  const matchNames: string[] = [];
  const candidates = Array.isArray(value) ? [name, ...value] : [name];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const matchName = normalizeDoomscrollingAppName(candidate);
    if (!matchName) continue;
    const key = appRuleKey(matchName);
    if (protectedDesktopAppKeys().has(key) || seen.has(key)) continue;
    seen.add(key);
    matchNames.push(matchName);
  }
  return matchNames.length > 0 ? matchNames : [name];
}

function normalizeAppRules(value: unknown, includeProtectedApps = false): DoomscrollingAppRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: DoomscrollingAppRule[] = [];
  for (const item of value) {
    const rule = normalizeAppRuleValue(item);
    if (!rule) continue;
    const key = appRuleKey(rule.name);
    if (!includeProtectedApps && protectedDesktopAppKeys().has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return rules;
}

function normalizeCategoryRuleValue(value: unknown): DoomscrollingCategoryRule | null {
  if (typeof value === "string" && isDoomscrollingCategoryId(value)) {
    return { id: value, enabled: true };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !isDoomscrollingCategoryId(record.id)) return null;
  return {
    id: record.id,
    enabled: record.enabled === true,
  };
}

function normalizeCategoryRules(value: unknown): DoomscrollingCategoryRule[] {
  const rules = defaultCategoryRules();
  if (!Array.isArray(value)) return rules;
  const byId = new Map<DoomscrollingCategoryId, DoomscrollingCategoryRule>(
    rules.map((rule) => [rule.id, rule]),
  );
  for (const item of value) {
    const rule = normalizeCategoryRuleValue(item);
    if (!rule) continue;
    byId.set(rule.id, rule);
  }
  return rules.map((rule) => byId.get(rule.id) ?? rule);
}

function normalizeCustomCategoryStackId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id)) return null;
  return id;
}

export function normalizeDoomscrollingCustomCategoryStackName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ").slice(0, 60);
  return name.length > 0 ? name : null;
}

function normalizeCustomCategoryStackValue(value: unknown): DoomscrollingCustomCategoryStack | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeCustomCategoryStackId(record.id);
  const name = typeof record.name === "string"
    ? normalizeDoomscrollingCustomCategoryStackName(record.name)
    : null;
  const hosts = normalizeHostRules(record.hosts);
  if (!id || !name || hosts.length === 0) return null;
  return {
    id,
    name,
    enabled: record.enabled !== false,
    hosts,
  };
}

function normalizeCustomCategoryStacks(value: unknown): DoomscrollingCustomCategoryStack[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const stacks: DoomscrollingCustomCategoryStack[] = [];
  for (const item of value) {
    const stack = normalizeCustomCategoryStackValue(item);
    if (!stack || seenIds.has(stack.id)) continue;
    seenIds.add(stack.id);
    stacks.push(stack);
  }
  return stacks;
}

function normalizeMode(value: unknown): DoomscrollingMode {
  return value === "whitelist" || value === "blacklist"
    ? value
    : DEFAULT_DOOMSCROLLING_CONFIG.mode;
}

function normalizeDesktopConfig(value: unknown): DoomscrollingDesktopConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaultDesktopConfig();
  }
  const record = value as Record<string, unknown>;
  const legacyBlockDuringBreaks = typeof record.blockDuringBreaks === "boolean"
    ? record.blockDuringBreaks
    : null;
  return {
    enabled: typeof record.enabled === "boolean"
      ? record.enabled
      : true,
    blockDuringFocus: typeof record.blockDuringFocus === "boolean"
      ? record.blockDuringFocus
      : true,
    blockDuringShortBreaks: typeof record.blockDuringShortBreaks === "boolean"
      ? record.blockDuringShortBreaks
      : legacyBlockDuringBreaks ?? true,
    blockDuringLongBreaks: typeof record.blockDuringLongBreaks === "boolean"
      ? record.blockDuringLongBreaks
      : legacyBlockDuringBreaks ?? true,
    blockedApps: normalizeAppRules(record.blockedApps),
  };
}

export function normalizeDoomscrollingConfig(value: unknown): DoomscrollingConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ...DEFAULT_DOOMSCROLLING_CONFIG,
      blockedCategories: defaultCategoryRules(),
      desktop: defaultDesktopConfig(),
    };
  }
  const record = value as Record<string, unknown>;
  const hasMode = record.mode === "blacklist" || record.mode === "whitelist";
  const hasExceptionHosts = Array.isArray(record.exceptionHosts);
  const legacyBlockDuringBreaks = typeof record.blockDuringBreaks === "boolean"
    ? record.blockDuringBreaks
    : null;
  const legacyAllowedHosts = normalizeHostRules(record.allowedHosts);
  return {
    mode: normalizeMode(record.mode),
    enabled: typeof record.enabled === "boolean"
      ? record.enabled
      : DEFAULT_DOOMSCROLLING_CONFIG.enabled,
    blockDuringFocus: typeof record.blockDuringFocus === "boolean"
      ? record.blockDuringFocus
      : DEFAULT_DOOMSCROLLING_CONFIG.blockDuringFocus,
    blockDuringShortBreaks: typeof record.blockDuringShortBreaks === "boolean"
      ? record.blockDuringShortBreaks
      : legacyBlockDuringBreaks ?? DEFAULT_DOOMSCROLLING_CONFIG.blockDuringShortBreaks,
    blockDuringLongBreaks: typeof record.blockDuringLongBreaks === "boolean"
      ? record.blockDuringLongBreaks
      : legacyBlockDuringBreaks ?? DEFAULT_DOOMSCROLLING_CONFIG.blockDuringLongBreaks,
    blockedCategories: normalizeCategoryRules(record.blockedCategories),
    customCategoryStacks: normalizeCustomCategoryStacks(record.customCategoryStacks),
    blockedHosts: normalizeHostRules(record.blockedHosts),
    exceptionHosts: hasExceptionHosts
      ? normalizeHostRules(record.exceptionHosts)
      : hasMode
        ? []
        : legacyAllowedHosts,
    allowedHosts: hasMode ? legacyAllowedHosts : [],
    desktop: normalizeDesktopConfig(record.desktop),
  };
}

export function doomscrollingHostMatchesRule(host: string, ruleHost: string): boolean {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

function categoryRuleMatchesHost(host: string, categoryId: DoomscrollingCategoryId): boolean {
  const category = getDoomscrollingCategoryDefinition(categoryId);
  return category?.hosts.some((ruleHost) => doomscrollingHostMatchesRule(host, ruleHost)) ?? false;
}

/**
 * Evaluate a URL against the current host-only doomscrolling rules.
 *
 * @param url - Browser URL to evaluate.
 * @param config - Doomscrolling configuration.
 * @returns A decision that explains the matching host rule.
 */
export function evaluateDoomscrollingUrl(
  url: string,
  config: DoomscrollingConfig,
): DoomscrollingDecision {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { blocked: false, host: null, matchedRule: null };
    }
    host = parsed.hostname.toLowerCase();
  } catch {
    return { blocked: false, host: null, matchedRule: null };
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) {
    return { blocked: false, host, matchedRule: "browser safety allowlist" };
  }

  if (config.mode === "whitelist") {
    for (const allowedRule of config.allowedHosts) {
      if (!allowedRule.enabled) continue;
      const allowedHost = allowedRule.host;
      if (doomscrollingHostMatchesRule(host, allowedHost)) {
        return { blocked: false, host, matchedRule: `whitelist: ${allowedHost}` };
      }
    }
    return { blocked: true, host, matchedRule: "not in whitelist" };
  }

  for (const exceptionRule of config.exceptionHosts) {
    if (!exceptionRule.enabled) continue;
    const exceptionHost = exceptionRule.host;
    if (doomscrollingHostMatchesRule(host, exceptionHost)) {
      return { blocked: false, host, matchedRule: `exception: ${exceptionHost}` };
    }
  }
  for (const blockedRule of config.blockedHosts) {
    if (!blockedRule.enabled) continue;
    const blockedHost = blockedRule.host;
    if (doomscrollingHostMatchesRule(host, blockedHost)) {
      return { blocked: true, host, matchedRule: `blocked host: ${blockedHost}` };
    }
  }
  for (const stack of config.customCategoryStacks) {
    if (!stack.enabled) continue;
    for (const stackRule of stack.hosts) {
      if (!stackRule.enabled) continue;
      if (doomscrollingHostMatchesRule(host, stackRule.host)) {
        return { blocked: true, host, matchedRule: `custom stack: ${stack.name}` };
      }
    }
  }
  for (const categoryRule of config.blockedCategories) {
    if (!categoryRule.enabled) continue;
    if (categoryRuleMatchesHost(host, categoryRule.id)) {
      const category = getDoomscrollingCategoryDefinition(categoryRule.id);
      return { blocked: true, host, matchedRule: `category: ${category?.label ?? categoryRule.id}` };
    }
  }
  return { blocked: false, host, matchedRule: null };
}

import rawDoomscrollingCategoryDefinitions from "./categories.json";

export type DoomscrollingMode = "blacklist" | "whitelist";

export const DOOMSCROLLING_CATEGORY_IDS = [
  "social-media",
  "streaming",
  "news",
  "sports",
  "porn",
  "gambling",
  "gaming",
  "shopping",
  "dating",
  "trading",
] as const;

export type DoomscrollingCategoryId = (typeof DOOMSCROLLING_CATEGORY_IDS)[number];

interface DoomscrollingCategoryDefinition {
  id: DoomscrollingCategoryId;
  label: string;
  hosts: readonly string[];
  domainKeywords?: readonly string[];
  redditSubredditKeywords?: readonly string[];
}

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

const DOOMSCROLLING_CATEGORY_ID_SET = new Set<string>(DOOMSCROLLING_CATEGORY_IDS);

function isKnownDoomscrollingCategoryId(value: string): value is DoomscrollingCategoryId {
  return DOOMSCROLLING_CATEGORY_ID_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCategoryStringList(
  value: unknown,
  categoryId: string,
  field: string,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Invalid doomscrolling category ${categoryId}.${field}`);
  }
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`Invalid doomscrolling category ${categoryId}.${field}`);
    }
    strings.push(item);
  }
  return strings;
}

function loadDoomscrollingCategoryDefinitions(value: unknown): readonly DoomscrollingCategoryDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error("Doomscrolling category definitions must be an array");
  }
  const definitions: DoomscrollingCategoryDefinition[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error("Doomscrolling category definitions must contain objects");
    }
    const id = item.id;
    const label = item.label;
    if (typeof id !== "string" || !isKnownDoomscrollingCategoryId(id)) {
      throw new Error("Doomscrolling category definition has an unsupported id");
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate doomscrolling category id: ${id}`);
    }
    if (typeof label !== "string" || label.trim() === "") {
      throw new Error(`Doomscrolling category ${id} has an invalid label`);
    }
    seenIds.add(id);
    definitions.push({
      id,
      label,
      hosts: parseCategoryStringList(item.hosts, id, "hosts"),
      domainKeywords: parseCategoryStringList(item.domainKeywords, id, "domainKeywords"),
      redditSubredditKeywords: parseCategoryStringList(
        item.redditSubredditKeywords,
        id,
        "redditSubredditKeywords",
      ),
    });
  }
  for (const id of DOOMSCROLLING_CATEGORY_IDS) {
    if (!seenIds.has(id)) {
      throw new Error(`Missing doomscrolling category id: ${id}`);
    }
  }
  return definitions;
}

export const DOOMSCROLLING_CATEGORY_DEFINITIONS = loadDoomscrollingCategoryDefinitions(
  rawDoomscrollingCategoryDefinitions,
);

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

export interface DoomscrollingLimitEntry {
  id: string;
  name: string | null;
  websiteHost: string | null;
  mobileAppName: string | null;
  desktopAppName: string | null;
}

export interface DoomscrollingUsageLimit {
  id: string;
  name: string;
  enabled: boolean;
  minutesPerDay: number;
  entries: DoomscrollingLimitEntry[];
}

export interface DoomscrollingUsageLimitsConfig {
  enabled: boolean;
  items: DoomscrollingUsageLimit[];
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
  limits: DoomscrollingUsageLimitsConfig;
}

export interface DoomscrollingDecision {
  blocked: boolean;
  host: string | null;
  matchedRule: string | null;
}

export interface DoomscrollingUsageSample {
  sourceType: "website" | "desktop-app" | "mobile-app";
  sourceKey: string;
  displayName: string | null;
  elapsedSeconds: number;
  startedAt: number;
  localDate: string;
}

export interface DoomscrollingDailyLimitTotal {
  limitId: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  exhausted: boolean;
}

export interface DoomscrollingLimitDecision {
  blocked: boolean;
  host: string | null;
  limitId: string | null;
  limitName: string | null;
  matchedRule: string | null;
}

const MAX_DAILY_LIMIT_MINUTES = 24 * 60;

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

function defaultUsageLimitsConfig(): DoomscrollingUsageLimitsConfig {
  return {
    enabled: true,
    items: [],
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
  limits: defaultUsageLimitsConfig(),
});

export function isDoomscrollingCategoryId(value: string): value is DoomscrollingCategoryId {
  return isKnownDoomscrollingCategoryId(value);
}

export function getDoomscrollingCategoryDefinition(
  id: DoomscrollingCategoryId,
): DoomscrollingCategoryDefinition | undefined {
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

function normalizeUsageLimitId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id)) return null;
  return id;
}

export function normalizeDoomscrollingUsageLimitName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ").slice(0, 80);
  return name.length > 0 ? name : null;
}

export function normalizeDoomscrollingLimitEntryName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ").slice(0, 80);
  return name.length > 0 ? name : null;
}

function normalizeLimitMinutes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const minutes = Math.trunc(value);
  if (minutes < 1 || minutes > MAX_DAILY_LIMIT_MINUTES) return null;
  return minutes;
}

function normalizeLimitEntryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id)) return null;
  return id;
}

function normalizeLimitEntryValue(value: unknown): DoomscrollingLimitEntry | null {
  if (!isRecord(value)) return null;
  const id = normalizeLimitEntryId(value.id);
  if (!id) return null;
  const name = typeof value.name === "string"
    ? normalizeDoomscrollingLimitEntryName(value.name)
    : null;
  const websiteHost = typeof value.websiteHost === "string"
    ? normalizeDoomscrollingHost(value.websiteHost)
    : null;
  const mobileAppName = typeof value.mobileAppName === "string"
    ? normalizeDoomscrollingAppName(value.mobileAppName)
    : null;
  const desktopAppName = typeof value.desktopAppName === "string"
    ? normalizeDoomscrollingAppName(value.desktopAppName)
    : null;
  if (!websiteHost && !mobileAppName && !desktopAppName) return null;
  if (desktopAppName && isProtectedDoomscrollingDesktopAppName(desktopAppName)) return null;
  return {
    id,
    name,
    websiteHost,
    mobileAppName,
    desktopAppName,
  };
}

export function doomscrollingLimitEntryKey(entry: DoomscrollingLimitEntry): string {
  return entry.id;
}

export function doomscrollingLimitEntrySourceKeys(entry: DoomscrollingLimitEntry): string[] {
  const keys: string[] = [];
  if (entry.websiteHost) keys.push(`website:${entry.websiteHost}`);
  if (entry.mobileAppName) keys.push(`mobile-app:${entry.mobileAppName.toLowerCase()}`);
  if (entry.desktopAppName) keys.push(`desktop-app:${appRuleKey(entry.desktopAppName)}`);
  return keys;
}

function normalizeLimitEntries(value: unknown): DoomscrollingLimitEntry[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const entries: DoomscrollingLimitEntry[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    const entry = normalizeLimitEntryValue(item);
    if (!entry || seenIds.has(entry.id)) return null;
    seenIds.add(entry.id);
    for (const key of doomscrollingLimitEntrySourceKeys(entry)) {
      if (seen.has(key)) return null;
      seen.add(key);
    }
    entries.push(entry);
  }
  return entries.length > 0 ? entries : null;
}

function normalizeUsageLimitValue(value: unknown): DoomscrollingUsageLimit | null {
  if (!isRecord(value)) return null;
  const id = normalizeUsageLimitId(value.id);
  const name = typeof value.name === "string"
    ? normalizeDoomscrollingUsageLimitName(value.name)
    : null;
  const minutesPerDay = normalizeLimitMinutes(value.minutesPerDay);
  const entries = normalizeLimitEntries(value.entries);
  if (!id || !name || minutesPerDay === null || !entries) return null;
  return {
    id,
    name,
    enabled: value.enabled !== false,
    minutesPerDay,
    entries,
  };
}

function normalizeUsageLimitsConfig(value: unknown): DoomscrollingUsageLimitsConfig {
  if (!isRecord(value)) return defaultUsageLimitsConfig();
  const itemsValue = value.items;
  const items: DoomscrollingUsageLimit[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(itemsValue)) {
    for (const item of itemsValue) {
      const limit = normalizeUsageLimitValue(item);
      if (!limit || seenIds.has(limit.id)) continue;
      seenIds.add(limit.id);
      items.push(limit);
    }
  }
  return {
    enabled: value.enabled !== false,
    items,
  };
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
      limits: defaultUsageLimitsConfig(),
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
    limits: normalizeUsageLimitsConfig(record.limits),
  };
}

export function doomscrollingHostMatchesRule(host: string, ruleHost: string): boolean {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

function redditSubredditFromUrl(parsedUrl: URL): string | null {
  if (!doomscrollingHostMatchesRule(parsedUrl.hostname.toLowerCase(), "reddit.com")) return null;
  const match = /^\/r\/([^/]+)/i.exec(parsedUrl.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

function categoryRuleMatchesUrl(
  parsedUrl: URL,
  host: string,
  categoryId: DoomscrollingCategoryId,
): boolean {
  const category = getDoomscrollingCategoryDefinition(categoryId);
  if (!category) return false;
  if (category.hosts.some((ruleHost) => doomscrollingHostMatchesRule(host, ruleHost))) {
    return true;
  }
  if (category.domainKeywords?.some((keyword) => host.includes(keyword))) {
    return true;
  }
  const subreddit = redditSubredditFromUrl(parsedUrl);
  return subreddit !== null
    && (category.redditSubredditKeywords?.some((keyword) => subreddit.includes(keyword)) ?? false);
}

function normalizedUsageSourceKey(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesDoomscrollingLimitEntry(
  entry: DoomscrollingLimitEntry,
  sample: DoomscrollingUsageSample,
): boolean {
  if (sample.sourceType === "website" && entry.websiteHost) {
    return doomscrollingHostMatchesRule(
      normalizedUsageSourceKey(sample.sourceKey),
      entry.websiteHost,
    );
  }
  if (sample.sourceType === "desktop-app" && entry.desktopAppName) {
    return appRuleKey(sample.sourceKey) === appRuleKey(entry.desktopAppName);
  }
  if (sample.sourceType === "mobile-app" && entry.mobileAppName) {
    return sample.sourceKey.toLowerCase() === entry.mobileAppName.toLowerCase();
  }
  return false;
}

export function computeDoomscrollingLimitDailyTotals(
  config: DoomscrollingConfig,
  samples: readonly DoomscrollingUsageSample[],
  localDate: string,
): DoomscrollingDailyLimitTotal[] {
  return config.limits.items.map((limit) => {
    let usedSeconds = 0;
    for (const sample of samples) {
      if (sample.localDate !== localDate) continue;
      if (!Number.isFinite(sample.elapsedSeconds) || sample.elapsedSeconds <= 0) continue;
      const matches = limit.entries.some((entry) =>
        matchesDoomscrollingLimitEntry(entry, sample)
      );
      if (matches) usedSeconds += Math.round(sample.elapsedSeconds);
    }
    const limitSeconds = limit.minutesPerDay * 60;
    const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);
    return {
      limitId: limit.id,
      usedSeconds,
      limitSeconds,
      remainingSeconds,
      exhausted: usedSeconds >= limitSeconds,
    };
  });
}

function totalForLimit(
  totals: readonly DoomscrollingDailyLimitTotal[],
  limitId: string,
): DoomscrollingDailyLimitTotal | null {
  return totals.find((total) => total.limitId === limitId) ?? null;
}

export function isSupportedDoomscrollingUsageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function doomscrollingWebsiteUsageSampleFromUrl(
  url: string,
  elapsedSeconds: number,
  startedAt: number,
  localDate: string,
): DoomscrollingUsageSample | null {
  if (!isSupportedDoomscrollingUsageUrl(url)) return null;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return {
    sourceType: "website",
    sourceKey: parsed.hostname.toLowerCase(),
    displayName: parsed.hostname.toLowerCase(),
    elapsedSeconds: Math.round(elapsedSeconds),
    startedAt,
    localDate,
  };
}

export function evaluateDoomscrollingWebsiteLimit(
  url: string,
  config: DoomscrollingConfig,
  totals: readonly DoomscrollingDailyLimitTotal[],
): DoomscrollingLimitDecision {
  let parsed: URL;
  let host: string;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { blocked: false, host: null, limitId: null, limitName: null, matchedRule: null };
    }
    host = parsed.hostname.toLowerCase();
  } catch {
    return { blocked: false, host: null, limitId: null, limitName: null, matchedRule: null };
  }

  if (!config.limits.enabled || isSafetyAllowedHost(host)) {
    return { blocked: false, host, limitId: null, limitName: null, matchedRule: null };
  }

  for (const limit of config.limits.items) {
    if (!limit.enabled) continue;
    const total = totalForLimit(totals, limit.id);
    if (!total?.exhausted) continue;
    if (limit.entries.some((entry) =>
      entry.websiteHost !== null && doomscrollingHostMatchesRule(host, entry.websiteHost)
    )) {
      return {
        blocked: true,
        host,
        limitId: limit.id,
        limitName: limit.name,
        matchedRule: `daily limit: ${limit.name}`,
      };
    }
  }

  return { blocked: false, host, limitId: null, limitName: null, matchedRule: null };
}

function isSafetyAllowedHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
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
  let parsed: URL;
  let host: string;
  try {
    parsed = new URL(url);
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
    if (categoryRuleMatchesUrl(parsed, host, categoryRule.id)) {
      const category = getDoomscrollingCategoryDefinition(categoryRule.id);
      return { blocked: true, host, matchedRule: `category: ${category?.label ?? categoryRule.id}` };
    }
  }
  return { blocked: false, host, matchedRule: null };
}

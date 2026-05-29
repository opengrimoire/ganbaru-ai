import {
  DEFAULT_DOOMSCROLLING_CONFIG,
  isProtectedDoomscrollingDesktopAppName,
  doomscrollingLimitEntrySourceKeys,
  normalizeDoomscrollingAppName,
  normalizeDoomscrollingConfig,
  normalizeDoomscrollingCustomCategoryStackName,
  normalizeDoomscrollingLimitEntryName,
  normalizeDoomscrollingUsageLimitName,
  normalizeDoomscrollingHost,
  parseDoomscrollingHosts,
  type DoomscrollingAppRule,
  type DoomscrollingCategoryId,
  type DoomscrollingCategoryRule,
  type DoomscrollingConfig,
  type DoomscrollingCustomCategoryStack,
  type DoomscrollingDesktopConfig,
  type DoomscrollingHostRule,
  type DoomscrollingLimitEntry,
  type DoomscrollingMode,
  type DoomscrollingUsageLimit,
} from "$lib/doomscrolling";
import { getConfigKey, setConfigKey } from "$lib/vault/config";

const CONFIG_KEY = "doomscrolling";

export type AddDoomscrollingCustomCategoryStackResult =
  | "added"
  | "invalid-name"
  | "invalid-hosts"
  | "duplicate-name";

export type UpdateDoomscrollingCustomCategoryStackResult =
  | "updated"
  | "missing"
  | "invalid-name"
  | "invalid-hosts"
  | "duplicate-name";

export type SaveDoomscrollingUsageLimitResult =
  | "saved"
  | "missing"
  | "invalid-name"
  | "invalid-minutes"
  | "invalid-sources"
  | "duplicate-source"
  | "protected-source";

export interface DoomscrollingUsageLimitDraft {
  name: string;
  minutesPerDay: number;
  entries: readonly DoomscrollingUsageLimitEntryDraft[];
}

export interface DoomscrollingUsageLimitEntryDraft {
  id: string;
  name: string;
  websiteHost: string;
  mobileAppName: string;
  desktopAppName: string;
}

function loadSavedConfig(): DoomscrollingConfig {
  const saved = getConfigKey<unknown>(CONFIG_KEY, undefined);
  return normalizeDoomscrollingConfig(saved);
}

let config = $state<DoomscrollingConfig>(loadSavedConfig());

function persist(next: DoomscrollingConfig): void {
  config = next;
  setConfigKey(CONFIG_KEY, next);
}

function update(partial: Partial<DoomscrollingConfig>): void {
  persist({ ...config, ...partial });
}

function updateDesktop(partial: Partial<DoomscrollingDesktopConfig>): void {
  update({ desktop: { ...config.desktop, ...partial } });
}

function updateLimits(partial: Partial<DoomscrollingConfig["limits"]>): void {
  update({ limits: { ...config.limits, ...partial } });
}

function mergeHosts(
  existingHosts: readonly DoomscrollingHostRule[],
  input: string,
): DoomscrollingHostRule[] | null {
  const hosts = parseDoomscrollingHosts(input);
  if (hosts.length === 0) return null;
  const seen = new Set(existingHosts.map((rule) => rule.host));
  const merged = [...existingHosts];
  for (const host of hosts) {
    if (seen.has(host)) continue;
    seen.add(host);
    merged.push({ host, enabled: true });
  }
  return merged;
}

function removeHost(
  existingHosts: readonly DoomscrollingHostRule[],
  host: string,
): DoomscrollingHostRule[] {
  return existingHosts.filter((rule) => rule.host !== host);
}

function setHostEnabled(
  existingHosts: readonly DoomscrollingHostRule[],
  host: string,
  enabled: boolean,
): DoomscrollingHostRule[] {
  return existingHosts.map((rule) => rule.host === host ? { ...rule, enabled } : rule);
}

function appRuleKey(name: string): string {
  return name.toLowerCase();
}

interface DoomscrollingAppRuleInput {
  name: string;
  matchNames?: readonly string[];
}

function appRuleInput(
  input: string | DoomscrollingAppRuleInput,
): DoomscrollingAppRule | null {
  const name = normalizeDoomscrollingAppName(typeof input === "string" ? input : input.name);
  if (!name || isProtectedDoomscrollingDesktopAppName(name)) return null;
  const seen = new Set<string>();
  const matchNames: string[] = [];
  const rawMatchNames = typeof input === "string" ? [name] : [name, ...(input.matchNames ?? [])];
  for (const rawMatchName of rawMatchNames) {
    const matchName = normalizeDoomscrollingAppName(rawMatchName);
    if (!matchName || isProtectedDoomscrollingDesktopAppName(matchName)) continue;
    const key = appRuleKey(matchName);
    if (seen.has(key)) continue;
    seen.add(key);
    matchNames.push(matchName);
  }
  return {
    name,
    enabled: true,
    matchNames: matchNames.length > 0 ? matchNames : [name],
  };
}

function mergeApps(
  existingApps: readonly DoomscrollingAppRule[],
  input: string | DoomscrollingAppRuleInput,
): DoomscrollingAppRule[] | null {
  const rule = appRuleInput(input);
  if (!rule) return null;
  const key = appRuleKey(rule.name);
  if (existingApps.some((rule) => appRuleKey(rule.name) === key)) return existingApps.slice();
  return [...existingApps, rule];
}

function removeApp(
  existingApps: readonly DoomscrollingAppRule[],
  name: string,
): DoomscrollingAppRule[] {
  const key = appRuleKey(name);
  return existingApps.filter((rule) => appRuleKey(rule.name) !== key);
}

function setAppEnabled(
  existingApps: readonly DoomscrollingAppRule[],
  name: string,
  enabled: boolean,
): DoomscrollingAppRule[] {
  if (isProtectedDoomscrollingDesktopAppName(name)) return existingApps.slice();
  const key = appRuleKey(name);
  return existingApps.map((rule) => appRuleKey(rule.name) === key ? { ...rule, enabled } : rule);
}

function setCategoryEnabled(
  categories: readonly DoomscrollingCategoryRule[],
  id: DoomscrollingCategoryId,
  enabled: boolean,
): DoomscrollingCategoryRule[] {
  return categories.map((rule) => rule.id === id ? { ...rule, enabled } : rule);
}

function slugifyCustomCategoryStackName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom-stack";
}

function createCustomCategoryStackId(name: string): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${slugifyCustomCategoryStackName(name).slice(0, 48)}-${suffix}`;
}

function setCustomCategoryStackEnabled(
  stacks: readonly DoomscrollingCustomCategoryStack[],
  id: string,
  enabled: boolean,
): DoomscrollingCustomCategoryStack[] {
  return stacks.map((stack) => stack.id === id ? { ...stack, enabled } : stack);
}

function removeCustomCategoryStack(
  stacks: readonly DoomscrollingCustomCategoryStack[],
  id: string,
): DoomscrollingCustomCategoryStack[] {
  return stacks.filter((stack) => stack.id !== id);
}

function duplicateCustomCategoryStackName(name: string, currentId: string | null): boolean {
  const normalizedName = name.toLowerCase();
  return config.customCategoryStacks.some((stack) => (
    stack.id !== currentId && stack.name.toLowerCase() === normalizedName
  ));
}

function createUsageLimitId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "limit";
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${base}-${suffix}`;
}

function normalizeUsageLimitEntryId(value: string): string | null {
  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id)) return null;
  return id;
}

function websiteDisplayName(host: string): string {
  const firstLabel = host.replace(/^www\./, "").split(".", 1)[0] ?? host;
  if (!firstLabel) return host;
  return `${firstLabel.charAt(0).toUpperCase()}${firstLabel.slice(1)}`;
}

function derivedEntryName(entry: DoomscrollingLimitEntry): string {
  return entry.name
    ?? entry.mobileAppName
    ?? entry.desktopAppName
    ?? (entry.websiteHost ? websiteDisplayName(entry.websiteHost) : "Daily limit");
}

function normalizeLimitDraftEntry(
  draft: DoomscrollingUsageLimitEntryDraft,
): DoomscrollingLimitEntry | "invalid-sources" | "protected-source" {
  const id = normalizeUsageLimitEntryId(draft.id);
  if (!id) return "invalid-sources";
  const name = normalizeDoomscrollingLimitEntryName(draft.name);
  const websiteHost = draft.websiteHost.trim()
    ? normalizeDoomscrollingHost(draft.websiteHost)
    : null;
  const mobileAppName = draft.mobileAppName.trim()
    ? normalizeDoomscrollingAppName(draft.mobileAppName)
    : null;
  const desktopAppName = draft.desktopAppName.trim()
    ? normalizeDoomscrollingAppName(draft.desktopAppName)
    : null;
  if (!websiteHost && !mobileAppName && !desktopAppName) return "invalid-sources";
  if (desktopAppName && isProtectedDoomscrollingDesktopAppName(desktopAppName)) {
    return "protected-source";
  }
  return {
    id,
    name,
    websiteHost,
    mobileAppName,
    desktopAppName,
  };
}

function normalizeLimitDraft(
  draft: DoomscrollingUsageLimitDraft,
): SaveDoomscrollingUsageLimitResult | Omit<DoomscrollingUsageLimit, "id" | "enabled"> {
  if (!Number.isFinite(draft.minutesPerDay)) return "invalid-minutes";
  const minutesPerDay = Math.trunc(draft.minutesPerDay);
  if (minutesPerDay < 1 || minutesPerDay > 24 * 60) return "invalid-minutes";
  if (draft.entries.length === 0) return "invalid-sources";
  const seenSources = new Set<string>();
  const seenEntryIds = new Set<string>();
  const entries: DoomscrollingLimitEntry[] = [];
  for (const draftEntry of draft.entries) {
    const entry = normalizeLimitDraftEntry(draftEntry);
    if (entry === "invalid-sources" || entry === "protected-source") return entry;
    if (seenEntryIds.has(entry.id)) return "duplicate-source";
    seenEntryIds.add(entry.id);
    for (const key of doomscrollingLimitEntrySourceKeys(entry)) {
      if (seenSources.has(key)) return "duplicate-source";
      seenSources.add(key);
    }
    entries.push(entry);
  }
  const firstEntry = entries[0];
  if (!firstEntry) return "invalid-sources";
  const name = normalizeDoomscrollingUsageLimitName(draft.name) ?? derivedEntryName(firstEntry);
  if (!name) return "invalid-name";
  return {
    name,
    minutesPerDay,
    entries,
  };
}

export function getDoomscrolling() {
  return {
    get enabled(): boolean {
      return config.enabled;
    },
    get mode(): DoomscrollingMode {
      return config.mode;
    },
    get blockDuringFocus(): boolean {
      return config.blockDuringFocus;
    },
    get blockDuringShortBreaks(): boolean {
      return config.blockDuringShortBreaks;
    },
    get blockDuringLongBreaks(): boolean {
      return config.blockDuringLongBreaks;
    },
    get blockedCategories(): readonly DoomscrollingCategoryRule[] {
      return config.blockedCategories;
    },
    get customCategoryStacks(): readonly DoomscrollingCustomCategoryStack[] {
      return config.customCategoryStacks;
    },
    get blockedHosts(): readonly DoomscrollingHostRule[] {
      return config.blockedHosts;
    },
    get exceptionHosts(): readonly DoomscrollingHostRule[] {
      return config.exceptionHosts;
    },
    get allowedHosts(): readonly DoomscrollingHostRule[] {
      return config.allowedHosts;
    },
    get desktopEnabled(): boolean {
      return config.desktop.enabled;
    },
    get desktopBlockDuringFocus(): boolean {
      return config.desktop.blockDuringFocus;
    },
    get desktopBlockDuringShortBreaks(): boolean {
      return config.desktop.blockDuringShortBreaks;
    },
    get desktopBlockDuringLongBreaks(): boolean {
      return config.desktop.blockDuringLongBreaks;
    },
    get blockedApps(): readonly DoomscrollingAppRule[] {
      return config.desktop.blockedApps;
    },
    get limitsEnabled(): boolean {
      return config.limits.enabled;
    },
    get usageLimits(): readonly DoomscrollingUsageLimit[] {
      return config.limits.items;
    },
    get config(): DoomscrollingConfig {
      return config;
    },
    setMode(mode: DoomscrollingMode): void {
      update({ mode });
    },
    setEnabled(enabled: boolean): void {
      update({ enabled });
    },
    setBlockDuringFocus(blockDuringFocus: boolean): void {
      update({ blockDuringFocus });
    },
    setBlockDuringShortBreaks(blockDuringShortBreaks: boolean): void {
      update({ blockDuringShortBreaks });
    },
    setBlockDuringLongBreaks(blockDuringLongBreaks: boolean): void {
      update({ blockDuringLongBreaks });
    },
    setDesktopEnabled(enabled: boolean): void {
      updateDesktop({ enabled });
    },
    setDesktopBlockDuringFocus(blockDuringFocus: boolean): void {
      updateDesktop({ blockDuringFocus });
    },
    setDesktopBlockDuringShortBreaks(blockDuringShortBreaks: boolean): void {
      updateDesktop({ blockDuringShortBreaks });
    },
    setDesktopBlockDuringLongBreaks(blockDuringLongBreaks: boolean): void {
      updateDesktop({ blockDuringLongBreaks });
    },
    setLimitsEnabled(enabled: boolean): void {
      updateLimits({ enabled });
    },
    setBlockedCategoryEnabled(id: DoomscrollingCategoryId, enabled: boolean): void {
      update({ blockedCategories: setCategoryEnabled(config.blockedCategories, id, enabled) });
    },
    addCustomCategoryStack(
      nameInput: string,
      hostsInput: string,
    ): AddDoomscrollingCustomCategoryStackResult {
      const name = normalizeDoomscrollingCustomCategoryStackName(nameInput);
      if (!name) return "invalid-name";
      const hosts = parseDoomscrollingHosts(hostsInput).map((host) => ({ host, enabled: true }));
      if (hosts.length === 0) return "invalid-hosts";
      if (duplicateCustomCategoryStackName(name, null)) return "duplicate-name";
      const existingIds = new Set(config.customCategoryStacks.map((stack) => stack.id));
      let id = createCustomCategoryStackId(name);
      while (existingIds.has(id)) {
        id = createCustomCategoryStackId(name);
      }
      update({
        customCategoryStacks: [
          ...config.customCategoryStacks,
          {
            id,
            name,
            enabled: true,
            hosts,
          },
        ],
      });
      return "added";
    },
    updateCustomCategoryStack(
      id: string,
      nameInput: string,
      hostsInput: string,
    ): UpdateDoomscrollingCustomCategoryStackResult {
      const name = normalizeDoomscrollingCustomCategoryStackName(nameInput);
      if (!name) return "invalid-name";
      const hosts = parseDoomscrollingHosts(hostsInput).map((host) => ({ host, enabled: true }));
      if (hosts.length === 0) return "invalid-hosts";
      if (duplicateCustomCategoryStackName(name, id)) return "duplicate-name";
      let found = false;
      const customCategoryStacks = config.customCategoryStacks.map((stack) => {
        if (stack.id !== id) return stack;
        found = true;
        return {
          ...stack,
          name,
          hosts,
        };
      });
      if (!found) return "missing";
      update({ customCategoryStacks });
      return "updated";
    },
    removeCustomCategoryStack(id: string): void {
      update({ customCategoryStacks: removeCustomCategoryStack(config.customCategoryStacks, id) });
    },
    setCustomCategoryStackEnabled(id: string, enabled: boolean): void {
      update({
        customCategoryStacks: setCustomCategoryStackEnabled(config.customCategoryStacks, id, enabled),
      });
    },
    addBlockedHostsText(text: string): boolean {
      const merged = mergeHosts(config.blockedHosts, text);
      if (!merged) return false;
      update({ blockedHosts: merged });
      return true;
    },
    addExceptionHostsText(text: string): boolean {
      const merged = mergeHosts(config.exceptionHosts, text);
      if (!merged) return false;
      update({ exceptionHosts: merged });
      return true;
    },
    addAllowedHostsText(text: string): boolean {
      const merged = mergeHosts(config.allowedHosts, text);
      if (!merged) return false;
      update({ allowedHosts: merged });
      return true;
    },
    addBlockedAppsText(text: string): boolean {
      const merged = mergeApps(config.desktop.blockedApps, text);
      if (!merged) return false;
      updateDesktop({ blockedApps: merged });
      return true;
    },
    addBlockedApp(name: string, matchNames: readonly string[]): boolean {
      const merged = mergeApps(config.desktop.blockedApps, { name, matchNames });
      if (!merged) return false;
      updateDesktop({ blockedApps: merged });
      return true;
    },
    removeBlockedHost(host: string): void {
      update({ blockedHosts: removeHost(config.blockedHosts, host) });
    },
    removeExceptionHost(host: string): void {
      update({ exceptionHosts: removeHost(config.exceptionHosts, host) });
    },
    removeAllowedHost(host: string): void {
      update({ allowedHosts: removeHost(config.allowedHosts, host) });
    },
    removeBlockedApp(name: string): void {
      updateDesktop({ blockedApps: removeApp(config.desktop.blockedApps, name) });
    },
    setBlockedHostEnabled(host: string, enabled: boolean): void {
      update({ blockedHosts: setHostEnabled(config.blockedHosts, host, enabled) });
    },
    setExceptionHostEnabled(host: string, enabled: boolean): void {
      update({ exceptionHosts: setHostEnabled(config.exceptionHosts, host, enabled) });
    },
    setAllowedHostEnabled(host: string, enabled: boolean): void {
      update({ allowedHosts: setHostEnabled(config.allowedHosts, host, enabled) });
    },
    setBlockedAppEnabled(name: string, enabled: boolean): void {
      updateDesktop({ blockedApps: setAppEnabled(config.desktop.blockedApps, name, enabled) });
    },
    addUsageLimit(draft: DoomscrollingUsageLimitDraft): SaveDoomscrollingUsageLimitResult {
      const normalized = normalizeLimitDraft(draft);
      if (typeof normalized === "string") return normalized;
      const existingIds = new Set(config.limits.items.map((limit) => limit.id));
      let id = createUsageLimitId(normalized.name);
      while (existingIds.has(id)) {
        id = createUsageLimitId(normalized.name);
      }
      updateLimits({
        items: [
          ...config.limits.items,
          {
            id,
            enabled: true,
            ...normalized,
          },
        ],
      });
      return "saved";
    },
    updateUsageLimit(id: string, draft: DoomscrollingUsageLimitDraft): SaveDoomscrollingUsageLimitResult {
      const normalized = normalizeLimitDraft(draft);
      if (typeof normalized === "string") return normalized;
      let found = false;
      const items = config.limits.items.map((limit) => {
        if (limit.id !== id) return limit;
        found = true;
        return {
          ...limit,
          ...normalized,
        };
      });
      if (!found) return "missing";
      updateLimits({ items });
      return "saved";
    },
    removeUsageLimit(id: string): void {
      updateLimits({ items: config.limits.items.filter((limit) => limit.id !== id) });
    },
    setUsageLimitEnabled(id: string, enabled: boolean): void {
      updateLimits({
        items: config.limits.items.map((limit) =>
          limit.id === id ? { ...limit, enabled } : limit
        ),
      });
    },
    reset(): void {
      persist({ ...DEFAULT_DOOMSCROLLING_CONFIG });
    },
  };
}

import {
  DEFAULT_DOOMSCROLLING_CONFIG,
  normalizeDoomscrollingConfig,
  parseDoomscrollingHosts,
  type DoomscrollingConfig,
  type DoomscrollingHostRule,
  type DoomscrollingMode,
} from "$lib/doomscrolling";
import { getConfigKey, setConfigKey } from "$lib/vault/config";

const CONFIG_KEY = "doomscrolling";

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

export function getDoomscrolling() {
  return {
    get enabled(): boolean {
      return config.enabled;
    },
    get mode(): DoomscrollingMode {
      return config.mode;
    },
    get blockDuringShortBreaks(): boolean {
      return config.blockDuringShortBreaks;
    },
    get blockDuringLongBreaks(): boolean {
      return config.blockDuringLongBreaks;
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
    setMode(mode: DoomscrollingMode): void {
      update({ mode });
    },
    setEnabled(enabled: boolean): void {
      update({ enabled });
    },
    setBlockDuringShortBreaks(blockDuringShortBreaks: boolean): void {
      update({ blockDuringShortBreaks });
    },
    setBlockDuringLongBreaks(blockDuringLongBreaks: boolean): void {
      update({ blockDuringLongBreaks });
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
    removeBlockedHost(host: string): void {
      update({ blockedHosts: removeHost(config.blockedHosts, host) });
    },
    removeExceptionHost(host: string): void {
      update({ exceptionHosts: removeHost(config.exceptionHosts, host) });
    },
    removeAllowedHost(host: string): void {
      update({ allowedHosts: removeHost(config.allowedHosts, host) });
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
    reset(): void {
      persist({ ...DEFAULT_DOOMSCROLLING_CONFIG });
    },
  };
}

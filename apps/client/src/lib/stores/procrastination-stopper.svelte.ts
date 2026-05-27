import {
  DEFAULT_PROCRASTINATION_STOPPER_CONFIG,
  normalizeProcrastinationStopperConfig,
  parseStopperHosts,
  type ProcrastinationStopperConfig,
  type ProcrastinationStopperHostRule,
  type ProcrastinationStopperMode,
} from "$lib/procrastination-stopper";
import { getConfigKey, setConfigKey } from "$lib/vault/config";

const CONFIG_KEY = "procrastinationStopper";

function loadSavedConfig(): ProcrastinationStopperConfig {
  const saved = getConfigKey<unknown>(CONFIG_KEY, undefined);
  return normalizeProcrastinationStopperConfig(saved);
}

let config = $state<ProcrastinationStopperConfig>(loadSavedConfig());

function persist(next: ProcrastinationStopperConfig): void {
  config = next;
  setConfigKey(CONFIG_KEY, next);
}

function update(partial: Partial<ProcrastinationStopperConfig>): void {
  persist({ ...config, ...partial });
}

function mergeHosts(
  existingHosts: readonly ProcrastinationStopperHostRule[],
  input: string,
): ProcrastinationStopperHostRule[] | null {
  const hosts = parseStopperHosts(input);
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
  existingHosts: readonly ProcrastinationStopperHostRule[],
  host: string,
): ProcrastinationStopperHostRule[] {
  return existingHosts.filter((rule) => rule.host !== host);
}

function setHostEnabled(
  existingHosts: readonly ProcrastinationStopperHostRule[],
  host: string,
  enabled: boolean,
): ProcrastinationStopperHostRule[] {
  return existingHosts.map((rule) => rule.host === host ? { ...rule, enabled } : rule);
}

export function getProcrastinationStopper() {
  return {
    get enabled(): boolean {
      return config.enabled;
    },
    get mode(): ProcrastinationStopperMode {
      return config.mode;
    },
    get blockDuringShortBreaks(): boolean {
      return config.blockDuringShortBreaks;
    },
    get blockDuringLongBreaks(): boolean {
      return config.blockDuringLongBreaks;
    },
    get blockedHosts(): readonly ProcrastinationStopperHostRule[] {
      return config.blockedHosts;
    },
    get exceptionHosts(): readonly ProcrastinationStopperHostRule[] {
      return config.exceptionHosts;
    },
    get allowedHosts(): readonly ProcrastinationStopperHostRule[] {
      return config.allowedHosts;
    },
    setMode(mode: ProcrastinationStopperMode): void {
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
      persist({ ...DEFAULT_PROCRASTINATION_STOPPER_CONFIG });
    },
  };
}

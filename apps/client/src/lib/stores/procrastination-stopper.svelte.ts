import {
  DEFAULT_PROCRASTINATION_STOPPER_CONFIG,
  normalizeProcrastinationStopperConfig,
  parseStopperHosts,
  type ProcrastinationStopperConfig,
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

function mergeHosts(existingHosts: readonly string[], input: string): string[] | null {
  const hosts = parseStopperHosts(input);
  if (hosts.length === 0) return null;
  const seen = new Set(existingHosts);
  const merged = [...existingHosts];
  for (const host of hosts) {
    if (seen.has(host)) continue;
    seen.add(host);
    merged.push(host);
  }
  return merged;
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
    get blockedHosts(): readonly string[] {
      return config.blockedHosts;
    },
    get exceptionHosts(): readonly string[] {
      return config.exceptionHosts;
    },
    get allowedHosts(): readonly string[] {
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
      update({ blockedHosts: config.blockedHosts.filter((item) => item !== host) });
    },
    removeExceptionHost(host: string): void {
      update({ exceptionHosts: config.exceptionHosts.filter((item) => item !== host) });
    },
    removeAllowedHost(host: string): void {
      update({ allowedHosts: config.allowedHosts.filter((item) => item !== host) });
    },
    reset(): void {
      persist({ ...DEFAULT_PROCRASTINATION_STOPPER_CONFIG });
    },
  };
}

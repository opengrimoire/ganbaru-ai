import {
  DEFAULT_PROCRASTINATION_STOPPER_CONFIG,
  normalizeProcrastinationStopperConfig,
  parseStopperHosts,
  serializeStopperHosts,
  type ProcrastinationStopperConfig,
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

export function getProcrastinationStopper() {
  return {
    get enabled(): boolean {
      return config.enabled;
    },
    get blockDuringBreaks(): boolean {
      return config.blockDuringBreaks;
    },
    get blockedHosts(): readonly string[] {
      return config.blockedHosts;
    },
    get allowedHosts(): readonly string[] {
      return config.allowedHosts;
    },
    get blockedHostsText(): string {
      return serializeStopperHosts(config.blockedHosts);
    },
    get allowedHostsText(): string {
      return serializeStopperHosts(config.allowedHosts);
    },
    setEnabled(enabled: boolean): void {
      update({ enabled });
    },
    setBlockDuringBreaks(blockDuringBreaks: boolean): void {
      update({ blockDuringBreaks });
    },
    setBlockedHostsText(text: string): void {
      update({ blockedHosts: parseStopperHosts(text) });
    },
    setAllowedHostsText(text: string): void {
      update({ allowedHosts: parseStopperHosts(text) });
    },
    reset(): void {
      persist({ ...DEFAULT_PROCRASTINATION_STOPPER_CONFIG });
    },
  };
}

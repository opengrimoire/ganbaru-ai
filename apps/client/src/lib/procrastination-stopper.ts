export interface ProcrastinationStopperConfig {
  enabled: boolean;
  blockDuringBreaks: boolean;
  blockedHosts: string[];
  allowedHosts: string[];
}

export interface ProcrastinationStopperDecision {
  blocked: boolean;
  host: string | null;
  matchedRule: string | null;
}

export const DEFAULT_PROCRASTINATION_STOPPER_CONFIG: ProcrastinationStopperConfig = Object.freeze({
  enabled: false,
  blockDuringBreaks: false,
  blockedHosts: [],
  allowedHosts: [],
});

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
export function normalizeStopperHost(input: string): string | null {
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
export function parseStopperHosts(input: string): string[] {
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const part of input.split(/[\s,;]+/)) {
    const host = normalizeStopperHost(part);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

export function serializeStopperHosts(hosts: readonly string[]): string {
  return hosts.join("\n");
}

function normalizeHostArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return parseStopperHosts(value.filter((item) => typeof item === "string").join("\n"));
}

export function normalizeProcrastinationStopperConfig(value: unknown): ProcrastinationStopperConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_PROCRASTINATION_STOPPER_CONFIG };
  }
  const record = value as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === "boolean"
      ? record.enabled
      : DEFAULT_PROCRASTINATION_STOPPER_CONFIG.enabled,
    blockDuringBreaks: typeof record.blockDuringBreaks === "boolean"
      ? record.blockDuringBreaks
      : DEFAULT_PROCRASTINATION_STOPPER_CONFIG.blockDuringBreaks,
    blockedHosts: normalizeHostArray(record.blockedHosts),
    allowedHosts: normalizeHostArray(record.allowedHosts),
  };
}

export function stopperHostMatchesRule(host: string, ruleHost: string): boolean {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

/**
 * Evaluate a URL against the current host-only stopper rules.
 *
 * @param url - Browser URL to evaluate.
 * @param config - Stopper configuration.
 * @returns A decision that explains the matching host rule.
 */
export function evaluateStopperUrl(
  url: string,
  config: ProcrastinationStopperConfig,
): ProcrastinationStopperDecision {
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

  for (const allowedHost of config.allowedHosts) {
    if (stopperHostMatchesRule(host, allowedHost)) {
      return { blocked: false, host, matchedRule: `allowed host: ${allowedHost}` };
    }
  }
  for (const blockedHost of config.blockedHosts) {
    if (stopperHostMatchesRule(host, blockedHost)) {
      return { blocked: true, host, matchedRule: `blocked host: ${blockedHost}` };
    }
  }
  return { blocked: false, host, matchedRule: null };
}

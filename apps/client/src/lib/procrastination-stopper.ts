export type ProcrastinationStopperMode = "blacklist" | "whitelist";

export interface ProcrastinationStopperHostRule {
  host: string;
  enabled: boolean;
}

export interface ProcrastinationStopperConfig {
  mode: ProcrastinationStopperMode;
  enabled: boolean;
  blockDuringShortBreaks: boolean;
  blockDuringLongBreaks: boolean;
  blockedHosts: ProcrastinationStopperHostRule[];
  exceptionHosts: ProcrastinationStopperHostRule[];
  allowedHosts: ProcrastinationStopperHostRule[];
}

export interface ProcrastinationStopperDecision {
  blocked: boolean;
  host: string | null;
  matchedRule: string | null;
}

export const DEFAULT_PROCRASTINATION_STOPPER_CONFIG: ProcrastinationStopperConfig = Object.freeze({
  mode: "blacklist",
  enabled: true,
  blockDuringShortBreaks: true,
  blockDuringLongBreaks: true,
  blockedHosts: [],
  exceptionHosts: [],
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

function normalizeHostRuleValue(value: unknown): ProcrastinationStopperHostRule | null {
  if (typeof value === "string") {
    const host = normalizeStopperHost(value);
    return host ? { host, enabled: true } : null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.host !== "string") return null;
  const host = normalizeStopperHost(record.host);
  if (!host) return null;
  return {
    host,
    enabled: record.enabled !== false,
  };
}

function normalizeHostRules(value: unknown): ProcrastinationStopperHostRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: ProcrastinationStopperHostRule[] = [];
  for (const item of value) {
    const rule = normalizeHostRuleValue(item);
    if (!rule || seen.has(rule.host)) continue;
    seen.add(rule.host);
    rules.push(rule);
  }
  return rules;
}

function normalizeMode(value: unknown): ProcrastinationStopperMode {
  return value === "whitelist" || value === "blacklist"
    ? value
    : DEFAULT_PROCRASTINATION_STOPPER_CONFIG.mode;
}

export function normalizeProcrastinationStopperConfig(value: unknown): ProcrastinationStopperConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_PROCRASTINATION_STOPPER_CONFIG };
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
      : DEFAULT_PROCRASTINATION_STOPPER_CONFIG.enabled,
    blockDuringShortBreaks: typeof record.blockDuringShortBreaks === "boolean"
      ? record.blockDuringShortBreaks
      : legacyBlockDuringBreaks ?? DEFAULT_PROCRASTINATION_STOPPER_CONFIG.blockDuringShortBreaks,
    blockDuringLongBreaks: typeof record.blockDuringLongBreaks === "boolean"
      ? record.blockDuringLongBreaks
      : legacyBlockDuringBreaks ?? DEFAULT_PROCRASTINATION_STOPPER_CONFIG.blockDuringLongBreaks,
    blockedHosts: normalizeHostRules(record.blockedHosts),
    exceptionHosts: hasExceptionHosts
      ? normalizeHostRules(record.exceptionHosts)
      : hasMode
        ? []
        : legacyAllowedHosts,
    allowedHosts: hasMode ? legacyAllowedHosts : [],
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

  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) {
    return { blocked: false, host, matchedRule: "browser safety allowlist" };
  }

  if (config.mode === "whitelist") {
    for (const allowedRule of config.allowedHosts) {
      if (!allowedRule.enabled) continue;
      const allowedHost = allowedRule.host;
      if (stopperHostMatchesRule(host, allowedHost)) {
        return { blocked: false, host, matchedRule: `whitelist: ${allowedHost}` };
      }
    }
    return { blocked: true, host, matchedRule: "not in whitelist" };
  }

  for (const exceptionRule of config.exceptionHosts) {
    if (!exceptionRule.enabled) continue;
    const exceptionHost = exceptionRule.host;
    if (stopperHostMatchesRule(host, exceptionHost)) {
      return { blocked: false, host, matchedRule: `exception: ${exceptionHost}` };
    }
  }
  for (const blockedRule of config.blockedHosts) {
    if (!blockedRule.enabled) continue;
    const blockedHost = blockedRule.host;
    if (stopperHostMatchesRule(host, blockedHost)) {
      return { blocked: true, host, matchedRule: `blocked host: ${blockedHost}` };
    }
  }
  return { blocked: false, host, matchedRule: null };
}

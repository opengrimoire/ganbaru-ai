import type { Translate } from "$lib/i18n/translator.svelte";

interface LinkedDeviceIdentity {
  deviceId: string;
}

function errorText(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : String(cause);
}

/** Converts native handoff failures into concise localized recovery guidance. */
export function formatHandoffError(cause: unknown, t: Translate): string {
  const raw = errorText(cause);
  const lower = raw.toLowerCase();
  if (lower.includes("chat") && (lower.includes("active") || lower.includes("running"))) {
    return t("vaultHandoff.blockerChat");
  }
  if (lower.includes("pomodoro") || lower.includes("focus session")) {
    return t("vaultHandoff.blockerFocus");
  }
  if (lower.includes("transfer") && (lower.includes("finish") || lower.includes("active"))) {
    return t("vaultHandoff.blockerTransfer");
  }
  if (
    lower.includes("handoff compatibility mismatch") ||
    lower.includes("handoff protocol version is unsupported")
  ) {
    return t("vaultHandoff.incompatibleVersions");
  }
  if (lower.includes("already linked to another coordinator")) {
    return t("vaultHandoff.differentCoordinator");
  }
  if (
    lower.includes("connect") ||
    lower.includes("unavailable") ||
    lower.includes("timed out") ||
    lower.includes("network")
  ) {
    return t("vaultHandoff.unreachable");
  }
  return t("vaultHandoff.failed", raw || t("vaultHandoff.unknownError"));
}

/** Reports whether an invitation enrolled a device absent when it was created. */
export function hasNewLinkedDevice(
  deviceIdsAtInvitation: ReadonlySet<string>,
  devices: readonly LinkedDeviceIdentity[],
): boolean {
  return devices.some((device) => !deviceIdsAtInvitation.has(device.deviceId));
}

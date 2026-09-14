import { invoke } from "@tauri-apps/api/core";

export interface PairingQrMatrix {
  width: number;
  modules: boolean[];
}

export interface PairingInvitation {
  invitation: string;
  qr: PairingQrMatrix;
  endpoint: string;
  expiresAtUnixMs: number;
}

export interface PairingStatus {
  deviceId: string;
  linked: boolean;
  peerDeviceId: string | null;
  peerLabel: string | null;
  coordinatorEndpoint: string | null;
  vaultId: string | null;
  canWrite: boolean | null;
  recoveryRequired: boolean;
  replicaReady: boolean;
  pendingTransfer: boolean;
}

export type DesktopBundleReceiveMode = "ownership" | "refresh";

export interface DesktopBundleReceiveOutcome {
  transferId: string | null;
  generation: number | null;
  activated: boolean;
  inProgress: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQrMatrix(value: unknown): PairingQrMatrix {
  if (!isRecord(value) || !Number.isSafeInteger(value.width) || !Array.isArray(value.modules)) {
    throw new Error("Invalid pairing QR matrix response");
  }
  const width = value.width as number;
  if (
    width <= 0 ||
    width > 177 ||
    value.modules.length !== width * width ||
    !value.modules.every((module) => typeof module === "boolean")
  ) {
    throw new Error("Invalid pairing QR matrix response");
  }
  return { width, modules: value.modules as boolean[] };
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error(`Invalid ${label} response`);
}

function parseInvitation(value: unknown): PairingInvitation {
  if (
    !isRecord(value) ||
    typeof value.invitation !== "string" ||
    typeof value.endpoint !== "string" ||
    typeof value.expiresAtUnixMs !== "number"
  ) {
    throw new Error("Invalid pairing invitation response");
  }
  return {
    invitation: value.invitation,
    qr: parseQrMatrix(value.qr),
    endpoint: value.endpoint,
    expiresAtUnixMs: value.expiresAtUnixMs,
  };
}

function parseStatus(value: unknown): PairingStatus {
  if (
    !isRecord(value) ||
    typeof value.deviceId !== "string" ||
    typeof value.linked !== "boolean" ||
    (value.canWrite !== null && typeof value.canWrite !== "boolean") ||
    typeof value.recoveryRequired !== "boolean" ||
    typeof value.replicaReady !== "boolean" ||
    typeof value.pendingTransfer !== "boolean"
  ) {
    throw new Error("Invalid pairing status response");
  }
  return {
    deviceId: value.deviceId,
    linked: value.linked,
    peerDeviceId: nullableString(value.peerDeviceId, "peer device id"),
    peerLabel: nullableString(value.peerLabel, "peer label"),
    coordinatorEndpoint: nullableString(value.coordinatorEndpoint, "coordinator endpoint"),
    vaultId: nullableString(value.vaultId, "vault id"),
    canWrite: value.canWrite as boolean | null,
    recoveryRequired: value.recoveryRequired,
    replicaReady: value.replicaReady,
    pendingTransfer: value.pendingTransfer,
  };
}

function parseReceiveOutcome(value: unknown): DesktopBundleReceiveOutcome {
  if (
    !isRecord(value) ||
    typeof value.activated !== "boolean" ||
    typeof value.inProgress !== "boolean" ||
    (value.transferId !== null && typeof value.transferId !== "string") ||
    (value.generation !== null && !Number.isSafeInteger(value.generation))
  ) {
    throw new Error("Invalid desktop bundle receive response");
  }
  return {
    transferId: value.transferId as string | null,
    generation: value.generation as number | null,
    activated: value.activated,
    inProgress: value.inProgress,
  };
}

/** Creates a short-lived single-use invitation on the desktop coordinator. */
export async function createPairingInvitation(): Promise<PairingInvitation> {
  return parseInvitation(await invoke<unknown>("handoff_create_pairing_invitation"));
}

/** Decodes a bounded grayscale camera frame into an authenticated invitation. */
export async function decodePairingQr(
  width: number,
  height: number,
  luma: Uint8Array,
): Promise<string> {
  const value = await invoke<unknown>("handoff_decode_pairing_qr", {
    width,
    height,
    luma: Array.from(luma),
  });
  if (typeof value !== "string") throw new Error("Invalid pairing QR response");
  return value;
}

/** Enrolls this device using the coordinator identity pinned by the QR code. */
export function enrollWithDesktop(
  invitation: string,
  deviceLabel: string,
): Promise<void> {
  return invoke("handoff_enroll", { invitation, deviceLabel });
}

/** Reads device-local linked coordinator status. */
export async function readPairingStatus(): Promise<PairingStatus> {
  return parseStatus(await invoke<unknown>("handoff_pairing_status"));
}

/** Receives and activates the desktop vault through the shared whole-vault path. */
export async function receiveDesktopBundle(
  mode: DesktopBundleReceiveMode,
): Promise<DesktopBundleReceiveOutcome> {
  return parseReceiveOutcome(
    await invoke<unknown>("handoff_receive_desktop_bundle", { mode }),
  );
}

/** Cancels the currently streaming desktop bundle, leaving resumable staging. */
export function cancelDesktopBundleReceive(): Promise<void> {
  return invoke("handoff_cancel_receive");
}

/** Requests the linked Android owner to upload a whole-vault bundle. */
export function requestAndroidBundle(
  purpose: DesktopBundleReceiveMode,
): Promise<void> {
  return invoke("handoff_request_android_bundle", { purpose });
}

/** Removes the linked-device relationship without changing the current owner. */
export function unlinkVaultDevice(): Promise<void> {
  return invoke("handoff_unlink");
}

/** Explicitly forks the last local copy after the owning device is permanently unavailable. */
export async function recoverLocalVaultCopy(): Promise<number> {
  const generation = await invoke<unknown>("handoff_recover_local_copy");
  if (!Number.isSafeInteger(generation) || (generation as number) < 0) {
    throw new Error("Invalid vault recovery generation response");
  }
  return generation as number;
}

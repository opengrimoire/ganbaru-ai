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
  if (!isRecord(value) || typeof value.deviceId !== "string" || typeof value.linked !== "boolean") {
    throw new Error("Invalid pairing status response");
  }
  return {
    deviceId: value.deviceId,
    linked: value.linked,
    peerDeviceId: nullableString(value.peerDeviceId, "peer device id"),
    peerLabel: nullableString(value.peerLabel, "peer label"),
    coordinatorEndpoint: nullableString(value.coordinatorEndpoint, "coordinator endpoint"),
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

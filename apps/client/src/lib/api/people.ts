import { invoke } from "@tauri-apps/api/core";
import {
  readArray,
  readBoolean,
  readEnum,
  readNullable,
  readRecord,
  readSafeInteger,
  readString,
  readUtcTimestamp,
} from "$lib/chat/validation/readers";
import { parseQrMatrix, type PairingQrMatrix } from "./vault-handoff";

/** Wire trust scopes as the Rust side stores them. */
export const PEOPLE_TRUST_KINDS = ["not_allowed", "once", "seven_days", "thirty_days", "until_revoked"] as const;
export type PeopleTrustKind = (typeof PEOPLE_TRUST_KINDS)[number];

export const PEOPLE_CONTACT_STATES = ["active", "blocked"] as const;
export type PeopleContactState = (typeof PEOPLE_CONTACT_STATES)[number];

export const PEOPLE_REQUEST_DIRECTIONS = ["sent", "received"] as const;
export type PeopleRequestDirection = (typeof PEOPLE_REQUEST_DIRECTIONS)[number];

export const PEOPLE_REQUEST_STATES = ["pending", "accepted", "declined", "expired"] as const;
export type PeopleRequestState = (typeof PEOPLE_REQUEST_STATES)[number];

export const PEOPLE_ERROR_CODES = [
  "identity_unavailable",
  "key_unavailable",
  "profile_incomplete",
  "invalid_card",
  "card_revoked",
  "recipient_unreachable",
  "read_only",
  "revision_conflict",
  "failed",
] as const;
export type PeopleErrorCode = (typeof PEOPLE_ERROR_CODES)[number];

const MAX_COLOR = 31;

export interface PeopleIdentity {
  publicKey: string;
  contactId: string;
  cardRevision: number;
  privateKeyAvailable: boolean;
}

export interface PeopleCard {
  text: string;
  qr: PairingQrMatrix;
  verificationCode: string;
  displayName: string;
  color: number;
  /** Empty when nobody can reach this person right now. */
  endpointHint: string;
}

export interface PeopleLocalCard {
  identity: PeopleIdentity;
  /** Absent while this device holds no private key copy. */
  card: PeopleCard | null;
}

export interface PeopleParsedCard {
  displayName: string;
  color: number;
  verificationCode: string;
  publicKey: string;
  contactId: string;
  hasEndpoint: boolean;
  isSelf: boolean;
  existingState: PeopleContactState | null;
  pendingSent: boolean;
}

export interface PeopleContact {
  id: string;
  publicKey: string;
  displayName: string;
  color: number;
  state: PeopleContactState;
  inviteTrust: PeopleTrustKind;
  inviteTrustExpiresAt: string | null;
  messageTrust: PeopleTrustKind;
  messageTrustExpiresAt: string | null;
  acceptedAt: string | null;
  blockedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PeopleContactRequest {
  id: string;
  direction: PeopleRequestDirection;
  publicKey: string;
  contactId: string;
  displayName: string;
  color: number;
  verificationCode: string;
  inviteTrust: PeopleTrustKind;
  messageTrust: PeopleTrustKind;
  state: PeopleRequestState;
  expiresAt: string;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PeopleSnapshot {
  identity: PeopleIdentity | null;
  contacts: PeopleContact[];
  requests: PeopleContactRequest[];
}

export interface PeopleTrustChoice {
  inviteTrust: PeopleTrustKind;
  messageTrust: PeopleTrustKind;
}

export interface PeopleRowRevision {
  id: string;
  expectedRevision: number;
}

/** A People command failure with the stable code the UI branches on. */
export class PeopleError extends Error {
  readonly code: PeopleErrorCode;

  constructor(code: PeopleErrorCode, message: string) {
    super(message);
    this.name = "PeopleError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Converts a rejected People command into a typed error; unknown shapes become `failed`. */
export function normalizePeopleError(error: unknown): PeopleError {
  if (error instanceof PeopleError) return error;
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    const code = (PEOPLE_ERROR_CODES as readonly string[]).includes(error.code)
      ? (error.code as PeopleErrorCode)
      : "failed";
    return new PeopleError(code, error.message);
  }
  if (error instanceof Error) return new PeopleError("failed", error.message);
  return new PeopleError("failed", typeof error === "string" ? error : "People command failed");
}

function readColor(value: unknown, label: string): number {
  const color = readSafeInteger(value, label);
  if (color < 0 || color > MAX_COLOR) throw new Error(`${label} is outside the palette`);
  return color;
}

function readIdentity(value: unknown, label: string): PeopleIdentity {
  const record = readRecord(value, label);
  return {
    publicKey: readString(record.publicKey, `${label}.publicKey`),
    contactId: readString(record.contactId, `${label}.contactId`),
    cardRevision: readSafeInteger(record.cardRevision, `${label}.cardRevision`),
    privateKeyAvailable: readBoolean(record.privateKeyAvailable, `${label}.privateKeyAvailable`),
  };
}

function readCard(value: unknown, label: string): PeopleCard {
  const record = readRecord(value, label);
  return {
    text: readString(record.text, `${label}.text`),
    qr: parseQrMatrix(record.qr),
    verificationCode: readString(record.verificationCode, `${label}.verificationCode`),
    displayName: readString(record.displayName, `${label}.displayName`),
    color: readColor(record.color, `${label}.color`),
    endpointHint: readString(record.endpointHint, `${label}.endpointHint`),
  };
}

export function parsePeopleLocalCard(value: unknown): PeopleLocalCard {
  const record = readRecord(value, "local card");
  return {
    identity: readIdentity(record.identity, "local card.identity"),
    card: readNullable(record.card, "local card.card", readCard),
  };
}

export function parsePeopleParsedCard(value: unknown): PeopleParsedCard {
  const record = readRecord(value, "parsed card");
  return {
    displayName: readString(record.displayName, "parsed card.displayName"),
    color: readColor(record.color, "parsed card.color"),
    verificationCode: readString(record.verificationCode, "parsed card.verificationCode"),
    publicKey: readString(record.publicKey, "parsed card.publicKey"),
    contactId: readString(record.contactId, "parsed card.contactId"),
    hasEndpoint: readBoolean(record.hasEndpoint, "parsed card.hasEndpoint"),
    isSelf: readBoolean(record.isSelf, "parsed card.isSelf"),
    existingState: readNullable(record.existingState, "parsed card.existingState", (state, label) =>
      readEnum(state, PEOPLE_CONTACT_STATES, label)),
    pendingSent: readBoolean(record.pendingSent, "parsed card.pendingSent"),
  };
}

function readContact(value: unknown, label: string): PeopleContact {
  const record = readRecord(value, label);
  return {
    id: readString(record.id, `${label}.id`),
    publicKey: readString(record.publicKey, `${label}.publicKey`),
    displayName: readString(record.displayName, `${label}.displayName`),
    color: readColor(record.color, `${label}.color`),
    state: readEnum(record.state, PEOPLE_CONTACT_STATES, `${label}.state`),
    inviteTrust: readEnum(record.inviteTrust, PEOPLE_TRUST_KINDS, `${label}.inviteTrust`),
    inviteTrustExpiresAt: readNullable(record.inviteTrustExpiresAt, `${label}.inviteTrustExpiresAt`, readUtcTimestamp),
    messageTrust: readEnum(record.messageTrust, PEOPLE_TRUST_KINDS, `${label}.messageTrust`),
    messageTrustExpiresAt: readNullable(record.messageTrustExpiresAt, `${label}.messageTrustExpiresAt`, readUtcTimestamp),
    acceptedAt: readNullable(record.acceptedAt, `${label}.acceptedAt`, readUtcTimestamp),
    blockedAt: readNullable(record.blockedAt, `${label}.blockedAt`, readUtcTimestamp),
    revision: readSafeInteger(record.revision, `${label}.revision`),
    createdAt: readUtcTimestamp(record.createdAt, `${label}.createdAt`),
    updatedAt: readUtcTimestamp(record.updatedAt, `${label}.updatedAt`),
  };
}

function readRequest(value: unknown, label: string): PeopleContactRequest {
  const record = readRecord(value, label);
  return {
    id: readString(record.id, `${label}.id`),
    direction: readEnum(record.direction, PEOPLE_REQUEST_DIRECTIONS, `${label}.direction`),
    publicKey: readString(record.publicKey, `${label}.publicKey`),
    contactId: readString(record.contactId, `${label}.contactId`),
    displayName: readString(record.displayName, `${label}.displayName`),
    color: readColor(record.color, `${label}.color`),
    verificationCode: readString(record.verificationCode, `${label}.verificationCode`),
    inviteTrust: readEnum(record.inviteTrust, PEOPLE_TRUST_KINDS, `${label}.inviteTrust`),
    messageTrust: readEnum(record.messageTrust, PEOPLE_TRUST_KINDS, `${label}.messageTrust`),
    state: readEnum(record.state, PEOPLE_REQUEST_STATES, `${label}.state`),
    expiresAt: readUtcTimestamp(record.expiresAt, `${label}.expiresAt`),
    lastAttemptAt: readNullable(record.lastAttemptAt, `${label}.lastAttemptAt`, readUtcTimestamp),
    lastErrorCode: readNullable(record.lastErrorCode, `${label}.lastErrorCode`, readString),
    revision: readSafeInteger(record.revision, `${label}.revision`),
    createdAt: readUtcTimestamp(record.createdAt, `${label}.createdAt`),
    updatedAt: readUtcTimestamp(record.updatedAt, `${label}.updatedAt`),
  };
}

export function parsePeopleSnapshot(value: unknown): PeopleSnapshot {
  const record = readRecord(value, "people snapshot");
  return {
    identity: readNullable(record.identity, "people snapshot.identity", readIdentity),
    contacts: readArray(record.contacts, "people snapshot.contacts", readContact),
    requests: readArray(record.requests, "people snapshot.requests", readRequest),
  };
}

async function invokePeople<T>(command: string, parse: (value: unknown) => T, args?: Record<string, unknown>): Promise<T> {
  let value: unknown;
  try {
    value = await invoke<unknown>(command, args);
  } catch (error) {
    throw normalizePeopleError(error);
  }
  return parse(value);
}

/** Reads the local identity, contacts, and contact requests. */
export function listPeople(): Promise<PeopleSnapshot> {
  return invokePeople("contacts_list", parsePeopleSnapshot);
}

/** Signs the current local card, creating the person identity on first use. */
export function loadLocalCard(): Promise<PeopleLocalCard> {
  return invokePeople("contacts_local_card", parsePeopleLocalCard);
}

/** Rotates the card nonce so every card issued so far stops being accepted. */
export function regenerateLocalCard(): Promise<PeopleLocalCard> {
  return invokePeople("contacts_regenerate_card", parsePeopleLocalCard);
}

/** Decodes and verifies pasted card text without writing anything. */
export function parseContactCard(text: string): Promise<PeopleParsedCard> {
  return invokePeople("contacts_parse_card", parsePeopleParsedCard, { text });
}

/** Decodes a bounded grayscale camera frame into contact card text. */
export function decodeContactCardQr(width: number, height: number, luma: Uint8Array): Promise<string> {
  return invokePeople(
    "contacts_decode_card_qr",
    (value) => readString(value, "contact card QR"),
    { width, height, luma: Array.from(luma) },
  );
}

/** Delivers a contact request to the person named by the card. */
export function sendContactRequest(cardText: string, trust: PeopleTrustChoice): Promise<PeopleSnapshot> {
  return invokePeople("contacts_send_request", parsePeopleSnapshot, {
    request: { cardText, inviteTrust: trust.inviteTrust, messageTrust: trust.messageTrust },
  });
}

export function acceptContactRequest(row: PeopleRowRevision, trust: PeopleTrustChoice): Promise<PeopleSnapshot> {
  return invokePeople("contacts_accept_request", parsePeopleSnapshot, {
    request: { ...row, inviteTrust: trust.inviteTrust, messageTrust: trust.messageTrust },
  });
}

export function declineContactRequest(row: PeopleRowRevision): Promise<PeopleSnapshot> {
  return invokePeople("contacts_decline_request", parsePeopleSnapshot, { request: row });
}

export function cancelContactRequest(row: PeopleRowRevision): Promise<PeopleSnapshot> {
  return invokePeople("contacts_cancel_request", parsePeopleSnapshot, { request: row });
}

export function blockPerson(publicKey: string): Promise<PeopleSnapshot> {
  return invokePeople("contacts_block", parsePeopleSnapshot, { request: { publicKey } });
}

export function unblockPerson(row: PeopleRowRevision): Promise<PeopleSnapshot> {
  return invokePeople("contacts_unblock", parsePeopleSnapshot, { request: row });
}

export function removeContact(row: PeopleRowRevision): Promise<PeopleSnapshot> {
  return invokePeople("contacts_remove", parsePeopleSnapshot, { request: row });
}

export function updateContactTrust(row: PeopleRowRevision, trust: PeopleTrustChoice): Promise<PeopleSnapshot> {
  return invokePeople("contacts_update_trust", parsePeopleSnapshot, {
    request: { ...row, inviteTrust: trust.inviteTrust, messageTrust: trust.messageTrust },
  });
}

/** Polls every pending sent request now instead of waiting for the background interval. */
export function syncContactRequests(): Promise<PeopleSnapshot> {
  return invokePeople("contacts_sync_requests", parsePeopleSnapshot);
}

/** Saves a PNG rendering of the card through the desktop save dialog. Resolves false when cancelled. */
export function saveCardImage(title: string, fileName: string, pngBase64: string): Promise<boolean> {
  return invokePeople(
    "contacts_save_card_image",
    (value) => readBoolean(value, "save card image"),
    { title, fileName, pngBase64 },
  );
}

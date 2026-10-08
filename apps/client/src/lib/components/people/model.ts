/**
 * Shared vocabulary for the People experience: roles, capabilities, trust scopes, invitation states, and the
 * deterministic contact card preview. docs/features/collaboration/README.md owns the product rules.
 */

export const PEOPLE_ROLES = ["owner", "administrator", "member", "guest", "custom"] as const;
export type PeopleRole = (typeof PEOPLE_ROLES)[number];

/** Roles a person can be invited with; ownership is transferred, never granted through an invitation. */
export const PEOPLE_INVITABLE_ROLES = ["administrator", "member", "guest", "custom"] as const;

export const PEOPLE_CAPABILITY_GROUPS = ["conversation", "content", "management"] as const;
export type PeopleCapabilityGroup = (typeof PEOPLE_CAPABILITY_GROUPS)[number];

export const PEOPLE_CAPABILITIES = [
  { id: "readHistory", group: "conversation" },
  { id: "participate", group: "conversation" },
  { id: "assignWork", group: "conversation" },
  { id: "editNotes", group: "content" },
  { id: "editTasks", group: "content" },
  { id: "editEvents", group: "content" },
  { id: "sharePages", group: "content" },
  { id: "manageChannels", group: "management" },
  { id: "manageMembers", group: "management" },
  { id: "manageTeammates", group: "management" },
  { id: "editSpaceSettings", group: "management" },
] as const satisfies readonly { id: string; group: PeopleCapabilityGroup }[];
export type PeopleCapability = (typeof PEOPLE_CAPABILITIES)[number]["id"];

const ROLE_GROUPS: Record<Exclude<PeopleRole, "guest">, readonly PeopleCapabilityGroup[]> = {
  owner: PEOPLE_CAPABILITY_GROUPS,
  administrator: PEOPLE_CAPABILITY_GROUPS,
  member: ["conversation", "content"],
  custom: ["conversation", "content"],
};

const GUEST_CAPABILITIES: readonly PeopleCapability[] = ["readHistory", "participate"];

/** Capabilities a role preset grants. Custom starts from the Member preset so the matrix is never empty. */
export function capabilitiesForRole(role: PeopleRole): ReadonlySet<PeopleCapability> {
  if (role === "guest") return new Set(GUEST_CAPABILITIES);
  const groups = new Set<PeopleCapabilityGroup>(ROLE_GROUPS[role]);
  return new Set(PEOPLE_CAPABILITIES.filter((capability) => groups.has(capability.group)).map((capability) => capability.id));
}

export const PEOPLE_HISTORY_BOUNDARIES = ["entire", "fromAcceptance"] as const;
export type PeopleHistoryBoundary = (typeof PEOPLE_HISTORY_BOUNDARIES)[number];

export const PEOPLE_TRUST_DURATIONS = ["notAllowed", "once", "sevenDays", "thirtyDays", "untilRevoked"] as const;
export type PeopleTrustDuration = (typeof PEOPLE_TRUST_DURATIONS)[number];

export const PEOPLE_INVITATION_STATES = ["pending", "accepted", "declined", "revoked", "expired"] as const;
export type PeopleInvitationState = (typeof PEOPLE_INVITATION_STATES)[number];

export const PEOPLE_SPACE_KINDS = ["group", "project", "channel", "page", "event", "conversation"] as const;
export type PeopleSpaceKind = (typeof PEOPLE_SPACE_KINDS)[number];

/** A space an invitation targets, as shown in the invitation dialog. The id preselects it in the space picker. */
export interface PeopleSpaceSummary {
  readonly kind: PeopleSpaceKind;
  readonly name: string;
  readonly id?: string;
}

export const NOTES_SHARE_ROLES = ["view", "comment", "edit", "full"] as const;
export type NotesShareRole = (typeof NOTES_SHARE_ROLES)[number];

export const NOTES_SHARE_SCOPES = ["page", "subtree"] as const;
export type NotesShareScope = (typeof NOTES_SHARE_SCOPES)[number];

export const NOTES_LINK_ACCESS = ["off", "view", "comment"] as const;
export type NotesLinkAccess = (typeof NOTES_LINK_ACCESS)[number];

/** Prefix of every contact code; it distinguishes a Ganbaru AI card from an arbitrary pasted string. */
export const CONTACT_CODE_PREFIX = "GANB";
const CONTACT_CODE_GROUPS = 4;
const CONTACT_CODE_GROUP_LENGTH = 4;
/** Crockford base32 leaves out I, L, O, and U so a code read aloud or typed is unambiguous. */
const CONTACT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VERIFICATION_GROUPS = 3;
const VERIFICATION_GROUP_LENGTH = 4;
export const CONTACT_CARD_MATRIX_SIZE = 25;
const FINDER_SIZE = 7;

/** FNV-1a over UTF-16 code units, folded into a 32-bit unsigned integer. */
function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Deterministic byte stream derived from a seed, so previews are stable across renders and devices. */
function hashBytes(seed: string, count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  let round = 0;
  let offset = 0;
  while (offset < count) {
    const word = fnv1a(`${seed}\u0000${round}`, fnv1a(String(round)));
    for (let shift = 0; shift < 4 && offset < count; shift += 1) {
      bytes[offset] = (word >>> (shift * 8)) & 0xff;
      offset += 1;
    }
    round += 1;
  }
  return bytes;
}

/** Pasteable contact code such as `GANB-K7Q2-X9MA-4TZ1-8R0C`, derived from the local identity seed. */
export function contactCardCode(seed: string): string {
  const bytes = hashBytes(`code:${seed}`, CONTACT_CODE_GROUPS * CONTACT_CODE_GROUP_LENGTH);
  const groups: string[] = [CONTACT_CODE_PREFIX];
  for (let group = 0; group < CONTACT_CODE_GROUPS; group += 1) {
    let text = "";
    for (let position = 0; position < CONTACT_CODE_GROUP_LENGTH; position += 1) {
      const byte = bytes[group * CONTACT_CODE_GROUP_LENGTH + position] ?? 0;
      text += CONTACT_CODE_ALPHABET[byte % CONTACT_CODE_ALPHABET.length];
    }
    groups.push(text);
  }
  return groups.join("-");
}

/** Digit groups two people compare out of band before accepting each other, derived from the same material. */
export function verificationCode(text: string): string {
  const bytes = hashBytes(`verify:${text.trim().toUpperCase()}`, VERIFICATION_GROUPS * VERIFICATION_GROUP_LENGTH);
  const groups: string[] = [];
  for (let group = 0; group < VERIFICATION_GROUPS; group += 1) {
    let digits = "";
    for (let position = 0; position < VERIFICATION_GROUP_LENGTH; position += 1) {
      digits += String((bytes[group * VERIFICATION_GROUP_LENGTH + position] ?? 0) % 10);
    }
    groups.push(digits);
  }
  return groups.join(" ");
}

/** Whether a module belongs to one of the three finder patterns or their separators. */
function finderModule(row: number, column: number, size: number): boolean | null {
  const corners: Array<[number, number]> = [[0, 0], [0, size - FINDER_SIZE], [size - FINDER_SIZE, 0]];
  for (const [top, left] of corners) {
    const localRow = row - top;
    const localColumn = column - left;
    if (localRow < -1 || localColumn < -1 || localRow > FINDER_SIZE || localColumn > FINDER_SIZE) continue;
    if (localRow === -1 || localColumn === -1 || localRow === FINDER_SIZE || localColumn === FINDER_SIZE) return false;
    const ring = Math.min(localRow, localColumn, FINDER_SIZE - 1 - localRow, FINDER_SIZE - 1 - localColumn);
    return ring === 0 || ring >= 2;
  }
  return null;
}

/** QR-styled module grid for the contact card preview. The finder patterns are real; the data area is derived. */
export function contactCardMatrix(seed: string, size = CONTACT_CARD_MATRIX_SIZE): { modules: boolean[]; width: number } {
  const bytes = hashBytes(`matrix:${seed}`, Math.ceil((size * size) / 8));
  const modules: boolean[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const finder = finderModule(row, column, size);
      if (finder !== null) {
        modules.push(finder);
        continue;
      }
      const index = row * size + column;
      const byte = bytes[index >> 3] ?? 0;
      modules.push(((byte >> (index & 7)) & 1) === 1);
    }
  }
  return { modules, width: size };
}

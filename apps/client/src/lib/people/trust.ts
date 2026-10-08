import type { PeopleContact, PeopleTrustKind } from "$lib/api/people";
import type { PeopleTrustDuration } from "$lib/stores/preference-options";

const DURATION_TO_KIND: Record<PeopleTrustDuration, PeopleTrustKind> = {
  notAllowed: "not_allowed",
  once: "once",
  sevenDays: "seven_days",
  thirtyDays: "thirty_days",
  untilRevoked: "until_revoked",
};

const KIND_TO_DURATION: Record<PeopleTrustKind, PeopleTrustDuration> = {
  not_allowed: "notAllowed",
  once: "once",
  seven_days: "sevenDays",
  thirty_days: "thirtyDays",
  until_revoked: "untilRevoked",
};

/** Maps a UI trust duration to the wire scope the Rust side stores. */
export function trustKindForDuration(duration: PeopleTrustDuration): PeopleTrustKind {
  return DURATION_TO_KIND[duration];
}

/** Maps a stored trust scope back to the UI duration. */
export function trustDurationForKind(kind: PeopleTrustKind): PeopleTrustDuration {
  return KIND_TO_DURATION[kind];
}

export type PeopleTrustScope = "invite" | "message";

/** What a contact is allowed to do right now, after timed grants have run out. */
export type PeopleTrustStatus =
  | { kind: "notAllowed" }
  | { kind: "once" }
  | { kind: "untilRevoked" }
  | { kind: "until"; expiresAt: string }
  | { kind: "expired" };

/** Resolves one trust scope of a contact against the current time. */
export function trustStatus(contact: PeopleContact, scope: PeopleTrustScope, now: Date): PeopleTrustStatus {
  const kind = scope === "invite" ? contact.inviteTrust : contact.messageTrust;
  const expiresAt = scope === "invite" ? contact.inviteTrustExpiresAt : contact.messageTrustExpiresAt;
  switch (kind) {
    case "not_allowed":
      return { kind: "notAllowed" };
    case "once":
      return { kind: "once" };
    case "until_revoked":
      return { kind: "untilRevoked" };
    case "seven_days":
    case "thirty_days": {
      if (!expiresAt) return { kind: "expired" };
      const expiry = Date.parse(expiresAt);
      if (!Number.isFinite(expiry) || expiry <= now.getTime()) return { kind: "expired" };
      return { kind: "until", expiresAt };
    }
  }
}

/** Whole days until a timestamp, rounded up so a grant ending later today still counts as one day. */
export function daysUntil(timestamp: string, now: Date): number {
  const target = Date.parse(timestamp);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - now.getTime()) / 86_400_000));
}

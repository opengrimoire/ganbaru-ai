import type { PeopleContact, PeopleErrorCode } from "$lib/api/people";
import { formatRelativeDays } from "$lib/i18n/formatters";
import type { Translate } from "$lib/i18n/translator.svelte";
import { daysUntil, trustStatus, type PeopleTrustScope, type PeopleTrustStatus } from "./trust";

export type PeopleMutationErrorKey = "revisionConflict" | "readOnly" | "failed";

/** Which contacts error sentence explains a failed mutation. */
export function peopleMutationErrorKey(code: PeopleErrorCode): PeopleMutationErrorKey {
  switch (code) {
    case "revision_conflict":
      return "revisionConflict";
    case "read_only":
    case "identity_unavailable":
      return "readOnly";
    default:
      return "failed";
  }
}

/** Short lowercase phrase for one resolved trust scope, for use inside a row detail. */
export function formatTrustSummary(t: Translate, status: PeopleTrustStatus, now: Date): string {
  switch (status.kind) {
    case "notAllowed":
      return t("people.contacts.trustSummary.notAllowed");
    case "once":
      return t("people.contacts.trustSummary.once");
    case "untilRevoked":
      return t("people.contacts.trustSummary.untilRevoked");
    case "until":
      return t("people.contacts.trustSummary.until", formatRelativeDays(t, daysUntil(status.expiresAt, now)));
    case "expired":
      return t("people.contacts.trustSummary.expired");
  }
}

/** Row detail describing both trust scopes of a contact as of now. */
export function formatContactTrustDetail(t: Translate, contact: PeopleContact, now: Date): string {
  const summary = (scope: PeopleTrustScope) => formatTrustSummary(t, trustStatus(contact, scope, now), now);
  return t("people.contacts.trustDetail", summary("invite"), summary("message"));
}

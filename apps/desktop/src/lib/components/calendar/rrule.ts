import type { RepeatRule } from "./types";

const RULE_TO_RRULE: Record<Exclude<RepeatRule, "none">, string> = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

const RRULE_TO_RULE = new Map<string, RepeatRule>(
  (Object.entries(RULE_TO_RRULE) as [RepeatRule, string][]).map(([k, v]) => [v, k]),
);

/**
 * Convert a UI RepeatRule preset to an iCal-style RRULE string.
 *
 * Parameters
 * ----------
 * rule : RepeatRule
 *     The UI repeat preset.
 *
 * Returns
 * -------
 * string | null
 *     The RRULE string, or null for "none".
 */
export function repeatRuleToRrule(rule: RepeatRule): string | null {
  if (rule === "none") return null;
  return RULE_TO_RRULE[rule] ?? null;
}

/**
 * Convert an iCal-style RRULE string back to a UI RepeatRule preset.
 *
 * Parameters
 * ----------
 * rrule : string | null
 *     The RRULE string from the database.
 *
 * Returns
 * -------
 * RepeatRule | undefined
 *     The matching preset, or undefined for null/unrecognized strings.
 */
export function rruleToRepeatRule(rrule: string | null): RepeatRule | undefined {
  if (rrule == null) return undefined;
  return RRULE_TO_RULE.get(rrule);
}

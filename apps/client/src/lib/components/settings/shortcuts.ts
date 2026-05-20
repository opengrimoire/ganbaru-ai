import { shortcutParts as platformShortcutParts } from "$lib/keyboard-shortcuts";

export interface ShortcutItem {
  keys: string[];
  action: string;
  context?: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = Object.freeze([
  {
    title: "General",
    items: [
      { keys: ["Mod + Tab"], action: "Next view" },
      { keys: ["Mod + Shift + Tab"], action: "Previous view" },
      { keys: ["Alt + 1"], action: "Open calendar" },
      { keys: ["Alt + 2"], action: "Open to-do" },
      { keys: ["Mod + M"], action: "Open music" },
      { keys: ["Mod + ,"], action: "Open or close settings" },
      { keys: ["Mod + +"], action: "Zoom in" },
      { keys: ["Mod + -"], action: "Zoom out" },
      { keys: ["Mod + 0"], action: "Reset zoom" },
      { keys: ["Mod + Shift + L"], action: "Toggle light/dark mode" },
      { keys: ["Mod + Shift + T"], action: "Open theme picker" },
      { keys: ["Mod + Shift + D"], action: "Toggle diagnostics panel" },
      { keys: ["F1"], action: "Open shortcuts" },
      { keys: ["Mod + Shift + W"], action: "Close app" },
    ],
  },
  {
    title: "Calendar",
    items: [
      { keys: ["0", "T"], action: "Go to today" },
      { keys: ["1", "D"], action: "Day view" },
      { keys: ["2", "W"], action: "Week view" },
      { keys: ["3", "M"], action: "Month view" },
      { keys: ["Arrow left", "Arrow right"], action: "Previous or next date range" },
      {
        keys: ["Arrow up", "Arrow down"],
        action: "Scroll timeline",
      },
      { keys: ["Shift + +", "+"], action: "Zoom in the calendar timeline" },
      { keys: ["Shift + -", "-"], action: "Zoom out the calendar timeline" },
      { keys: ["Shift + 0"], action: "Reset calendar timeline zoom" },
      { keys: ["Mod + Enter"], action: "Save event" },
      { keys: ["Mod + D"], action: "Delete event" },
    ],
  },
  {
    title: "Music",
    items: [
      { keys: ["Spacebar"], action: "Play or pause" },
      { keys: ["P", "L", "Mod + P", "Mod + L"], action: "Show or hide playlist" },
      { keys: ["M"], action: "Mute or unmute" },
      { keys: ["S", "R"], action: "Toggle shuffle" },
      { keys: ["0-9"], action: "Jump to playback position" },
      { keys: ["Arrow left", "Arrow right"], action: "Jump 10 seconds" },
      { keys: ["Arrow up", "Arrow down"], action: "Adjust volume" },
      {
        keys: ["Mod + Arrow left", "Mod + Shift + Arrow left", "Shift + Arrow left"],
        action: "Last track",
      },
      {
        keys: ["Mod + Arrow right", "Mod + Shift + Arrow right", "Shift + Arrow right"],
        action: "Next track",
      },
      { keys: ["+", "-"], action: "Adjust playback speed" },
    ],
  },
]);

export function shortcutParts(shortcut: string): string[] {
  return platformShortcutParts(shortcut);
}

function rawShortcutParts(shortcut: string): string[] {
  return shortcut.split(" + ");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\bcontrol\b/g, "ctrl")
    .replace(/\bcommand\b/g, "cmd")
    .replace(/\boption\b/g, "alt")
    .replace(/\breturn\b/g, "enter")
    .replace(/\bspace\s*bar\b/g, "space")
    .replace(/\bspacebar\b/g, "space")
    .replace(/,/g, "comma")
    .replace(/-/g, "minus")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeKeyPart(part: string): string {
  const trimmed = part.trim();
  if (trimmed === "+") return "plus";
  if (trimmed === "-") return "minus";
  if (trimmed === ",") return "comma";
  return normalizeText(trimmed);
}

function keyPartVariants(part: string): string[] {
  const trimmed = part.trim();
  if (trimmed === "Mod") {
    return ["ctrl", "cmd"];
  }

  if (trimmed.includes("/")) {
    return unique([
      normalizeKeyPart(trimmed),
      ...trimmed.split("/").map((candidate) => normalizeKeyPart(candidate)),
    ]);
  }

  if (trimmed.toLowerCase().startsWith("arrow ")) {
    return unique([normalizeKeyPart(trimmed), normalizeKeyPart(trimmed.slice(6))]);
  }

  if (trimmed === "0-9") {
    return ["09", "digits", "digit", "numbers", "number"];
  }

  return [normalizeKeyPart(trimmed)];
}

function combineVariants(parts: readonly string[][]): string[] {
  return parts.reduce<string[]>(
    (prefixes, partVariants) =>
      prefixes.flatMap((prefix) => partVariants.map((variant) => `${prefix}${variant}`)),
    [""],
  );
}

function combinePartVariants(parts: readonly string[][]): string[][] {
  return parts.reduce<string[][]>(
    (prefixes, partVariants) =>
      prefixes.flatMap((prefix) =>
        partVariants.map((variant) => [...prefix, variant]),
      ),
    [[]],
  );
}

export function normalizedShortcutVariants(shortcut: string): string[] {
  return unique([
    normalizeText(shortcut),
    ...combineVariants(rawShortcutParts(shortcut).map(keyPartVariants)),
  ]);
}

function shortcutPartSequences(shortcut: string): string[][] {
  return combinePartVariants(rawShortcutParts(shortcut).map(keyPartVariants));
}

const MODIFIER_KEYS = new Set(["ctrl", "cmd", "alt", "shift"]);
const DIRECTION_KEYS = new Set(["left", "right", "up", "down"]);
const NAMED_KEYS = new Set([
  ...MODIFIER_KEYS,
  ...DIRECTION_KEYS,
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  "enter",
  "tab",
  "space",
  "comma",
  "plus",
  "minus",
  "digits",
  "digit",
  "numbers",
  "number",
  "09",
]);

interface ParsedShortcutQuery {
  parts: string[];
  candidate: string;
}

function parsedShortcutQuery(parts: readonly string[]): ParsedShortcutQuery {
  return {
    parts: [...parts],
    candidate: parts.join(""),
  };
}

function isKnownShortcutPart(part: string): boolean {
  return NAMED_KEYS.has(part) || /^f\d{1,2}$/.test(part) || /^[a-z0-9]$/.test(part);
}

function searchLabelsForKeyPart(part: string): string[] {
  if (part === "ctrl") return ["ctrl"];
  if (part === "cmd") return ["cmd"];
  if (part === "alt") return ["alt"];
  if (part === "space") return ["space"];
  if (DIRECTION_KEYS.has(part)) return [part, `arrow${part}`];
  return [part];
}

function isSearchableShortcutPart(part: string): boolean {
  return isKnownShortcutPart(part)
    || [...NAMED_KEYS].some((knownPart) =>
      searchLabelsForKeyPart(knownPart).some((label) => label.startsWith(part)),
    );
}

function canMatchKeyPartPrefix(keyPart: string, queryPart: string): boolean {
  if (MODIFIER_KEYS.has(keyPart)) return queryPart.length >= 1;
  if (DIRECTION_KEYS.has(keyPart) || keyPart.startsWith("arrow")) {
    return queryPart.length >= 2;
  }
  if (keyPart === "plus" || keyPart === "minus" || keyPart === "comma") {
    return queryPart.length >= 2;
  }
  if (keyPart === "space") return queryPart.length >= 2;
  if (keyPart === "09") return queryPart === "0" || queryPart === "09";
  return queryPart.length >= 1;
}

function normalizeQueryParts(parts: readonly string[]): string[] {
  const normalized = parts.map((part) => normalizeKeyPart(part)).filter(Boolean);
  const merged: string[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const part = normalized[index];
    const next = normalized[index + 1];
    if (
      part === "arrow"
      && next
      && [...DIRECTION_KEYS].some((direction) => direction.startsWith(next))
    ) {
      merged.push(next);
      index += 1;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function shortcutPartsAreSearchable(parts: readonly string[]): boolean {
  return parts.length > 0 && parts.every(isSearchableShortcutPart);
}

function parsePlusSeparatedShortcutQuery(value: string): ParsedShortcutQuery | undefined {
  const trimmed = value.trim();
  if (!trimmed.includes("+")) return undefined;
  if (trimmed === "+") return parsedShortcutQuery(["plus"]);

  const plusKeyMatch = trimmed.match(/\+\s*\+$/);
  if (plusKeyMatch) {
    const prefix = trimmed.slice(0, plusKeyMatch.index).trim();
    const parts = normalizeQueryParts(prefix.split("+"));
    if (!shortcutPartsAreSearchable(parts)) return undefined;
    return parsedShortcutQuery([...parts, "plus"]);
  }

  const parts = normalizeQueryParts(trimmed.split("+"));
  if (!shortcutPartsAreSearchable(parts)) return undefined;
  return parsedShortcutQuery(parts);
}

function parseSpaceSeparatedShortcutQuery(value: string): ParsedShortcutQuery | undefined {
  const parts = normalizeQueryParts(value.trim().split(/\s+/));
  if (!shortcutPartsAreSearchable(parts)) return undefined;
  return parsedShortcutQuery(parts);
}

function parseShortcutQuery(query: string): ParsedShortcutQuery | undefined {
  const trimmed = query.trim();
  if (trimmed.length === 0) return undefined;
  return parsePlusSeparatedShortcutQuery(trimmed)
    ?? parseSpaceSeparatedShortcutQuery(trimmed);
}

export function normalizedShortcutQueryCandidates(query: string): string[] {
  const shortcut = parseShortcutQuery(query);
  return shortcut ? [shortcut.candidate] : [normalizeText(query.trim())].filter(Boolean);
}

function shortcutSequenceMatches(
  sequence: readonly string[],
  query: ParsedShortcutQuery,
): boolean {
  let sequenceIndex = 0;
  for (const queryPart of query.parts) {
    let found = false;
    while (sequenceIndex < sequence.length) {
      const sequencePart = sequence[sequenceIndex];
      sequenceIndex += 1;
      if (shortcutPartMatchesQueryPart(sequencePart, queryPart)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function shortcutPartMatchesQueryPart(
  keyPart: string,
  queryPart: string,
): boolean {
  if (keyPart === queryPart) return true;
  return searchLabelsForKeyPart(keyPart).some((label) =>
    label.startsWith(queryPart) && canMatchKeyPartPrefix(keyPart, queryPart),
  );
}

function shortcutItemMatchesShortcutQuery(
  item: ShortcutItem,
  query: ParsedShortcutQuery,
): boolean {
  return item.keys.some((key) =>
    shortcutPartSequences(key).some((sequence) =>
      shortcutSequenceMatches(sequence, query),
    ),
  );
}

export function shortcutItemMatches(
  item: ShortcutItem,
  groupTitle: string,
  query: string,
): boolean {
  const candidates = normalizedShortcutQueryCandidates(query);
  if (candidates.length === 0) return query.trim().length === 0;

  const shortcutQuery = parseShortcutQuery(query);
  if (shortcutQuery) {
    return shortcutItemMatchesShortcutQuery(item, shortcutQuery);
  }

  const haystacks = unique([
    normalizeText(item.action),
    normalizeText(item.context ?? ""),
    normalizeText(groupTitle),
  ]);

  return candidates.some((candidate) =>
    haystacks.some((haystack) => haystack.includes(candidate)),
  );
}

function filterShortcutGroupsByPredicate(
  groups: readonly ShortcutGroup[],
  predicate: (item: ShortcutItem, group: ShortcutGroup) => boolean,
): ShortcutGroup[] {
  return groups.flatMap((group) => {
    const items = group.items.filter((item) => predicate(item, group));
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

export function filterShortcutGroups(
  groups: readonly ShortcutGroup[],
  query: string,
): ShortcutGroup[] {
  if (query.trim().length === 0) return [...groups];

  const candidates = normalizedShortcutQueryCandidates(query);
  if (candidates.length === 0) return [];

  const shortcutQuery = parseShortcutQuery(query);
  if (shortcutQuery) {
    return filterShortcutGroupsByPredicate(groups, (item) =>
      shortcutItemMatchesShortcutQuery(item, shortcutQuery),
    );
  }

  return filterShortcutGroupsByPredicate(groups, (item, group) =>
    shortcutItemMatches(item, group.title, query),
  );
}

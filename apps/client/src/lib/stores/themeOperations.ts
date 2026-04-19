/**
 * Pure helpers for the user-theme CRUD pipeline.
 *
 * The reactive store in `theme.svelte.ts` glues these together with a `$state`
 * map of user themes, but the merge / clone / naming logic itself is pure so
 * it can be tested in isolation.
 */

import type { Theme, ThemeId } from "./themes";

const MAX_DISPLAY_NAME_LENGTH = 60;
const NAME_SUFFIX_CAP = 999;

/**
 * Deep-copy a theme, replacing its identity (id + displayName) with the
 * supplied values. The eventPalette and any override blocks are cloned at
 * the top level so later mutations on the copy do not bleed back into the
 * source theme.
 */
export function cloneTheme(
  source: Theme,
  id: ThemeId,
  displayName: string,
): Theme {
  const copy: Theme = {
    id,
    displayName,
    base: source.base,
    blendCanvas: source.blendCanvas,
    eventPalette: { ...source.eventPalette },
  };
  if (source.appTokenOverrides) {
    copy.appTokenOverrides = { ...source.appTokenOverrides };
  }
  if (source.calendarTokenOverrides) {
    copy.calendarTokenOverrides = { ...source.calendarTokenOverrides };
  }
  return copy;
}

/**
 * Apply a partial patch to a theme, returning a new Theme.
 *
 * - The id is preserved (callers cannot rename ids through a patch).
 * - eventPalette merges (single-slot edits do not require sending all 24).
 * - appTokenOverrides / calendarTokenOverrides REPLACE the existing block
 *   when present (the editor manages the full override set), and an empty
 *   object collapses to `undefined` so the on-disk JSON stays minimal.
 */
export function mergeThemePatch(
  current: Theme,
  patch: Partial<Omit<Theme, "id">>,
): Theme {
  const next: Theme = {
    ...current,
    ...patch,
    id: current.id,
    eventPalette: patch.eventPalette
      ? { ...current.eventPalette, ...patch.eventPalette }
      : current.eventPalette,
  };
  if (patch.appTokenOverrides !== undefined) {
    next.appTokenOverrides =
      Object.keys(patch.appTokenOverrides).length > 0
        ? { ...patch.appTokenOverrides }
        : undefined;
  }
  if (patch.calendarTokenOverrides !== undefined) {
    next.calendarTokenOverrides =
      Object.keys(patch.calendarTokenOverrides).length > 0
        ? { ...patch.calendarTokenOverrides }
        : undefined;
  }
  return next;
}

/**
 * Pick a display name that does not collide with any name in `existing`.
 * Comparison is case-insensitive (matches what users perceive). Falls back
 * to the unsuffixed base after a sanity-bound number of attempts.
 */
export function nextUniqueDisplayName(
  base: string,
  existing: Iterable<string>,
): string {
  const taken = new Set<string>();
  for (const name of existing) taken.add(name.toLowerCase());
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < NAME_SUFFIX_CAP; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

/**
 * Trim and length-cap a user-supplied display name. Returns `undefined` if
 * the name is empty after trimming so callers can reject the rename.
 */
export function normalizeDisplayName(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

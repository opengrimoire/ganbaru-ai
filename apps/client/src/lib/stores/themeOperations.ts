/**
 * Pure helpers for the user-theme CRUD pipeline.
 *
 * The reactive store in `theme.svelte.ts` glues these together with a `$state`
 * map of user themes, but the merge / clone / naming logic itself is pure so
 * it can be tested in isolation.
 */

import {
  resolveAppTokens,
  resolveCalendarTokens,
  type Theme,
  type ThemeId,
} from "./themes";

const MAX_DISPLAY_NAME_LENGTH = 60;
const NAME_SUFFIX_CAP = 999;

/**
 * Deep-copy a theme, replacing its identity (id + displayName) with the
 * supplied values.
 *
 * The clone's strategy depends on whether the source has a `sources` field:
 *
 * - **Source-driven (sources present):** copy `sources` and only the explicit
 *   overrides. The three-layer resolver will re-derive the rest from sources,
 *   so manipulating source colors on the clone keeps propagating through
 *   derived tokens. Seed fields still snapshot the effective resolved values
 *   so per-row reset restores what the source theme looked like at clone time.
 * - **Override-only (no sources):** snapshot the full set of resolved tokens
 *   into both the working overrides AND the seed fields. The clone becomes
 *   visually self-contained even before the user edits anything. This is the
 *   path built-ins take when duplicated.
 */
export function cloneTheme(
  source: Theme,
  id: ThemeId,
  displayName: string,
): Theme {
  const resolvedApp = resolveAppTokens(source);
  const resolvedCal = resolveCalendarTokens(source);
  const palette = [...source.eventPalette];
  const next: Theme = {
    id,
    displayName,
    base: source.base,
    blendCanvas: source.blendCanvas,
    eventPalette: palette,
    seedAppTokens: { ...resolvedApp },
    seedCalendarTokens: { ...resolvedCal },
    seedEventPalette: [...palette],
  };
  if (source.sources) {
    next.sources = { ...source.sources };
    if (source.appTokenOverrides) {
      next.appTokenOverrides = { ...source.appTokenOverrides };
    }
    if (source.calendarTokenOverrides) {
      next.calendarTokenOverrides = { ...source.calendarTokenOverrides };
    }
  } else {
    next.appTokenOverrides = { ...resolvedApp };
    next.calendarTokenOverrides = { ...resolvedCal };
  }
  return next;
}

/**
 * Apply a partial patch to a theme, returning a new Theme.
 *
 * - The id is preserved (callers cannot rename ids through a patch).
 * - eventPalette is an array; passing it replaces the palette wholesale,
 *   so callers should spread the current palette and overwrite the slots
 *   they want to change before handing it in.
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
      ? [...patch.eventPalette]
      : current.eventPalette,
  };
  if ("sources" in patch) {
    next.sources = patch.sources ? { ...patch.sources } : undefined;
  }
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

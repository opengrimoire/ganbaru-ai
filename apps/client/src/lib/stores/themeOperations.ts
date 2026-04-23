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
 * supplied values. The clone always carries a `sources` palette:
 *
 * - If the source has one, copy it verbatim.
 * - Otherwise synthesize sources by sampling canvas, ink, primary,
 *   destructive, confirm, and warning from the source's resolved tokens.
 *   Calendar canvas is not a source: it auto-derives from the app canvas
 *   via a direction-aware OKLab ΔL offset and is pinnable through
 *   `calendarTokenOverrides["--cal-bg"]` when the user wants to isolate it.
 *
 * Explicit overrides on the source are preserved verbatim, but no new
 * identity overrides are generated: the derivation is already calibrated
 * to reproduce the dark built-in's surface hierarchy on any canvas, so
 * the clone naturally tracks its sources. Editing a source (e.g. canvas)
 * on the clone cascades through the full surface stack without fighting
 * pinned tokens. Seeds snapshot the resolved set for per-row reset.
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
    seedBlendCanvas: source.blendCanvas,
  };
  if (source.sources) {
    next.sources = { ...source.sources };
  } else {
    next.sources = {
      canvas: resolvedApp["--background"],
      ink: resolvedApp["--foreground"],
      primary: resolvedApp["--primary"],
      destructive: resolvedApp["--destructive"],
      confirm: resolvedApp["--action-confirm"],
      warning: resolvedApp["--status-tentative"],
    };
  }
  next.seedSources = { ...next.sources };

  if (source.appTokenOverrides) {
    const copy = { ...source.appTokenOverrides };
    if (Object.keys(copy).length > 0) {
      next.appTokenOverrides = copy;
      next.seedAppTokenOverrides = { ...copy };
    }
  }
  if (source.calendarTokenOverrides) {
    const copy = { ...source.calendarTokenOverrides };
    if (Object.keys(copy).length > 0) {
      next.calendarTokenOverrides = copy;
      next.seedCalendarTokenOverrides = { ...copy };
    }
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

/**
 * Fill in `seed*` snapshots for a theme that predates the seed feature.
 *
 * A legacy user theme (cloned before seeds landed) may carry `sources` but
 * no `seedSources`, which disables row-level reset and "Reset all". This
 * helper copies the current live values as the synthetic seed set: the
 * theme's present state is treated as the reset target. It is a no-op for
 * themes that already have seeds, so loading is safely idempotent across
 * app restarts.
 */
export function synthesizeSeedsIfMissing(theme: Theme): Theme {
  if (theme.seedSources !== undefined) return theme;
  const resolvedApp = resolveAppTokens(theme);
  const resolvedCal = resolveCalendarTokens(theme);
  const next: Theme = { ...theme };
  next.seedAppTokens = { ...resolvedApp };
  next.seedCalendarTokens = { ...resolvedCal };
  next.seedEventPalette = [...theme.eventPalette];
  next.seedBlendCanvas = theme.blendCanvas;
  if (theme.sources) {
    next.seedSources = { ...theme.sources };
  } else {
    next.seedSources = {
      canvas: resolvedApp["--background"],
      ink: resolvedApp["--foreground"],
      primary: resolvedApp["--primary"],
      destructive: resolvedApp["--destructive"],
      confirm: resolvedApp["--action-confirm"],
      warning: resolvedApp["--status-tentative"],
    };
  }
  if (
    theme.appTokenOverrides &&
    Object.keys(theme.appTokenOverrides).length > 0
  ) {
    next.seedAppTokenOverrides = { ...theme.appTokenOverrides };
  }
  if (
    theme.calendarTokenOverrides &&
    Object.keys(theme.calendarTokenOverrides).length > 0
  ) {
    next.seedCalendarTokenOverrides = { ...theme.calendarTokenOverrides };
  }
  return next;
}

/**
 * Pure helpers for the user-theme CRUD pipeline.
 *
 * The reactive store in `theme.svelte.ts` glues these together with a `$state`
 * map of user themes, but the merge / clone / naming logic itself is pure so
 * it can be tested in isolation.
 */

import {
  DERIVATION_ENGINE_VERSION,
  resolveAppTokens,
  resolveCalendarTokens,
  type Theme,
  type ThemeId,
  type ThemeSources,
  type UserTheme,
} from "./themes";

const MAX_DISPLAY_NAME_LENGTH = 60;
const NAME_SUFFIX_CAP = 999;

/**
 * Deep-copy a theme into a new {@link UserTheme} with a fresh identity.
 *
 * The clone always carries a `sources` palette:
 * - User-theme source: copy the existing sources, isolated flags, snapshots.
 * - Built-in source: synthesize sources by sampling canvas, ink, primary,
 *   destructive, confirm, and warning from the resolved tokens. Calendar
 *   canvas is not a source: it auto-derives from the app canvas via a
 *   direction-aware OKLab ΔL offset and is pinnable through the
 *   `calendarIsolated` flag set on `--cal-bg` when the user wants to
 *   isolate it from the app canvas.
 *
 * Identity overrides for derived tokens are NOT captured: the derivation
 * is calibrated to reproduce the dark built-in's surface hierarchy on any
 * canvas, so the clone naturally tracks its sources. Editing canvas on the
 * clone cascades through every non-isolated surface. Seeds snapshot the
 * live state at clone time for per-row reset and "Reset all".
 */
export function cloneTheme(
  source: Theme,
  id: ThemeId,
  displayName: string,
): UserTheme {
  const resolvedApp = resolveAppTokens(source);
  const resolvedCal = resolveCalendarTokens(source);
  const palette = [...source.eventPalette];
  const sources: ThemeSources =
    source.kind === "user"
      ? { ...source.sources }
      : synthesizeSourcesFromResolved(resolvedApp);
  const appIsolated =
    source.kind === "user"
      ? new Set(source.appIsolated)
      : new Set<string>();
  const calIsolated =
    source.kind === "user"
      ? new Set(source.calendarIsolated)
      : new Set<string>();
  // Carry the source's scheme verbatim. Built-ins peg scheme to base, so
  // a clone of "Light" starts as scheme=light. Cloning a user theme that
  // was manually flipped preserves the flip on the clone.
  const scheme = source.scheme;
  return {
    kind: "user",
    id,
    displayName,
    base: source.base,
    scheme,
    blendCanvas: source.blendCanvas,
    eventPalette: palette,
    derivationEngineVersion:
      source.kind === "user"
        ? source.derivationEngineVersion
        : DERIVATION_ENGINE_VERSION,
    sources,
    appTokens: { ...resolvedApp },
    calendarTokens: { ...resolvedCal },
    appIsolated,
    calendarIsolated: calIsolated,
    seedSources: { ...sources },
    seedAppTokens: { ...resolvedApp },
    seedCalendarTokens: { ...resolvedCal },
    seedAppIsolated: new Set(appIsolated),
    seedCalendarIsolated: new Set(calIsolated),
    seedEventPalette: [...palette],
    seedBlendCanvas: source.blendCanvas,
    seedScheme: scheme,
  };
}

/**
 * Synthesize a six-color sources palette from a resolved app-token
 * snapshot. Used when cloning a built-in theme into a user theme: every
 * UserTheme requires sources, and the resolved tokens carry the right
 * starting points (canvas = --background, ink = --foreground, etc.).
 */
export function synthesizeSourcesFromResolved(
  resolvedApp: Readonly<Record<string, string>>,
): ThemeSources {
  return {
    canvas: resolvedApp["--background"],
    ink: resolvedApp["--foreground"],
    primary: resolvedApp["--primary"],
    destructive: resolvedApp["--destructive"],
    confirm: resolvedApp["--action-confirm"],
    warning: resolvedApp["--status-tentative"],
  };
}

/**
 * Merge a small subset of fields onto a user theme. Most patches now go
 * through targeted store mutators (updateSourceValue, isolateToken, etc.);
 * this helper survives only for fields that don't fit the targeted paths:
 * displayName rename, eventPalette replacement, blendCanvas pin.
 */
export type UserThemePatch = Partial<
  Pick<UserTheme, "displayName" | "eventPalette" | "blendCanvas">
>;

export function mergeThemePatch(
  current: UserTheme,
  patch: UserThemePatch,
): UserTheme {
  return {
    ...current,
    displayName: patch.displayName ?? current.displayName,
    eventPalette: patch.eventPalette
      ? [...patch.eventPalette]
      : current.eventPalette,
    blendCanvas: patch.blendCanvas ?? current.blendCanvas,
  };
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

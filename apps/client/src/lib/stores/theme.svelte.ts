import {
  type Theme,
  type ThemeId,
  BUILTIN_THEME_REGISTRY,
  DEFAULT_THEME_ID,
  computeThemeTokenOps,
  getThemeById,
  isBuiltinThemeId,
  generateThemeId,
  serializeTheme,
  validateThemeJson,
  darkTheme,
  lightTheme,
} from "./themes";
import {
  cloneTheme,
  mergeThemePatch,
  nextUniqueDisplayName,
  normalizeDisplayName,
} from "./themeOperations";
import { getConfigKey, setConfigKey } from "../vault/config";

const ACTIVE_KEY = "theme.activeId";
const CUSTOM_KEY = "themes.user";

function loadSavedCustomThemes(): Record<ThemeId, Theme> {
  const saved = getConfigKey<Record<string, unknown> | undefined>(
    CUSTOM_KEY,
    undefined,
  );
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const out: Record<ThemeId, Theme> = {};
  for (const key of Object.keys(saved)) {
    if (!Object.hasOwn(saved, key)) continue;
    if (isBuiltinThemeId(key)) continue;
    const value = saved[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const result = validateThemeJson({ ...(value as Record<string, unknown>), id: key });
    if (result.ok) out[key] = result.theme;
  }
  return out;
}

let customThemes = $state<Record<ThemeId, Theme>>(loadSavedCustomThemes());

function combinedRegistry(): Readonly<Record<ThemeId, Theme>> {
  return { ...BUILTIN_THEME_REGISTRY, ...customThemes };
}

function loadSavedThemeId(): ThemeId {
  const saved = getConfigKey<string | undefined>(ACTIVE_KEY, undefined);
  if (saved && getThemeById(saved, combinedRegistry())) return saved;
  return DEFAULT_THEME_ID;
}

let activeId = $state<ThemeId>(loadSavedThemeId());

// Tracks which CSS custom properties the active theme injected. When the
// user switches, any key set by the previous theme but not the new one is
// removed from the root so stale colors do not leak across switches.
let appliedTokenKeys = new Set<string>();

function resolveActive(): Theme {
  return getThemeById(activeId, combinedRegistry()) ?? darkTheme;
}

function applyThemeToDom(): void {
  if (typeof document === "undefined") return;
  const theme = resolveActive();
  const root = document.documentElement;
  root.classList.toggle("dark", theme.base === "dark");
  const { toSet, toClear, applied } = computeThemeTokenOps(
    theme,
    appliedTokenKeys,
  );
  for (const [key, value] of toSet) root.style.setProperty(key, value);
  for (const key of toClear) root.style.removeProperty(key);
  appliedTokenKeys = applied;
}

// Apply the initial theme on module load so first paint matches the stored
// preference (no FOUC on light-mode boot).
if (typeof document !== "undefined") {
  applyThemeToDom();
}

function persistCustomThemes(): void {
  setConfigKey(CUSTOM_KEY, $state.snapshot(customThemes));
}

function setTheme(id: ThemeId): void {
  if (!getThemeById(id, combinedRegistry())) return;
  activeId = id;
  applyThemeToDom();
  setConfigKey(ACTIVE_KEY, id);
}

function existingDisplayNames(): string[] {
  return Object.values(combinedRegistry()).map((t) => t.displayName);
}

function createTheme(seedFromId?: ThemeId): ThemeId {
  const registry = combinedRegistry();
  const seed = seedFromId
    ? (registry[seedFromId] ?? darkTheme)
    : (registry[activeId] ?? darkTheme);
  const id = generateThemeId(registry);
  const displayName = nextUniqueDisplayName("New theme", existingDisplayNames());
  customThemes[id] = cloneTheme(seed, id, displayName);
  persistCustomThemes();
  return id;
}

function duplicateTheme(sourceId: ThemeId): ThemeId | undefined {
  const registry = combinedRegistry();
  const source = registry[sourceId];
  if (!source) return undefined;
  const id = generateThemeId(registry);
  const displayName = nextUniqueDisplayName(
    `${source.displayName} copy`,
    existingDisplayNames(),
  );
  customThemes[id] = cloneTheme(source, id, displayName);
  persistCustomThemes();
  return id;
}

function updateTheme(id: ThemeId, patch: Partial<Omit<Theme, "id">>): boolean {
  if (isBuiltinThemeId(id)) return false;
  const current = customThemes[id];
  if (!current) return false;
  customThemes[id] = mergeThemePatch(current, patch);
  persistCustomThemes();
  if (id === activeId) applyThemeToDom();
  return true;
}

function renameTheme(id: ThemeId, displayName: string): boolean {
  const normalized = normalizeDisplayName(displayName);
  if (normalized === undefined) return false;
  return updateTheme(id, { displayName: normalized });
}

function deleteTheme(id: ThemeId): boolean {
  if (isBuiltinThemeId(id)) return false;
  if (!Object.hasOwn(customThemes, id)) return false;
  delete customThemes[id];
  persistCustomThemes();
  if (id === activeId) {
    activeId = DEFAULT_THEME_ID;
    applyThemeToDom();
    setConfigKey(ACTIVE_KEY, activeId);
  }
  return true;
}

/**
 * Whether the theme can be reset to its clone-time state. Requires the
 * input seeds (seedSources and friends) to exist, which cloneTheme populates
 * on all new user themes. Old themes saved before the reset feature was
 * introduced lack these fields and cannot be reset.
 */
function canResetTheme(id: ThemeId): boolean {
  const theme = customThemes[id];
  if (!theme) return false;
  return theme.seedSources !== undefined;
}

/**
 * Restore a user theme to the inputs captured at clone time: sources,
 * overrides, blend canvas, and event palette. Resolved-token seeds are left
 * alone because they describe outputs, not inputs.
 */
function resetTheme(id: ThemeId): boolean {
  if (isBuiltinThemeId(id)) return false;
  const current = customThemes[id];
  if (!current) return false;
  if (!current.seedSources) return false;
  const patch: Partial<Omit<Theme, "id">> = {
    sources: { ...current.seedSources },
    appTokenOverrides: current.seedAppTokenOverrides
      ? { ...current.seedAppTokenOverrides }
      : {},
    calendarTokenOverrides: current.seedCalendarTokenOverrides
      ? { ...current.seedCalendarTokenOverrides }
      : {},
    blendCanvas: current.seedBlendCanvas ?? current.blendCanvas,
    eventPalette: current.seedEventPalette
      ? [...current.seedEventPalette]
      : current.eventPalette,
  };
  customThemes[id] = mergeThemePatch(current, patch);
  persistCustomThemes();
  if (id === activeId) applyThemeToDom();
  return true;
}

export type ImportThemeResult =
  | { ok: true; id: ThemeId }
  | { ok: false; errors: string[] };

function importTheme(json: string): ImportThemeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      errors: [`could not parse JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const result = validateThemeJson(parsed);
  if (!result.ok) return result;
  const registry = combinedRegistry();
  const incomingId = result.theme.id;
  const finalId =
    isBuiltinThemeId(incomingId) || Object.hasOwn(registry, incomingId)
      ? generateThemeId(registry, incomingId)
      : incomingId;
  customThemes[finalId] = { ...result.theme, id: finalId };
  persistCustomThemes();
  return { ok: true, id: finalId };
}

function exportTheme(id: ThemeId): string | undefined {
  const theme = combinedRegistry()[id];
  if (!theme) return undefined;
  return serializeTheme(theme);
}

export type ReplaceThemeResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Replace a user theme in place from raw JSON. The id is locked to the
 * existing slot so the editor's "Apply changes" path cannot accidentally
 * fork into a new theme. Built-in ids and unknown ids are rejected.
 */
function replaceTheme(id: ThemeId, json: string): ReplaceThemeResult {
  if (isBuiltinThemeId(id)) {
    return { ok: false, errors: ["built-in themes cannot be edited"] };
  }
  if (!Object.hasOwn(customThemes, id)) {
    return { ok: false, errors: ["theme not found"] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `could not parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  // Force the validator to evaluate against the locked id so callers cannot
  // sneak through a rename by editing the id field in the textarea.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    (parsed as Record<string, unknown>).id = id;
  }
  const result = validateThemeJson(parsed);
  if (!result.ok) return result;
  customThemes[id] = { ...result.theme, id };
  persistCustomThemes();
  if (id === activeId) applyThemeToDom();
  return { ok: true };
}

/**
 * Access the active theme and mutators. Returns an object of getters so
 * Svelte's reactivity tracks reads and re-runs derived values when the
 * active theme changes.
 */
export function getTheme() {
  return {
    get current(): Theme {
      return resolveActive();
    },
    get id(): ThemeId {
      return activeId;
    },
    get isDark(): boolean {
      return resolveActive().base === "dark";
    },
    /** Combined registry of built-in and user themes. */
    get registry(): Readonly<Record<ThemeId, Theme>> {
      return combinedRegistry();
    },
    /** Snapshot of just the user-authored themes. */
    get customThemes(): Readonly<Record<ThemeId, Theme>> {
      return customThemes;
    },
    isBuiltin(id: ThemeId): boolean {
      return isBuiltinThemeId(id);
    },
    setTheme,
    createTheme,
    duplicateTheme,
    updateTheme,
    renameTheme,
    deleteTheme,
    canResetTheme,
    resetTheme,
    importTheme,
    exportTheme,
    replaceTheme,
    /**
     * Cycle between the two built-in themes. Used by the title bar
     * sun/moon toggle. For the full multi-theme selector, use setTheme.
     */
    toggle() {
      const nextId = activeId === lightTheme.id ? darkTheme.id : lightTheme.id;
      setTheme(nextId);
    },
  };
}

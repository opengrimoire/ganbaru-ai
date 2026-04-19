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

function uniqueDisplayName(base: string): string {
  const existing = new Set(
    Object.values(combinedRegistry()).map((t) => t.displayName.toLowerCase()),
  );
  if (!existing.has(base.toLowerCase())) return base;
  for (let i = 2; i < 999; i++) {
    const candidate = `${base} ${i}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

function deepCopyTheme(source: Theme, id: ThemeId, displayName: string): Theme {
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

function createTheme(seedFromId?: ThemeId): ThemeId {
  const registry = combinedRegistry();
  const seed = seedFromId
    ? (registry[seedFromId] ?? darkTheme)
    : (registry[activeId] ?? darkTheme);
  const id = generateThemeId(registry);
  const displayName = uniqueDisplayName("New theme");
  customThemes[id] = deepCopyTheme(seed, id, displayName);
  persistCustomThemes();
  return id;
}

function duplicateTheme(sourceId: ThemeId): ThemeId | undefined {
  const registry = combinedRegistry();
  const source = registry[sourceId];
  if (!source) return undefined;
  const id = generateThemeId(registry);
  const displayName = uniqueDisplayName(`${source.displayName} copy`);
  customThemes[id] = deepCopyTheme(source, id, displayName);
  persistCustomThemes();
  return id;
}

function updateTheme(id: ThemeId, patch: Partial<Omit<Theme, "id">>): boolean {
  if (isBuiltinThemeId(id)) return false;
  const current = customThemes[id];
  if (!current) return false;
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
  customThemes[id] = next;
  persistCustomThemes();
  if (id === activeId) applyThemeToDom();
  return true;
}

function renameTheme(id: ThemeId, displayName: string): boolean {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return false;
  return updateTheme(id, { displayName: trimmed.slice(0, 60) });
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
    importTheme,
    exportTheme,
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

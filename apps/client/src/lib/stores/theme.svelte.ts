import {
  type Theme,
  type ThemeId,
  THEME_REGISTRY,
  DEFAULT_THEME_ID,
  computeThemeTokenOps,
  getThemeById,
  darkTheme,
  lightTheme,
} from "./themes";
import { getConfigKey, setConfigKey } from "../vault/config";

const CONFIG_KEY = "theme.activeId";

function loadSavedThemeId(): ThemeId {
  const saved = getConfigKey<string | undefined>(CONFIG_KEY, undefined);
  if (saved && getThemeById(saved)) return saved;
  return DEFAULT_THEME_ID;
}

let activeId = $state<ThemeId>(loadSavedThemeId());

// Tracks which CSS custom properties the active theme injected. When the
// user switches, any key set by the previous theme but not the new one is
// removed from the root so stale colors do not leak across switches.
let appliedTokenKeys = new Set<string>();

function applyThemeToDom(): void {
  if (typeof document === "undefined") return;
  const theme = getThemeById(activeId) ?? darkTheme;
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

function setTheme(id: ThemeId): void {
  if (!getThemeById(id)) return;
  activeId = id;
  applyThemeToDom();
  setConfigKey(CONFIG_KEY, id);
}

/**
 * Access the active theme and mutators. Returns an object of getters so
 * Svelte's reactivity tracks reads and re-runs derived values when the
 * active theme changes.
 */
export function getTheme() {
  return {
    get current(): Theme {
      return getThemeById(activeId) ?? darkTheme;
    },
    get id(): ThemeId {
      return activeId;
    },
    get isDark(): boolean {
      return (getThemeById(activeId) ?? darkTheme).base === "dark";
    },
    /** List registered themes for building a theme picker. */
    get registry(): Readonly<Record<ThemeId, Theme>> {
      return THEME_REGISTRY;
    },
    setTheme,
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

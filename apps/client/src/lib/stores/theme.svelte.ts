import {
  type Theme,
  type ThemeId,
  THEME_REGISTRY,
  DEFAULT_THEME_ID,
  getThemeById,
  darkTheme,
  lightTheme,
} from "./themes";

const STORAGE_KEY = "ganbaruai-theme";

function loadSavedThemeId(): ThemeId {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && getThemeById(saved)) return saved;
  return DEFAULT_THEME_ID;
}

let activeId = $state<ThemeId>(loadSavedThemeId());

function applyThemeToDom(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme.base === "dark");
  // Reserved: when themes ship chrome overrides, iterate here and call
  // root.style.setProperty(key, value) for each override. The built-in
  // light/dark themes rely on app.css's :root / .dark rules instead.
  if (theme.appTokenOverrides) {
    for (const [key, value] of Object.entries(theme.appTokenOverrides)) {
      root.style.setProperty(key, value);
    }
  }
  if (theme.calendarTokenOverrides) {
    for (const [key, value] of Object.entries(theme.calendarTokenOverrides)) {
      root.style.setProperty(key, value);
    }
  }
}

// Apply the initial theme on module load so first paint matches the stored
// preference (no FOUC on light-mode boot).
if (typeof document !== "undefined") {
  applyThemeToDom(getThemeById(activeId) ?? darkTheme);
}

function setTheme(id: ThemeId): void {
  const target = getThemeById(id);
  if (!target) return;
  activeId = id;
  applyThemeToDom(target);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, id);
  }
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

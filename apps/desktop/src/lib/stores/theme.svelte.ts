export type Theme = "light" | "dark";

const STORAGE_KEY = "ganbaruai-theme";

function loadSavedTheme(): Theme {
  if (typeof localStorage === "undefined") return "dark";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}

let current = $state<Theme>(loadSavedTheme());

// Apply theme class on module load
if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("dark", loadSavedTheme() === "dark");
}

export function getTheme() {
  return {
    get current() {
      return current;
    },
    get isDark() {
      return current === "dark";
    },
    toggle() {
      current = current === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", current === "dark");
      localStorage.setItem(STORAGE_KEY, current);
    },
  };
}

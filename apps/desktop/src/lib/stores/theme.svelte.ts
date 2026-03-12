export type Theme = "light" | "dark";

let current = $state<Theme>("dark");

// Apply dark class on module load so first paint is dark
if (typeof document !== "undefined") {
  document.documentElement.classList.add("dark");
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
    },
  };
}

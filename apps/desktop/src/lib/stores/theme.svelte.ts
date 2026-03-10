export type Theme = "light" | "dark";

let current = $state<Theme>("light");

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

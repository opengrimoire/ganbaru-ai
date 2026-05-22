import { parseInitialViewSearch, type View } from "$lib/navigation";

export type { View } from "$lib/navigation";

function initialView(): View {
  if (typeof window === "undefined") return "calendar";
  return parseInitialViewSearch(window.location.search) ?? "calendar";
}

let currentView = $state<View>(initialView());

export function getNavigation() {
  return {
    get current() {
      return currentView;
    },
    set current(view: View) {
      currentView = view;
    },
    navigate(view: View) {
      currentView = view;
    },
  };
}

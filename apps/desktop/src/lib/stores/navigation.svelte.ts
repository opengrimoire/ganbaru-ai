export type View = "calendar" | "kanban" | "skill-tree";

let currentView = $state<View>("calendar");

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

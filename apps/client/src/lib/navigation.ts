export const APP_VIEWS = ["calendar", "projects", "notes", "music"] as const;
export type View = (typeof APP_VIEWS)[number];

export const DETACHABLE_TAB_VIEWS = ["calendar", "projects", "notes"] as const;
export type DetachableTabView = (typeof DETACHABLE_TAB_VIEWS)[number];

const VIEW_SET = new Set<string>(APP_VIEWS);
const DETACHABLE_TAB_VIEW_SET = new Set<string>(DETACHABLE_TAB_VIEWS);

export function isView(value: unknown): value is View {
  return typeof value === "string" && VIEW_SET.has(value);
}

export function isDetachableTabView(value: unknown): value is DetachableTabView {
  return typeof value === "string" && DETACHABLE_TAB_VIEW_SET.has(value);
}

export function viewLabel(view: View): string {
  if (view === "calendar") return "Calendar";
  if (view === "projects") return "Projects";
  if (view === "notes") return "Notes";
  return "Music";
}

export function parseInitialViewSearch(search: string): View | undefined {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  return isView(view) ? view : undefined;
}

export function mainTabViews(detachedViews: ReadonlySet<DetachableTabView>): DetachableTabView[] {
  return DETACHABLE_TAB_VIEWS.filter((view) => !detachedViews.has(view));
}

export function firstMainView(detachedViews: ReadonlySet<DetachableTabView>): View {
  return mainTabViews(detachedViews)[0] ?? "music";
}

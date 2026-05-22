import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DetachableTabView } from "$lib/navigation";
import {
  DETACHED_VIEW_WINDOW_CHANGED_EVENT,
  listDetachedViews,
  type DetachedViewWindowChange,
} from "$lib/windows/detached";

let initialized = false;
let eventUnlisten: UnlistenFn | undefined;
let detachedViews = $state<ReadonlySet<DetachableTabView>>(new Set());

function setDetachedViews(nextViews: ReadonlySet<DetachableTabView>): void {
  detachedViews = new Set(nextViews);
}

async function refresh(): Promise<void> {
  try {
    setDetachedViews(await listDetachedViews());
  } catch (error) {
    console.error("Failed to refresh detached windows:", error);
  }
}

function applyChange(change: DetachedViewWindowChange): void {
  const nextViews = new Set(detachedViews);
  if (change.detached) {
    nextViews.add(change.view);
  } else {
    nextViews.delete(change.view);
  }
  detachedViews = nextViews;
}

function isDetachedViewWindowChange(value: unknown): value is DetachedViewWindowChange {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.view === "string"
    && (record.view === "calendar" || record.view === "projects" || record.view === "notes")
    && typeof record.detached === "boolean";
}

function init(): void {
  if (initialized) return;
  initialized = true;
  void refresh();
  listen<unknown>(DETACHED_VIEW_WINDOW_CHANGED_EVENT, (event) => {
    if (isDetachedViewWindowChange(event.payload)) {
      applyChange(event.payload);
    } else {
      void refresh();
    }
  }).then((unlisten) => {
    eventUnlisten = unlisten;
  }).catch((error) => {
    console.error("Failed to listen for detached window changes:", error);
  });

  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => {
      void refresh();
    });
  }
}

export function getDetachedWindows() {
  init();
  return {
    get views(): ReadonlySet<DetachableTabView> {
      return detachedViews;
    },
    markDetached(view: DetachableTabView): void {
      applyChange({ view, detached: true });
    },
    markAttached(view: DetachableTabView): void {
      applyChange({ view, detached: false });
    },
    refresh,
    destroy(): void {
      eventUnlisten?.();
      eventUnlisten = undefined;
      initialized = false;
    },
  };
}

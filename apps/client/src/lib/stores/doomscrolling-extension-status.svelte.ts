import {
  getDoomscrollingExtensionStatus,
  type DoomscrollingExtensionStatus,
} from "$lib/api/doomscrolling";
import { appSessionStartedAt } from "$lib/stores/app-session";

const EXTENSION_STATUS_POLL_MS = 15_000;

let status = $state<DoomscrollingExtensionStatus | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
let refreshPromise: Promise<void> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

async function refreshExtensionStatus(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  if (!status) loading = true;
  refreshPromise = (async () => {
    try {
      status = await getDoomscrollingExtensionStatus(appSessionStartedAt);
      error = null;
    } catch (err) {
      console.warn("Failed to read browser extension connection status:", err);
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function startExtensionStatusPolling(): () => void {
  subscriberCount += 1;
  void refreshExtensionStatus();
  if (!intervalId) {
    intervalId = setInterval(() => {
      void refreshExtensionStatus();
    }, EXTENSION_STATUS_POLL_MS);
  }
  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount > 0 || !intervalId) return;
    clearInterval(intervalId);
    intervalId = null;
  };
}

export function getDoomscrollingExtensionConnection() {
  return {
    get status(): DoomscrollingExtensionStatus | null {
      return status;
    },
    get loading(): boolean {
      return loading;
    },
    get error(): string | null {
      return error;
    },
    refresh(): Promise<void> {
      return refreshExtensionStatus();
    },
    start(): () => void {
      return startExtensionStatusPolling();
    },
  };
}

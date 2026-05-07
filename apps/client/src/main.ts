import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import "@fontsource-variable/inter";
import "./app.css";
import { mount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ensureConfigLoaded } from "./lib/vault/config";
import { hydrateUserThemes } from "./lib/stores/theme.svelte";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function revealMainWindow(): Promise<void> {
  await nextFrame();
  await nextFrame();
  try {
    await getCurrentWindow().show();
  } catch (error) {
    console.warn("Failed to reveal the main window:", error);
  }
}

// Boot order: hydrate vault/config.json, then load user themes from
// SQLite, then mount App. Config and theme reads block first paint so
// the initial render matches what the user has on disk (no flash of
// defaults). The one-shot calendar timezone migration runs from
// `App.svelte`'s onMount instead, gating only `calendar.load()`: the
// migration is idempotent (short-circuits once the marker is set), so on
// every boot after the first successful run it is a single config read,
// and on first run only the calendar grid waits while the rest of the
// chrome paints immediately.
const appPromise = (async () => {
  try {
    await ensureConfigLoaded();
    await hydrateUserThemes();
    const { default: App } = await import("./App.svelte");
    const app = mount(App, {
      target: document.getElementById("app")!,
    });
    await revealMainWindow();
    return app;
  } catch (error) {
    await revealMainWindow();
    throw error;
  }
})();

export default appPromise;

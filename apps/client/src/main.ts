import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import "@fontsource-variable/inter";
import "./app.css";
import { mount } from "svelte";
import { ensureConfigLoaded } from "./lib/vault/config";
import { hydrateUserThemes } from "./lib/stores/theme.svelte";

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
  await ensureConfigLoaded();
  await hydrateUserThemes();
  const { default: App } = await import("./App.svelte");
  return mount(App, {
    target: document.getElementById("app")!,
  });
})();

export default appPromise;

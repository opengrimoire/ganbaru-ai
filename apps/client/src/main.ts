import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import "@fontsource-variable/inter";
import "./app.css";
import { mount } from "svelte";
import { ensureConfigLoaded } from "./lib/vault/config";
import { hydrateUserThemes } from "./lib/stores/theme.svelte";

// Boot order: hydrate vault/config.json, then load user themes from SQLite,
// then import App. App pulls in the theme and preferences stores, which
// read their initial values out of the vault cache and SQLite. Loading
// both first means first paint matches what the user has on disk (no
// flash of defaults).
const appPromise = (async () => {
  await ensureConfigLoaded();
  await hydrateUserThemes();
  const { default: App } = await import("./App.svelte");
  return mount(App, {
    target: document.getElementById("app")!,
  });
})();

export default appPromise;

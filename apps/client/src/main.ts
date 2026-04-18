import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import "@fontsource-variable/inter";
import "./app.css";
import { mount } from "svelte";
import { ensureConfigLoaded } from "./lib/vault/config";

// Boot order: hydrate vault/config.json before importing App. App pulls in
// the theme and preferences stores, which read their initial values out of
// the vault cache. Loading the cache first means first paint matches what
// the user has on disk (no flash of defaults).
const appPromise = (async () => {
  await ensureConfigLoaded();
  const { default: App } = await import("./App.svelte");
  return mount(App, {
    target: document.getElementById("app")!,
  });
})();

export default appPromise;

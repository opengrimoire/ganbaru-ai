import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import "@fontsource-variable/inter";
import "./app.css";
import { mount } from "svelte";
import { ensureConfigLoaded } from "./lib/vault/config";
import { hydrateUserThemes } from "./lib/stores/theme.svelte";
import { hydrateCalendarEventTimezones } from "./lib/stores/timezone-migration";

// Boot order: hydrate vault/config.json, then load user themes from SQLite,
// then run the one-shot calendar timezone migration (legacy wall-clock
// rows to UTC ISO 8601), then import App. App pulls in the theme and
// preferences stores, which read their initial values out of the vault
// cache and SQLite. Loading both first means first paint matches what the
// user has on disk (no flash of defaults). The timezone hydrator is
// idempotent: it short-circuits once the migration marker is set.
const appPromise = (async () => {
  await ensureConfigLoaded();
  await hydrateUserThemes();
  await hydrateCalendarEventTimezones();
  const { default: App } = await import("./App.svelte");
  return mount(App, {
    target: document.getElementById("app")!,
  });
})();

export default appPromise;

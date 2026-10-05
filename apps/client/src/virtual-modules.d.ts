declare module "virtual:ganbaru-ai-platform-entry" {
  const appPromise: Promise<unknown>;

  export default appPromise;
}

declare module "$lib/components/settings/distractions-desktop-selector" {
  import type {
    DistractionsAppSelection,
    DistractionsAppSelectorMode,
  } from "$lib/components/settings/DistractionsAppSelector.svelte";

  const component: typeof import("$lib/components/settings/DistractionsAppSelector.svelte").default;
  export { type DistractionsAppSelection, type DistractionsAppSelectorMode };
  export default component;
}

declare module "$lib/components/settings/distractions-browser-connection" {
  const component: typeof import("$lib/components/settings/DistractionsBrowserConnectionStatus.svelte").default;
  export default component;
}

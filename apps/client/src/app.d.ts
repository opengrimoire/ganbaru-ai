/// <reference types="svelte" />
/// <reference types="vite/client" />

// Fontsource packages are CSS-only and ship no .d.ts. Without this the TS
// language service flags every side-effect import with TS2882.
declare module "@fontsource-variable/*";
declare module "@fontsource/*";

// `main.ts` binds @js-temporal/polyfill to globalThis at boot so the rest
// of the app can use `Temporal.*` without importing per-module. This
// declaration tells TypeScript the global exists. When browsers ship the
// native API, the polyfill assignment in main.ts becomes a no-op and this
// declaration can be replaced by the standard ES type once it is published.
import type { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";
declare global {
  // eslint-disable-next-line no-var
  var Temporal: typeof TemporalPolyfill;
}

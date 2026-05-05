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
  const __GANBARUAI_APP_VERSION__: string;
  const __GANBARUAI_BUILD_REF__: string;

  // eslint-disable-next-line no-var
  var Temporal: typeof TemporalPolyfill;
  // Expose as a namespace alias too, so call sites can write
  // `Temporal.PlainDate` for both the value and the type.
  namespace Temporal {
    export type PlainDate = TemporalPolyfill.PlainDate;
    export type PlainDateTime = TemporalPolyfill.PlainDateTime;
    export type ZonedDateTime = TemporalPolyfill.ZonedDateTime;
    export type Instant = TemporalPolyfill.Instant;
    export type Duration = TemporalPolyfill.Duration;
  }
}

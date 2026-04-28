import { Temporal } from "@js-temporal/polyfill";

(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;

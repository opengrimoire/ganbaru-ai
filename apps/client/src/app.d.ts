/// <reference types="svelte" />
/// <reference types="vite/client" />

// Fontsource packages are CSS-only and ship no .d.ts. Without this the TS
// language service flags every side-effect import with TS2882.
declare module "@fontsource-variable/*";
declare module "@fontsource/*";

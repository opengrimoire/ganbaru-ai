import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import App from "./App.svelte";
import { mount } from "svelte";
import "./app.css";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;

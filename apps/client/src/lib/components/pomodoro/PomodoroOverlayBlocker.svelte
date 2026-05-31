<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  function blockEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if ("stopImmediatePropagation" in event) event.stopImmediatePropagation();
  }

  onMount(() => {
    const appWindow = getCurrentWindow();
    const reinforce = (): void => {
      appWindow.setAlwaysOnTop(true).catch(() => {});
      appWindow.setFullscreen(true).catch(() => {});
    };
    reinforce();
    const timerIds = [
      setTimeout(reinforce, 100),
      setTimeout(reinforce, 500),
      setTimeout(reinforce, 1000),
    ];
    window.addEventListener("keydown", blockEvent, true);
    window.addEventListener("contextmenu", blockEvent, true);
    return () => {
      for (const id of timerIds) clearTimeout(id);
      window.removeEventListener("keydown", blockEvent, true);
      window.removeEventListener("contextmenu", blockEvent, true);
    };
  });
</script>

<div class="fixed inset-0 h-screen w-screen select-none bg-black"></div>

<style>
  :global(html),
  :global(body),
  :global(#app) {
    background: #000 !important;
  }
</style>

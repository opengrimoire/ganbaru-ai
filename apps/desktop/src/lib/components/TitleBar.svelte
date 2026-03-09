<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";

  const win = getCurrentWindow();
  let isMaximized = $state(false);

  $effect(() => {
    win.isMaximized().then((v) => (isMaximized = v));
    let cleanup: (() => void) | undefined;
    win.onResized(() => {
      win.isMaximized().then((v) => (isMaximized = v));
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  });
</script>

<div
  data-tauri-drag-region
  class="flex h-8 w-full flex-shrink-0 select-none items-center justify-end bg-card"
>
  <button
    onclick={() => win.minimize()}
    class="flex h-8 w-11 items-center justify-center text-muted-foreground/40 hover:bg-accent hover:text-foreground"
    title="Minimize"
  >
    <Minus size={14} />
  </button>
  <button
    onclick={() => win.toggleMaximize()}
    class="flex h-8 w-11 items-center justify-center text-muted-foreground/40 hover:bg-accent hover:text-foreground"
    title={isMaximized ? "Restore" : "Maximize"}
  >
    {#if isMaximized}
      <Minimize2 size={13} />
    {:else}
      <Square size={13} />
    {/if}
  </button>
  <button
    onclick={() => win.close()}
    class="flex h-8 w-11 items-center justify-center text-muted-foreground/40 hover:bg-destructive hover:text-white"
    title="Close"
  >
    <X size={14} />
  </button>
</div>

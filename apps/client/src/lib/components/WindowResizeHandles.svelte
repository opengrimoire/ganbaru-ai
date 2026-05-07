<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  type ResizeDirection =
    | "East"
    | "North"
    | "NorthEast"
    | "NorthWest"
    | "South"
    | "SouthEast"
    | "SouthWest"
    | "West";

  let { disabled = false }: { disabled?: boolean } = $props();

  const win = getCurrentWindow();

  function startResize(direction: ResizeDirection, e: PointerEvent) {
    if (disabled || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    void win.startResizeDragging(direction).catch((error) => {
      console.error("Failed to start window resize:", error);
    });
  }

  function resizeHandle(node: HTMLElement, direction: ResizeDirection) {
    const handlePointerDown = (e: PointerEvent) => startResize(direction, e);
    node.addEventListener("pointerdown", handlePointerDown);

    return {
      destroy() {
        node.removeEventListener("pointerdown", handlePointerDown);
      },
    };
  }
</script>

{#if !disabled}
  <div aria-hidden="true" class="pointer-events-none fixed inset-0 z-[80]">
    <div
      class="pointer-events-auto absolute left-3 right-3 top-0 h-1.5 cursor-n-resize"
      use:resizeHandle={"North"}
    ></div>
    <div
      class="pointer-events-auto absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize"
      use:resizeHandle={"South"}
    ></div>
    <div
      class="pointer-events-auto absolute bottom-3 top-3 left-0 w-1.5 cursor-w-resize"
      use:resizeHandle={"West"}
    ></div>
    <div
      class="pointer-events-auto absolute bottom-3 top-3 right-0 w-1.5 cursor-e-resize"
      use:resizeHandle={"East"}
    ></div>
    <div
      class="pointer-events-auto absolute left-0 top-0 h-3 w-3 cursor-nw-resize"
      use:resizeHandle={"NorthWest"}
    ></div>
    <div
      class="pointer-events-auto absolute right-0 top-0 h-3 w-3 cursor-ne-resize"
      use:resizeHandle={"NorthEast"}
    ></div>
    <div
      class="pointer-events-auto absolute bottom-0 left-0 h-3 w-3 cursor-sw-resize"
      use:resizeHandle={"SouthWest"}
    ></div>
    <div
      class="pointer-events-auto absolute bottom-0 right-0 h-3 w-3 cursor-se-resize"
      use:resizeHandle={"SouthEast"}
    ></div>
  </div>
{/if}

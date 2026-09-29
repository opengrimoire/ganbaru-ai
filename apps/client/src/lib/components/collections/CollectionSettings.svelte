<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import X from "@lucide/svelte/icons/x";
  import { portal } from "$lib/utils/portal";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import CollectionPanel from "./CollectionPanel.svelte";
  let { label, onclose, children }: { label: string; onclose: () => void; children: Snippet } = $props();
  const { t } = getLocalization();
  let panel: HTMLDivElement | null = $state(null);

  $effect(() => {
    const node = panel;
    if (!node) return;
    const trigger = document.activeElement;
    let disposed = false;
    void tick().then(() => { if (!disposed) node.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); });
    return () => { disposed = true; if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true }); };
  });

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onclose(); return; }
    if (event.key !== "Tab" || !panel) return;
    const fields = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    const first = fields[0];
    const last = fields[fields.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
</script>

<div use:portal class="fixed inset-0 z-80 flex justify-end" data-app-floating-surface>
  <button type="button" tabindex="-1" class="absolute inset-0" aria-label={t("common.close")} onclick={onclose}></button>
  <CollectionPanel {label} bind:element={panel} aria-modal="true" class="relative h-full w-full max-w-100 rounded-none border-y-0 border-r-0" onkeydown={keydown}>
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3"><h3 class="min-w-0 truncate text-sm font-semibold">{label}</h3><button type="button" class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent" aria-label={t("common.close")} onclick={onclose}><X class="size-4" /></button></div>
    <div class="min-h-0 overflow-y-auto p-3">{@render children()}</div>
  </CollectionPanel>
</div>

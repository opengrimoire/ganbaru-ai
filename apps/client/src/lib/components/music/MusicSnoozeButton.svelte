<script lang="ts">
  import ClockFading from "@lucide/svelte/icons/clock-fading";
  import { getLocalization } from "$lib/i18n/translator.svelte";

  let { onRemove }: { onRemove: () => Promise<void> } = $props();

  const { t } = getLocalization();
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function remove(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (busy) return;
    busy = true;
    error = null;
    try {
      await onRemove();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }
</script>

<button
  type="button"
  class="music-snooze-button pointer-events-auto relative z-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50"
  onclick={(event) => { void remove(event); }}
  disabled={busy}
  aria-label={error ?? t("music.removeSnooze")}
  data-app-tooltip={error ?? t("music.removeSnooze")}
><ClockFading size={12} strokeWidth={1.7} /></button>
{#if error}<span class="sr-only" role="alert">{error}</span>{/if}

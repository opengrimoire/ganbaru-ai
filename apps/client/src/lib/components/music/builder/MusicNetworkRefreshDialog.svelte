<script lang="ts">
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import MusicBuilderDialog from "./MusicBuilderDialog.svelte";
  let { onlineCount, onLocalOnly, onContinue, onClose }: { onlineCount: number; onLocalOnly: () => void; onContinue: () => void; onClose: () => void } = $props();
  const { t } = getLocalization();
</script>

<MusicBuilderDialog
  title={t("music.builder.refreshRequiresNetworkTitle")}
  titleId="music-network-refresh-title"
  description={t("music.builder.refreshRequiresNetworkDescription", onlineCount)}
  size="small"
  onDismiss={onClose}
>
  {#snippet footer()}
    <button type="button" onclick={onClose} class="min-h-10 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-accent">{t("music.builder.cancel")}</button>
    <button type="button" onclick={onLocalOnly} class="min-h-10 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-accent">{t("music.builder.localOnly")}</button>
    <button type="button" onclick={onContinue} class="min-h-10 rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">{t("music.builder.continueOnline")}</button>
  {/snippet}
</MusicBuilderDialog>

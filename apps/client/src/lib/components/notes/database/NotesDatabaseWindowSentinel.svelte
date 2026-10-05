<script lang="ts">
  import { getLocalization } from "$lib/i18n/translator.svelte";

  let {
    hasMore,
    loading,
    onLoad,
  }: {
    hasMore: boolean;
    loading: boolean;
    onLoad: () => Promise<void> | void;
  } = $props();

  const { t } = getLocalization();
  let sentinel: HTMLDivElement | null = $state(null);

  $effect(() => {
    const node = sentinel;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!loading && entries.some((entry) => entry.isIntersecting)) void onLoad();
    }, { root: node.closest("[data-notes-editor-scroll]") });
    observer.observe(node);
    return () => observer.disconnect();
  });
</script>

{#if hasMore}
  <div bind:this={sentinel} class="h-px" aria-hidden="true"></div>
  {#if loading}
    <div class="py-2 text-center text-[0.8rem] text-muted-foreground" aria-busy="true">
      {t("common.loading")}
    </div>
  {/if}
{/if}

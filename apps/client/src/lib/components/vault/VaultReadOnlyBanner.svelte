<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { onActiveVaultIdentityChange } from "$lib/vault/active-vault";
  import { getVaultOwnership } from "$lib/vault/ownership.svelte";

  const ownership = getVaultOwnership();
  const { t } = getLocalization();

  function refresh(): void {
    void ownership.refresh().catch((error) => {
      console.warn("Failed to read vault ownership status:", error);
    });
  }

  onMount(() => {
    refresh();
    const unsubscribe = onActiveVaultIdentityChange((_previous, next) => {
      if (next) refresh();
      else ownership.clear();
    });
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  $effect(() => {
    document.documentElement.dataset.vaultWritable = ownership.canWrite ? "true" : "false";
  });
</script>

{#if ownership.status && !ownership.status.canWrite}
  <div
    class="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-2 text-center text-xs font-medium text-foreground"
    role="status"
    aria-live="polite"
  >
    {ownership.status.role === "recovery"
      ? t("vaultOwnership.recovery")
      : t("vaultOwnership.readOnly")}
  </div>
{/if}

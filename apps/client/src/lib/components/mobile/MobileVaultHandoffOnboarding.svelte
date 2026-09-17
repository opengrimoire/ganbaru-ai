<script lang="ts">
  import type { PairingStatus } from "$lib/api/vault-handoff";
  import VaultHandoffOnboardingContent from "$lib/components/vault/VaultHandoffOnboardingContent.svelte";

  let {
    initialStatus = null,
    onComplete,
  }: {
    initialStatus?: PairingStatus | null;
    onComplete: () => void | Promise<void>;
  } = $props();
</script>

<main
  class="mobile-viewport-height w-screen overflow-y-auto bg-background pb-(--safe-area-bottom) pt-(--safe-area-top) text-foreground"
  style="padding-left: var(--safe-area-left); padding-right: var(--safe-area-right);"
>
  <VaultHandoffOnboardingContent platform="android" {initialStatus} {onComplete} />
</main>

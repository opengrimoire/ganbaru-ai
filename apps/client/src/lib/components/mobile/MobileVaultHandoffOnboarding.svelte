<script lang="ts">
  import VaultHandoffOnboardingContent from "$lib/components/vault/VaultHandoffOnboardingContent.svelte";

  let { onComplete }: { onComplete: () => void | Promise<void> } = $props();
</script>

<main
  class="mobile-viewport-height w-screen overflow-y-auto bg-background pb-(--safe-area-bottom) pt-(--safe-area-top) text-foreground"
  style="padding-left: var(--safe-area-left); padding-right: var(--safe-area-right);"
>
  <VaultHandoffOnboardingContent platform="android" {onComplete} />
</main>

<script lang="ts">
  import { untrack } from "svelte";
  import type { PairingInvitation, PairingStatus } from "$lib/api/vault-handoff";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { completeVaultHandoffOnboarding } from "$lib/vault/handoff-onboarding";
  import VaultHandoffPanel from "./VaultHandoffPanel.svelte";

  let {
    platform,
    initialInvitation = null,
    initialStatus = null,
    onComplete,
  }: {
    platform: "desktop" | "android";
    initialInvitation?: PairingInvitation | null;
    initialStatus?: PairingStatus | null;
    onComplete: () => void | Promise<void>;
  } = $props();

  const { t } = getLocalization();
  let status = $state<PairingStatus | null>(untrack(() => initialStatus));
  let completing = $state(false);
  const readyToContinue = $derived(
    status?.linked === true
      && (platform === "desktop" || status.replicaReady || status.canWrite === true),
  );

  function safeStorage(): Storage | undefined {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  }

  async function leave(persistCompletion: boolean): Promise<void> {
    if (completing) return;
    completing = true;
    try {
      await onComplete();
      if (persistCompletion) {
        const storage = safeStorage();
        if (storage) completeVaultHandoffOnboarding(storage);
      }
    } catch (error) {
      completing = false;
      console.error("Failed to leave linking onboarding:", error);
    }
  }
</script>

{#if completing}
  <section
    class="grid h-full w-full place-items-center"
    role="status"
    aria-label={t("common.loading")}
  >
    <svg
      viewBox="0 0 48 48"
      class="ganbaru-loading-ring size-12 text-foreground"
      aria-hidden="true"
    >
      <circle
        class="ganbaru-loading-ring-stroke"
        cx="24"
        cy="24"
        r="18"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
  </section>
{:else}
<section
  class="mx-auto grid min-h-full w-full max-w-5xl content-center px-4 py-8 min-[560px]:px-8"
  data-vault-handoff-onboarding={platform}
>
  <div class={platform === "desktop"
    ? "mx-auto flex w-full max-w-4xl flex-col gap-6"
    : "mx-auto flex w-full max-w-md flex-col gap-6"}>
    <div class="space-y-2 text-center">
      <h1 class="text-2xl font-semibold leading-tight text-foreground min-[560px]:text-3xl">
        {platform === "desktop"
          ? t("vaultHandoff.desktopOnboardingTitle")
          : t("vaultHandoff.androidOnboardingTitle")}
      </h1>
      {#if platform === "android"}
        <p class="text-sm leading-6 text-muted-foreground">
          {t("vaultHandoff.androidOnboardingDescription")}
        </p>
        <p class="text-xs leading-5 text-muted-foreground">
          {t("vaultHandoff.cameraDisclosure")}
        </p>
      {/if}
    </div>

    <VaultHandoffPanel
      {platform}
      {initialInvitation}
      {initialStatus}
      presentation="onboarding"
      onStatusChange={(next) => { status = next; }}
      onActivated={() => void leave(true)}
    />

    <div class="flex flex-col gap-2">
      {#if readyToContinue}
        <button
          type="button"
          class="min-h-11 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onclick={() => void leave(true)}
        >
          {t("vaultHandoff.continue")}
        </button>
      {/if}
      {#if status?.linked !== true}
        <button
          type="button"
          class="min-h-11 self-center rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          onclick={() => void leave(false)}
        >
          {t("vaultHandoff.notNow")}
        </button>
      {/if}
    </div>
  </div>
</section>
{/if}

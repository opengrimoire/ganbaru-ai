<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import { onMount } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { PairingCameraScanner } from "$lib/vault/pairing-camera";

  let {
    disabled = false,
    onInvitation,
    onCancel,
    onError,
  }: {
    disabled?: boolean;
    onInvitation: (invitation: string) => void | Promise<void>;
    onCancel: () => void;
    onError: (cause: unknown) => void;
  } = $props();

  const { t } = getLocalization();
  let video: HTMLVideoElement;
  let scanner: PairingCameraScanner | null = null;
  let ready = $state(false);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleScan(): void {
    if (stopped || disabled) return;
    timer = setTimeout(() => void scan(), 180);
  }

  async function scan(): Promise<void> {
    if (!scanner || stopped || disabled) return;
    try {
      const invitation = await scanner.scanFrame();
      stopped = true;
      scanner.stop();
      await onInvitation(invitation);
    } catch {
      scheduleScan();
    }
  }

  function stop(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
    scanner?.stop();
  }

  onMount(() => {
    scanner = new PairingCameraScanner(video);
    void scanner.start().then(() => {
      ready = true;
      scheduleScan();
    }).catch(onError);
    return stop;
  });
</script>

<div class="grid gap-3">
  <div class="relative aspect-square max-h-72 overflow-hidden rounded-md bg-black">
    <video bind:this={video} muted class="h-full w-full object-cover" aria-label={t("vaultHandoff.scanQr")}></video>
    {#if !ready}
      <div class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
        <LoaderCircle size={16} strokeWidth={2} class="animate-spin" aria-hidden="true" />
        {t("vaultHandoff.cameraStarting")}
      </div>
    {/if}
    <div class="pointer-events-none absolute inset-[12%] rounded-lg border-2 border-white/80"></div>
  </div>
  <p class="text-[0.8rem] leading-5 text-muted-foreground">{t("vaultHandoff.scanning")}</p>
  <button
    type="button"
    disabled={disabled}
    class="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-[0.8rem] font-medium disabled:opacity-55"
    onclick={() => { stop(); onCancel(); }}
  >
    {t("vaultHandoff.stopScanning")}
  </button>
</div>

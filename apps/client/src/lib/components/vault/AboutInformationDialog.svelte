<script lang="ts">
  import { onMount, tick } from "svelte";
  import AboutAcknowledgments from "$lib/components/settings/AboutAcknowledgments.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { activateModalFocus, activateModalKeyboardLayer, trapModalTabKey } from "$lib/modal-focus";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import licenseText from "../../../../../../LICENSE?raw";

  let { kind, onClose }: { kind: "license" | "acknowledgments"; onClose: () => void } = $props();
  const { t } = getLocalization();
  const title = $derived(kind === "license" ? t("vaultSetup.licenseButton") : t("settings.about.acknowledgmentsHeading"));
  let dialog = $state<HTMLDivElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Tab" && dialog) trapModalTabKey(dialog, event);
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    event.stopPropagation();
  }

  onMount(() => {
    const deactivateBack = platformHasCapability(BUILD_PLATFORM_PROFILE, "system.android-back")
      ? getMobileBackStack().activate({ handle: onClose })
      : () => undefined;
    const deactivateKeyboard = activateModalKeyboardLayer(handleKeydown);
    let deactivateFocus = (): void => undefined;
    void tick().then(() => {
      if (dialog) deactivateFocus = activateModalFocus(dialog, closeButton);
    });
    return () => {
      deactivateBack();
      deactivateKeyboard();
      deactivateFocus();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed z-90 flex items-center justify-center" style="left: var(--visual-viewport-offset-left); top: var(--visual-viewport-offset-top); width: var(--visual-viewport-width); height: var(--visual-viewport-height); padding: calc(var(--safe-area-top) + 1rem) calc(var(--safe-area-right) + 1rem) calc(var(--safe-area-bottom) + 1rem) calc(var(--safe-area-left) + 1rem);" onclick={onClose}>
  <div class="absolute inset-0 bg-black/50"></div>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={dialog} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" class="relative z-10 flex max-h-full w-full max-w-2xl flex-col rounded-md border border-border bg-card text-card-foreground shadow-2xl outline-none" onclick={(event) => event.stopPropagation()} onkeydown={handleKeydown}>
    <div class="min-h-0 overflow-y-auto p-5 sm:p-7">
      {#if kind === "license"}
        <h2 class="mb-4 text-base font-semibold text-foreground">{title}</h2>
        <pre class="overflow-x-auto text-xs leading-5 text-foreground" data-selectable-content>{licenseText}</pre>
      {:else}
        <AboutAcknowledgments />
      {/if}
    </div>
    <div class="flex shrink-0 justify-end border-t border-border px-5 py-3 sm:px-7">
      <button bind:this={closeButton} type="button" class="min-h-10 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-accent" onclick={onClose}>{t("common.close")}</button>
    </div>
  </div>
</div>

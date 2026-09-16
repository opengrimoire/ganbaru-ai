<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import X from "@lucide/svelte/icons/x";
  import { onMount, tick } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    activateModalFocus,
    activateModalKeyboardLayer,
    trapModalTabKey,
  } from "$lib/modal-focus";

  let {
    busy,
    error,
    onSubmit,
    onClose,
  }: {
    busy: boolean;
    error: string | null;
    onSubmit: (code: string) => void;
    onClose: () => void;
  } = $props();

  const { t } = getLocalization();
  let dialog = $state<HTMLDivElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let code = $state("");

  function submit(): void {
    const value = code.trim();
    if (value && !busy) onSubmit(value);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Tab" && dialog) {
      trapModalTabKey(dialog, event);
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
    event.stopPropagation();
  }

  onMount(() => {
    const deactivateKeyboard = activateModalKeyboardLayer(handleKeydown);
    let deactivateFocus = (): void => undefined;
    void tick().then(() => {
      if (dialog) deactivateFocus = activateModalFocus(dialog, input);
    });
    return () => {
      deactivateKeyboard();
      deactivateFocus();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-90 flex items-center justify-center p-4" onclick={onClose}>
  <div class="absolute inset-0 bg-black/50"></div>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={dialog}
    class="relative z-10 w-full max-w-md rounded-md border border-black/20 bg-card px-5 py-5 text-card-foreground shadow-2xl outline-none dark:border-white/10 dark:bg-sidebar dark:text-sidebar-foreground sm:px-8"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pairing-code-title"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 id="pairing-code-title" class="text-base font-semibold text-foreground">
          {t("vaultHandoff.codeDialogTitle")}
        </h2>
        <p class="mt-1 text-[0.866667rem] leading-5 text-muted-foreground">
          {t("vaultHandoff.codeInstructions")}
        </p>
      </div>
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("common.close")}
        onclick={onClose}
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>

    <input
      bind:this={input}
      bind:value={code}
      type="text"
      autocomplete="off"
      spellcheck="false"
      class="mt-5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
      placeholder={t("vaultHandoff.codePlaceholder")}
      disabled={busy}
    />
    {#if error}
      <p role="alert" class="mt-2 text-[0.8rem] leading-5 text-destructive">{error}</p>
    {/if}
    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        class="inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 text-[0.8rem] font-medium hover:bg-accent"
        disabled={busy}
        onclick={onClose}
      >
        {t("common.cancel")}
      </button>
      <button
        type="button"
        class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-55"
        disabled={busy || code.trim().length === 0}
        onclick={submit}
      >
        {#if busy}<LoaderCircle size={14} class="animate-spin" />{/if}
        {t("vaultHandoff.linkDevice")}
      </button>
    </div>
  </div>
</div>

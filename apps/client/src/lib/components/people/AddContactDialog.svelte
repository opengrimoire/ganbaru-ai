<script lang="ts">
  import ScanLine from "@lucide/svelte/icons/scan-line";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { verificationCode } from "./model";
  import PeopleDialog from "./PeopleDialog.svelte";

  /**
   * Adds a contact from a pasted code or a scanned card. The verification digits appear as soon as a code is typed so
   * both people can compare them before either accepts.
   */
  let {
    layer = "first",
    onClose,
  }: {
    layer?: "first" | "second";
    onClose: () => void;
  } = $props();

  const { t } = getLocalization();
  let codeInput = $state<HTMLTextAreaElement | null>(null);
  let code = $state("");
  const trimmedCode = $derived(code.trim());
  const verification = $derived(trimmedCode ? verificationCode(trimmedCode) : null);
</script>

<PeopleDialog
  title={t("people.addContact.title")}
  description={t("people.addContact.description")}
  {layer}
  initialFocus={codeInput}
  cancelLabel={t("people.invite.cancel")}
  confirmLabel={t("people.addContact.confirm")}
  {onClose}
>
  <label class="grid gap-1.5">
    <span class="people-field-label">{t("people.addContact.codeLabel")}</span>
    <textarea
      bind:this={codeInput}
      bind:value={code}
      class="field min-h-16 resize-none font-mono text-[0.8rem] uppercase"
      placeholder={t("people.addContact.codePlaceholder")}
      autocapitalize="characters"
      autocomplete="off"
      spellcheck="false"
      rows="2"
    ></textarea>
  </label>

  <button type="button" class="menu-item control-unavailable" aria-disabled="true">
    <ScanLine size={16} class="text-muted-foreground" />
    <span>{t("people.addContact.scan")}</span>
  </button>

  {#if verification}
    <div class="grid gap-1.5 rounded-floating-item border border-border px-3 py-2.5">
      <span class="people-field-label">{t("people.addContact.verificationLabel")}</span>
      <p class="font-mono text-[1.1rem] font-semibold tracking-[0.2em] text-foreground tabular-nums" aria-live="polite">{verification}</p>
      <p class="text-panel-detail text-muted-foreground">{t("people.addContact.verificationDescription")}</p>
    </div>
  {/if}
</PeopleDialog>

<style>
  .people-field-label { color: var(--muted-foreground); font-size: var(--panel-detail-font-size); font-weight: 500; line-height: 1.4; }
</style>

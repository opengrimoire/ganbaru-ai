<script lang="ts">
  import ScanLine from "@lucide/svelte/icons/scan-line";
  import X from "@lucide/svelte/icons/x";
  import { decodeContactCardQr, normalizePeopleError, parseContactCard, type PeopleErrorCode, type PeopleParsedCard } from "$lib/api/people";
  import MobilePairingScanner from "$lib/components/vault/handoff/MobilePairingScanner.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { trustKindForDuration } from "$lib/people/trust";
  import { BUILD_PLATFORM_PROFILE } from "$lib/platform";
  import { getPeople } from "$lib/stores/people.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { cn } from "$lib/utils";
  import PeopleDialog from "./PeopleDialog.svelte";
  import PersonAvatar from "./PersonAvatar.svelte";

  /**
   * Adds a contact from a pasted code or a scanned card. The card is parsed natively as soon as it is typed so the
   * other person's name and verification code appear before the request leaves, and the request carries the trust
   * defaults from Settings so acceptance on the other side needs nothing more from here.
   */
  let {
    layer = "first",
    onClose,
    onSent,
  }: {
    layer?: "first" | "second";
    onClose: () => void;
    /** Runs after a request left this device, before the dialog closes. */
    onSent?: () => void;
  } = $props();

  const PARSE_DEBOUNCE_MS = 250;
  const { t } = getLocalization();
  const people = getPeople();
  const preferences = getPreferences();
  const canScan = BUILD_PLATFORM_PROFILE.shell === "mobile";
  let codeInput = $state<HTMLTextAreaElement | null>(null);
  let code = $state("");
  let parsed = $state<PeopleParsedCard | null>(null);
  let parseError = $state<PeopleErrorCode | null>(null);
  let sendError = $state<PeopleErrorCode | null>(null);
  let sending = $state(false);
  let scanning = $state(false);
  let scanFailed = $state(false);
  let parseTimer: ReturnType<typeof setTimeout> | null = null;
  let parseSequence = 0;

  const trimmedCode = $derived(code.trim());
  /** Why the parsed card cannot be sent to, independent of delivery. */
  const blocker = $derived.by(() => {
    if (!parsed) return null;
    if (parsed.isSelf) return t("people.addContact.self");
    if (parsed.existingState === "active") return t("people.addContact.alreadyContact");
    if (parsed.existingState === "blocked") return t("people.addContact.blocked");
    if (parsed.pendingSent) return t("people.addContact.pending");
    if (!parsed.hasEndpoint) return t("people.addContact.noEndpoint");
    return null;
  });
  const message = $derived.by(() => {
    if (sendError) return describeSendError(sendError);
    if (parseError) return t("people.addContact.invalid");
    if (scanFailed) return t("people.addContact.scanFailed");
    return blocker;
  });
  const canSend = $derived(parsed !== null && blocker === null && !sending);

  $effect(() => {
    const text = trimmedCode;
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = null;
    sendError = null;
    const sequence = ++parseSequence;
    if (!text) {
      parsed = null;
      parseError = null;
      return;
    }
    parseTimer = setTimeout(() => {
      parseTimer = null;
      void parseContactCard(text)
        .then((view) => {
          if (sequence !== parseSequence) return;
          parsed = view;
          parseError = null;
        })
        .catch((cause: unknown) => {
          if (sequence !== parseSequence) return;
          parsed = null;
          parseError = normalizePeopleError(cause).code;
        });
    }, PARSE_DEBOUNCE_MS);
    return () => {
      if (parseTimer) clearTimeout(parseTimer);
      parseTimer = null;
    };
  });

  function describeSendError(error: PeopleErrorCode): string {
    switch (error) {
      case "invalid_card":
        return t("people.addContact.invalid");
      case "card_revoked":
        return t("people.addContact.revoked");
      case "recipient_unreachable":
        return t("people.addContact.unreachable");
      case "key_unavailable":
        return t("people.card.keyPending");
      case "identity_unavailable":
      case "read_only":
        return t("people.addContact.readOnly");
      case "profile_incomplete":
        return t("people.card.profileIncomplete");
      default:
        return t("people.addContact.failed");
    }
  }

  async function send(): Promise<void> {
    if (!canSend) return;
    sending = true;
    sendError = null;
    try {
      await people.sendRequest(trimmedCode, {
        inviteTrust: trustKindForDuration(preferences.peopleInviteTrustDefault),
        messageTrust: trustKindForDuration(preferences.peopleMessageTrustDefault),
      });
      onSent?.();
      onClose();
    } catch (cause: unknown) {
      sendError = normalizePeopleError(cause).code;
    } finally {
      sending = false;
    }
  }

  function startScan(): void {
    if (!canScan) return;
    scanFailed = false;
    scanning = true;
  }

  function acceptScan(text: string): void {
    code = text;
    scanning = false;
  }

  function failScan(): void {
    scanning = false;
    scanFailed = true;
  }
</script>

<PeopleDialog
  title={t("people.addContact.title")}
  description={t("people.addContact.description")}
  {layer}
  initialFocus={codeInput}
  cancelLabel={t("people.invite.cancel")}
  confirmLabel={t("people.addContact.confirm")}
  confirmDisabled={!canSend}
  onConfirm={() => { void send(); }}
  {onClose}
>
  <label class="grid gap-1.5">
    <span class="people-field-label">{t("people.addContact.codeLabel")}</span>
    <textarea
      bind:this={codeInput}
      bind:value={code}
      class="field min-h-16 resize-none font-mono text-[0.8rem]"
      placeholder={t("people.addContact.codePlaceholder")}
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      rows="3"
    ></textarea>
  </label>

  {#if scanning}
    <div class="grid gap-2">
      <MobilePairingScanner decode={decodeContactCardQr} label={t("people.addContact.scan")} onInvitation={acceptScan} onError={failScan} />
      <p class="text-panel-detail text-center text-muted-foreground">{t("people.addContact.scanning")}</p>
      <button type="button" class="menu-item" onclick={() => { scanning = false; }}>
        <X size={16} class="text-muted-foreground" />
        <span>{t("people.addContact.stopScan")}</span>
      </button>
    </div>
  {:else}
    <button type="button" class={cn("menu-item", !canScan && "control-unavailable")} aria-disabled={!canScan || undefined} onclick={startScan}>
      <ScanLine size={16} class="text-muted-foreground" />
      <span>{t("people.addContact.scan")}</span>
    </button>
  {/if}

  {#if parsed}
    <div class="grid gap-2 rounded-floating-item border border-border px-3 py-2.5">
      <div class="flex min-w-0 items-center gap-2.5">
        <PersonAvatar displayName={parsed.displayName} color={parsed.color} size={30} />
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{parsed.displayName}</span>
      </div>
      <span class="people-field-label">{t("people.addContact.verificationLabel")}</span>
      <p class="font-mono text-[1.1rem] font-semibold tracking-[0.2em] text-foreground tabular-nums" aria-live="polite">{parsed.verificationCode}</p>
      <p class="text-panel-detail text-muted-foreground">{t("people.addContact.verificationDescription")}</p>
    </div>
  {/if}

  {#if message}
    <p class={cn("text-panel-detail", sendError || parseError || scanFailed ? "text-destructive" : "text-muted-foreground")} aria-live="polite">{message}</p>
  {/if}
</PeopleDialog>

<style>
  .people-field-label { color: var(--muted-foreground); font-size: var(--panel-detail-font-size); font-weight: 500; line-height: 1.4; }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import ContactRound from "@lucide/svelte/icons/contact-round";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Search from "@lucide/svelte/icons/search";
  import type { PeopleContact, PeopleContactRequest } from "$lib/api/people";
  import AddContactDialog from "$lib/components/people/AddContactDialog.svelte";
  import ContactTrustDialog from "$lib/components/people/ContactTrustDialog.svelte";
  import PeopleEmptyState from "$lib/components/people/PeopleEmptyState.svelte";
  import PeopleHeadingAction from "$lib/components/people/PeopleHeadingAction.svelte";
  import PeopleMemberRow from "$lib/components/people/PeopleMemberRow.svelte";
  import PersonAvatar from "$lib/components/people/PersonAvatar.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { formatRelativeDays } from "$lib/i18n/formatters";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { formatContactTrustDetail, peopleMutationErrorKey } from "$lib/people/presentation";
  import { daysUntil, trustKindForDuration } from "$lib/people/trust";
  import { getPeople } from "$lib/stores/people.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";

  /**
   * Contacts and the requests on their way in and out. Received requests are accepted with the trust defaults from
   * the card tab; everything else a contact may do is edited per row. The list fills only through mutual requests.
   */
  const AVATAR_SIZE = 26;
  const { t } = getLocalization();
  const people = getPeople();
  const preferences = getPreferences();
  let query = $state("");
  let addContactOpen = $state(false);
  let notice = $state<string | null>(null);
  let menuFor = $state<string | null>(null);
  let trustTarget = $state<PeopleContact | null>(null);
  let removeTarget = $state<PeopleContact | null>(null);
  let blockTarget = $state<{ publicKey: string; displayName: string } | null>(null);
  let now = $state(new Date());

  const filtered = $derived(people.filter(query));
  const errorMessage = $derived(people.error ? t(`people.contacts.error.${peopleMutationErrorKey(people.error.code)}`) : null);

  function trustDefaults() {
    return {
      inviteTrust: trustKindForDuration(preferences.peopleInviteTrustDefault),
      messageTrust: trustKindForDuration(preferences.peopleMessageTrustDefault),
    };
  }

  function row(entry: { id: string; revision: number }) {
    return { id: entry.id, expectedRevision: entry.revision };
  }

  /** Runs one store mutation; the store records the failure and the tab shows it under the heading. */
  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      // Recorded in `people.error`.
    }
  }

  function requestDetail(request: PeopleContactRequest): string {
    const expiry = t("people.contacts.expiresIn", formatRelativeDays(t, daysUntil(request.expiresAt, now)));
    const status = request.lastErrorCode ? `${expiry}. ${t("people.contacts.deliveryRetrying")}` : expiry;
    return `${request.verificationCode} · ${status}`;
  }

  function toggleMenu(contactId: string): void {
    menuFor = menuFor === contactId ? null : contactId;
  }

  onMount(() => {
    void people.ensureLoaded().then(() => people.syncRequests());
    const clock = window.setInterval(() => { now = new Date(); }, 60_000);
    const onPointerDown = (event: PointerEvent) => {
      if (menuFor && event.target instanceof Element && !event.target.closest("[data-contact-menu]")) menuFor = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuFor) {
        event.stopPropagation();
        menuFor = null;
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearInterval(clock);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });
</script>

{#if people.receivedPending.length > 0}
  <section class="flex flex-col gap-3">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.contacts.requestsReceived")}</h2>
    <ul class="flex flex-col">
      {#each people.receivedPending as request (request.id)}
        <PeopleMemberRow name={request.displayName} detail={request.verificationCode}>
          {#snippet avatar()}<PersonAvatar displayName={request.displayName} color={request.color} size={AVATAR_SIZE} />{/snippet}
          {#snippet trailing()}
            <button type="button" class="people-row-action people-row-action-primary" onclick={() => void run(() => people.accept(row(request), trustDefaults()))}>{t("people.invitations.accept")}</button>
            <button type="button" class="people-row-action" onclick={() => void run(() => people.decline(row(request)))}>{t("people.invitations.decline")}</button>
            <button type="button" class="people-row-action" onclick={() => { blockTarget = { publicKey: request.publicKey, displayName: request.displayName }; }}>{t("people.invitations.block")}</button>
          {/snippet}
        </PeopleMemberRow>
      {/each}
    </ul>
  </section>
{/if}

{#if people.sentPending.length > 0}
  <section class="flex flex-col gap-3">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.contacts.requestsSent")}</h2>
    <ul class="flex flex-col">
      {#each people.sentPending as request (request.id)}
        <PeopleMemberRow name={request.displayName} detail={requestDetail(request)}>
          {#snippet avatar()}<PersonAvatar displayName={request.displayName} color={request.color} size={AVATAR_SIZE} />{/snippet}
          {#snippet trailing()}
            <button type="button" class="people-row-action" onclick={() => void run(() => people.cancel(row(request)))}>{t("people.contacts.cancel")}</button>
          {/snippet}
        </PeopleMemberRow>
      {/each}
    </ul>
  </section>
{/if}

<section class="flex flex-col gap-4">
  <div class="flex items-center gap-2 px-1">
    <h2 class="text-[0.866667rem] font-semibold text-foreground">{t("people.contacts.heading")}</h2>
    <PeopleHeadingAction label={t("people.contacts.add")} expanded={addContactOpen} onclick={() => { addContactOpen = true; }} />
  </div>
  {#if notice || errorMessage}
    <div class="flex items-start gap-2 px-1 text-[0.8rem]" aria-live="polite">
      <span class={errorMessage ? "flex-1 text-destructive" : "flex-1 text-muted-foreground"}>{errorMessage ?? notice}</span>
      <button type="button" class="people-row-action" onclick={() => { notice = null; people.clearError(); }}>{t("people.contacts.dismiss")}</button>
    </div>
  {/if}
  <div class="flex flex-col gap-3">
    <label class="people-search field mx-1 flex items-center gap-1.5 text-muted-foreground">
      <Search size={13} aria-hidden="true" />
      <input class="field-bare text-foreground" type="search" bind:value={query} aria-label={t("people.contacts.search")} placeholder={t("people.contacts.search")} />
    </label>
    {#if people.activeContacts.length === 0}
      <div class="px-1">
        <PeopleEmptyState title={t("people.contacts.emptyTitle")} description={t("people.contacts.emptyDescription")}>
          {#snippet icon()}<ContactRound size={24} strokeWidth={1.5} />{/snippet}
        </PeopleEmptyState>
      </div>
    {:else if filtered.length === 0}
      <p class="px-2 text-[0.8rem] text-muted-foreground">{t("people.contacts.noMatches")}</p>
    {:else}
      <ul class="flex flex-col">
        {#each filtered as contact (contact.id)}
          <PeopleMemberRow name={contact.displayName} detail={formatContactTrustDetail(t, contact, now)}>
            {#snippet avatar()}<PersonAvatar displayName={contact.displayName} color={contact.color} size={AVATAR_SIZE} />{/snippet}
            {#snippet trailing()}
              <span class="relative" data-contact-menu>
                <button type="button" class="people-row-icon" aria-label={t("people.contacts.actions", contact.displayName)} aria-haspopup="menu" aria-expanded={menuFor === contact.id} onclick={() => toggleMenu(contact.id)}><Ellipsis size={16} /></button>
                {#if menuFor === contact.id}
                  <div class="surface-floating surface-floating-body absolute right-0 top-full z-20 mt-1 flex min-w-36 flex-col" role="menu">
                    <button type="button" role="menuitem" class="menu-item" onclick={() => { menuFor = null; trustTarget = contact; }}>{t("people.contacts.editTrust")}</button>
                    <button type="button" role="menuitem" class="menu-item" onclick={() => { menuFor = null; removeTarget = contact; }}>{t("people.contacts.remove")}</button>
                    <button type="button" role="menuitem" class="menu-item text-destructive" onclick={() => { menuFor = null; blockTarget = contact; }}>{t("people.contacts.block")}</button>
                  </div>
                {/if}
              </span>
            {/snippet}
          </PeopleMemberRow>
        {/each}
      </ul>
    {/if}
  </div>
</section>

{#if addContactOpen}
  <AddContactDialog onClose={() => { addContactOpen = false; }} onSent={() => { notice = t("people.addContact.sent"); }} />
{/if}

{#if trustTarget}
  <ContactTrustDialog contact={trustTarget} onClose={() => { trustTarget = null; }} />
{/if}

{#if removeTarget}
  {@const target = removeTarget}
  <ConfirmDialog
    title={t("people.contacts.removeTitle")}
    message={t("people.contacts.removeMessage", target.displayName)}
    confirmLabel={t("people.contacts.remove")}
    cancelLabel={t("people.invite.cancel")}
    onConfirm={() => { removeTarget = null; void run(() => people.remove(row(target))); }}
    onCancel={() => { removeTarget = null; }}
  />
{/if}

{#if blockTarget}
  {@const target = blockTarget}
  <ConfirmDialog
    title={t("people.contacts.blockTitle")}
    message={t("people.contacts.blockMessage", target.displayName)}
    confirmLabel={t("people.contacts.block")}
    cancelLabel={t("people.invite.cancel")}
    onConfirm={() => { blockTarget = null; void run(() => people.block(target.publicKey)); }}
    onCancel={() => { blockTarget = null; }}
  />
{/if}

<style>
  .people-search { min-height: 2rem; padding-block: 0; font-size: calc(0.8rem * var(--type-scale)); }
  .people-search input::-webkit-search-cancel-button { display: none; }
  .people-row-action { display: inline-flex; height: 1.625rem; flex: 0 0 auto; align-items: center; border-radius: 0.375rem; padding-inline: 0.5rem; color: var(--muted-foreground); font-size: calc(0.75rem * var(--type-scale)); font-weight: 500; white-space: nowrap; transition: background-color 120ms ease, color 120ms ease; }
  .people-row-action:hover { background: var(--accent); color: var(--foreground); }
  .people-row-action-primary { color: var(--foreground); }
  .people-row-icon { display: grid; width: 1.75rem; height: 1.75rem; flex: 0 0 auto; place-items: center; border-radius: 0.375rem; color: var(--muted-foreground); }
  .people-row-icon:hover, .people-row-icon[aria-expanded="true"] { background: var(--accent); color: var(--foreground); }
</style>

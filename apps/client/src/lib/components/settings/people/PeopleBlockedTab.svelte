<script lang="ts">
  import { onMount } from "svelte";
  import Ban from "@lucide/svelte/icons/ban";
  import PeopleEmptyState from "$lib/components/people/PeopleEmptyState.svelte";
  import PeopleMemberRow from "$lib/components/people/PeopleMemberRow.svelte";
  import PersonAvatar from "$lib/components/people/PersonAvatar.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { peopleMutationErrorKey } from "$lib/people/presentation";
  import { getPeople } from "$lib/stores/people.svelte";

  /** People the local person blocked. Blocking is silent; unblocking only lets them send a new contact request. */
  const AVATAR_SIZE = 26;
  const { t } = getLocalization();
  const people = getPeople();
  const errorMessage = $derived(people.error ? t(`people.contacts.error.${peopleMutationErrorKey(people.error.code)}`) : null);

  async function unblock(id: string, revision: number): Promise<void> {
    try {
      await people.unblock({ id, expectedRevision: revision });
    } catch {
      // Recorded in `people.error`.
    }
  }

  onMount(() => {
    void people.ensureLoaded();
  });
</script>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.blocked.heading")}</h2>
  {#if errorMessage}
    <div class="flex items-start gap-2 px-1 text-[0.8rem]" aria-live="polite">
      <span class="flex-1 text-destructive">{errorMessage}</span>
      <button type="button" class="people-row-action" onclick={() => people.clearError()}>{t("people.contacts.dismiss")}</button>
    </div>
  {/if}
  {#if people.blocked.length === 0}
    <div class="px-1">
      <PeopleEmptyState title={t("people.blocked.emptyTitle")} description={t("people.blocked.emptyDescription")}>
        {#snippet icon()}<Ban size={24} strokeWidth={1.5} />{/snippet}
      </PeopleEmptyState>
    </div>
  {:else}
    <ul class="flex flex-col">
      {#each people.blocked as contact (contact.id)}
        <PeopleMemberRow name={contact.displayName}>
          {#snippet avatar()}<PersonAvatar displayName={contact.displayName} color={contact.color} size={AVATAR_SIZE} />{/snippet}
          {#snippet trailing()}
            <button type="button" class="people-row-action" onclick={() => void unblock(contact.id, contact.revision)}>{t("people.blocked.unblock")}</button>
          {/snippet}
        </PeopleMemberRow>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .people-row-action { display: inline-flex; height: 1.625rem; flex: 0 0 auto; align-items: center; border-radius: 0.375rem; padding-inline: 0.5rem; color: var(--muted-foreground); font-size: calc(0.75rem * var(--type-scale)); font-weight: 500; white-space: nowrap; transition: background-color 120ms ease, color 120ms ease; }
  .people-row-action:hover { background: var(--accent); color: var(--foreground); }
</style>

<script lang="ts">
  import ContactRound from "@lucide/svelte/icons/contact-round";
  import Search from "@lucide/svelte/icons/search";
  import AddContactDialog from "$lib/components/people/AddContactDialog.svelte";
  import PeopleEmptyState from "$lib/components/people/PeopleEmptyState.svelte";
  import PeopleHeadingAction from "$lib/components/people/PeopleHeadingAction.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";

  /** Accepted contacts with their trust scopes. The list fills only through mutual contact requests. */
  const { t } = getLocalization();
  let query = $state("");
  let addContactOpen = $state(false);
</script>

<section class="flex flex-col gap-4">
  <div class="flex items-center gap-2 px-1">
    <h2 class="text-[0.866667rem] font-semibold text-foreground">{t("people.contacts.heading")}</h2>
    <PeopleHeadingAction label={t("people.contacts.add")} expanded={addContactOpen} onclick={() => { addContactOpen = true; }} />
  </div>
  <div class="flex flex-col gap-3">
    <label class="people-search field mx-1 flex items-center gap-1.5 text-muted-foreground">
      <Search size={13} aria-hidden="true" />
      <input class="field-bare text-foreground" type="search" bind:value={query} aria-label={t("people.contacts.search")} placeholder={t("people.contacts.search")} />
    </label>
    <div class="px-1">
      <PeopleEmptyState title={t("people.contacts.emptyTitle")} description={t("people.contacts.emptyDescription")}>
        {#snippet icon()}<ContactRound size={24} strokeWidth={1.5} />{/snippet}
      </PeopleEmptyState>
    </div>
  </div>
</section>

{#if addContactOpen}
  <AddContactDialog onClose={() => { addContactOpen = false; }} />
{/if}

<style>
  .people-search { min-height: 2rem; padding-block: 0; font-size: calc(0.8rem * var(--type-scale)); }
  .people-search input::-webkit-search-cancel-button { display: none; }
</style>

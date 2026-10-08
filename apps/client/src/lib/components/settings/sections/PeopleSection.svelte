<script lang="ts">
  import PeopleBlockedTab from "$lib/components/settings/people/PeopleBlockedTab.svelte";
  import PeopleCardTab from "$lib/components/settings/people/PeopleCardTab.svelte";
  import PeopleContactsTab from "$lib/components/settings/people/PeopleContactsTab.svelte";
  import PeopleInvitationsTab from "$lib/components/settings/people/PeopleInvitationsTab.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { PeopleSettingsTab } from "$lib/settings/types";
  import { cn } from "$lib/utils";

  /** Settings > People: the local person's contact card and trust defaults, contacts, invitations, and blocked people. */
  let { initialTab = null }: { initialTab?: PeopleSettingsTab | null } = $props();

  const { t } = getLocalization();
  const tabs: readonly { id: PeopleSettingsTab; label: () => string }[] = [
    { id: "card", label: () => t("people.tabs.card") },
    { id: "contacts", label: () => t("people.tabs.contacts") },
    { id: "invitations", label: () => t("people.tabs.invitations") },
    { id: "blocked", label: () => t("people.tabs.blocked") },
  ];
  let activeTab = $state<PeopleSettingsTab>("card");

  $effect.pre(() => {
    if (initialTab) activeTab = initialTab;
  });
</script>

<div class="flex flex-col gap-6 pb-4">
  <div
    class="grid grid-cols-2 gap-1 rounded-md border border-border bg-card p-1 min-[560px]:grid-cols-4 dark:bg-transparent"
    role="tablist"
    aria-label={t("people.tabs.label")}
  >
    {#each tabs as tab (tab.id)}
      {@const active = activeTab === tab.id}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        class={cn(
          "flex min-h-8 items-center justify-center rounded-sm px-2 text-center text-[0.8rem] font-medium text-muted-foreground",
          active && "bg-background text-foreground dark:bg-foreground/5",
        )}
        onclick={() => { activeTab = tab.id; }}
      >
        <span>{tab.label()}</span>
      </button>
    {/each}
  </div>

  {#if activeTab === "card"}
    <PeopleCardTab />
  {:else if activeTab === "contacts"}
    <PeopleContactsTab />
  {:else if activeTab === "invitations"}
    <PeopleInvitationsTab />
  {:else}
    <PeopleBlockedTab />
  {/if}
</div>

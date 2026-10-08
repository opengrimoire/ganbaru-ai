<script lang="ts">
  import Inbox from "@lucide/svelte/icons/inbox";
  import Send from "@lucide/svelte/icons/send";
  import InvitePersonDialog from "$lib/components/people/InvitePersonDialog.svelte";
  import PeopleEmptyState from "$lib/components/people/PeopleEmptyState.svelte";
  import PeopleHeadingAction from "$lib/components/people/PeopleHeadingAction.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { cn } from "$lib/utils";

  /** Received and sent invitations. Received ones also surface in the Chat sidebar so they are never missed. */
  type Direction = "received" | "sent";

  const { t } = getLocalization();
  const directions: readonly { id: Direction; label: () => string }[] = [
    { id: "received", label: () => t("people.invitations.received") },
    { id: "sent", label: () => t("people.invitations.sent") },
  ];
  let direction = $state<Direction>("received");
  let inviteOpen = $state(false);
</script>

<section class="flex flex-col gap-4">
  <div class="flex items-center gap-2 px-1">
    <h2 class="text-[0.866667rem] font-semibold text-foreground">{t("people.invitations.heading")}</h2>
    <PeopleHeadingAction label={t("people.invitations.invite")} expanded={inviteOpen} onclick={() => { inviteOpen = true; }} />
  </div>
  <div class="flex flex-col gap-3">
    <div class="px-1">
      <div class="inline-grid grid-cols-2 gap-1 rounded-md border border-border bg-card p-1 dark:bg-transparent" role="tablist" aria-label={t("people.invitations.heading")}>
        {#each directions as entry (entry.id)}
          {@const active = direction === entry.id}
          <button
            type="button"
            role="tab"
            aria-selected={active}
            class={cn(
              "flex min-h-7 items-center justify-center rounded-sm px-3 text-center text-[0.8rem] font-medium text-muted-foreground",
              active && "bg-background text-foreground dark:bg-foreground/5",
            )}
            onclick={() => { direction = entry.id; }}
          >
            <span>{entry.label()}</span>
          </button>
        {/each}
      </div>
    </div>
    <div class="px-1">
      {#if direction === "received"}
        <PeopleEmptyState title={t("people.invitations.emptyReceivedTitle")} description={t("people.invitations.emptyReceivedDescription")}>
          {#snippet icon()}<Inbox size={24} strokeWidth={1.5} />{/snippet}
        </PeopleEmptyState>
      {:else}
        <PeopleEmptyState title={t("people.invitations.emptySentTitle")} description={t("people.invitations.emptySentDescription")}>
          {#snippet icon()}<Send size={24} strokeWidth={1.5} />{/snippet}
        </PeopleEmptyState>
      {/if}
    </div>
  </div>
</section>

{#if inviteOpen}
  <InvitePersonDialog onClose={() => { inviteOpen = false; }} />
{/if}

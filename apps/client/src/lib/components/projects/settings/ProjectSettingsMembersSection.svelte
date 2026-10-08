<script lang="ts">
  import MailPlus from "@lucide/svelte/icons/mail-plus";
  import InvitePersonDialog from "$lib/components/people/InvitePersonDialog.svelte";
  import LocalPersonAvatar from "$lib/components/people/LocalPersonAvatar.svelte";
  import PeopleMemberRow from "$lib/components/people/PeopleMemberRow.svelte";
  import PeopleRoleChip from "$lib/components/people/PeopleRoleChip.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import ProjectSettingsSectionHeading from "./ProjectSettingsSectionHeading.svelte";

  /** Who can open this project. The owner is always listed; group members join with their group role. */
  let {
    projectId,
    projectName,
  }: {
    projectId: string;
    projectName: string;
  } = $props();

  const AVATAR_SIZE = 26;
  const OWNER_COUNT = 1;
  const { t } = getLocalization();
  const preferences = getPreferences();

  let inviteOpen = $state(false);

  const localName = $derived(preferences.profileDisplayName.trim() || t("people.you"));
  const localDetail = $derived(preferences.profileDisplayName.trim() ? t("people.you") : null);
</script>

<section class="flex flex-col gap-2">
  <div class="flex items-center justify-between gap-2">
    <ProjectSettingsSectionHeading label={t("projects.settings.members.heading")} count={OWNER_COUNT} inlineCount />
    <button
      type="button"
      class="flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[0.733333rem] text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-haspopup="dialog"
      aria-expanded={inviteOpen}
      onclick={() => { inviteOpen = true; }}
    >
      <MailPlus size={14} strokeWidth={1.75} />
      <span>{t("projects.settings.members.invite")}</span>
    </button>
  </div>
  <!-- Member rows pad wider than the section's other rows; the negative margin keeps avatars on the same left edge. -->
  <ul class="-mx-0.5 grid">
    <PeopleMemberRow name={localName} detail={localDetail}>
      {#snippet avatar()}<LocalPersonAvatar size={AVATAR_SIZE} />{/snippet}
      {#snippet trailing()}<PeopleRoleChip label={t("people.role.owner")} />{/snippet}
    </PeopleMemberRow>
  </ul>
</section>

{#if inviteOpen}
  <InvitePersonDialog space={{ kind: "project", id: projectId, name: projectName }} onClose={() => { inviteOpen = false; }} />
{/if}

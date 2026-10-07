<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import Hash from "@lucide/svelte/icons/hash";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Plus from "@lucide/svelte/icons/plus";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import X from "@lucide/svelte/icons/x";
  import * as chatApi from "$lib/api/chat";
  import type { ChatChannelRead, ChatChannelMembershipRemovalPreview } from "$lib/chat/contracts";
  import type { ChatSidebarSection } from "$lib/chat/channel-sections";
  import {
    channelAccessWithChannel,
    channelAccessWithoutChannel,
    conversationAccessProfile,
    resolveChannelMemberChanges,
  } from "$lib/chat/teammates/channel-membership";
  import ChatParticipantAvatar from "$lib/components/chat/identity/ChatParticipantAvatar.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { activateModalFocus, activateModalKeyboardLayer, trapModalTabKey } from "$lib/modal-focus";
  import { getChat } from "$lib/stores/chat.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";

  let {
    channel = null,
    sections,
    initialSectionId = null,
    onSaved,
    onCancel,
  }: {
    channel?: ChatChannelRead | null;
    sections: ChatSidebarSection[];
    initialSectionId?: string | null;
    onSaved: (channel: ChatChannelRead, sectionId: string | null) => void;
    onCancel: () => void;
  } = $props();

  const NEW_TEAMMATE_OPTION = "new-teammate";
  const MEMBER_AVATAR_SIZE = 26;

  const chat = getChat();
  const projects = getProjects();
  const { t } = getLocalization();
  const currentChannel = untrack(() => channel);
  const projectId = $derived(currentChannel?.projectId ?? projects.selectedProjectId ?? "");
  const sectionOptions = $derived([
    { value: "", label: t("chat.channels.defaultSection") },
    ...sections.map((section) => ({ value: section.id, label: section.name })),
  ]);
  const humanMembers = (currentChannel?.memberships ?? [])
    .filter((membership) => membership.removedAt === null && membership.participant.kind !== "ai_teammate");
  const currentTeammateIds = new Set((currentChannel?.memberships ?? [])
    .filter((membership) => membership.removedAt === null && membership.participant.kind === "ai_teammate")
    .map((membership) => membership.participant.id));

  let dialog = $state<HTMLDivElement | null>(null);
  let nameInput = $state<HTMLInputElement | null>(null);
  let name = $state(currentChannel?.name ?? "");
  let topic = $state(currentChannel?.topic ?? "");
  let sectionId = $state(untrack(() => initialSectionId ?? ""));
  let selectedTeammateIds = $state(new Set(currentTeammateIds));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let removal = $state<{ teammateId: string; preview: ChatChannelMembershipRemovalPreview } | null>(null);
  let removalBusy = $state(false);

  const memberTeammates = $derived(chat.teammates.filter((teammate) => selectedTeammateIds.has(teammate.participant.id)));
  const addOptions = $derived([
    ...chat.teammates
      .filter((teammate) => !selectedTeammateIds.has(teammate.participant.id))
      .map((teammate) => ({ value: teammate.participant.id, label: teammate.participant.displayName, summary: teammate.role || undefined })),
    { value: NEW_TEAMMATE_OPTION, label: t("chat.organization.newTeammate") },
  ]);
  const removalParticipant = $derived.by(() => {
    const pending = removal;
    if (!pending) return null;
    return chat.teammates.find((teammate) => teammate.participant.id === pending.teammateId)?.participant ?? null;
  });

  function teammateFor(participantId: string) {
    return chat.teammates.find((teammate) => teammate.participant.id === participantId) ?? null;
  }

  function addMember(value: string): void {
    if (value === NEW_TEAMMATE_OPTION) {
      onCancel();
      window.dispatchEvent(new CustomEvent("ganbaru-ai:chat-new-teammate", {
        detail: currentChannel ? { channelId: currentChannel.id } : {},
      }));
      return;
    }
    selectedTeammateIds = new Set([...selectedTeammateIds, value]);
  }

  function dropMember(teammateId: string): void {
    const next = new Set(selectedTeammateIds);
    next.delete(teammateId);
    selectedTeammateIds = next;
  }

  async function removeMember(teammateId: string): Promise<void> {
    if (!currentChannel || !currentTeammateIds.has(teammateId)) {
      dropMember(teammateId);
      return;
    }
    if (removalBusy) return;
    removalBusy = true;
    error = null;
    try {
      const access = await chatApi.readChatTeammateAccess(teammateId);
      const preview = await chatApi.previewChatChannelMembershipRemoval({
        teammateId,
        channelId: currentChannel.id,
        expectedAccessRevision: access.accessRevision,
      });
      if (preview.activeAssignmentCount === 0 && preview.activeAuthorizationCount === 0) dropMember(teammateId);
      else removal = { teammateId, preview };
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      removalBusy = false;
    }
  }

  function configureMember(participantId: string): void {
    onCancel();
    window.dispatchEvent(new CustomEvent("ganbaru-ai:chat-configure-teammate", {
      detail: { participantId, channelId: currentChannel?.id },
    }));
  }

  async function applyMemberChanges(channelId: string): Promise<boolean> {
    const changes = resolveChannelMemberChanges(currentTeammateIds, selectedTeammateIds);
    if (changes.addedTeammateIds.length === 0 && changes.removedTeammateIds.length === 0) return false;
    const profile = changes.addedTeammateIds.length > 0
      ? conversationAccessProfile(await chatApi.listChatAccessProfiles())
      : null;
    for (const teammateId of changes.addedTeammateIds) {
      const access = await chatApi.readChatTeammateAccess(teammateId);
      await chatApi.replaceChatTeammateAccess({
        teammateId,
        expectedAccessRevision: access.accessRevision,
        teammateDefaultRuntimeApproval: access.teammateDefaultRuntimeApproval,
        channels: channelAccessWithChannel(access, channelId, profile),
      });
    }
    for (const teammateId of changes.removedTeammateIds) {
      const access = await chatApi.readChatTeammateAccess(teammateId);
      await chatApi.replaceChatTeammateAccess({
        teammateId,
        expectedAccessRevision: access.accessRevision,
        teammateDefaultRuntimeApproval: access.teammateDefaultRuntimeApproval,
        channels: channelAccessWithoutChannel(access, channelId),
      });
    }
    return true;
  }

  async function save(): Promise<void> {
    if (!projectId || saving || !name.trim()) return;
    saving = true;
    error = null;
    try {
      let saved = currentChannel
        ? await chat.updateChannelDetails(currentChannel, name, topic)
        : await chat.createChannel({ id: `channel:${crypto.randomUUID()}`, projectId, name, topic });
      if (await applyMemberChanges(saved.id)) {
        saved = await chatApi.readChatChannel(saved.id);
        chat.activeChannels = chat.activeChannels.map((entry) => entry.id === saved.id ? saved : entry);
        await chat.refreshTeammates();
      }
      onSaved(saved, sectionId || null);
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (removal) return;
    if (event.key === "Tab" && dialog) {
      trapModalTabKey(dialog, event);
      return;
    }
    if (event.key !== "Escape" || dialog?.querySelector("[data-app-floating-surface]")) return;
    event.preventDefault();
    onCancel();
  }

  onMount(() => {
    const deactivateKeyboard = activateModalKeyboardLayer(handleKeydown);
    let deactivateFocus = (): void => undefined;
    void tick().then(() => {
      if (dialog) deactivateFocus = activateModalFocus(dialog, nameInput?.disabled ? null : nameInput);
    });
    return () => {
      deactivateKeyboard();
      deactivateFocus();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-90 flex items-center justify-center p-4" onclick={onCancel}>
  <div class="surface-backdrop absolute inset-0"></div>
  <div
    bind:this={dialog}
    class="channel-dialog surface-dialog relative z-10 flex max-h-full w-full max-w-md flex-col outline-none"
    style="--foreground: var(--card-foreground);"
    role="dialog"
    aria-modal="true"
    aria-labelledby="channel-dialog-title"
    tabindex="-1"
    data-floating-root
    onclick={(event) => event.stopPropagation()}
  >
  <form class="contents" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <header class="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
      <h2 id="channel-dialog-title" class="truncate text-[1rem] font-semibold">{currentChannel ? `#${currentChannel.name}` : t("chat.channels.createTitle")}</h2>
      <button type="button" class="dialog-icon-button" aria-label={t("common.close")} onclick={onCancel}><X size={16} /></button>
    </header>

    <div class="dialog-body flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-3 text-panel">
      <label class="grid gap-1.5">
        <span class="field-label">{t("chat.channels.name")}</span>
        <div class="field flex h-9 items-center gap-1 pl-2.5"><Hash size={14} class="shrink-0 text-muted-foreground" /><input bind:this={nameInput} class="field-bare min-w-0 flex-1" bind:value={name} maxlength="80" required disabled={currentChannel?.isDefault} /></div>
      </label>
      <label class="grid gap-1.5">
        <span class="field-label">{t("chat.channels.topic")}</span>
        <input class="field h-9" bind:value={topic} maxlength="250" placeholder={t("chat.channels.topicPlaceholder")} />
      </label>
      {#if sections.length > 0}
        <div class="grid gap-1.5">
          <span class="field-label">{t("chat.channels.section")}</span>
          <Select inline class="w-full" value={sectionId} options={sectionOptions} ariaLabel={t("chat.channels.section")} onChange={(value) => { sectionId = value; }} />
        </div>
      {/if}

      <div class="grid gap-1.5">
        <span class="field-label">{t("chat.organization.members")}</span>
        <ul class="member-list">
          {#each humanMembers as membership (membership.participant.id)}
            <li class="member-row">
              <ChatParticipantAvatar participant={membership.participant} size={MEMBER_AVATAR_SIZE} />
              <span class="member-name">{membership.participant.displayName}</span>
            </li>
          {/each}
          {#each memberTeammates as teammate (teammate.participant.id)}
            <li class="member-row">
              <ChatParticipantAvatar participant={teammate.participant} {teammate} size={MEMBER_AVATAR_SIZE} />
              <span class="member-name">{teammate.participant.displayName}</span>
              <span class="member-detail">{teammate.configurationState === "healthy" ? teammate.role || t("chat.organization.aiTeammate") : t("chat.organization.needsSetup")}</span>
              {#if currentTeammateIds.has(teammate.participant.id)}
                <button type="button" class="dialog-icon-button member-action" aria-label={t("chat.organization.accessSettings", teammate.participant.displayName)} onclick={() => configureMember(teammate.participant.id)}><Settings2 size={14} /></button>
              {/if}
              <button type="button" class="dialog-icon-button member-action" aria-label={t("chat.organization.removeTeammate", teammate.participant.displayName)} disabled={removalBusy} onclick={() => void removeMember(teammate.participant.id)}><X size={14} /></button>
            </li>
          {/each}
        </ul>
        <Select inline appearance="quiet" contentAlign="start" class="w-full" value="" triggerLabel={t("chat.organization.addTeammate")} ariaLabel={t("chat.organization.addTeammate")} options={addOptions} searchPlaceholder={addOptions.length > 1 ? t("chat.organization.searchTeammates") : undefined} showActiveCheck={false} onChange={addMember}>
          {#snippet leading(value: string)}
            {@const teammate = teammateFor(value)}
            {#if teammate}
              <ChatParticipantAvatar participant={teammate.participant} {teammate} size={20} />
            {:else if value === NEW_TEAMMATE_OPTION}
              <Plus size={14} class="shrink-0 text-muted-foreground" />
            {/if}
          {/snippet}
        </Select>
      </div>

      {#if error}<p class="text-panel-detail text-destructive" role="alert">{error}</p>{/if}
    </div>

    <footer class="flex justify-end gap-2 px-5 pt-2 pb-4">
      <button type="button" class="chat-secondary-button" onclick={onCancel}>{t("common.cancel")}</button>
      <button type="submit" class="chat-primary-button" disabled={saving || !name.trim()}>{#if saving}<LoaderCircle size={14} class="animate-spin" />{/if}{currentChannel ? t("common.save") : t("chat.channels.create")}</button>
    </footer>
  </form>
  </div>
</div>

{#if removal && removalParticipant}
  <ConfirmDialog
    title={t("chat.organization.removeTeammateTitle", removalParticipant.displayName)}
    message={t("chat.organization.removeTeammateImpact", removal.preview.activeAssignmentCount, removal.preview.activeAuthorizationCount)}
    confirmLabel={t("chat.organization.removeTeammateConfirm")}
    cancelLabel={t("common.cancel")}
    onConfirm={() => { if (removal) dropMember(removal.teammateId); removal = null; }}
    onCancel={() => { removal = null; }}
  />
{/if}

<style>
  .channel-dialog { max-height: min(40rem, 100%); }
  .field-label { color: var(--muted-foreground); font-size: var(--panel-detail-font-size); font-weight: 500; line-height: 1.4; }
  .dialog-icon-button { display: grid; width: 1.75rem; height: 1.75rem; flex: 0 0 auto; place-items: center; border-radius: 0.375rem; color: var(--muted-foreground); }
  .dialog-icon-button:hover:not(:disabled) { background: var(--accent); color: var(--foreground); }
  .dialog-icon-button:disabled { opacity: 0.45; }
  .member-list { display: grid; }
  .member-list:empty { display: none; }
  .member-row { display: flex; min-height: 2.25rem; align-items: center; gap: 0.6rem; padding-inline: 0.375rem; }
  .member-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .member-detail { min-width: 0; flex: 1; overflow: hidden; color: var(--muted-foreground); font-size: var(--panel-detail-font-size); text-overflow: ellipsis; white-space: nowrap; }
  .member-row:has(.member-action) .member-name { flex: 0 1 auto; }
  .member-row:not(:has(.member-detail)) .member-name { flex: 1; }
  @media (pointer: coarse) { .dialog-icon-button { width: 2.5rem; height: 2.5rem; } }
</style>

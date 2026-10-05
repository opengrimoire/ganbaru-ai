<script lang="ts">
  import { tick } from "svelte";
  import Bot from "@lucide/svelte/icons/bot";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Users from "@lucide/svelte/icons/users";
  import * as chatApi from "$lib/api/chat";
  import {
    pickSelectPopoverGeometry,
    type SelectPopoverGeometry,
    type SelectPopoverRect,
  } from "$lib/utils/select-popover-position";
  import type {
    ChatChannelMembershipRemovalPreview,
    ChatTeammateAccessRead,
  } from "$lib/chat/contracts";
  import { channelCapabilityPreset } from "$lib/chat/teammates/access";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getChat } from "$lib/stores/chat.svelte";
  import { portal } from "$lib/utils/portal";
  import ChatParticipantAvatar from "$lib/components/chat/identity/ChatParticipantAvatar.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const chat = getChat();
  const { t } = getLocalization();
  let open = $state(false);
  let query = $state("");
  let anchor = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let popover = $state<HTMLDivElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let popoverReady = $state(false);
  let popoverGeometry = $state<SelectPopoverGeometry>({
    top: 0,
    left: 0,
    width: null,
    minWidth: 0,
    maxWidth: 0,
    maxHeight: 0,
    placement: "below",
  });
  let accessByTeammate = $state<Map<string, ChatTeammateAccessRead>>(new Map());
  let loadRequest = 0;
  let showAdd = $state(false);
  let pendingRemovalId = $state<string | null>(null);
  let removalExpectedAccessRevision = $state<number | null>(null);
  let removalPreview = $state<ChatChannelMembershipRemovalPreview | null>(null);
  let removalBusy = $state(false);
  let removalError = $state<string | null>(null);

  const channel = $derived(chat.selectedChannel);
  const memberships = $derived((channel?.memberships ?? []).filter((membership) => membership.removedAt === null));
  const memberIds = $derived(new Set(memberships.map((membership) => membership.participant.id)));
  const matchingMembers = $derived.by(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return memberships;
    return memberships.filter((membership) => membership.participant.displayName
      .toLocaleLowerCase()
      .includes(normalized));
  });
  const availableTeammates = $derived(chat.teammates.filter((teammate) => (
    !memberIds.has(teammate.participant.id)
      && (!query.trim() || `${teammate.participant.displayName} ${teammate.role}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()))
  )));

  $effect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !anchor?.contains(target) && !popover?.contains(target)) open = false;
    };
    const reposition = () => positionPopover();
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  });

  function rect(value: DOMRect): SelectPopoverRect {
    return {
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      left: value.left,
      width: value.width,
      height: value.height,
    };
  }

  function positionPopover(): void {
    if (!trigger || !popover) return;
    popoverGeometry = pickSelectPopoverGeometry({
      triggerRect: rect(trigger.getBoundingClientRect()),
      boundaryRect: {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      },
      contentHeight: popover.scrollHeight,
      contentWidth: popover.scrollWidth,
      horizontalAlign: "end",
    });
    popoverReady = true;
  }

  function popoverStyle(): string {
    if (!popoverReady) return "visibility:hidden;top:0;left:0;";
    return `visibility:visible;top:${popoverGeometry.top}px;left:${popoverGeometry.left}px;width:${popoverGeometry.width ?? 336}px;max-height:${popoverGeometry.maxHeight}px;`;
  }

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    query = "";
    showAdd = false;
    popoverReady = false;
    void loadAccess();
    await tick();
    positionPopover();
    searchInput?.focus();
  }

  async function loadAccess(): Promise<void> {
    const request = ++loadRequest;
    const teammateIds = memberships
      .filter((membership) => membership.participant.kind === "ai_teammate")
      .map((membership) => membership.participant.id);
    const reads = await Promise.allSettled(teammateIds.map((id) => chatApi.readChatTeammateAccess(id)));
    if (request !== loadRequest) return;
    accessByTeammate = new Map(reads.flatMap((read) => (
      read.status === "fulfilled" ? [[read.value.teammateId, read.value] as const] : []
    )));
  }

  function accessSummary(teammateId: string): string {
    const current = accessByTeammate.get(teammateId)?.channels.find((entry) => (
      entry.channelId === channel?.id && entry.removedAt === null
    ));
    if (!current) return t("chat.organization.accessUnavailable");
    const preset = channelCapabilityPreset(current.capabilities);
    const folderCount = current.folderGrants.filter((grant) => grant.revokedAt === null).length;
    const missingBinding = current.folderGrants.some((grant) => (
      grant.revokedAt === null
        && chat.workingFolders.find((folder) => folder.workingFolder.id === grant.workingFolderId)
          ?.bindingStatus !== "available"
    ));
    const teammate = chat.teammates.find((entry) => entry.participant.id === teammateId);
    const provider = chat.settings?.providerInstances.find((entry) => (
      entry.configuration.instanceId === teammate?.latestPolicy?.providerInstanceId
    ));
    const providerLabel = provider?.configuration.label ?? t("settings.chat.teammates.needsSetup");
    const health = teammate?.configurationState === "healthy" && !missingBinding
      ? t("settings.chat.teammates.available")
      : t("settings.chat.teammates.needsSetup");
    const behavior = preset === "custom"
      ? t("settings.chat.teammates.presets.custom")
      : t(`settings.chat.teammates.presetControls.${preset}.label`);
    return `${behavior} · ${folderCount
      ? t("settings.chat.teammates.folderCount", folderCount)
      : t("settings.chat.teammates.noWorkResources")} · ${providerLabel} · ${health}`;
  }

  function configure(participantId: string): void {
    if (!channel) return;
    open = false;
    window.dispatchEvent(new CustomEvent("ganbaru-ai:chat-configure-teammate", {
      detail: { participantId, channelId: channel.id },
    }));
  }

  function manage(): void {
    open = false;
    window.dispatchEvent(new Event("ganbaru-ai:chat-manage-members"));
  }

  function createTeammate(): void {
    if (!channel) return;
    open = false;
    window.dispatchEvent(new CustomEvent("ganbaru-ai:chat-new-teammate", {
      detail: { channelId: channel.id },
    }));
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    open = false;
    void tick().then(() => trigger?.focus());
  }

  async function prepareRemoval(teammateId: string): Promise<void> {
    const currentChannel = channel;
    if (!currentChannel || removalBusy) return;
    removalBusy = true;
    removalError = null;
    try {
      const access = await chatApi.readChatTeammateAccess(teammateId);
      removalPreview = await chatApi.previewChatChannelMembershipRemoval({
        teammateId,
        channelId: currentChannel.id,
        expectedAccessRevision: access.accessRevision,
      });
      pendingRemovalId = teammateId;
      removalExpectedAccessRevision = access.accessRevision;
    } catch (cause: unknown) {
      removalPreview = null;
      removalExpectedAccessRevision = null;
      removalError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      removalBusy = false;
    }
  }

  async function confirmRemoval(): Promise<void> {
    const teammateId = pendingRemovalId;
    const preview = removalPreview;
    const expectedAccessRevision = removalExpectedAccessRevision;
    const currentChannel = channel;
    pendingRemovalId = null;
    removalPreview = null;
    removalExpectedAccessRevision = null;
    if (!teammateId || !preview || expectedAccessRevision === null || !currentChannel || removalBusy) return;
    removalBusy = true;
    removalError = null;
    try {
      const access = preview.proposedAccess;
      const request = {
        teammateId,
        expectedAccessRevision,
        teammateDefaultRuntimeApproval: access.teammateDefaultRuntimeApproval,
        channels: access.channels
          .filter((entry) => entry.removedAt === null && entry.channelId !== currentChannel.id)
          .map((entry) => ({
            channelId: entry.channelId,
            accessProfileId: entry.accessProfileId,
            accessProfileRevision: entry.accessProfileRevision,
            capabilities: { ...entry.capabilities },
            historyBoundary: entry.historyBoundary.kind === "entire"
              ? { kind: "entire" as const }
              : { kind: "fromGrant" as const },
            runtimeApprovalOverride: entry.runtimeApprovalOverride,
            scratchRuntimeApprovalOverride: entry.scratchRuntimeApprovalOverride,
            folderGrants: entry.folderGrants.filter((grant) => grant.revokedAt === null).map((grant) => ({
              workingFolderId: grant.workingFolderId,
              capability: grant.capability,
              isDefault: grant.isDefault,
              runtimeApprovalOverride: grant.runtimeApprovalOverride,
            })),
          })),
      };
      await chatApi.replaceChatTeammateAccess(request);
      const refreshed = await chatApi.readChatChannel(currentChannel.id);
      chat.activeChannels = chat.activeChannels.map((entry) => entry.id === refreshed.id ? refreshed : entry);
      await chat.refreshTeammates();
      void loadAccess();
    } catch (cause: unknown) {
      removalError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      removalBusy = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div bind:this={anchor} class="roster-anchor">
  <button bind:this={trigger} type="button" class="roster-trigger" aria-label={t("chat.organization.manageMembers")} aria-haspopup="dialog" aria-controls={open ? "chat-channel-roster" : undefined} aria-expanded={open} data-chat-roster-trigger onclick={() => void toggle()}>
    <Users size={15} />
  </button>
  {#if open}
    <div bind:this={popover} use:portal id="chat-channel-roster" class="roster-popover" role="dialog" aria-label={t("chat.organization.channelRoster")} data-app-floating-surface style={popoverStyle()}>
      <header><div><strong>{channel ? `#${channel.name}` : t("chat.organization.channelRoster")}</strong><small>{t("chat.organization.members", memberships.length)}</small></div><button type="button" aria-label={t("chat.organization.addTeammate")} aria-expanded={showAdd} onclick={() => { showAdd = !showAdd; }}><Plus size={14} /></button></header>
      <label class="roster-search"><Search size={13} /><input bind:this={searchInput} bind:value={query} placeholder={t("chat.organization.searchMembers")} aria-label={t("chat.organization.searchMembers")} /></label>
      <div class="roster-list">
        {#each matchingMembers as membership (membership.participant.id)}
          {@const teammate = chat.teammates.find((entry) => entry.participant.id === membership.participant.id)}
          <div class="roster-row"><button type="button" class="member-identity" onclick={() => membership.participant.kind === "ai_teammate" && configure(membership.participant.id)}><ChatParticipantAvatar participant={membership.participant} {teammate} size={30} /><span><strong>{membership.participant.displayName}</strong><small>{membership.participant.kind === "ai_teammate" ? accessSummary(membership.participant.id) : t("chat.organization.humanMember")}</small></span></button>{#if membership.participant.kind === "ai_teammate"}<button type="button" class="remove-member" aria-label={t("chat.organization.removeTeammate", membership.participant.displayName)} disabled={removalBusy} onclick={() => void prepareRemoval(membership.participant.id)}><Trash2 size={13} /></button>{/if}</div>
        {/each}
        {#if (showAdd || query) && availableTeammates.length}
          <div class="section-label">{t("chat.organization.addExistingTeammate")}</div>
          {#each availableTeammates as teammate (teammate.participant.id)}
            <button type="button" class="roster-row" onclick={() => configure(teammate.participant.id)}><ChatParticipantAvatar participant={teammate.participant} {teammate} size={30} /><span><strong>{teammate.participant.displayName}</strong><small>{t("chat.organization.reviewChannelAccess")}</small></span><Plus size={13} /></button>
          {/each}
        {/if}
        {#if matchingMembers.length === 0 && availableTeammates.length === 0}<p>{t("chat.organization.noMemberResults")}</p>{/if}
        {#if removalError}<p class="roster-error" role="alert">{removalError}</p>{/if}
      </div>
      <footer><button type="button" onclick={createTeammate}><Plus size={14} />{t("chat.organization.newTeammate")}</button><button type="button" onclick={manage}><Bot size={14} />{t("chat.organization.manageTeammates")}</button></footer>
    </div>
  {/if}
</div>

{#if pendingRemovalId && removalPreview}
  {@const pendingParticipant = memberships.find((membership) => membership.participant.id === pendingRemovalId)?.participant}
  <ConfirmDialog title={t("chat.organization.removeTeammateTitle", pendingParticipant?.displayName ?? "")} message={t("chat.organization.removeTeammateImpact", removalPreview.activeAssignmentCount, removalPreview.activeAuthorizationCount)} confirmLabel={t("chat.organization.removeTeammateConfirm")} cancelLabel={t("common.cancel")} danger onConfirm={() => void confirmRemoval()} onCancel={() => { pendingRemovalId = null; removalExpectedAccessRevision = null; removalPreview = null; }} />
{/if}

<style>
  .roster-anchor { position:relative; }
  .roster-trigger { display:flex; width:1.75rem; height:1.75rem; align-items:center; justify-content:center; border-radius:0.375rem; color:var(--foreground); }
  .roster-trigger:hover,.roster-trigger[aria-expanded="true"] { background:var(--accent); }
  .roster-popover { position:fixed; z-index:90; display:grid; width:min(21rem,calc(100vw - 1rem)); grid-template-rows:auto auto minmax(0,1fr) auto; border:1px solid var(--border); border-radius:0.65rem; background:var(--popover); color:var(--popover-foreground); box-shadow:0 18px 42px color-mix(in srgb,#000 22%,transparent); overflow:hidden; }
  .roster-popover > header { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; border-bottom:1px solid var(--border); padding:0.65rem; }
  .roster-popover > header div { display:grid; }
  .roster-popover > header strong { font-size:calc(0.75rem * var(--type-scale)); }
  .roster-popover > header small { color:var(--muted-foreground); font-size:calc(0.62rem * var(--type-scale)); }
  .roster-popover > header button { display:grid; width:1.8rem; height:1.8rem; place-items:center; border-radius:0.4rem; }
  .roster-popover > header button:hover { background:var(--accent); }
  .roster-search { display:flex; min-height:2rem; align-items:center; gap:0.4rem; margin:0.55rem; border:1px solid var(--border); border-radius:0.42rem; padding-inline:0.5rem; color:var(--muted-foreground); }
  .roster-search input { width:100%; min-width:0; border:0; background:transparent; color:var(--foreground); outline:0; font-size:calc(0.68rem * var(--type-scale)); }
  .roster-list { overflow-y:auto; padding:0 0.4rem 0.45rem; }
  .roster-row { display:grid; width:100%; min-width:0; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:0.25rem; border-radius:0.45rem; }
  .roster-row:hover { background:var(--accent); }
  .member-identity { display:grid; min-width:0; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:0.5rem; padding:0.45rem; text-align:left; }
  .member-identity > span { display:grid; min-width:0; }
  .roster-row strong,.roster-row small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .roster-row strong { font-size:calc(0.7rem * var(--type-scale)); }
  .roster-row small { color:var(--muted-foreground); font-size:calc(0.6rem * var(--type-scale)); }
  .section-label { padding:0.55rem 0.45rem 0.25rem; color:var(--muted-foreground); font-size:calc(0.58rem * var(--type-scale)); font-weight:650; text-transform:uppercase; }
  .remove-member { display:grid; width:1.75rem; height:1.75rem; place-items:center; border-radius:0.38rem; color:var(--muted-foreground); }
  .remove-member:hover { background:color-mix(in srgb,var(--destructive) 12%,transparent); color:var(--destructive); }
  .roster-error { color:var(--destructive) !important; }
  .roster-list > p { padding:1rem; color:var(--muted-foreground); font-size:calc(0.68rem * var(--type-scale)); text-align:center; }
  .roster-popover > footer { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0.3rem; border-top:1px solid var(--border); padding:0.45rem; }
  .roster-popover > footer button { display:flex; min-height:2rem; width:100%; align-items:center; justify-content:center; gap:0.4rem; border-radius:0.42rem; font-size:calc(0.68rem * var(--type-scale)); font-weight:600; }
  .roster-popover > footer button:hover { background:var(--accent); }
  @media (pointer:coarse) { .roster-trigger,.roster-popover > header button,.remove-member { min-width:2.75rem; min-height:2.75rem; }.member-identity,.roster-popover > footer button { min-height:2.75rem; } }
</style>

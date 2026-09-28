<script lang="ts">
  import { onMount, tick } from "svelte";
  import { COMPACT_IDENTITY_ICON_SIZE, COMPACT_IDENTITY_ICON_STROKE_WIDTH } from "$lib/icon-sizing";
  import ExplorerSearch from "$lib/components/ExplorerSearch.svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronsLeft from "@lucide/svelte/icons/chevrons-left";
  import ChevronsRight from "@lucide/svelte/icons/chevrons-right";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Hash from "@lucide/svelte/icons/hash";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Plus from "@lucide/svelte/icons/plus";
  import type { ChatChannelRead, ChatMessageSearchResultRead } from "$lib/chat/contracts";
  import { chatParticipantDisplayName } from "$lib/chat/participant-display";
  import {
    moveChatChannelToSection,
    normalizeChatSidebarSections,
    readChatSidebarSections,
    saveChatSidebarSections,
    type ChatSidebarSection,
  } from "$lib/chat/channel-sections";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getChat } from "$lib/stores/chat.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { onActiveVaultIdentityChange } from "$lib/vault/active-vault";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import ChatChannelSetupDialog from "./ChatChannelSetupDialog.svelte";

  let {
    presentation = "column",
    expanded,
    showCollapsedStrip,
    onExpand,
    onCollapse,
  }: {
    presentation?: "column" | "sheet" | "surface";
    expanded: boolean;
    showCollapsedStrip: boolean;
    onExpand: () => void;
    onCollapse: () => void;
  } = $props();

  const chat = getChat();
  const preferences = getPreferences();
  const projects = getProjects();
  const { t } = getLocalization();
  let query = $state("");
  let railElement = $state<HTMLElement | null>(null);
  let channelMenuTrigger: HTMLElement | null = null;
  let sectionInput = $state<HTMLInputElement>();
  let sectionButton = $state<HTMLElement>();
  let channelContextMenuElement = $state<HTMLElement | null>(null);
  let channelContextMenu = $state<{ channel: ChatChannelRead; x: number; y: number } | null>(null);
  let setupChannel = $state<ChatChannelRead | null | undefined>(undefined);
  let setupSectionId = $state<string | null>(null);
  let sections = $state<ChatSidebarSection[]>([]);
  let loadedProjectId = $state<string | null>(null);
  let newSectionName = $state("");
  let creatingSection = $state(false);
  let channelsCollapsed = $state(false);
  let archiveCandidate = $state<ChatChannelRead | null>(null);
  let deleteSectionCandidate = $state<ChatSidebarSection | null>(null);
  let railError = $state<string | null>(null);
  let messageSearchResults = $state<ChatMessageSearchResultRead[]>([]);
  let messageSearchLoading = $state(false);
  let messageSearchRequest = 0;
  const matchingChannels = $derived(chat.activeChannels.filter(matchesQuery));
  const assignedChannelIds = $derived(new Set(sections.flatMap((section) => section.channelIds)));
  const unsectionedChannels = $derived(matchingChannels.filter((channel) => !assignedChannelIds.has(channel.id)));

  function searchAuthorDisplayName(result: ChatMessageSearchResultRead): string {
    return chatParticipantDisplayName(
      {
        id: result.authorParticipantId,
        kind: result.authorKind,
        displayName: result.authorDisplayName,
      },
      preferences.profileDisplayName,
      t("chat.timeline.you"),
    );
  }

  $effect(() => {
    const projectId = projects.selectedProjectId;
    if (!projectId || projectId === loadedProjectId) return;
    const projectChannels = chat.activeChannels.filter((channel) => channel.projectId === projectId);
    if (projectChannels.length === 0 && chat.activeChannels.length > 0) return;
    loadedProjectId = projectId;
    sections = normalizeChatSidebarSections(readChatSidebarSections(projectId), projectChannels.map((channel) => channel.id));
  });

  $effect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      messageSearchRequest += 1;
      messageSearchResults = [];
      messageSearchLoading = false;
      return;
    }
    const request = ++messageSearchRequest;
    messageSearchLoading = true;
    const timeout = window.setTimeout(() => {
      void chat.searchOrganizationalMessages(normalized)
        .then((results) => {
          if (request === messageSearchRequest) messageSearchResults = results;
        })
        .catch((cause: unknown) => {
          if (request === messageSearchRequest) {
            railError = cause instanceof Error ? cause.message : String(cause);
          }
        })
        .finally(() => {
          if (request === messageSearchRequest) messageSearchLoading = false;
        });
    }, 180);
    return () => window.clearTimeout(timeout);
  });

  $effect(() => {
    const projectId = loadedProjectId;
    const channelIds = chat.activeChannels
      .filter((channel) => channel.projectId === projectId)
      .map((channel) => channel.id);
    if (!projectId) return;
    const normalized = normalizeChatSidebarSections(sections, channelIds);
    if (JSON.stringify(normalized) !== JSON.stringify(sections)) sections = normalized;
  });

  function matchesQuery(channel: ChatChannelRead): boolean {
    const normalized = query.trim().toLocaleLowerCase();
    return !normalized
      || channel.name.toLocaleLowerCase().includes(normalized)
      || channel.topic.toLocaleLowerCase().includes(normalized);
  }

  function sectionChannels(section: ChatSidebarSection): ChatChannelRead[] {
    const byId = new Map(matchingChannels.map((channel) => [channel.id, channel]));
    return section.channelIds.flatMap((id) => byId.get(id) ?? []);
  }

  function persist(next: ChatSidebarSection[]): void {
    sections = next;
    if (loadedProjectId) saveChatSidebarSections(loadedProjectId, next);
  }

  function toggleSection(sectionId: string): void {
    persist(sections.map((section) => section.id === sectionId
      ? { ...section, collapsed: !section.collapsed }
      : section));
  }

  function sectionToggleLabel(name: string, collapsed: boolean): string {
    return collapsed
      ? t("chat.channels.expandSection", name)
      : t("chat.channels.collapseSection", name);
  }

  /** Reveal the section draft and focus its name, or return to the section menu. */
  function toggleSectionDraft(): void {
    creatingSection = !creatingSection;
    newSectionName = "";
    if (creatingSection) void tick().then(() => sectionInput?.focus());
    else sectionButton?.focus();
  }

  function createSection(): void {
    const name = newSectionName.trim();
    if (!name || [...name].length > 80) return;
    persist([...sections, { id: `section:${crypto.randomUUID()}`, name, collapsed: false, channelIds: [] }]);
    newSectionName = "";
    creatingSection = false;
    sectionButton?.focus();
  }

  function deleteSection(section: ChatSidebarSection): void {
    persist(sections.filter((entry) => entry.id !== section.id));
    deleteSectionCandidate = null;
  }

  function confirmDeleteSection(): void {
    const section = deleteSectionCandidate;
    if (section) deleteSection(section);
  }

  function renameSection(section: ChatSidebarSection): void {
    const name = window.prompt(t("chat.channels.sectionName"), section.name)?.trim();
    if (!name || [...name].length > 80 || name === section.name) return;
    persist(sections.map((entry) => entry.id === section.id ? { ...entry, name } : entry));
  }

  function moveChannel(channelId: string, sectionId: string | null): void {
    persist(moveChatChannelToSection(sections, channelId, sectionId));
  }

  function handleDrop(event: DragEvent, sectionId: string | null): void {
    event.preventDefault();
    const channelId = event.dataTransfer?.getData("application/x-ganbaru-chat-channel") ?? "";
    if (channelId) moveChannel(channelId, sectionId);
  }

  function beginDrag(event: DragEvent, channelId: string): void {
    event.dataTransfer?.setData("application/x-ganbaru-chat-channel", channelId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  async function openChannelContextMenu(event: MouseEvent, channel: ChatChannelRead): Promise<void> {
    event.preventDefault();
    const viewportGap = 8;
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    channelMenuTrigger = trigger;
    const triggerBounds = trigger?.getBoundingClientRect();
    const openedFromKeyboard = event.type === "click" || (event.clientX === 0 && event.clientY === 0);
    const initialX = openedFromKeyboard ? triggerBounds?.left ?? viewportGap : event.clientX;
    const initialY = openedFromKeyboard ? triggerBounds?.bottom ?? viewportGap : event.clientY;
    channelContextMenu = { channel, x: initialX, y: initialY };
    await tick();
    if (!channelContextMenuElement || channelContextMenu?.channel.id !== channel.id) return;
    const menuBounds = channelContextMenuElement.getBoundingClientRect();
    channelContextMenu = {
      channel,
      x: Math.min(Math.max(viewportGap, initialX), Math.max(viewportGap, window.innerWidth - menuBounds.width - viewportGap)),
      y: Math.min(Math.max(viewportGap, initialY), Math.max(viewportGap, window.innerHeight - menuBounds.height - viewportGap)),
    };
    channelContextMenuElement.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function editChannelFromContextMenu(): void {
    const menu = channelContextMenu;
    if (!menu) return;
    channelContextMenu = null;
    setupChannel = menu.channel;
    setupSectionId = sections.find((section) => section.channelIds.includes(menu.channel.id))?.id ?? null;
  }

  function moveChannelFromContextMenu(sectionId: string | null): void {
    const menu = channelContextMenu;
    if (!menu) return;
    channelContextMenu = null;
    moveChannel(menu.channel.id, sectionId);
  }

  function archiveChannelFromContextMenu(): void {
    const menu = channelContextMenu;
    if (!menu) return;
    channelContextMenu = null;
    archiveCandidate = menu.channel;
  }

  async function confirmArchive(): Promise<void> {
    const channel = archiveCandidate;
    archiveCandidate = null;
    if (!channel) return;
    railError = null;
    try {
      await chat.archiveChannel(channel);
    } catch (cause: unknown) {
      railError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function savedChannel(channel: ChatChannelRead, sectionId: string | null): void {
    moveChannel(channel.id, sectionId);
    setupChannel = undefined;
    setupSectionId = null;
    if (presentation === "surface") onCollapse();
  }

  /** Focus the persistent search field after the rail has opened. */
  function openSearch(): void {
    void tick().then(() => railElement?.querySelector<HTMLInputElement>('input[type="search"]')?.focus());
  }

  function openCreate(sectionId: string | null = null): void {
    onExpand();
    setupChannel = null;
    setupSectionId = sectionId;
  }

  async function selectChannel(channelId: string): Promise<void> {
    railError = null;
    try {
      await chat.selectChannel(channelId);
      if (presentation === "surface") onCollapse();
    } catch (cause: unknown) {
      railError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function openMessageResult(result: ChatMessageSearchResultRead): Promise<void> {
    railError = null;
    try {
      await chat.openMessageSearchResult(result);
      query = "";
      if (presentation === "surface") onCollapse();
    } catch (cause: unknown) {
      railError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function searchExcerpt(result: ChatMessageSearchResultRead): string {
    return result.excerpt.replace(/<\/?mark>/g, "");
  }

  function projectName(projectId: string): string {
    return projects.projects.find((project) => project.id === projectId)?.name ?? t("chat.title");
  }

  onMount(() => {
    const createChannel = () => openCreate();
    const focusSearch = () => {
      onExpand();
      openSearch();
    };
    const closeOpenMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const openMenus = railElement?.querySelectorAll<HTMLDetailsElement>(".section-menu[open]") ?? [];
      for (const menu of openMenus) {
        if (!menu.contains(target)) menu.open = false;
      }
      if (channelContextMenu && !channelContextMenuElement?.contains(target)) channelContextMenu = null;
    };
    window.addEventListener("ganbaru-ai:chat-new-channel", createChannel);
    window.addEventListener("ganbaru-ai:chat-focus-search", focusSearch);
    document.addEventListener("pointerdown", closeOpenMenus);
    const unsubscribeVault = onActiveVaultIdentityChange(() => {
      loadedProjectId = null;
      sections = [];
    });
    return () => {
      window.removeEventListener("ganbaru-ai:chat-new-channel", createChannel);
      window.removeEventListener("ganbaru-ai:chat-focus-search", focusSearch);
      document.removeEventListener("pointerdown", closeOpenMenus);
      unsubscribeVault();
    };
  });
</script>

{#if expanded}
  <aside bind:this={railElement} class="explorer-sidebar flex h-full min-h-0 flex-col" class:explorer-touch={presentation === "surface"} aria-label={t("chat.channels.explorerLabel")}>
    <div class="explorer-toolbar">
      <ExplorerSearch bind:value={query} label={t("chat.channels.search")} clearLabel={t("chat.channels.clearSearch")} inline focusOnMount={false} />
      <button type="button" class="explorer-icon" data-chat-rail-close aria-label={t("chat.collapseRail")} aria-expanded="true" data-app-tooltip={t("chat.collapseRail")} onclick={onCollapse}><ChevronsLeft size={16} /></button>
    </div>

    {#if creatingSection}
      <form class="mx-2 mb-2 flex gap-1" onsubmit={(event) => { event.preventDefault(); createSection(); }}>
        <input bind:this={sectionInput} class="min-h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs" bind:value={newSectionName} maxlength="80" placeholder={t("chat.channels.sectionName")} aria-label={t("chat.channels.sectionName")} onkeydown={(event) => { if (event.key === "Escape") { event.stopPropagation(); toggleSectionDraft(); } }} />
        <button type="submit" class="explorer-icon" disabled={!newSectionName.trim()} aria-label={t("chat.channels.add")}><Plus size={16} /></button>
      </form>
    {/if}

    {#if railError}<p class="mx-2 mb-1 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" role="alert">{railError}</p>{/if}

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {#if query.trim().length >= 2}
        <section class="message-results" aria-label={t("chat.organization.messageSearchResults")}>
          <div class="section-heading"><span>{t("chat.organization.messages")}</span>{#if messageSearchLoading}<LoaderCircle size={12} class="animate-spin" aria-label={t("common.loading")} />{/if}</div>
          {#each messageSearchResults as result (result.messageItemId)}
            <button type="button" class="message-result" onclick={() => void openMessageResult(result)}>
              <span><strong>{searchAuthorDisplayName(result)}</strong><small>{projectName(result.projectId)} · #{result.channelName}{#if result.replyThreadId} · {t("chat.organization.thread")}{/if}</small></span>
              <span>{searchExcerpt(result)}</span>
            </button>
          {/each}
          {#if !messageSearchLoading && messageSearchResults.length === 0}<p class="px-2 py-1 text-xs text-muted-foreground">{t("chat.organization.noMessageSearchResults")}</p>{/if}
        </section>
      {/if}
      <section class="channel-section" role="group" ondragover={(event) => event.preventDefault()} ondrop={(event) => handleDrop(event, null)}>
        <div class="section-heading">
          <button type="button" class="section-toggle" class:collapsed={channelsCollapsed} aria-label={sectionToggleLabel(t("chat.channels.defaultSection"), channelsCollapsed)} aria-expanded={!channelsCollapsed} onclick={() => { channelsCollapsed = !channelsCollapsed; }}>
            <span>{t("chat.channels.defaultSection")}</span>
            {#if channelsCollapsed}<ChevronRight class="section-chevron" size={13} />{:else}<ChevronDown class="section-chevron" size={13} />{/if}
          </button>
          <button type="button" aria-label={t("chat.channels.createTitle")} onclick={() => openCreate()}><Plus size={13} /></button>
          <details class="section-menu">
            <summary bind:this={sectionButton} aria-label={t("chat.moreActions")}><EllipsisVertical size={13} /></summary>
            <div><button type="button" disabled={!projects.selectedProjectId} onclick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); toggleSectionDraft(); }}>{t("chat.channels.newSection")}</button></div>
          </details>
        </div>
        {#if !channelsCollapsed}
          {#if chat.channelsLoading && projects.selectedProjectId}
            <div class="channel-row explorer-row-label channel-loading" role="status" aria-label={t("common.loading")}>
              <Hash size={COMPACT_IDENTITY_ICON_SIZE} strokeWidth={COMPACT_IDENTITY_ICON_STROKE_WIDTH} class="explorer-row-icon" />
              <span class="min-w-0 flex-1 truncate">general</span>
              <LoaderCircle size={12} class="animate-spin" />
            </div>
          {:else}
            {#each unsectionedChannels as channel (channel.id)}
              {@render ChannelRow({ channel })}
            {/each}
            {#if unsectionedChannels.length === 0 && query}<p class="px-2 py-1 text-xs text-muted-foreground">{t("chat.channels.noResults")}</p>{/if}
          {/if}
        {/if}
      </section>

      {#each sections as section (section.id)}
        <section class="channel-section" role="group" ondragover={(event) => event.preventDefault()} ondrop={(event) => handleDrop(event, section.id)}>
          <div class="section-heading">
            <button type="button" class="section-toggle" class:collapsed={section.collapsed} aria-label={sectionToggleLabel(section.name, section.collapsed)} aria-expanded={!section.collapsed} onclick={() => toggleSection(section.id)}>
              <span>{section.name}</span>
              {#if section.collapsed}<ChevronRight class="section-chevron" size={13} />{:else}<ChevronDown class="section-chevron" size={13} />{/if}
            </button>
            <button type="button" aria-label={t("chat.channels.createTitle")} title={t("chat.channels.createTitle")} onclick={() => openCreate(section.id)}><Plus size={13} /></button>
            <details class="section-menu">
              <summary aria-label={`${t("chat.moreActions")}: ${section.name}`}><EllipsisVertical size={13} /></summary>
              <div><button type="button" onclick={() => renameSection(section)}>{t("chat.rename")}</button><button type="button" class="danger" onclick={() => { deleteSectionCandidate = section; }}>{t("chat.channels.deleteSectionConfirm")}</button></div>
            </details>
          </div>
          {#if !section.collapsed}
            {#each sectionChannels(section) as channel (channel.id)}{@render ChannelRow({ channel })}{/each}
          {/if}
        </section>
      {/each}

    </div>

  </aside>
{:else if showCollapsedStrip}
  <aside class="explorer-sidebar flex h-full flex-col items-center" aria-label={t("chat.channels.explorerLabel")}><div class="explorer-toolbar"><button type="button" class="explorer-icon" aria-expanded="false" data-app-tooltip={t("chat.openRail")} aria-label={t("chat.openRail")} onclick={onExpand}><ChevronsRight size={16} /></button></div></aside>
{/if}

{#if channelContextMenu}
  <div
    bind:this={channelContextMenuElement}
    class="channel-context-menu"
    class:explorer-touch={presentation === "surface"}
    role="menu"
    tabindex="-1"
    style={`left:${channelContextMenu.x}px;top:${channelContextMenu.y}px`}
    onkeydown={(event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        channelContextMenu = null;
        channelMenuTrigger?.focus();
      }
    }}
  >
    <button type="button" role="menuitem" onclick={editChannelFromContextMenu}>{t("chat.channels.edit")}</button>
    <span>{t("chat.channels.moveTo")}</span>
    <button type="button" role="menuitem" onclick={() => moveChannelFromContextMenu(null)}>{t("chat.channels.defaultSection")}</button>
    {#each sections as section (section.id)}<button type="button" role="menuitem" onclick={() => moveChannelFromContextMenu(section.id)}>{section.name}</button>{/each}
    {#if !channelContextMenu.channel.isDefault}<button type="button" role="menuitem" class="danger" onclick={archiveChannelFromContextMenu}>{t("chat.archive")}</button>{/if}
  </div>
{/if}

{#snippet ChannelRow({ channel }: { channel: ChatChannelRead })}
  <div class="channel-row-group explorer-row" class:explorer-selected={chat.selectedChannelId === channel.id && !chat.channelArchiveOpen} role="group" aria-label={channel.name} draggable="true" ondragstart={(event) => beginDrag(event, channel.id)}>
    <button type="button" class="channel-row explorer-row-label" class:selected={chat.selectedChannelId === channel.id && !chat.channelArchiveOpen} aria-current={chat.selectedChannelId === channel.id && !chat.channelArchiveOpen ? "page" : undefined} onclick={() => void selectChannel(channel.id)} oncontextmenu={(event) => void openChannelContextMenu(event, channel)}>
      <Hash size={COMPACT_IDENTITY_ICON_SIZE} strokeWidth={COMPACT_IDENTITY_ICON_STROKE_WIDTH} class="explorer-row-icon" />
      <span class="min-w-0 flex-1 truncate" title={channel.name}>{channel.name}</span>
    </button>
    <button type="button" class="explorer-icon explorer-row-action" aria-label={`${t("chat.channels.actions")}: ${channel.name}`} aria-haspopup="menu" aria-expanded={channelContextMenu?.channel.id === channel.id} data-app-tooltip={t("chat.channels.actions")} onclick={(event) => void openChannelContextMenu(event, channel)}><EllipsisVertical size={14} /></button>
  </div>
{/snippet}

{#if setupChannel !== undefined}
  <ChatChannelSetupDialog channel={setupChannel} {sections} initialSectionId={setupSectionId} onSaved={savedChannel} onCancel={() => { setupChannel = undefined; setupSectionId = null; }} />
{/if}

{#if archiveCandidate}<ConfirmDialog title={t("chat.channels.archiveConfirmTitle", archiveCandidate.name)} message={t("chat.channels.archiveConfirmMessage")} confirmLabel={t("chat.archive")} cancelLabel={t("chat.cancel")} onConfirm={() => void confirmArchive()} onCancel={() => { archiveCandidate = null; }} />{/if}
{#if deleteSectionCandidate}<ConfirmDialog title={t("chat.channels.deleteSectionTitle", deleteSectionCandidate.name)} message={t("chat.channels.deleteSectionMessage")} confirmLabel={t("chat.channels.deleteSectionConfirm")} cancelLabel={t("chat.cancel")} onConfirm={confirmDeleteSection} onCancel={() => { deleteSectionCandidate = null; }} />{/if}

<style>
  .channel-section + .channel-section { margin-top: 0.5rem; }
  .message-results { margin-block:0.3rem 0.45rem; border-bottom:1px solid var(--border); padding-bottom:0.45rem; }
  .message-result { display:grid; width:100%; gap:0.18rem; border-radius:0.4rem; padding:0.42rem 0.5rem; text-align:left; }
  .message-result:hover,.message-result:focus-visible { background:var(--accent); }
  .message-result > span:first-child { display:flex; min-width:0; align-items:baseline; gap:0.35rem; }
  .message-result strong { flex:0 0 auto; font-size: calc(0.72rem * var(--type-scale)); }
  .message-result small { min-width:0; overflow:hidden; color:var(--muted-foreground); font-size: calc(0.6rem * var(--type-scale)); text-overflow:ellipsis; white-space:nowrap; }
  .message-result > span:last-child { display:-webkit-box; overflow:hidden; color:var(--muted-foreground); font-size: calc(0.68rem * var(--type-scale)); line-height: calc(1rem * var(--type-scale)); -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; }
  .section-heading { display: flex; min-height: var(--explorer-row-height); align-items: center; gap: 0.2rem; padding-inline: 0.5rem; color: var(--muted-foreground); }
  .section-heading > button { display: flex; min-width: var(--explorer-action-size); min-height: var(--explorer-action-size); align-items: center; justify-content: center; gap: 0.2rem; border-radius: 0.3rem; }
  .section-heading > button:hover { background: var(--accent); color: var(--foreground); }
  .section-heading > .section-toggle { min-width: 0; flex: 1; justify-content: flex-start; }
  .section-toggle > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-toggle :global(.section-chevron) { flex: 0 0 auto; transition: opacity 120ms ease; }
  .section-menu { position:relative; }
  .section-menu summary { display:grid;min-width:var(--explorer-action-size);min-height:var(--explorer-action-size);list-style:none;place-items:center;border-radius:0.3rem; }
  .section-menu summary::-webkit-details-marker { display:none; }
  .section-menu summary:hover { background:var(--accent);color:var(--foreground); }
  .section-menu > div { position:absolute;right:0;z-index:75;width:9rem;border:1px solid var(--border);border-radius:0.5rem;background:var(--popover);padding:0.25rem;box-shadow:0 12px 30px rgb(0 0 0 / 0.2); }
  .section-menu button { display:flex;width:100%;min-height:2rem;align-items:center;border-radius:0.3rem;padding-inline:0.5rem;text-align:left;font-size: calc(0.8rem * var(--type-scale)); }
  .section-menu button:hover { background:var(--accent); }
  .section-menu button.danger { color:var(--destructive); }
  .section-menu > div { box-shadow: 0 2px 8px rgb(0 0 0 / 0.08); }
  .channel-context-menu { position:fixed;z-index:90;display:grid;width:9rem;max-height:calc(100vh - 1rem);overflow-y:auto;border:1px solid var(--border);border-radius:0.5rem;background:var(--popover);padding:0.25rem;color:var(--popover-foreground);box-shadow:0 2px 8px rgb(0 0 0 / 0.08); }
  .channel-context-menu button { display:flex;width:100%;min-height:2rem;align-items:center;border-radius:0.3rem;padding-inline:0.5rem;text-align:left;font-size: calc(0.8rem * var(--type-scale)); }
  .channel-context-menu button:hover, .channel-context-menu button:focus-visible { background:var(--accent); }
  .channel-context-menu > span { padding:0.3rem 0.5rem 0.15rem;color:var(--muted-foreground);font-size: calc(0.6rem * var(--type-scale)); }
  .channel-context-menu.explorer-touch button { min-height: var(--touch-target-min); }
  .channel-context-menu button.danger { color:var(--destructive); }
  .channel-row-group { position: relative; display: flex; min-width: 0; align-items: center; }
  .channel-row { display: flex; width: 100%; min-width: 0; min-height: var(--explorer-row-height); align-items: center; gap: 0.375rem; border-radius: 0.35rem; padding: var(--explorer-row-padding) 0.5rem; color: var(--foreground); text-align: left; }
  .channel-row-group .channel-row { flex: 1; }
  .explorer-touch .section-heading > button,
  .explorer-touch .section-menu summary { min-width: var(--touch-target-min); min-height: var(--touch-target-min); }
  .explorer-touch .section-heading > .section-toggle { min-width: 0; }
  .channel-loading { padding-right: 0.55rem; opacity: 0.72; }
</style>

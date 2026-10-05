<script lang="ts">
  import { onMount, tick } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Search from "@lucide/svelte/icons/search";
  import type { ChatChannelRead } from "$lib/chat/contracts";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    isPointerAimingAtSubmenu,
    type MenuAimPoint,
  } from "$lib/utils/menu-aim";
  import {
    projectPickerBridgeFrameStyle,
    projectPickerMenuAimRect,
    projectPickerPanelFrameStyle,
    projectPickerPointerPoint,
    projectPickerSubpanelAimOrigin,
    projectPickerSubpanelGeometry,
    projectPickerSubpanelSide,
  } from "$lib/projects/picker-panels";
  import { PROJECT_NAVIGATOR_PANEL_WIDTH } from "$lib/projects/toolbar";
  import type { Project, ProjectGroup } from "$lib/projects/types";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { portal } from "$lib/utils/portal";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import SettingsCheckbox from "$lib/components/settings/SettingsCheckbox.svelte";

  type CompactStage = "groups" | "projects" | "channels";

  interface SearchResult {
    channel: ChatChannelRead;
    groupName: string;
    projectName: string;
  }

  let {
    anchor,
    channels,
    selectedChannelIds,
    disabled = false,
    onSelectionChange,
    onClose,
  }: {
    anchor: HTMLElement;
    channels: readonly ChatChannelRead[];
    selectedChannelIds: ReadonlySet<string>;
    disabled?: boolean;
    onSelectionChange: (channelIds: readonly string[], selected: boolean) => void;
    onClose: () => void;
  } = $props();

  const projects = getProjects();
  const { t } = getLocalization();
  const panelGap = 4;
  const panelWidth = PROJECT_NAVIGATOR_PANEL_WIDTH;
  const panelRowHeight = 32;
  const panelListPadding = 8;
  const channelPanelChromeHeight = 42;
  const viewportMargin = 8;

  let query = $state("");
  let channelQuery = $state("");
  let compact = $state(false);
  let compactStage = $state<CompactStage>("groups");
  let activeGroupId = $state<string | null>(null);
  let activeProjectId = $state<string | null>(null);
  let mainPanelElement = $state<HTMLDivElement>();
  let mainScrollElement = $state<HTMLElement>();
  let mainScrollContentElement = $state<HTMLElement>();
  let mainSearchElement = $state<HTMLElement>();
  let compactBackElement = $state<HTMLButtonElement>();
  let searchInputElement = $state<HTMLInputElement>();
  let groupAnchorElement = $state<HTMLElement | null>(null);
  let projectPanelElement = $state<HTMLDivElement>();
  let projectScrollElement = $state<HTMLElement>();
  let projectAnchorElement = $state<HTMLElement | null>(null);
  let channelPanelElement = $state<HTMLDivElement>();
  let channelScrollElement = $state<HTMLElement>();
  let projectBridgeStyle = $state("");
  let projectPanelStyle = $state("");
  let channelBridgeStyle = $state("");
  let channelPanelStyle = $state("");
  let mainPanelStyle = $state("visibility:hidden");

  const activeChannels = $derived(channels.filter((channel) => channel.archivedAt === null));
  const activeProjects = $derived(projects.projects.filter((project) => project.status === "active"));
  const visibleGroups = $derived(projects.visibleGroups().filter((group) => channelsForGroup(group.id).length > 0));
  const activeGroup = $derived(visibleGroups.find((group) => group.id === activeGroupId) ?? null);
  const visibleProjects = $derived(activeGroup
    ? activeProjects.filter((project) => (
      project.groupId === activeGroup.id && channelsForProject(project.id).length > 0
    ))
    : []);
  const activeProject = $derived(visibleProjects.find((project) => project.id === activeProjectId) ?? null);
  const visibleChannels = $derived(activeProject ? channelsForProject(activeProject.id) : []);
  const normalizedChannelQuery = $derived(channelQuery.trim().toLocaleLowerCase());
  const filteredChannels = $derived(visibleChannels.filter((channel) => (
    !normalizedChannelQuery
    || channel.name.toLocaleLowerCase().includes(normalizedChannelQuery)
    || channel.topic.toLocaleLowerCase().includes(normalizedChannelQuery)
  )));
  const normalizedQuery = $derived(query.trim().toLocaleLowerCase());
  const searchResults = $derived.by((): SearchResult[] => {
    if (!normalizedQuery) return [];
    return activeChannels.flatMap((channel) => {
      const project = activeProjects.find((entry) => entry.id === channel.projectId);
      const group = visibleGroups.find((entry) => entry.id === project?.groupId);
      if (!project || !group) return [];
      const searchable = `${group.name} ${project.name} ${channel.name}`.toLocaleLowerCase();
      return searchable.includes(normalizedQuery)
        ? [{ channel, groupName: group.name, projectName: project.name }]
        : [];
    });
  });

  function channelsForProject(projectId: string): ChatChannelRead[] {
    return activeChannels.filter((channel) => channel.projectId === projectId);
  }

  function channelsForGroup(groupId: string): ChatChannelRead[] {
    const projectIds = new Set(activeProjects
      .filter((project) => project.groupId === groupId)
      .map((project) => project.id));
    return activeChannels.filter((channel) => projectIds.has(channel.projectId));
  }

  function selectionState(channelIds: readonly string[]): "none" | "some" | "all" {
    const selectedCount = channelIds.filter((channelId) => selectedChannelIds.has(channelId)).length;
    if (selectedCount === 0) return "none";
    if (selectedCount === channelIds.length) return "all";
    return "some";
  }

  function viewportBounds() {
    return {
      left: viewportMargin,
      right: window.innerWidth - viewportMargin,
      top: viewportMargin,
      bottom: window.innerHeight - viewportMargin,
    };
  }

  function outerHeight(element: HTMLElement | undefined): number {
    if (!element) return 0;
    const style = getComputedStyle(element);
    const marginTop = Number.parseFloat(style.marginTop) || 0;
    const marginBottom = Number.parseFloat(style.marginBottom) || 0;
    return element.offsetHeight + marginTop + marginBottom;
  }

  function verticalPadding(element: HTMLElement): number {
    const style = getComputedStyle(element);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    return paddingTop + paddingBottom;
  }

  function updateMainPanelGeometry(): void {
    if (!mainPanelElement || !mainScrollElement || !mainScrollContentElement) return;
    const trigger = anchor.getBoundingClientRect();
    const bounds = viewportBounds();
    const usableWidth = Math.max(0, bounds.right - bounds.left);
    const width = Math.min(compact ? 320 : panelWidth, usableWidth);
    const maxHeight = Math.max(0, bounds.bottom - bounds.top);
    const naturalHeight = outerHeight(mainSearchElement)
      + outerHeight(compactBackElement)
      + mainScrollContentElement.scrollHeight
      + verticalPadding(mainScrollElement);
    const height = Math.min(naturalHeight, maxHeight);
    const left = Math.min(Math.max(bounds.left, trigger.left), Math.max(bounds.left, bounds.right - width));
    const belowTop = trigger.bottom + panelGap;
    const top = belowTop + height <= bounds.bottom
      ? belowTop
      : Math.max(bounds.top, trigger.top - panelGap - height);
    mainPanelStyle = [
      "visibility:visible",
      `left:${Math.round(left)}px`,
      `top:${Math.round(top)}px`,
      `width:${Math.round(width)}px`,
      `height:${Math.round(height)}px`,
      `max-height:${Math.round(maxHeight)}px`,
    ].join(";");
  }

  function pointerAimingAtPanel(
    point: MenuAimPoint,
    row: HTMLElement | null,
    panel: HTMLElement | undefined,
  ): boolean {
    if (!row || !panel) return false;
    const rowRect = row.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return isPointerAimingAtSubmenu({
      origin: projectPickerSubpanelAimOrigin(rowRect),
      point,
      submenu: projectPickerMenuAimRect(panelRect),
      side: projectPickerSubpanelSide(rowRect, panelRect),
      tolerance: 12,
      topTolerance: 8,
      bottomTolerance: 32,
      minTowardDistance: 3,
    });
  }

  function updateProjectPanelGeometry(): void {
    if (compact || !groupAnchorElement || !mainPanelElement || !activeGroup) return;
    const geometry = projectPickerSubpanelGeometry({
      anchorRect: groupAnchorElement.getBoundingClientRect(),
      panelRect: mainPanelElement.getBoundingClientRect(),
      bounds: viewportBounds(),
      gap: panelGap,
      footerHeight: 0,
      projectCount: visibleProjects.length,
      visibleRows: null,
      listPadding: panelListPadding,
      rowHeight: panelRowHeight,
    });
    projectBridgeStyle = projectPickerBridgeFrameStyle(geometry.bridge);
    projectPanelStyle = projectPickerPanelFrameStyle(geometry.panel);
  }

  function updateChannelPanelGeometry(): void {
    if (compact || !projectAnchorElement || !projectPanelElement || !activeProject) return;
    const geometry = projectPickerSubpanelGeometry({
      anchorRect: projectAnchorElement.getBoundingClientRect(),
      panelRect: projectPanelElement.getBoundingClientRect(),
      bounds: viewportBounds(),
      gap: panelGap,
      footerHeight: channelPanelChromeHeight,
      projectCount: Math.max(1, filteredChannels.length),
      visibleRows: null,
      listPadding: panelListPadding,
      rowHeight: panelRowHeight,
    });
    channelBridgeStyle = projectPickerBridgeFrameStyle(geometry.bridge);
    channelPanelStyle = projectPickerPanelFrameStyle(geometry.panel);
  }

  function openGroup(
    group: ProjectGroup,
    target: EventTarget | null,
    moveFocus = false,
  ): void {
    activeGroupId = group.id;
    activeProjectId = null;
    groupAnchorElement = target instanceof HTMLElement ? target : null;
    projectAnchorElement = null;
    channelPanelStyle = "";
    if (compact) compactStage = "projects";
    void tick().then(() => {
      updateProjectPanelGeometry();
      if (moveFocus) {
        const panel = compact ? mainPanelElement : projectPanelElement;
        panel?.querySelector<HTMLButtonElement>(".access-picker-name")?.focus();
      }
    });
  }

  function openProject(
    project: Project,
    target: EventTarget | null,
    moveFocus = false,
  ): void {
    activeProjectId = project.id;
    channelQuery = "";
    projectAnchorElement = target instanceof HTMLElement ? target : null;
    if (compact) compactStage = "channels";
    void tick().then(() => {
      updateChannelPanelGeometry();
      if (moveFocus) {
        const panel = compact ? mainPanelElement : channelPanelElement;
        panel?.querySelector<HTMLButtonElement>(".access-picker-name")?.focus();
      }
    });
  }

  function handleGroupPointer(group: ProjectGroup, event: PointerEvent): void {
    if (compact || activeGroupId === group.id) return;
    if (activeGroupId && pointerAimingAtPanel(
      projectPickerPointerPoint(event),
      groupAnchorElement,
      projectPanelElement,
    )) return;
    openGroup(group, event.currentTarget);
  }

  function handleProjectPointer(project: Project, event: PointerEvent): void {
    if (compact || activeProjectId === project.id) return;
    if (activeProjectId && pointerAimingAtPanel(
      projectPickerPointerPoint(event),
      projectAnchorElement,
      channelPanelElement,
    )) return;
    openProject(project, event.currentTarget);
  }

  function toggleChannels(channelIds: readonly string[]): void {
    const state = selectionState(channelIds);
    onSelectionChange(channelIds, state !== "all");
  }

  function toggleChannel(channelId: string): void {
    onSelectionChange([channelId], !selectedChannelIds.has(channelId));
  }

  function backCompact(): void {
    if (compactStage === "channels") {
      compactStage = "projects";
      activeProjectId = null;
    } else {
      compactStage = "groups";
      activeGroupId = null;
    }
    void tick().then(() => mainPanelElement?.querySelector<HTMLButtonElement>(".access-picker-name")?.focus());
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function handleResize(): void {
    compact = window.innerWidth < 760;
    if (!compact) compactStage = "groups";
    requestAnimationFrame(() => {
      updateMainPanelGeometry();
      updateProjectPanelGeometry();
      updateChannelPanelGeometry();
    });
  }

  $effect(() => {
    const resultCount = searchResults.length;
    const groupCount = visibleGroups.length;
    const stage = compactStage;
    void resultCount;
    void groupCount;
    void stage;
    requestAnimationFrame(updateMainPanelGeometry);
  });

  $effect(() => {
    const resultCount = filteredChannels.length;
    const activeQuery = normalizedChannelQuery;
    void resultCount;
    void activeQuery;
    requestAnimationFrame(updateChannelPanelGeometry);
  });

  $effect(() => {
    if (!normalizedQuery) return;
    activeGroupId = null;
    activeProjectId = null;
    groupAnchorElement = null;
    projectAnchorElement = null;
  });

  onMount(() => {
    compact = window.innerWidth < 760;
    void tick().then(() => {
      updateMainPanelGeometry();
      searchInputElement?.focus();
    });
  });
</script>

<svelte:window onresize={handleResize} onkeydown={handleKeydown} />

<div use:portal class="access-picker-layer">
  <button
    type="button"
    class="access-picker-dismiss"
    aria-label={t("common.close")}
    data-app-tooltip-disabled="true"
    data-app-tooltip-focus-disabled="true"
    onclick={onClose}
  ></button>

  <div
    bind:this={mainPanelElement}
    class="access-picker-panel main-panel"
    style={mainPanelStyle}
    role="dialog"
    aria-label={t("settings.chat.teammates.channelPickerLabel")}
    data-app-floating-surface
  >
    <label bind:this={mainSearchElement} class="access-picker-search">
      <Search size={13} />
      <input
        bind:this={searchInputElement}
        bind:value={query}
        aria-label={t("settings.chat.teammates.searchChannels")}
        placeholder={t("settings.chat.teammates.searchChannels")}
      />
    </label>

    {#if compact && !normalizedQuery && compactStage !== "groups"}
      <button bind:this={compactBackElement} type="button" class="compact-back" onclick={backCompact}>
        <ChevronLeft size={13} />
        <span>
          {compactStage === "channels"
            ? activeProject?.name ?? t("settings.chat.teammates.channels")
            : activeGroup?.name ?? t("settings.chat.teammates.projects")}
        </span>
      </button>
    {/if}

    <div class="access-picker-scroll-frame">
      <div bind:this={mainScrollElement} class="access-picker-list hide-scrollbar">
        <div bind:this={mainScrollContentElement}>
          {#if normalizedQuery}
            {#each searchResults as result (result.channel.id)}
              <div class="access-picker-row search-result-row">
                <SettingsCheckbox
                  checked={selectedChannelIds.has(result.channel.id)}
                  label={t("settings.chat.teammates.channelAccessTitle", result.channel.name)}
                  {disabled}
                  onChange={() => toggleChannel(result.channel.id)}
                />
                <button type="button" class="access-picker-name search-result" {disabled} onclick={() => toggleChannel(result.channel.id)}>
                  <strong>{result.channel.name}</strong>
                  <small>{result.groupName} / {result.projectName}</small>
                </button>
              </div>
            {:else}
              <p class="access-picker-empty">{t("settings.chat.teammates.noChannels")}</p>
            {/each}
          {:else if compact && compactStage === "projects"}
            {#each visibleProjects as project (project.id)}
              {@const projectChannelIds = channelsForProject(project.id).map((channel) => channel.id)}
              {@const state = selectionState(projectChannelIds)}
              <div class="access-picker-row">
                <SettingsCheckbox checked={state === "all"} mixed={state === "some"} label={project.name} {disabled} onChange={() => toggleChannels(projectChannelIds)} />
                <button type="button" class="access-picker-name" {disabled} onclick={(event) => openProject(project, event.currentTarget, true)}><span>{project.name}</span><ChevronRight size={13} /></button>
              </div>
            {/each}
          {:else if compact && compactStage === "channels"}
            {#each visibleChannels as channel (channel.id)}
              <div class="access-picker-row">
                <SettingsCheckbox checked={selectedChannelIds.has(channel.id)} label={t("settings.chat.teammates.channelAccessTitle", channel.name)} {disabled} onChange={() => toggleChannel(channel.id)} />
                <button type="button" class="access-picker-name" {disabled} onclick={() => toggleChannel(channel.id)}><span>{channel.name}</span></button>
              </div>
            {/each}
          {:else}
            {#each visibleGroups as group (group.id)}
              {@const groupChannelIds = channelsForGroup(group.id).map((channel) => channel.id)}
              {@const state = selectionState(groupChannelIds)}
              <div class:active={activeGroupId === group.id} class="access-picker-row">
                <SettingsCheckbox checked={state === "all"} mixed={state === "some"} label={group.name} {disabled} onChange={() => toggleChannels(groupChannelIds)} />
                <button
                  type="button"
                  class="access-picker-name"
                  {disabled}
                  onpointerenter={(event) => handleGroupPointer(group, event)}
                  onpointermove={(event) => handleGroupPointer(group, event)}
                  onfocus={(event) => openGroup(group, event.currentTarget)}
                  onclick={(event) => openGroup(group, event.currentTarget, true)}
                ><span>{group.name}</span><ChevronRight size={13} /></button>
              </div>
            {:else}
              <p class="access-picker-empty">{t("settings.chat.teammates.noChannels")}</p>
            {/each}
          {/if}
        </div>
      </div>
      <CalendarScrollbar scrollContainer={mainScrollElement} stickyTop={4} stickyBottom={4} wheelPassthrough />
    </div>
  </div>

  {#if !compact && !normalizedQuery && activeGroup && groupAnchorElement}
    <div aria-hidden="true" class="access-picker-bridge" style={projectBridgeStyle}></div>
    <div bind:this={projectPanelElement} class="access-picker-panel subpanel" style={projectPanelStyle}>
      <div class="access-picker-scroll-frame">
        <div bind:this={projectScrollElement} class="access-picker-list hide-scrollbar">
          {#each visibleProjects as project (project.id)}
            {@const projectChannelIds = channelsForProject(project.id).map((channel) => channel.id)}
            {@const state = selectionState(projectChannelIds)}
            <div class:active={activeProjectId === project.id} class="access-picker-row">
              <SettingsCheckbox checked={state === "all"} mixed={state === "some"} label={project.name} {disabled} onChange={() => toggleChannels(projectChannelIds)} />
              <button
                type="button"
                class="access-picker-name"
                {disabled}
                onpointerenter={(event) => handleProjectPointer(project, event)}
                onpointermove={(event) => handleProjectPointer(project, event)}
                onfocus={(event) => openProject(project, event.currentTarget)}
                onclick={(event) => openProject(project, event.currentTarget, true)}
              ><span>{project.name}</span><ChevronRight size={13} /></button>
            </div>
          {/each}
        </div>
        <CalendarScrollbar scrollContainer={projectScrollElement} stickyTop={4} stickyBottom={4} wheelPassthrough />
      </div>
    </div>
  {/if}

  {#if !compact && !normalizedQuery && activeProject && projectAnchorElement && projectPanelElement}
    <div aria-hidden="true" class="access-picker-bridge" style={channelBridgeStyle}></div>
    <div bind:this={channelPanelElement} class="access-picker-panel subpanel" style={channelPanelStyle}>
      <label class="access-picker-search">
        <Search size={13} />
        <input
          bind:value={channelQuery}
          aria-label={t("chat.channels.search")}
          placeholder={t("chat.channels.search")}
        />
      </label>
      <div class="access-picker-scroll-frame">
        <div bind:this={channelScrollElement} class="access-picker-list hide-scrollbar">
          {#each filteredChannels as channel (channel.id)}
            <div class="access-picker-row">
              <SettingsCheckbox checked={selectedChannelIds.has(channel.id)} label={t("settings.chat.teammates.channelAccessTitle", channel.name)} {disabled} onChange={() => toggleChannel(channel.id)} />
              <button type="button" class="access-picker-name" {disabled} onclick={() => toggleChannel(channel.id)}><span>{channel.name}</span></button>
            </div>
          {:else}
            <p class="access-picker-empty">{t("settings.chat.teammates.noChannels")}</p>
          {/each}
        </div>
        <CalendarScrollbar scrollContainer={channelScrollElement} stickyTop={4} stickyBottom={4} wheelPassthrough />
      </div>
    </div>
  {/if}
</div>

<style>
  .access-picker-layer { position:fixed; z-index:84; inset:0; pointer-events:none; }
  .access-picker-dismiss { position:fixed; inset:0; pointer-events:auto; cursor:default; }
  .access-picker-panel { position:fixed; z-index:2; display:flex; min-height:0; flex-direction:column; overflow:hidden; border:1px solid color-mix(in srgb,var(--border) 60%,transparent); border-radius:0.55rem; background:var(--popover); color:var(--popover-foreground); box-shadow:0 0.45rem 1.25rem color-mix(in srgb,var(--foreground) 14%,transparent); pointer-events:auto; }
  .main-panel { height:auto; }
  .subpanel { z-index:4; }
  .access-picker-bridge { position:fixed; z-index:3; background:transparent; pointer-events:auto; }
  .access-picker-search { display:flex; min-height:2rem; flex:0 0 auto; align-items:center; gap:0.45rem; margin:0.4rem 0.4rem 0.15rem; border:1px solid color-mix(in srgb,var(--border) 70%,transparent); border-radius:0.42rem; padding-inline:0.55rem; color:var(--muted-foreground); }
  .access-picker-search input { min-width:0; flex:1; background:transparent; color:var(--popover-foreground); font-size:calc(0.733333rem * var(--type-scale)); outline:0; }
  .access-picker-scroll-frame { position:relative; min-height:0; flex:1; }
  .access-picker-list { height:100%; overflow-y:auto; overscroll-behavior:contain; padding:0.25rem; }
  .access-picker-row { display:grid; min-height:2rem; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:0.45rem; border-radius:0.4rem; padding:0 0.35rem; }
  .access-picker-row:hover,.access-picker-row.active { background:var(--accent); color:var(--accent-foreground); }
  .access-picker-name { display:flex; min-width:0; height:100%; align-items:center; justify-content:space-between; gap:0.5rem; overflow:hidden; color:inherit; text-align:left; }
  .access-picker-name > span,.access-picker-name strong,.access-picker-name small { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .access-picker-name > span { flex:1; font-size:calc(0.733333rem * var(--type-scale)); font-weight:500; }
  .access-picker-name :global(svg) { flex:0 0 auto; color:var(--muted-foreground); }
  .search-result-row { min-height:2.55rem; }
  .access-picker-name.search-result { display:grid; justify-content:stretch; align-content:center; }
  .access-picker-name strong { font-size:calc(0.733333rem * var(--type-scale)); font-weight:550; }
  .access-picker-name small { color:var(--muted-foreground); font-size:calc(0.616667rem * var(--type-scale)); }
  .access-picker-empty { padding:0.65rem 0.75rem; color:var(--muted-foreground); font-size:calc(0.7rem * var(--type-scale)); }
  .compact-back { display:flex; min-height:2rem; flex:0 0 auto; align-items:center; gap:0.45rem; margin:0.1rem 0.4rem 0; border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent); padding:0 0.25rem; color:var(--muted-foreground); font-size:calc(0.7rem * var(--type-scale)); font-weight:600; }
  @media (pointer:coarse) {
    .access-picker-row,.compact-back { min-height:2.75rem; }
    .access-picker-row :global(button[role="checkbox"]) { width:1.4rem; height:1.4rem; }
  }
</style>

<script lang="ts">
  import { tick } from "svelte";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    projectLifecycleBadgeClass,
    projectLifecycleLabel,
  } from "$lib/projects/project-display";
  import {
    isPointerAimingAtSubmenu,
    type MenuAimPoint,
  } from "$lib/projects/menu-aim";
  import {
    projectPickerBridgeFrameStyle,
    projectPickerMenuAimRect,
    projectPickerPanelEstimatedListHeight,
    projectPickerPanelFrameStyle,
    projectPickerPanelHeight,
    projectPickerPointerPoint,
    projectPickerScrollState,
    projectPickerSubpanelAimOrigin,
    projectPickerSubpanelGeometry,
    projectPickerSubpanelSide,
  } from "$lib/projects/project-picker-panels";
  import {
    PROJECT_TEMPLATE_IDS,
    type Project,
    type ProjectGroup,
    type ProjectTemplateId,
  } from "$lib/projects/types";
  import { notesFoldersForProject } from "$lib/notes/navigation-tree";
  import { notesHierarchyChildren } from "$lib/notes/hierarchy-navigation";
  import { notesPagesForProject } from "$lib/notes/project-membership";
  import type { ProjectNavigatorPanelMode } from "$lib/projects/project-toolbar";
  import { getNotes } from "$lib/stores/notes.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { cn } from "$lib/utils";
  import ProjectIcon from "$lib/components/projects/ProjectIcon.svelte";
  import NotesHierarchyPickerPanel from "./NotesHierarchyPickerPanel.svelte";

  type MaybePromise<T> = T | Promise<T>;

  interface ProjectSearchResultGroup {
    group: ProjectGroup;
    projects: Project[];
  }

  let {
    selectedProjectId = null,
    selectedGroupId = null,
    panelMode = "groups",
    panelMaxHeight = null,
    showInactiveProjects = false,
    onShowInactiveProjectsChange,
    onProjectSelected,
    onPageSelected,
  }: {
    selectedProjectId?: string | null;
    selectedGroupId?: string | null;
    panelMode?: ProjectNavigatorPanelMode;
    panelMaxHeight?: number | null;
    showInactiveProjects?: boolean;
    onShowInactiveProjectsChange: (value: boolean) => void;
    onProjectSelected: () => MaybePromise<void>;
    onPageSelected: () => MaybePromise<void>;
  } = $props();

  const projects = getProjects();
  const notes = getNotes();
  const { t } = getLocalization();
  const iconStrokeWidth = 1.6;
  const iconSize = 13;
  const emojiScale = 0.94;
  const panelFallbackHeaderHeight = 40;
  const panelFallbackFooterHeight = 44;
  const panelListPadding = 6;
  const panelRowHeightRem = 2;
  const panelFallbackRowHeight = 30;
  const subpanelListPadding = 8;
  const subpanelFallbackFooterHeight = 44;
  const subpanelRowHeight = 32;
  const subpanelGap = 4;
  const zIndexClass = "z-81";

  let projectSearch = $state("");
  let groupDraft = $state("");
  let createGroupOpen = $state(false);
  let createProjectGroupId = $state<string | null>(null);
  let projectDraftByGroup = $state<Record<string, string>>({});
  let projectTemplateDraftByGroup = $state<Record<string, ProjectTemplateId>>({});
  let activeGroupId = $state<string | null>(null);
  let activeGroupAnchorElement = $state<HTMLElement | null>(null);
  let activeProjectId = $state<string | null>(null);
  let activeProjectAnchorElement = $state<HTMLElement | null>(null);
  let activeProjectPanelElement = $state<HTMLDivElement | null>(null);
  let panelRootElement = $state<HTMLDivElement | null>(null);
  let panelHeaderElement = $state<HTMLDivElement | undefined>();
  let panelFooterElement = $state<HTMLDivElement | undefined>();
  let panelStyle = $state("");
  let groupScrollElement = $state<HTMLElement | undefined>();
  let groupScrollContentElement = $state<HTMLElement | undefined>();
  let groupScrollable = $state(false);
  let groupCanScrollUp = $state(false);
  let groupCanScrollDown = $state(false);
  let groupScrollStateFrame: number | null = null;
  let projectSubpanelElement = $state<HTMLDivElement | undefined>();
  let projectSubpanelBridgeElement = $state<HTMLDivElement | undefined>();
  let projectSubpanelFooterElement = $state<HTMLDivElement | undefined>();
  let projectSubpanelStyle = $state("");
  let projectSubpanelBridgeStyle = $state("");
  let projectScrollElement = $state<HTMLElement | undefined>();
  let projectScrollContentElement = $state<HTMLElement | undefined>();
  let projectScrollable = $state(false);
  let projectCanScrollUp = $state(false);
  let projectCanScrollDown = $state(false);
  let projectScrollStateFrame: number | null = null;
  let noteSubpanelElement = $state<HTMLDivElement | undefined>();
  let noteSubpanelBridgeElement = $state<HTMLDivElement | undefined>();
  let noteSubpanelStyle = $state("");
  let noteSubpanelBridgeStyle = $state("");

  const selectedProject = $derived(projects.projectById(selectedProjectId));
  const selectedGroup = $derived(projects.groupById(selectedProject?.groupId ?? selectedGroupId));
  const normalizedSearch = $derived(projectSearch.trim().toLowerCase());
  const searchActive = $derived(normalizedSearch.length > 0);
  const groups = $derived.by(() => projects.visibleGroups());
  const visibleGroups = $derived.by(() => groups.filter(groupVisible));
  const searchResultGroups = $derived.by((): ProjectSearchResultGroup[] =>
    groups
      .map((group) => ({ group, projects: projectsInGroup(group) }))
      .filter((entry) => entry.projects.length > 0)
  );
  const activeGroup = $derived.by(() => visibleGroups.find((group) => group.id === activeGroupId));
  const directProjectGroup = $derived.by(() => selectedGroup);
  const directProjects = $derived.by(() => directProjectGroup ? projectsInGroup(directProjectGroup) : []);
  const activeProjectPages = $derived.by(() => notesPagesForProject(notes.allPages, activeProjectId));
  const activeProjectFolders = $derived.by(() => notesFoldersForProject(notes.folders, activeProjectId));
  const activeProjectRootItems = $derived(notesHierarchyChildren(
    activeProjectPages,
    activeProjectFolders,
    { kind: "root" },
    t("notes.untitled"),
    notes.sidebarPageIdsWithChildren,
  ));

  function projectsInGroup(group: ProjectGroup): Project[] {
    const groupProjects = showInactiveProjects
      ? projects.projectsForGroupIncludingInactive(group.id)
      : projects.projectsForGroup(group.id);
    if (!normalizedSearch) return groupProjects;
    return groupProjects.filter((project) =>
      project.name.toLowerCase().includes(normalizedSearch)
    );
  }

  function groupVisible(group: ProjectGroup): boolean {
    if (!normalizedSearch) return true;
    return projectsInGroup(group).length > 0;
  }

  function projectTemplateLabel(templateId: ProjectTemplateId): string {
    if (templateId === "software") return t("projects.templates.software");
    if (templateId === "course") return t("projects.templates.course");
    if (templateId === "routine") return t("projects.templates.routine");
    if (templateId === "reading") return t("projects.templates.reading");
    if (templateId === "chores") return t("projects.templates.chores");
    return t("projects.templates.blank");
  }

  function rowHeight(): number {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(rootFontSize)
      ? rootFontSize * panelRowHeightRem
      : panelFallbackRowHeight;
  }

  function cssPixelValue(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function scrollAreaVerticalPadding(element: HTMLElement | undefined, fallback: number): number {
    if (!element) return fallback;
    const style = getComputedStyle(element);
    return cssPixelValue(style.paddingTop) + cssPixelValue(style.paddingBottom);
  }

  function mainListEstimatedHeight(): number {
    const itemCount = searchActive
      ? searchResultGroups.reduce((count, entry) => count + entry.projects.length, 0)
      : panelMode === "projects" && directProjectGroup
        ? projectsInGroup(directProjectGroup).length
        : visibleGroups.length;
    return projectPickerPanelEstimatedListHeight({
      itemCount,
      visibleRows: null,
      listPadding: panelListPadding,
      rowHeight: rowHeight(),
    });
  }

  function updatePanelStyle(): void {
    const headerHeight = panelHeaderElement?.offsetHeight ?? panelFallbackHeaderHeight;
    const footerHeight = searchActive
      ? 0
      : panelFooterElement?.offsetHeight ?? panelFallbackFooterHeight;
    const measuredListHeight = groupScrollContentElement
      ? groupScrollContentElement.scrollHeight + scrollAreaVerticalPadding(
        groupScrollElement,
        panelListPadding,
      )
      : undefined;
    const listHeight = measuredListHeight ?? mainListEstimatedHeight();
    const panelHeight = projectPickerPanelHeight({
      headerHeight,
      footerHeight,
      listHeight,
      maxHeight: panelMaxHeight,
      visibleRows: null,
      listPadding: panelListPadding,
      rowHeight: rowHeight(),
    });
    panelStyle = [
      `height: ${panelHeight}px`,
      `max-height: ${panelHeight}px`,
    ].join("; ");
  }

  function currentPanelBounds() {
    const margin = 8;
    const viewportBounds = {
      left: margin,
      right: window.innerWidth - margin,
      top: margin,
      bottom: window.innerHeight - margin,
    };
    const rect = panelRootElement?.closest(".notes-view-root")?.getBoundingClientRect();
    if (!rect) return viewportBounds;
    return {
      left: Math.max(rect.left, viewportBounds.left),
      right: Math.min(rect.right, viewportBounds.right),
      top: Math.max(rect.top, viewportBounds.top),
      bottom: Math.min(rect.bottom, viewportBounds.bottom),
    };
  }

  function pointerAimingAtProjectSubpanel(point: MenuAimPoint): boolean {
    if (!activeGroupAnchorElement || !projectSubpanelElement) return false;
    const anchorRect = activeGroupAnchorElement.getBoundingClientRect();
    const subpanelRect = projectSubpanelElement.getBoundingClientRect();
    const side = projectPickerSubpanelSide(anchorRect, subpanelRect);
    return isPointerAimingAtSubmenu({
      origin: projectPickerSubpanelAimOrigin(anchorRect),
      point,
      submenu: projectPickerMenuAimRect(subpanelRect),
      side,
      tolerance: 12,
      topTolerance: 8,
      bottomTolerance: 32,
      minTowardDistance: 3,
    });
  }

  function pointerAimingAtNoteSubpanel(point: MenuAimPoint): boolean {
    if (!activeProjectAnchorElement || !noteSubpanelElement) return false;
    const anchorRect = activeProjectAnchorElement.getBoundingClientRect();
    const subpanelRect = noteSubpanelElement.getBoundingClientRect();
    const side = projectPickerSubpanelSide(anchorRect, subpanelRect);
    return isPointerAimingAtSubmenu({
      origin: projectPickerSubpanelAimOrigin(anchorRect),
      point,
      submenu: projectPickerMenuAimRect(subpanelRect),
      side,
      tolerance: 12,
      topTolerance: 8,
      bottomTolerance: 32,
      minTowardDistance: 3,
    });
  }

  function updateProjectSubpanelGeometry(): void {
    if (!activeGroupAnchorElement || !panelRootElement) return;
    const anchorRect = activeGroupAnchorElement.getBoundingClientRect();
    const panelRect = panelRootElement.getBoundingClientRect();
    const bounds = currentPanelBounds();
    const footerHeight = projectSubpanelFooterElement?.offsetHeight ?? subpanelFallbackFooterHeight;
    const projectCount = activeGroup ? projectsInGroup(activeGroup).length : 0;
    const measuredListHeight = projectScrollContentElement
      ? projectScrollContentElement.scrollHeight + scrollAreaVerticalPadding(
        projectScrollElement,
        subpanelListPadding,
      )
      : undefined;
    const geometry = projectPickerSubpanelGeometry({
      anchorRect,
      panelRect,
      bounds,
      gap: subpanelGap,
      footerHeight,
      projectCount,
      visibleRows: null,
      listHeight: measuredListHeight,
      listPadding: subpanelListPadding,
      rowHeight: subpanelRowHeight,
    });

    projectSubpanelStyle = projectPickerPanelFrameStyle(geometry.panel);
    projectSubpanelBridgeStyle = projectPickerBridgeFrameStyle(geometry.bridge);
  }

  function updateNoteSubpanelGeometry(): void {
    if (!activeProjectAnchorElement || !activeProjectPanelElement) return;
    const anchorRect = activeProjectAnchorElement.getBoundingClientRect();
    const panelRect = activeProjectPanelElement.getBoundingClientRect();
    const bounds = currentPanelBounds();
    const geometry = projectPickerSubpanelGeometry({
      anchorRect,
      panelRect,
      bounds,
      gap: subpanelGap,
      footerHeight: subpanelFallbackFooterHeight,
      panelHeight: noteSubpanelElement?.getBoundingClientRect().height || undefined,
      projectCount: Math.max(1, activeProjectRootItems.length),
      visibleRows: null,
      listPadding: subpanelListPadding,
      rowHeight: subpanelRowHeight,
    });

    noteSubpanelStyle = projectPickerPanelFrameStyle(geometry.panel);
    noteSubpanelBridgeStyle = projectPickerBridgeFrameStyle(geometry.bridge);
  }

  function refreshGroupScrollState(): void {
    groupScrollStateFrame = null;
    const element = groupScrollElement;
    if (!element) {
      groupScrollable = false;
      groupCanScrollUp = false;
      groupCanScrollDown = false;
      return;
    }
    const state = projectPickerScrollState(element);
    groupScrollable = state.scrollable;
    groupCanScrollUp = state.canScrollUp;
    groupCanScrollDown = state.canScrollDown;
  }

  function requestGroupScrollStateRefresh(): void {
    if (groupScrollStateFrame !== null) cancelAnimationFrame(groupScrollStateFrame);
    groupScrollStateFrame = requestAnimationFrame(refreshGroupScrollState);
  }

  function refreshProjectScrollState(): void {
    projectScrollStateFrame = null;
    const element = projectScrollElement;
    if (!element) {
      projectScrollable = false;
      projectCanScrollUp = false;
      projectCanScrollDown = false;
      return;
    }
    const state = projectPickerScrollState(element);
    projectScrollable = state.scrollable;
    projectCanScrollUp = state.canScrollUp;
    projectCanScrollDown = state.canScrollDown;
  }

  function requestProjectScrollStateRefresh(): void {
    if (projectScrollStateFrame !== null) cancelAnimationFrame(projectScrollStateFrame);
    projectScrollStateFrame = requestAnimationFrame(refreshProjectScrollState);
  }

  function handleGroupScroll(): void {
    refreshGroupScrollState();
  }

  function handleProjectScroll(): void {
    refreshProjectScrollState();
  }

  function closeNoteSubpanel(): void {
    activeProjectId = null;
    activeProjectAnchorElement = null;
    activeProjectPanelElement = null;
    noteSubpanelStyle = "";
    noteSubpanelBridgeStyle = "";
  }

  function closeProjectSubpanel(): void {
    activeGroupId = null;
    activeGroupAnchorElement = null;
    createProjectGroupId = null;
    projectSubpanelFooterElement = undefined;
    projectSubpanelStyle = "";
    projectSubpanelBridgeStyle = "";
    closeNoteSubpanel();
  }

  function showProjectSubpanel(
    group: ProjectGroup,
    target: EventTarget | null,
  ): void {
    if (activeGroupId !== group.id) {
      createProjectGroupId = null;
      closeNoteSubpanel();
    }
    activeGroupId = group.id;
    activeGroupAnchorElement = target instanceof HTMLElement ? target : null;
    updateProjectSubpanelGeometry();
    void tick().then(updateProjectSubpanelGeometry);
  }

  function showNoteSubpanel(
    project: Project,
    target: EventTarget | null,
    sourcePanelElement: HTMLDivElement | null | undefined,
  ): void {
    activeProjectId = project.id;
    activeProjectAnchorElement = target instanceof HTMLElement ? target : null;
    activeProjectPanelElement = sourcePanelElement ?? null;
    updateNoteSubpanelGeometry();
    void tick().then(updateNoteSubpanelGeometry);
  }

  function handleGroupPointerEnter(group: ProjectGroup, event: PointerEvent): void {
    const point = projectPickerPointerPoint(event);
    if (activeGroupId && activeGroupId !== group.id && pointerAimingAtProjectSubpanel(point)) {
      return;
    }
    showProjectSubpanel(group, event.currentTarget);
  }

  function handleGroupPointerMove(group: ProjectGroup, event: PointerEvent): void {
    const point = projectPickerPointerPoint(event);
    if (activeGroupId === group.id) {
      return;
    }
    if (activeGroupId && pointerAimingAtProjectSubpanel(point)) {
      return;
    }
    showProjectSubpanel(group, event.currentTarget);
  }

  function handleProjectPointerEnter(
    project: Project,
    event: PointerEvent,
    sourcePanelElement: HTMLDivElement | null | undefined,
  ): void {
    const point = projectPickerPointerPoint(event);
    if (activeProjectId && activeProjectId !== project.id && pointerAimingAtNoteSubpanel(point)) {
      return;
    }
    showNoteSubpanel(project, event.currentTarget, sourcePanelElement);
  }

  function handleProjectPointerMove(
    project: Project,
    event: PointerEvent,
    sourcePanelElement: HTMLDivElement | null | undefined,
  ): void {
    const point = projectPickerPointerPoint(event);
    if (activeProjectId === project.id) {
      return;
    }
    if (activeProjectId && pointerAimingAtNoteSubpanel(point)) {
      return;
    }
    showNoteSubpanel(project, event.currentTarget, sourcePanelElement);
  }

  function isProjectSubpanelBoundaryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return Boolean(
      activeGroupAnchorElement?.contains(target)
      || projectSubpanelBridgeElement?.contains(target)
      || projectSubpanelElement?.contains(target)
      || noteSubpanelBridgeElement?.contains(target)
      || noteSubpanelElement?.contains(target),
    );
  }

  function isNoteSubpanelBoundaryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return Boolean(
      activeProjectAnchorElement?.contains(target)
      || activeProjectPanelElement?.contains(target)
      || noteSubpanelBridgeElement?.contains(target)
      || noteSubpanelElement?.contains(target),
    );
  }

  function handleProjectSubpanelBoundaryLeave(event: PointerEvent): void {
    if (isProjectSubpanelBoundaryTarget(event.relatedTarget)) return;
    if (pointerAimingAtProjectSubpanel(projectPickerPointerPoint(event))) return;
    closeProjectSubpanel();
  }

  function handleNoteSubpanelBoundaryLeave(event: PointerEvent): void {
    if (isNoteSubpanelBoundaryTarget(event.relatedTarget)) return;
    if (pointerAimingAtNoteSubpanel(projectPickerPointerPoint(event))) return;
    closeNoteSubpanel();
  }

  async function selectProject(project: Project): Promise<void> {
    await projects.selectProject(project.id);
    await onProjectSelected();
    projectSearch = "";
  }

  async function submitGroup(): Promise<void> {
    const name = groupDraft.trim();
    if (!name) return;
    await projects.addGroup(name);
    groupDraft = "";
    createGroupOpen = false;
  }

  async function submitProject(groupId: string): Promise<void> {
    const name = (projectDraftByGroup[groupId] ?? "").trim();
    if (!name) return;
    const templateId = projectTemplateDraftByGroup[groupId] ?? "blank";
    await projects.addProject(groupId, name, templateId);
    projectDraftByGroup = { ...projectDraftByGroup, [groupId]: "" };
    projectTemplateDraftByGroup = { ...projectTemplateDraftByGroup, [groupId]: "blank" };
    createProjectGroupId = null;
    await onProjectSelected();
  }

  $effect(() => {
    if (searchActive) {
      closeProjectSubpanel();
      closeNoteSubpanel();
      return;
    }
    if (panelMode === "projects") {
      closeProjectSubpanel();
      return;
    }
    if (!activeGroupId) {
      closeNoteSubpanel();
      return;
    }
    if (activeProjectPanelElement === panelRootElement) {
      closeNoteSubpanel();
    }
    if (!visibleGroups.some((group) => group.id === activeGroupId)) {
      closeProjectSubpanel();
    }
  });

  $effect(() => {
    const maxHeight = panelMaxHeight;
    const activeSearch = searchActive;
    const mode = panelMode;
    const groupCount = visibleGroups.length;
    const resultCount = searchResultGroups.reduce((count, entry) => count + entry.projects.length, 0);
    const directProjectCount = directProjectGroup ? projectsInGroup(directProjectGroup).length : 0;
    const noteCount = activeProjectRootItems.length;
    const creatingGroup = createGroupOpen;
    const creatingProject = createProjectGroupId;
    void maxHeight;
    void activeSearch;
    void mode;
    void groupCount;
    void resultCount;
    void directProjectCount;
    void noteCount;
    void creatingGroup;
    void creatingProject;
    requestAnimationFrame(() => {
      updatePanelStyle();
      requestGroupScrollStateRefresh();
      updateProjectSubpanelGeometry();
      updateNoteSubpanelGeometry();
    });
  });

  $effect(() => {
    const scrollElement = groupScrollElement;
    if (!scrollElement) return;
    const resizeObserver = new ResizeObserver(() => {
      updatePanelStyle();
      requestGroupScrollStateRefresh();
      updateProjectSubpanelGeometry();
      updateNoteSubpanelGeometry();
    });
    resizeObserver.observe(scrollElement);
    if (panelHeaderElement) resizeObserver.observe(panelHeaderElement);
    if (panelFooterElement) resizeObserver.observe(panelFooterElement);
    if (groupScrollContentElement) resizeObserver.observe(groupScrollContentElement);
    updatePanelStyle();
    requestGroupScrollStateRefresh();
    return () => {
      resizeObserver.disconnect();
      if (groupScrollStateFrame !== null) {
        cancelAnimationFrame(groupScrollStateFrame);
        groupScrollStateFrame = null;
      }
    };
  });

  $effect(() => {
    const scrollElement = projectScrollElement;
    if (!scrollElement) return;
    const resizeObserver = new ResizeObserver(() => {
      requestProjectScrollStateRefresh();
      updateProjectSubpanelGeometry();
      updateNoteSubpanelGeometry();
    });
    resizeObserver.observe(scrollElement);
    if (projectScrollContentElement) resizeObserver.observe(projectScrollContentElement);
    if (projectSubpanelFooterElement) resizeObserver.observe(projectSubpanelFooterElement);
    requestProjectScrollStateRefresh();
    return () => {
      resizeObserver.disconnect();
      if (projectScrollStateFrame !== null) {
        cancelAnimationFrame(projectScrollStateFrame);
        projectScrollStateFrame = null;
      }
    };
  });
</script>

{#snippet projectRow(project: Project, group: ProjectGroup, sourcePanelElement: HTMLDivElement | null | undefined)}
  <button
    type="button"
    class={cn(
      "grid min-h-8 w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-[0.8rem] transition-colors hover:bg-accent hover:text-accent-foreground",
      project.status === "active" ? "text-popover-foreground" : "text-popover-foreground/60",
      activeProjectId === project.id && "bg-accent text-accent-foreground",
    )}
    aria-label={t("projects.actions.selectProject", project.name, group.name)}
    onpointerenter={(event) => handleProjectPointerEnter(project, event, sourcePanelElement)}
    onpointermove={(event) => handleProjectPointerMove(project, event, sourcePanelElement)}
    onpointerleave={handleNoteSubpanelBoundaryLeave}
    onfocus={(event) => showNoteSubpanel(project, event.currentTarget, sourcePanelElement)}
    onclick={() => { void selectProject(project); }}
  >
    <ProjectIcon name={project.icon} size={iconSize} strokeWidth={iconStrokeWidth} emojiScale={emojiScale} class="shrink-0" />
    <span class="min-w-0 truncate">{project.name}</span>
    <span class="flex min-w-0 items-center justify-end gap-1">
      {#if project.status !== "active"}
        <span class={cn("shrink-0 rounded border px-1.5 py-0.5 text-[0.666667rem]", projectLifecycleBadgeClass(project.status))}>
          {projectLifecycleLabel(project.status, t)}
        </span>
      {/if}
      <ChevronRight size={13} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/60" />
    </span>
  </button>
{/snippet}

<div
  bind:this={panelRootElement}
  class="project-picker-panel flex min-h-0 w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-lg ring-1 ring-border/60"
  style={panelStyle}
>
  <div bind:this={panelHeaderElement} class="px-1.5 pb-0.5 pt-1.5">
    <div class="flex min-h-8 items-center gap-1.5 rounded-md border border-border/70 bg-muted/20 pl-2 pr-1">
      <Search size={13} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/60" />
      <input
        bind:value={projectSearch}
        placeholder={t("calendar.eventPanel.searchProjects")}
        class="min-w-0 flex-1 bg-transparent text-[0.8rem] text-popover-foreground placeholder:text-popover-foreground/45"
      />
      <button
        type="button"
        class={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded text-popover-foreground/60 hover:bg-accent hover:text-accent-foreground",
          showInactiveProjects && "bg-accent text-accent-foreground",
        )}
        aria-label={showInactiveProjects ? t("projects.navigator.hideInactive") : t("projects.navigator.showInactive")}
        title={showInactiveProjects ? t("projects.navigator.hideInactive") : t("projects.navigator.showInactive")}
        onclick={() => {
          onShowInactiveProjectsChange(!showInactiveProjects);
        }}
      >
        {#if showInactiveProjects}
          <EyeOff size={13} strokeWidth={iconStrokeWidth} />
        {:else}
          <Eye size={13} strokeWidth={iconStrokeWidth} />
        {/if}
      </button>
    </div>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="relative min-h-0 flex-1" onpointerleave={handleNoteSubpanelBoundaryLeave}>
    <div
      bind:this={groupScrollElement}
      class={cn(
        "project-picker-scroll-area hide-scrollbar h-full min-h-0 overflow-y-auto pb-1 pt-0.5",
        groupScrollable && "pr-2",
        groupScrollable && groupCanScrollUp && groupCanScrollDown && "project-picker-scroll-both",
        groupScrollable && groupCanScrollUp && !groupCanScrollDown && "project-picker-scroll-top",
        groupScrollable && !groupCanScrollUp && groupCanScrollDown && "project-picker-scroll-bottom",
      )}
      onscroll={handleGroupScroll}
    >
      <div bind:this={groupScrollContentElement}>
        {#if projects.loading && !projects.loaded}
          <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
            {t("projects.loading")}
          </div>
        {:else if projects.loadError}
          <div class="px-3 py-2 text-[0.8rem] text-destructive">
            {t("projects.loadFailed", projects.loadError)}
          </div>
        {:else if searchActive && searchResultGroups.length === 0}
          <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
            {t("calendar.eventPanel.noProjectsFound")}
          </div>
        {:else if searchActive}
          <div class="grid px-1">
            {#each searchResultGroups as resultGroup (resultGroup.group.id)}
              <div class="px-1 pb-1">
                <div class="px-2 pb-0.5 pt-1 text-[0.7rem] font-medium text-popover-foreground/45">
                  {resultGroup.group.name}
                </div>
                <div class="grid">
                  {#each resultGroup.projects as project (project.id)}
                    <button
                      type="button"
                      class={cn(
                        "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[0.8rem] transition-colors hover:bg-accent hover:text-accent-foreground",
                        project.status === "active" ? "text-popover-foreground" : "text-popover-foreground/60",
                      )}
                      aria-label={t("projects.actions.selectProject", project.name, resultGroup.group.name)}
                      onclick={() => { void selectProject(project); }}
                    >
                      <ProjectIcon name={project.icon} size={iconSize} strokeWidth={iconStrokeWidth} emojiScale={emojiScale} class="shrink-0" />
                      <span class="min-w-0 flex-1 truncate">{project.name}</span>
                      {#if project.status !== "active"}
                        <span class={cn("shrink-0 rounded border px-1.5 py-0.5 text-[0.666667rem]", projectLifecycleBadgeClass(project.status))}>
                          {projectLifecycleLabel(project.status, t)}
                        </span>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if panelMode === "groups"}
          {#if visibleGroups.length === 0}
            <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
              {t("calendar.eventPanel.noProjectsFound")}
            </div>
          {:else}
            <div class="grid pl-1">
              {#each visibleGroups as group (group.id)}
                <div class="pl-1 pr-1">
                  <button
                    type="button"
                    class={cn(
                      "grid min-h-8 w-full grid-cols-[1.25rem_minmax(0,1fr)_1rem] items-center gap-2 rounded-md px-2 text-left transition-colors",
                      activeGroupId === group.id
                        ? "bg-accent text-accent-foreground"
                        : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                    onpointerenter={(event) => handleGroupPointerEnter(group, event)}
                    onpointermove={(event) => handleGroupPointerMove(group, event)}
                    onpointerleave={handleProjectSubpanelBoundaryLeave}
                    onfocus={(event) => showProjectSubpanel(group, event.currentTarget)}
                    onclick={(event) => showProjectSubpanel(group, event.currentTarget)}
                  >
                    <ProjectIcon name={group.icon} size={iconSize} strokeWidth={iconStrokeWidth} emojiScale={emojiScale} class="shrink-0" />
                    <span class="truncate text-[0.8rem] font-medium">{group.name}</span>
                    <ChevronRight size={13} strokeWidth={iconStrokeWidth} class="justify-self-end text-popover-foreground/60" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {:else if !directProjectGroup}
          <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
            {t("projects.navigator.empty")}
          </div>
        {:else if directProjects.length === 0}
          <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
            {t("calendar.eventPanel.noProjectsFound")}
          </div>
        {:else}
          <div class="grid px-1">
            {#each directProjects as project (project.id)}
              <div class="px-1">
                {@render projectRow(project, directProjectGroup, panelRootElement)}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <CalendarScrollbar
      scrollContainer={groupScrollElement}
      stickyTop={4}
      stickyBottom={4}
      wheelPassthrough
    />
  </div>

  {#if !searchActive}
    <div bind:this={panelFooterElement} class="relative z-10 shrink-0 bg-popover p-1.5">
      <div class="pointer-events-none absolute left-1.5 right-1.5 top-0 border-t border-border/70"></div>
      {#if panelMode === "groups"}
        {#if createGroupOpen}
          <form class="flex gap-1" onsubmit={(event) => { event.preventDefault(); void submitGroup(); }}>
            <input
              bind:value={groupDraft}
              placeholder={t("projects.navigator.groupNamePlaceholder")}
              class="min-h-8 min-w-0 flex-1 rounded border border-border bg-muted/40 px-2 text-[0.8rem] text-popover-foreground placeholder:text-popover-foreground/45"
            />
            <button type="submit" class="min-h-8 rounded bg-primary px-2 text-[0.733333rem] font-medium text-primary-foreground">
              {t("common.save")}
            </button>
          </form>
        {:else}
          <button
            type="button"
            class="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md text-[0.8rem] text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onclick={() => { createGroupOpen = true; }}
          >
            <Plus size={13} strokeWidth={iconStrokeWidth} />
            <span>{t("calendar.eventPanel.createGroup")}</span>
          </button>
        {/if}
      {:else if directProjectGroup}
        {#if createProjectGroupId === directProjectGroup.id}
          <form class="grid gap-1" onsubmit={(event) => { event.preventDefault(); void submitProject(directProjectGroup.id); }}>
            <div class="flex gap-1">
              <input
                value={projectDraftByGroup[directProjectGroup.id] ?? ""}
                oninput={(event) => {
                  projectDraftByGroup = {
                    ...projectDraftByGroup,
                    [directProjectGroup.id]: event.currentTarget.value,
                  };
                }}
                placeholder={t("projects.navigator.projectNamePlaceholder")}
                class="min-h-7 min-w-0 flex-1 rounded border border-border bg-muted/40 px-2 text-[0.8rem] text-popover-foreground placeholder:text-popover-foreground/45"
              />
              <button type="submit" class="min-h-7 rounded bg-primary px-2 text-[0.733333rem] font-medium text-primary-foreground">
                {t("common.save")}
              </button>
            </div>
            <div class="flex flex-wrap gap-1" aria-label={t("projects.navigator.projectTemplate")}>
              {#each PROJECT_TEMPLATE_IDS as templateId}
                <button
                  type="button"
                  class={cn(
                    "min-h-6 rounded border px-1.5 text-[0.7rem]",
                    (projectTemplateDraftByGroup[directProjectGroup.id] ?? "blank") === templateId
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-transparent text-popover-foreground/60 hover:bg-accent hover:text-accent-foreground",
                  )}
                  onclick={() => {
                    projectTemplateDraftByGroup = {
                      ...projectTemplateDraftByGroup,
                      [directProjectGroup.id]: templateId,
                    };
                  }}
                >
                  {projectTemplateLabel(templateId)}
                </button>
              {/each}
            </div>
          </form>
        {:else}
          <button
            type="button"
            class="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md text-[0.8rem] text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onclick={() => {
              createProjectGroupId = directProjectGroup.id;
            }}
          >
            <Plus size={13} strokeWidth={iconStrokeWidth} />
            <span>{t("calendar.eventPanel.createProject")}</span>
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if panelMode === "groups" && !searchActive && activeGroup && activeGroupAnchorElement}
  {@const activeGroupProjects = projectsInGroup(activeGroup)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={projectSubpanelBridgeElement}
    aria-hidden="true"
    class={cn("fixed bg-transparent", zIndexClass)}
    style={projectSubpanelBridgeStyle}
    onpointerleave={handleProjectSubpanelBoundaryLeave}
  ></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={projectSubpanelElement}
    class={cn("project-picker-panel fixed flex min-h-0 flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-lg ring-1 ring-border/60", zIndexClass)}
    style={projectSubpanelStyle}
    onpointerleave={handleProjectSubpanelBoundaryLeave}
  >
    <div class="relative min-h-0 flex-1">
      <div
        bind:this={projectScrollElement}
        class={cn(
          "project-picker-scroll-area hide-scrollbar h-full min-h-0 overflow-y-auto py-1",
          projectScrollable ? "px-1 pr-2" : "px-1",
          projectScrollable && projectCanScrollUp && projectCanScrollDown && "project-picker-scroll-both",
          projectScrollable && projectCanScrollUp && !projectCanScrollDown && "project-picker-scroll-top",
          projectScrollable && !projectCanScrollUp && projectCanScrollDown && "project-picker-scroll-bottom",
        )}
        onscroll={handleProjectScroll}
      >
        <div bind:this={projectScrollContentElement}>
          {#if activeGroupProjects.length === 0}
            <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
              {t("calendar.eventPanel.noProjectsFound")}
            </div>
          {:else}
            <div class="grid">
              {#each activeGroupProjects as project (project.id)}
                {@render projectRow(project, activeGroup, projectSubpanelElement)}
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <CalendarScrollbar
        scrollContainer={projectScrollElement}
        stickyTop={4}
        stickyBottom={4}
        wheelPassthrough
      />
    </div>

    <div bind:this={projectSubpanelFooterElement} class="relative z-10 shrink-0 bg-popover p-1.5">
      <div class="pointer-events-none absolute left-1.5 right-1.5 top-0 border-t border-border/70"></div>
      {#if createProjectGroupId === activeGroup.id}
        <form class="grid gap-1" onsubmit={(event) => { event.preventDefault(); void submitProject(activeGroup.id); }}>
          <div class="flex gap-1">
            <input
              value={projectDraftByGroup[activeGroup.id] ?? ""}
              oninput={(event) => {
                projectDraftByGroup = {
                  ...projectDraftByGroup,
                  [activeGroup.id]: event.currentTarget.value,
                };
              }}
              placeholder={t("projects.navigator.projectNamePlaceholder")}
              class="min-h-7 min-w-0 flex-1 rounded border border-border bg-muted/40 px-2 text-[0.8rem] text-popover-foreground placeholder:text-popover-foreground/45"
            />
            <button type="submit" class="min-h-7 rounded bg-primary px-2 text-[0.733333rem] font-medium text-primary-foreground">
              {t("common.save")}
            </button>
          </div>
          <div class="flex flex-wrap gap-1" aria-label={t("projects.navigator.projectTemplate")}>
            {#each PROJECT_TEMPLATE_IDS as templateId}
              <button
                type="button"
                class={cn(
                  "min-h-6 rounded border px-1.5 text-[0.7rem]",
                  (projectTemplateDraftByGroup[activeGroup.id] ?? "blank") === templateId
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-transparent text-popover-foreground/60 hover:bg-accent hover:text-accent-foreground",
                )}
                onclick={() => {
                  projectTemplateDraftByGroup = {
                    ...projectTemplateDraftByGroup,
                    [activeGroup.id]: templateId,
                  };
                }}
              >
                {projectTemplateLabel(templateId)}
              </button>
            {/each}
          </div>
        </form>
      {:else}
        <button
          type="button"
          class="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md text-[0.8rem] text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onclick={() => {
            createProjectGroupId = activeGroup.id;
            void tick().then(updateProjectSubpanelGeometry);
          }}
        >
          <Plus size={13} strokeWidth={iconStrokeWidth} />
          <span>{t("calendar.eventPanel.createProject")}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

{#if activeProjectId && activeProjectAnchorElement}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={noteSubpanelBridgeElement}
    aria-hidden="true"
    class={cn("fixed bg-transparent", zIndexClass)}
    style={noteSubpanelBridgeStyle}
    onpointerleave={handleNoteSubpanelBoundaryLeave}
  ></div>
  <NotesHierarchyPickerPanel
    bind:rootElement={noteSubpanelElement}
    projectId={activeProjectId}
    parent={{ kind: "root" }}
    showSearch={false}
    frameStyle={noteSubpanelStyle}
    className="fixed"
    {zIndexClass}
    onLayoutChange={updateNoteSubpanelGeometry}
    onPointerLeave={handleNoteSubpanelBoundaryLeave}
    onPageSelected={async () => {
      closeNoteSubpanel();
      await onPageSelected();
    }}
  />
{/if}

<style>
  .project-picker-panel {
    --cal-scrollbar-thumb: color-mix(in srgb, var(--popover-foreground) 18%, var(--popover));
    --cal-scrollbar-thumb-hover: color-mix(in srgb, var(--popover-foreground) 36%, var(--popover));
  }

  .project-picker-scroll-area {
    --project-picker-scroll-fade: 28px;

    transition: -webkit-mask-image 120ms ease, mask-image 120ms ease;
  }

  .project-picker-scroll-top {
    -webkit-mask-image: linear-gradient(to bottom, transparent, black var(--project-picker-scroll-fade), black);
    mask-image: linear-gradient(to bottom, transparent, black var(--project-picker-scroll-fade), black);
  }

  .project-picker-scroll-bottom {
    -webkit-mask-image: linear-gradient(to top, transparent, black var(--project-picker-scroll-fade), black);
    mask-image: linear-gradient(to top, transparent, black var(--project-picker-scroll-fade), black);
  }

  .project-picker-scroll-both {
    -webkit-mask-image:
      linear-gradient(
        to bottom,
        transparent,
        black var(--project-picker-scroll-fade),
        black calc(100% - var(--project-picker-scroll-fade)),
        transparent
      );
    mask-image:
      linear-gradient(
        to bottom,
        transparent,
        black var(--project-picker-scroll-fade),
        black calc(100% - var(--project-picker-scroll-fade)),
        transparent
      );
  }
</style>

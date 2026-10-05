<script lang="ts">
  import { tick, untrack } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    projectLifecycleBadgeClass,
    projectLifecycleLabel,
  } from "$lib/projects/display";
  import {
    isPointerAimingAtSubmenu,
    type MenuAimPoint,
  } from "$lib/utils/menu-aim";
  import {
    projectPickerBridgeFrameStyle,
    projectPickerMobileBackAction,
    projectPickerMobilePane,
    projectPickerMenuAimRect,
    projectPickerPanelEstimatedListHeight,
    projectPickerPanelFrameStyle,
    projectPickerPanelHeight,
    projectPickerPointerPoint,
    projectPickerScrollState,
    projectPickerSubpanelAimOrigin,
    projectPickerSubpanelGeometry,
    projectPickerSubpanelSide,
    type ProjectPickerPanelBounds,
  } from "$lib/projects/picker-panels";
  import {
    PROJECT_TEMPLATE_IDS,
    type Project,
    type ProjectGroup,
    type ProjectTemplateId,
  } from "$lib/projects/types";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import { cn, type MaybePromise } from "$lib/utils";
  import type { ProjectNavigatorPanelMode } from "$lib/projects/toolbar";
  import ProjectIcon from "$lib/components/projects/ProjectIcon.svelte";


  interface ProjectSearchResultGroup {
    group: ProjectGroup;
    projects: Project[];
  }

  let {
    selectedProjectId = null,
    selectedGroupId = null,
    mode = "groups",
    iconStrokeWidth = 1.6,
    panelMaxHeight = null,
    panelHeight = $bindable(0),
    mainVisibleRows = 6,
    subpanelVisibleRows = 6,
    pickerBounds = null,
    boundsSelector = null,
    zIndexClass = "z-61",
    showInactiveProjects = false,
    showInactiveToggle = false,
    showClearProject = false,
    showLifecycleBadges = false,
    closeOnProjectCreate = false,
    showProjectChildren = false,
    activeProjectId = null,
    projectSearch = $bindable(""),
    onShowInactiveProjectsChange = undefined,
    onProjectSelected,
    onProjectCreated = undefined,
    onClearProject = undefined,
    onProjectPreview = undefined,
    onProjectPreviewClose = undefined,
    projectChildContainsTarget = undefined,
    pointerAimingAtProjectChild = undefined,
    mobileLayout = false,
    initialMobileGroupId = null,
    onProjectDrilldown = undefined,
    onClose = undefined,
  }: {
    selectedProjectId?: string | null;
    selectedGroupId?: string | null;
    mode?: ProjectNavigatorPanelMode;
    iconStrokeWidth?: number;
    panelMaxHeight?: number | null;
    panelHeight?: number;
    mainVisibleRows?: number | null;
    subpanelVisibleRows?: number | null;
    pickerBounds?: ProjectPickerPanelBounds | null;
    boundsSelector?: string | null;
    zIndexClass?: string;
    showInactiveProjects?: boolean;
    showInactiveToggle?: boolean;
    showClearProject?: boolean;
    showLifecycleBadges?: boolean;
    closeOnProjectCreate?: boolean;
    showProjectChildren?: boolean;
    activeProjectId?: string | null;
    projectSearch?: string;
    onShowInactiveProjectsChange?: (value: boolean) => void;
    onProjectSelected: (project: Project) => MaybePromise<void>;
    onProjectCreated?: (projectId: string | null) => MaybePromise<void>;
    onClearProject?: () => MaybePromise<void>;
    onProjectPreview?: (
      project: Project,
      anchor: HTMLElement,
      sourcePanel: HTMLDivElement | null,
    ) => void;
    onProjectPreviewClose?: () => void;
    projectChildContainsTarget?: (target: EventTarget | null) => boolean;
    pointerAimingAtProjectChild?: (point: MenuAimPoint) => boolean;
    mobileLayout?: boolean;
    initialMobileGroupId?: string | null;
    onProjectDrilldown?: (project: Project) => MaybePromise<void>;
    onClose?: () => void;
  } = $props();

  const projects = getProjects();
  const mobileBackStack = getMobileBackStack();
  const { t } = getLocalization();
  const iconSize = $derived(mobileLayout ? 18 : 13);
  const EMOJI_SCALE = 0.94;
  const PANEL_FALLBACK_HEADER_HEIGHT = 40;
  const PANEL_FALLBACK_FOOTER_HEIGHT = 44;
  const PANEL_LIST_PADDING = 6;
  const PANEL_ROW_HEIGHT_REM = 2;
  const PANEL_FALLBACK_ROW_HEIGHT = 30;
  const SUBPANEL_LIST_PADDING = 8;
  const SUBPANEL_FALLBACK_FOOTER_HEIGHT = 44;
  const SUBPANEL_ROW_HEIGHT = 32;
  const SUBPANEL_GAP = 4;

  let groupDraft = $state("");
  let createGroupOpen = $state(false);
  let createProjectGroupId = $state<string | null>(null);
  let projectDraftByGroup = $state<Record<string, string>>({});
  let projectTemplateDraftByGroup = $state<Record<string, ProjectTemplateId>>({});
  let activeGroupId = $state<string | null>(untrack(() => mobileLayout ? initialMobileGroupId : null));
  let activeGroupAnchorElement = $state<HTMLElement | null>(null);
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
  let mobileBackButtonElement = $state<HTMLButtonElement | null>(null);

  const selectedProject = $derived(projects.projectById(selectedProjectId));
  const selectedGroup = $derived(projects.groupById(selectedProject?.groupId ?? selectedGroupId));
  const normalizedSearch = $derived(projectSearch.trim().toLowerCase());
  const searchActive = $derived(normalizedSearch.length > 0);
  const groups = $derived.by(() => projects.visibleGroups());
  const visibleGroups = $derived.by(() => groups.filter(groupVisible));
  const searchResultGroups = $derived.by((): ProjectSearchResultGroup[] =>
    groups
      .map((group) => ({ group, projects: projectsInGroup(group) }))
      .filter((entry) => entry.projects.length > 0),
  );
  const activeGroup = $derived.by(() => groups.find((group) => group.id === activeGroupId));
  const directProjectGroup = $derived.by(() => selectedGroup);
  const directProjects = $derived.by(() => directProjectGroup ? projectsInGroup(directProjectGroup) : []);
  const mobilePane = $derived(projectPickerMobilePane({
    mode,
    activeGroupId,
    searchActive,
  }));
  const mainProjectGroup = $derived(
    mobileLayout && mode === "groups" ? activeGroup : directProjectGroup,
  );
  const mainProjects = $derived.by(() => (
    mainProjectGroup ? projectsInGroup(mainProjectGroup) : []
  ));
  const mobileNestedBackAction = $derived(projectPickerMobileBackAction({
    mode,
    activeGroupId,
    searchActive,
    createGroupOpen,
    createProjectGroupId,
  }));
  const projectRowsHaveChildren = $derived(
    showProjectChildren || (mobileLayout && onProjectDrilldown !== undefined),
  );

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
      ? rootFontSize * PANEL_ROW_HEIGHT_REM
      : PANEL_FALLBACK_ROW_HEIGHT;
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
      : mobileLayout && mobilePane === "projects"
        ? mainProjects.length
        : mode === "projects" && directProjectGroup
          ? directProjects.length
          : visibleGroups.length;
    return projectPickerPanelEstimatedListHeight({
      itemCount,
      visibleRows: mainVisibleRows,
      listPadding: PANEL_LIST_PADDING,
      rowHeight: rowHeight(),
    });
  }

  function updatePanelStyle(): void {
    if (mobileLayout) {
      panelHeight = panelRootElement?.clientHeight ?? 0;
      panelStyle = "height: 100%; max-height: 100%";
      return;
    }
    const headerHeight = panelHeaderElement?.offsetHeight ?? PANEL_FALLBACK_HEADER_HEIGHT;
    const footerHeight = searchActive
      ? 0
      : panelFooterElement?.offsetHeight ?? PANEL_FALLBACK_FOOTER_HEIGHT;
    const measuredListHeight = groupScrollContentElement
      ? groupScrollContentElement.scrollHeight + scrollAreaVerticalPadding(
        groupScrollElement,
        PANEL_LIST_PADDING,
      )
      : undefined;
    const listHeight = measuredListHeight ?? mainListEstimatedHeight();
    panelHeight = projectPickerPanelHeight({
      headerHeight,
      footerHeight,
      listHeight,
      maxHeight: panelMaxHeight,
      visibleRows: mainVisibleRows,
      listPadding: PANEL_LIST_PADDING,
      rowHeight: rowHeight(),
    });
    panelStyle = [
      `height: ${panelHeight}px`,
      `max-height: ${panelHeight}px`,
    ].join("; ");
  }

  function currentPanelBounds(): ProjectPickerPanelBounds {
    if (pickerBounds) return pickerBounds;
    const margin = 8;
    const viewportBounds = {
      left: margin,
      right: window.innerWidth - margin,
      top: margin,
      bottom: window.innerHeight - margin,
    };
    const boundsElement = boundsSelector
      ? panelRootElement?.closest(boundsSelector)
      : null;
    const rect = boundsElement?.getBoundingClientRect();
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

  function updateProjectSubpanelGeometry(): void {
    if (mobileLayout) return;
    if (!activeGroupAnchorElement || !panelRootElement) return;
    const anchorRect = activeGroupAnchorElement.getBoundingClientRect();
    const panelRect = panelRootElement.getBoundingClientRect();
    const bounds = currentPanelBounds();
    const footerHeight = projectSubpanelFooterElement?.offsetHeight ?? SUBPANEL_FALLBACK_FOOTER_HEIGHT;
    const projectCount = activeGroup ? projectsInGroup(activeGroup).length : 0;
    const measuredListHeight = projectScrollContentElement
      ? projectScrollContentElement.scrollHeight + scrollAreaVerticalPadding(
        projectScrollElement,
        SUBPANEL_LIST_PADDING,
      )
      : undefined;
    const geometry = projectPickerSubpanelGeometry({
      anchorRect,
      panelRect,
      bounds,
      gap: SUBPANEL_GAP,
      footerHeight,
      projectCount,
      visibleRows: subpanelVisibleRows,
      listHeight: measuredListHeight,
      listPadding: SUBPANEL_LIST_PADDING,
      rowHeight: SUBPANEL_ROW_HEIGHT,
    });

    projectSubpanelStyle = projectPickerPanelFrameStyle(geometry.panel);
    projectSubpanelBridgeStyle = projectPickerBridgeFrameStyle(geometry.bridge);
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

  function closeProjectSubpanel(): void {
    activeGroupId = null;
    activeGroupAnchorElement = null;
    createProjectGroupId = null;
    projectSubpanelFooterElement = undefined;
    projectSubpanelStyle = "";
    projectSubpanelBridgeStyle = "";
  }

  function showProjectSubpanel(
    group: ProjectGroup,
    target: EventTarget | null,
  ): void {
    if (activeGroupId !== group.id) {
      createProjectGroupId = null;
      onProjectPreviewClose?.();
    }
    activeGroupId = group.id;
    activeGroupAnchorElement = target instanceof HTMLElement ? target : null;
    if (mobileLayout) {
      void tick().then(() => mobileBackButtonElement?.focus());
      return;
    }
    updateProjectSubpanelGeometry();
    void tick().then(updateProjectSubpanelGeometry);
  }

  function handleGroupPointerEnter(group: ProjectGroup, event: PointerEvent): void {
    if (mobileLayout) return;
    const point = projectPickerPointerPoint(event);
    if (activeGroupId && activeGroupId !== group.id && pointerAimingAtProjectSubpanel(point)) {
      return;
    }
    showProjectSubpanel(group, event.currentTarget);
  }

  function handleGroupPointerMove(group: ProjectGroup, event: PointerEvent): void {
    if (mobileLayout) return;
    const point = projectPickerPointerPoint(event);
    if (activeGroupId === group.id) {
      return;
    }
    if (activeGroupId && pointerAimingAtProjectSubpanel(point)) {
      return;
    }
    showProjectSubpanel(group, event.currentTarget);
  }

  function isProjectSubpanelBoundaryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return Boolean(
      activeGroupAnchorElement?.contains(target)
      || projectSubpanelBridgeElement?.contains(target)
      || projectSubpanelElement?.contains(target)
      || projectChildContainsTarget?.(target)
    );
  }

  function handleProjectSubpanelBoundaryLeave(event: PointerEvent): void {
    if (mobileLayout) return;
    if (isProjectSubpanelBoundaryTarget(event.relatedTarget)) return;
    if (pointerAimingAtProjectChild?.(projectPickerPointerPoint(event))) return;
    if (pointerAimingAtProjectSubpanel(projectPickerPointerPoint(event))) return;
    onProjectPreviewClose?.();
    closeProjectSubpanel();
  }

  function previewProject(project: Project, target: EventTarget | null): void {
    if (mobileLayout || !showProjectChildren || !(target instanceof HTMLElement)) return;
    onProjectPreview?.(
      project,
      target,
      target.closest<HTMLDivElement>(".project-picker-panel"),
    );
  }

  function handleProjectPointerEnter(project: Project, event: PointerEvent): void {
    if (
      activeProjectId
      && activeProjectId !== project.id
      && pointerAimingAtProjectChild?.(projectPickerPointerPoint(event))
    ) return;
    previewProject(project, event.currentTarget);
  }

  function handleProjectPointerMove(project: Project, event: PointerEvent): void {
    if (activeProjectId === project.id) return;
    if (activeProjectId && pointerAimingAtProjectChild?.(projectPickerPointerPoint(event))) return;
    previewProject(project, event.currentTarget);
  }

  function handleProjectPointerLeave(event: PointerEvent): void {
    if (projectChildContainsTarget?.(event.relatedTarget)) return;
    if (pointerAimingAtProjectChild?.(projectPickerPointerPoint(event))) return;
    onProjectPreviewClose?.();
  }

  async function activateProject(project: Project): Promise<void> {
    if (mobileLayout && onProjectDrilldown) {
      await onProjectDrilldown(project);
      projectSearch = "";
      return;
    }
    await onProjectSelected(project);
    projectSearch = "";
  }

  async function clearProject(): Promise<void> {
    await onClearProject?.();
    projectSearch = "";
  }

  function updateProjectSearch(value: string): void {
    projectSearch = value;
    if (!mobileLayout || value.trim().length === 0) return;
    createGroupOpen = false;
    createProjectGroupId = null;
  }

  function showMobileGroups(): void {
    const previousGroupId = activeGroupId;
    onProjectPreviewClose?.();
    closeProjectSubpanel();
    if (!previousGroupId) return;
    void tick().then(() => {
      const groupButtons = panelRootElement?.querySelectorAll<HTMLButtonElement>(
        "[data-mobile-project-group-id]",
      );
      const previousButton = Array.from(groupButtons ?? []).find(
        (button) => button.dataset.mobileProjectGroupId === previousGroupId,
      );
      previousButton?.focus();
    });
  }

  function closeMobileGroupCreator(): void {
    createGroupOpen = false;
    void tick().then(() => {
      panelRootElement?.querySelector<HTMLButtonElement>(
        "[data-mobile-create-project-group]",
      )?.focus();
    });
  }

  function closeMobileProjectCreator(): void {
    createProjectGroupId = null;
    void tick().then(() => {
      panelRootElement?.querySelector<HTMLButtonElement>(
        "[data-mobile-create-project]",
      )?.focus();
    });
  }

  function handleMobileNestedBack(): void {
    if (mobileNestedBackAction === "close-project-creator") {
      closeMobileProjectCreator();
      return;
    }
    if (mobileNestedBackAction === "close-group-creator") {
      closeMobileGroupCreator();
      return;
    }
    if (mobileNestedBackAction === "clear-search") {
      projectSearch = "";
      return;
    }
    if (mobileNestedBackAction === "show-groups") {
      showMobileGroups();
      return;
    }
    onClose?.();
  }

  async function submitGroup(): Promise<void> {
    const name = groupDraft.trim();
    if (!name) return;
    await projects.addGroup(name);
    groupDraft = "";
    if (mobileLayout) closeMobileGroupCreator();
    else createGroupOpen = false;
  }

  async function submitProject(groupId: string): Promise<void> {
    const name = (projectDraftByGroup[groupId] ?? "").trim();
    if (!name) return;
    const templateId = projectTemplateDraftByGroup[groupId] ?? "blank";
    await projects.addProject(groupId, name, templateId);
    projectDraftByGroup = { ...projectDraftByGroup, [groupId]: "" };
    projectTemplateDraftByGroup = { ...projectTemplateDraftByGroup, [groupId]: "blank" };
    if (mobileLayout) closeMobileProjectCreator();
    else createProjectGroupId = null;
    await onProjectCreated?.(projects.selectedProjectId);
    if (closeOnProjectCreate) {
      projectSearch = "";
    }
  }

  $effect(() => {
    if (mode === "projects") {
      closeProjectSubpanel();
      onProjectPreviewClose?.();
      return;
    }
    if (searchActive) {
      if (!mobileLayout) {
        closeProjectSubpanel();
        onProjectPreviewClose?.();
      }
      return;
    }
    if (!activeGroupId) return;
    const availableGroups = mobileLayout ? groups : visibleGroups;
    if (!availableGroups.some((group) => group.id === activeGroupId)) {
      closeProjectSubpanel();
    }
  });

  $effect(() => {
    const action = mobileNestedBackAction;
    if (!mobileLayout || action === "close-picker") return;
    return mobileBackStack.activate({ handle: handleMobileNestedBack });
  });

  $effect(() => {
    const maxHeight = panelMaxHeight;
    const activeSearch = searchActive;
    const panelMode = mode;
    const groupCount = visibleGroups.length;
    const resultCount = searchResultGroups.reduce((count, entry) => count + entry.projects.length, 0);
    const directProjectCount = directProjectGroup ? projectsInGroup(directProjectGroup).length : 0;
    const mainProjectCount = mainProjects.length;
    const creatingGroup = createGroupOpen;
    const creatingProject = createProjectGroupId;
    void maxHeight;
    void activeSearch;
    void panelMode;
    void groupCount;
    void resultCount;
    void directProjectCount;
    void mainProjectCount;
    void creatingGroup;
    void creatingProject;
    requestAnimationFrame(() => {
      updatePanelStyle();
      requestGroupScrollStateRefresh();
      updateProjectSubpanelGeometry();
    });
  });

  $effect(() => {
    const scrollElement = groupScrollElement;
    if (!scrollElement) return;
    const resizeObserver = new ResizeObserver(() => {
      updatePanelStyle();
      requestGroupScrollStateRefresh();
      updateProjectSubpanelGeometry();
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

<svelte:window
  onkeydown={(event) => {
    if (!mobileLayout || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    handleMobileNestedBack();
  }}
/>

<div
  bind:this={panelRootElement}
  class={cn(
    "project-picker-panel flex min-h-0 w-full flex-col overflow-hidden bg-popover text-popover-foreground shadow-lg ring-1 ring-border/60",
    mobileLayout ? "h-full rounded-2xl" : "rounded-md",
  )}
  style={panelStyle}
>
  <div bind:this={panelHeaderElement} class={mobileLayout ? "border-b border-border/70 p-2" : "px-1.5 pb-0.5 pt-1.5"}>
    {#if mobileLayout}
      <div class="flex min-h-14 items-center gap-1">
        {#if mode === "groups" && activeGroup && !searchActive}
          <button
            bind:this={mobileBackButtonElement}
            type="button"
            class="flex min-h-12 min-w-12 items-center justify-center rounded-xl active:bg-accent"
            aria-label={t("projects.navigator.backToGroups")}
            onclick={showMobileGroups}
          >
            <ChevronLeft size={22} strokeWidth={iconStrokeWidth} aria-hidden="true" />
          </button>
        {/if}
        <h2 class="min-w-0 flex-1 truncate px-2 text-base font-semibold">
          {searchActive
            ? t("calendar.eventPanel.searchProjects")
            : mainProjectGroup?.name ?? t("projects.navigator.pickerLabel")}
        </h2>
        {#if onClose}
          <button
            type="button"
            data-project-picker-initial-focus="true"
            class="flex min-h-12 min-w-12 items-center justify-center rounded-xl active:bg-accent"
            aria-label={t("projects.navigator.closePicker")}
            onclick={onClose}
          >
            <X size={22} strokeWidth={iconStrokeWidth} aria-hidden="true" />
          </button>
        {/if}
      </div>
    {/if}
    <div class={cn(
      "flex items-center gap-1.5 border border-border/70 bg-muted/20",
      mobileLayout ? "min-h-12 rounded-xl pl-3" : "min-h-8 rounded-md pl-2 pr-1",
    )}>
      <Search size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/60" />
      <input
        type="search"
        value={projectSearch}
        oninput={(event) => updateProjectSearch(event.currentTarget.value)}
        placeholder={t("calendar.eventPanel.searchProjects")}
        class={cn(
          "min-w-0 flex-1 bg-transparent text-popover-foreground placeholder:text-popover-foreground/45",
          mobileLayout ? "h-12 text-base" : "text-[0.8rem]",
        )}
      />
      {#if showInactiveToggle}
        <button
          type="button"
          class={cn(
            "flex shrink-0 items-center justify-center text-popover-foreground/60 hover:bg-accent hover:text-accent-foreground",
            mobileLayout ? "h-12 w-12 rounded-xl" : "h-6 w-6 rounded",
            showInactiveProjects && "bg-accent text-accent-foreground",
          )}
          aria-label={showInactiveProjects ? t("projects.navigator.hideInactive") : t("projects.navigator.showInactive")}
          title={showInactiveProjects ? t("projects.navigator.hideInactive") : t("projects.navigator.showInactive")}
          onclick={() => {
            onShowInactiveProjectsChange?.(!showInactiveProjects);
          }}
        >
          {#if showInactiveProjects}
            <EyeOff size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} />
          {:else}
            <Eye size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} />
          {/if}
        </button>
      {/if}
      {#if mobileLayout && searchActive}
        <button
          type="button"
          onclick={() => { projectSearch = ""; }}
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-popover-foreground/60 active:bg-accent"
          aria-label={t("projects.navigator.clearSearch")}
        >
          <X size={18} strokeWidth={iconStrokeWidth} />
        </button>
      {:else if showClearProject && selectedProjectId}
        <button
          type="button"
          onclick={() => { void clearProject(); }}
          class={cn(
            "flex shrink-0 items-center justify-center text-popover-foreground/60 hover:bg-accent hover:text-accent-foreground",
            mobileLayout ? "h-12 w-12 rounded-xl" : "h-6 w-6 rounded",
          )}
          aria-label={t("calendar.eventPanel.projectPlaceholder")}
        >
          <Trash2 size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} />
        </button>
      {/if}
    </div>
  </div>

  <div class="relative min-h-0 flex-1">
    <div
      bind:this={groupScrollElement}
      class={cn(
        "project-picker-scroll-area hide-scrollbar h-full min-h-0 overflow-y-auto",
        mobileLayout ? "overscroll-contain px-1 py-2" : "pb-1 pt-0.5",
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
                        "flex w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-accent hover:text-accent-foreground",
                        mobileLayout ? "min-h-12 px-3 text-sm active:bg-accent" : "min-h-8 px-2 text-[0.8rem]",
                        project.status === "active" ? "text-popover-foreground" : "text-popover-foreground/60",
                      )}
                      aria-label={t("projects.actions.selectProject", project.name, resultGroup.group.name)}
                      onclick={() => { void activateProject(project); }}
                    >
                      <ProjectIcon name={project.icon} size={iconSize} strokeWidth={iconStrokeWidth} emojiScale={EMOJI_SCALE} class="shrink-0" />
                      <span class="min-w-0 flex-1 truncate">{project.name}</span>
                      {#if showLifecycleBadges && project.status !== "active"}
                        <span class={cn("shrink-0 rounded border px-1.5 py-0.5 text-[0.666667rem]", projectLifecycleBadgeClass(project.status))}>
                          {projectLifecycleLabel(project.status, t)}
                        </span>
                      {/if}
                      {#if projectRowsHaveChildren}
                        <ChevronRight size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/60" />
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if mode === "groups" && (!mobileLayout || mobilePane === "groups")}
          {#if visibleGroups.length === 0}
            <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
              {t("calendar.eventPanel.noProjectsFound")}
            </div>
          {:else}
            <div class={mobileLayout ? "grid px-1" : "grid pl-1"}>
              {#each visibleGroups as group (group.id)}
                <div class={mobileLayout ? "px-1" : "pl-1 pr-1"}>
                  <button
                    type="button"
                    data-mobile-project-group-id={mobileLayout ? group.id : undefined}
                    class={cn(
                      "grid w-full items-center gap-2 rounded-md text-left transition-colors",
                      mobileLayout
                        ? "min-h-12 grid-cols-[1.125rem_minmax(0,1fr)_1.5rem] px-3"
                        : "min-h-8 grid-cols-[0.8125rem_minmax(0,1fr)_1rem] px-2",
                      activeGroupId === group.id
                        ? "bg-accent text-accent-foreground"
                        : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                    onpointerenter={(event) => handleGroupPointerEnter(group, event)}
                    onpointermove={(event) => handleGroupPointerMove(group, event)}
                    onpointerleave={handleProjectSubpanelBoundaryLeave}
                    onfocus={(event) => {
                      if (!mobileLayout) showProjectSubpanel(group, event.currentTarget);
                    }}
                    onclick={(event) => showProjectSubpanel(group, event.currentTarget)}
                  >
                    <ProjectIcon name={group.icon} size={iconSize} strokeWidth={iconStrokeWidth} emojiScale={EMOJI_SCALE} class="shrink-0" />
                    <span class={cn("truncate", mobileLayout ? "text-sm" : "text-[0.8rem]")}>{group.name}</span>
                    <ChevronRight size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} class="justify-self-end text-popover-foreground/60" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {:else if !mainProjectGroup}
          <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
            {t("projects.navigator.empty")}
          </div>
        {:else if mainProjects.length === 0}
          <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
            {t("calendar.eventPanel.noProjectsFound")}
          </div>
        {:else}
          <div class="grid px-1">
            {#each mainProjects as project (project.id)}
              <div class="px-1">
                <button
                  type="button"
                  class={cn(
                    "w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-accent hover:text-accent-foreground",
                    mobileLayout ? "min-h-12 px-3 text-sm active:bg-accent" : "min-h-8 px-2 text-[0.8rem]",
                    projectRowsHaveChildren
                      ? mobileLayout
                        ? "grid grid-cols-[1.5rem_minmax(0,1fr)_auto]"
                        : "grid grid-cols-[1rem_minmax(0,1fr)_auto]"
                      : "flex",
                    project.status === "active" ? "text-popover-foreground" : "text-popover-foreground/60",
                    activeProjectId === project.id && "bg-accent text-accent-foreground",
                  )}
                  aria-label={t("projects.actions.selectProject", project.name, mainProjectGroup.name)}
                  onpointerenter={(event) => handleProjectPointerEnter(project, event)}
                  onpointermove={(event) => handleProjectPointerMove(project, event)}
                  onpointerleave={handleProjectPointerLeave}
                  onfocus={(event) => previewProject(project, event.currentTarget)}
                  onclick={() => { void activateProject(project); }}
                >
                  <ProjectIcon name={project.icon} size={iconSize} strokeWidth={iconStrokeWidth} emojiScale={EMOJI_SCALE} class="shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{project.name}</span>
                  {#if projectRowsHaveChildren || (showLifecycleBadges && project.status !== "active")}
                    <span class="flex min-w-0 items-center justify-end gap-1">
                      {#if showLifecycleBadges && project.status !== "active"}
                        <span class={cn("shrink-0 rounded border px-1.5 py-0.5 text-[0.666667rem]", projectLifecycleBadgeClass(project.status))}>
                          {projectLifecycleLabel(project.status, t)}
                        </span>
                      {/if}
                      {#if projectRowsHaveChildren}<ChevronRight size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/60" />{/if}
                    </span>
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    {#if !mobileLayout}
      <CalendarScrollbar
        scrollContainer={groupScrollElement}
        stickyTop={4}
        stickyBottom={4}
        wheelPassthrough
      />
    {/if}
  </div>

  {#if !searchActive}
    <div
      bind:this={panelFooterElement}
      class={cn(
        "relative z-10 shrink-0 bg-popover",
        mobileLayout ? "max-h-[55%] overflow-y-auto overscroll-contain p-2" : "p-1.5",
      )}
    >
      <div class="pointer-events-none absolute left-1.5 right-1.5 top-0 border-t border-border/70"></div>
      {#if mode === "groups" && (!mobileLayout || !activeGroup)}
        {#if createGroupOpen}
          <form class={cn("flex gap-1", mobileLayout && "gap-2")} onsubmit={(event) => { event.preventDefault(); void submitGroup(); }}>
            <input
              bind:value={groupDraft}
              placeholder={t("projects.navigator.groupNamePlaceholder")}
              class={cn(
                "min-w-0 flex-1 border border-border bg-muted/40 text-popover-foreground placeholder:text-popover-foreground/45",
                mobileLayout ? "min-h-12 rounded-xl px-3 text-base" : "min-h-8 rounded px-2 text-[0.8rem]",
              )}
            />
            <button
              type="submit"
              class={cn(
                "bg-primary font-medium text-primary-foreground",
                mobileLayout ? "min-h-12 rounded-xl px-4 text-sm" : "min-h-8 rounded px-2 text-[0.733333rem]",
              )}
            >
              {t("common.save")}
            </button>
            {#if mobileLayout}
              <button
                type="button"
                class="flex min-h-12 min-w-12 items-center justify-center rounded-xl active:bg-accent"
                aria-label={t("common.cancel")}
                onclick={closeMobileGroupCreator}
              >
                <X size={18} strokeWidth={iconStrokeWidth} aria-hidden="true" />
              </button>
            {/if}
          </form>
        {:else}
          <button
            type="button"
            data-mobile-create-project-group={mobileLayout ? "true" : undefined}
            class={cn(
              "flex w-full items-center justify-center gap-1.5 text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              mobileLayout ? "min-h-12 rounded-xl text-sm active:bg-accent" : "min-h-8 rounded-md text-[0.8rem]",
            )}
            onclick={() => { createGroupOpen = true; }}
          >
            <Plus size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} />
            <span>{t("calendar.eventPanel.createGroup")}</span>
          </button>
        {/if}
      {:else if mainProjectGroup}
        {#if createProjectGroupId === mainProjectGroup.id}
          <form class={cn("grid gap-1", mobileLayout && "gap-2")} onsubmit={(event) => { event.preventDefault(); void submitProject(mainProjectGroup.id); }}>
            <div class={cn("flex gap-1", mobileLayout && "gap-2")}>
              <input
                value={projectDraftByGroup[mainProjectGroup.id] ?? ""}
                oninput={(event) => {
                  projectDraftByGroup = {
                    ...projectDraftByGroup,
                    [mainProjectGroup.id]: event.currentTarget.value,
                  };
                }}
                placeholder={t("projects.navigator.projectNamePlaceholder")}
                class={cn(
                  "min-w-0 flex-1 border border-border bg-muted/40 text-popover-foreground placeholder:text-popover-foreground/45",
                  mobileLayout ? "min-h-12 rounded-xl px-3 text-base" : "min-h-7 rounded px-2 text-[0.8rem]",
                )}
              />
              <button
                type="submit"
                class={cn(
                  "bg-primary font-medium text-primary-foreground",
                  mobileLayout ? "min-h-12 rounded-xl px-4 text-sm" : "min-h-7 rounded px-2 text-[0.733333rem]",
                )}
              >
                {t("common.save")}
              </button>
              {#if mobileLayout}
                <button
                  type="button"
                  class="flex min-h-12 min-w-12 items-center justify-center rounded-xl active:bg-accent"
                  aria-label={t("common.cancel")}
                  onclick={closeMobileProjectCreator}
                >
                  <X size={18} strokeWidth={iconStrokeWidth} aria-hidden="true" />
                </button>
              {/if}
            </div>
            <div class="flex flex-wrap gap-1" aria-label={t("projects.navigator.projectTemplate")}>
              {#each PROJECT_TEMPLATE_IDS as templateId}
                <button
                  type="button"
                  class={cn(
                    "rounded border",
                    mobileLayout ? "min-h-12 px-3 text-sm" : "min-h-6 px-1.5 text-[0.7rem]",
                    (projectTemplateDraftByGroup[mainProjectGroup.id] ?? "blank") === templateId
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-transparent text-popover-foreground/60 hover:bg-accent hover:text-accent-foreground",
                  )}
                  onclick={() => {
                    projectTemplateDraftByGroup = {
                      ...projectTemplateDraftByGroup,
                      [mainProjectGroup.id]: templateId,
                    };
                  }}
                >
                  {projectTemplateLabel(templateId)}
                </button>
              {/each}
            </div>
            <p class={cn("text-popover-foreground/55", mobileLayout ? "text-xs leading-5" : "text-[0.66rem] leading-4")}>{t("projects.navigator.managedFolderCreationHint")}</p>
          </form>
        {:else}
          <button
            type="button"
            data-mobile-create-project={mobileLayout ? "true" : undefined}
            class={cn(
              "flex w-full items-center justify-center gap-1.5 text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              mobileLayout ? "min-h-12 rounded-xl text-sm active:bg-accent" : "min-h-8 rounded-md text-[0.8rem]",
            )}
            onclick={() => {
              createProjectGroupId = mainProjectGroup.id;
            }}
          >
            <Plus size={mobileLayout ? 18 : 13} strokeWidth={iconStrokeWidth} />
            <span>{t("calendar.eventPanel.createProject")}</span>
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if !mobileLayout && mode === "groups" && !searchActive && activeGroup && activeGroupAnchorElement}
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
                <button
                  type="button"
                  class={cn(
                    "min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[0.8rem] transition-colors hover:bg-accent hover:text-accent-foreground",
                    showProjectChildren
                      ? "grid grid-cols-[1rem_minmax(0,1fr)_auto]"
                      : "flex",
                    project.status === "active" ? "text-popover-foreground" : "text-popover-foreground/60",
                    activeProjectId === project.id && "bg-accent text-accent-foreground",
                  )}
                  aria-label={t("projects.actions.selectProject", project.name, activeGroup.name)}
                  onpointerenter={(event) => handleProjectPointerEnter(project, event)}
                  onpointermove={(event) => handleProjectPointerMove(project, event)}
                  onpointerleave={handleProjectPointerLeave}
                  onfocus={(event) => previewProject(project, event.currentTarget)}
                  onclick={() => { void activateProject(project); }}
                >
                  <ProjectIcon name={project.icon} size={iconSize} strokeWidth={iconStrokeWidth} emojiScale={EMOJI_SCALE} class="shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{project.name}</span>
                  {#if showProjectChildren || (showLifecycleBadges && project.status !== "active")}
                    <span class="flex min-w-0 items-center justify-end gap-1">
                      {#if showLifecycleBadges && project.status !== "active"}
                        <span class={cn("shrink-0 rounded border px-1.5 py-0.5 text-[0.666667rem]", projectLifecycleBadgeClass(project.status))}>
                          {projectLifecycleLabel(project.status, t)}
                        </span>
                      {/if}
                      {#if showProjectChildren}<ChevronRight size={13} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/60" />{/if}
                    </span>
                  {/if}
                </button>
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
          <p class="text-[0.66rem] leading-4 text-popover-foreground/55">{t("projects.navigator.managedFolderCreationHint")}</p>
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
    -webkit-mask-image: linear-gradient(to bottom, black, black calc(100% - var(--project-picker-scroll-fade)), transparent);
    mask-image: linear-gradient(to bottom, black, black calc(100% - var(--project-picker-scroll-fade)), transparent);
  }

  .project-picker-scroll-both {
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent,
      black var(--project-picker-scroll-fade),
      black calc(100% - var(--project-picker-scroll-fade)),
      transparent
    );
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black var(--project-picker-scroll-fade),
      black calc(100% - var(--project-picker-scroll-fade)),
      transparent
    );
  }
</style>

<script lang="ts">
  import { untrack } from "svelte";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import UserRoundPlus from "@lucide/svelte/icons/user-round-plus";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getChat } from "$lib/stores/chat.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { overflowTooltip } from "$lib/utils/overflow-tooltip";
  import AddContactDialog from "./AddContactDialog.svelte";
  import {
    PEOPLE_CAPABILITIES,
    PEOPLE_CAPABILITY_GROUPS,
    PEOPLE_HISTORY_BOUNDARIES,
    PEOPLE_INVITABLE_ROLES,
    capabilitiesForRole,
    type PeopleCapability,
    type PeopleHistoryBoundary,
    type PeopleRole,
    type PeopleSpaceSummary,
  } from "./model";
  import PeopleDialog from "./PeopleDialog.svelte";
  import PeopleSpacePicker from "./PeopleSpacePicker.svelte";
  import { summarizeSpaceSelection, type PeopleSpaceNode, type PeopleSpaceSummaryEntry } from "./space-selection";

  /**
   * Invitation dialog shared by channels, projects, groups, pages, and events. Groups, projects, and channels are
   * chosen in the cascading space picker; a page, event, or conversation is fixed by the opener.
   */
  let {
    space = null,
    showHistory = true,
    onClose,
  }: {
    space?: PeopleSpaceSummary | null;
    showHistory?: boolean;
    onClose: () => void;
  } = $props();

  const ADD_CONTACT_OPTION = "add-contact";
  const SPACE_PATH_SEPARATOR = " / ";
  const { t } = getLocalization();
  const projects = getProjects();
  const chat = getChat();

  const tree = $derived.by((): PeopleSpaceNode[] => {
    const groups = projects.visibleGroups();
    const groupIds = new Set(groups.map((group) => group.id));
    const activeProjects = projects.projects.filter((project) => project.status === "active" && groupIds.has(project.groupId));
    const projectIds = new Set(activeProjects.map((project) => project.id));
    return [
      ...groups.map((group): PeopleSpaceNode => ({ id: group.id, kind: "group", name: group.name, parentId: null })),
      ...activeProjects.map((project): PeopleSpaceNode => ({ id: project.id, kind: "project", name: project.name, parentId: project.groupId })),
      ...chat.activeChannels
        .filter((channel) => channel.archivedAt === null && projectIds.has(channel.projectId))
        .map((channel): PeopleSpaceNode => ({ id: channel.id, kind: "channel", name: channel.name, parentId: channel.projectId })),
    ];
  });
  const pickableSpace = $derived(space?.id !== undefined && tree.some((node) => node.id === space.id));
  const fixedSpace = $derived(space && !pickableSpace ? space : null);

  let selectedSpaces = $state<ReadonlySet<string>>(new Set());
  let spacesAction = $state<HTMLButtonElement | null>(null);
  let spacePickerOpen = $state(false);
  let role = $state<PeopleRole>("member");
  let history = $state<PeopleHistoryBoundary>("fromAcceptance");
  let capabilities = $state<ReadonlySet<PeopleCapability>>(capabilitiesForRole("member"));
  let message = $state("");
  let addContactOpen = $state(false);

  untrack(() => {
    if (space?.id !== undefined && pickableSpace) selectedSpaces = new Set([space.id]);
  });

  const spaceSummary = $derived(summarizeSpaceSelection(tree, selectedSpaces));
  /** One path per covered space, in the same shape as the picker's search results, so the summary reads at the dialog's size. */
  const spaceLines = $derived.by((): string[] => {
    if (fixedSpace) return [[t(`people.space.${fixedSpace.kind}`), fixedSpace.name].join(SPACE_PATH_SEPARATOR)];
    if (spaceSummary.length === 0) return [t("people.invite.noSpaces")];
    return spaceSummary.flatMap((group) => {
      if (group.whole) return [[group.node.name, ...(group.childCount > 0 ? [wholeLabel(group)] : [])].join(SPACE_PATH_SEPARATOR)];
      return group.children.flatMap((project) => {
        const projectPath = [group.node.name, project.node.name];
        if (project.whole) return [[...projectPath, ...(project.childCount > 0 ? [wholeLabel(project)] : [])].join(SPACE_PATH_SEPARATOR)];
        return project.children.map((channel) => [...projectPath, `#${channel.node.name}`].join(SPACE_PATH_SEPARATOR));
      });
    });
  });
  const personOptions = $derived([{ value: ADD_CONTACT_OPTION, label: t("people.invite.addContact") }]);
  const roleOptions = $derived(PEOPLE_INVITABLE_ROLES.map((value) => ({ value, label: t(`people.role.${value}`) })));
  const historyOptions = $derived(PEOPLE_HISTORY_BOUNDARIES.map((value) => ({ value, label: t(`people.history.${value}`) })));

  function isRole(value: string): value is PeopleRole {
    return (PEOPLE_INVITABLE_ROLES as readonly string[]).includes(value);
  }

  function isHistory(value: string): value is PeopleHistoryBoundary {
    return (PEOPLE_HISTORY_BOUNDARIES as readonly string[]).includes(value);
  }

  function changeRole(value: string): void {
    if (!isRole(value)) return;
    role = value;
    capabilities = capabilitiesForRole(value);
  }

  function toggleCapability(capability: PeopleCapability, checked: boolean): void {
    const next = new Set(capabilities);
    if (checked) next.add(capability);
    else next.delete(capability);
    capabilities = next;
  }

  function wholeLabel(entry: PeopleSpaceSummaryEntry): string {
    return entry.node.kind === "group" ? t("people.invite.allProjects") : t("people.invite.allChannels");
  }

  function closeSpacePicker(): void {
    spacePickerOpen = false;
    spacesAction?.focus();
  }
</script>

<PeopleDialog
  title={t("people.invite.title")}
  cancelLabel={t("people.invite.cancel")}
  confirmLabel={t("people.invite.send")}
  {onClose}
>
  <!-- Rows carry their own inline padding, so the negative margin keeps labels on the title's left edge. -->
  <div class="-mx-1 flex flex-col gap-2">
    <Select
      label={t("people.invite.person")}
      description={t("people.invite.noContacts")}
      value=""
      triggerLabel={t("people.invite.personPlaceholder")}
      options={personOptions}
      showActiveCheck={false}
      onChange={(value) => { if (value === ADD_CONTACT_OPTION) addContactOpen = true; }}
    >
      {#snippet leading(value: string)}
        {#if value === ADD_CONTACT_OPTION}<UserRoundPlus size={14} class="shrink-0 text-muted-foreground" />{/if}
      {/snippet}
    </Select>

    <div class="flex flex-col gap-1 px-1 py-1">
      <div class="flex min-h-7 items-center justify-between gap-4">
        <span class="text-[0.866667rem] text-foreground">{t("people.invite.spaces")}</span>
        {#if !fixedSpace}
          <button
            bind:this={spacesAction}
            type="button"
            class="flex h-7 w-44 max-w-full items-center justify-between gap-2 rounded-md border border-border bg-transparent px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent"
            aria-haspopup="dialog"
            aria-expanded={spacePickerOpen}
            onclick={() => { spacePickerOpen = true; }}
          >
            <span class="truncate">{t("people.invite.editSpaces")}</span>
            <ChevronRight size={13} strokeWidth={2} class="shrink-0 text-muted-foreground" />
          </button>
        {/if}
      </div>
      <ul class="grid gap-0.5 text-[0.8rem] text-muted-foreground">
        {#each spaceLines as line (line)}
          <li class="truncate" use:overflowTooltip={line}>{line}</li>
        {/each}
      </ul>
    </div>

    <Select
      label={t("people.role.label")}
      value={role}
      options={roleOptions}
      onChange={changeRole}
    />

    {#if role === "custom"}
      {#each PEOPLE_CAPABILITY_GROUPS as group (group)}
        <div class="px-1 pt-1 text-[0.733333rem] font-medium text-muted-foreground">{t(`people.capability.group.${group}`)}</div>
        {#each PEOPLE_CAPABILITIES.filter((capability) => capability.group === group) as capability (capability.id)}
          <label class="flex cursor-pointer items-center justify-between gap-4 px-1 py-1">
            <span class="text-[0.866667rem] text-foreground">{t(`people.capability.${capability.id}`)}</span>
            <Checkbox checked={capabilities.has(capability.id)} onChange={(checked) => toggleCapability(capability.id, checked)} />
          </label>
        {/each}
      {/each}
    {/if}

    {#if showHistory}
      <Select
        label={t("people.history.label")}
        value={history}
        options={historyOptions}
        onChange={(value) => { if (isHistory(value)) history = value; }}
      />
    {/if}

    <label class="flex flex-col gap-1.5 px-1 py-1">
      <span class="text-[0.866667rem] text-foreground">{t("people.invite.message")}</span>
      <textarea bind:value={message} class="field min-h-20 resize-none text-[0.8rem]" placeholder={t("people.invite.messagePlaceholder")} maxlength="500" rows="3"></textarea>
    </label>
  </div>
</PeopleDialog>

{#if spacePickerOpen && spacesAction}
  <PeopleSpacePicker anchor={spacesAction} {tree} selected={selectedSpaces} onSelectionChange={(next) => { selectedSpaces = next; }} onClose={closeSpacePicker} />
{/if}

{#if addContactOpen}
  <AddContactDialog layer="second" onClose={() => { addContactOpen = false; }} />
{/if}

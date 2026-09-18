<script lang="ts">
  import type { Component } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import AppearanceSection from "./AppearanceSection.svelte";
  import ProfileSection from "./ProfileSection.svelte";
  import CalendarsSection from "./CalendarsSection.svelte";
  import ProjectsSection from "./ProjectsSection.svelte";
  import NotesSection from "./NotesSection.svelte";
  import ChatSection from "./ChatSection.svelte";
  import FocusSection from "./FocusSection.svelte";
  import MusicSection from "./MusicSection.svelte";
  import DoomscrollingSection from "./DoomscrollingSection.svelte";
  import UpdatesSection from "./UpdatesSection.svelte";
  import ShortcutsSection from "./ShortcutsSection.svelte";
  import AboutSection from "./AboutSection.svelte";
  import {
    getPreloadedDataSection,
    preloadDataSection,
  } from "./settings-sections";
  import type { SectionId } from "./types";
  import type { SettingsSectionRendererProps } from "./settings-section-renderer-contract";

  let {
    activeSection,
    initialDoomscrollingTab,
    activeChatSubsection,
    initialChatTeammateId,
    initialChatChannelId,
    initialChatCreateTeammate,
    onOpenDoomscrollingLimitEditor,
    onOpenNotesTransferPanel,
    onOpenChatProviderSetup,
    onChatSubsectionChange,
    onRequestNavigation,
    onTeammateDraftStateChange,
  }: SettingsSectionRendererProps = $props();

  const { t } = getLocalization();
  let DataSection = $state<Component | null>(getPreloadedDataSection());
  let dataSectionLoadFailed = $state(false);

  function loadDataSection(): void {
    dataSectionLoadFailed = false;
    void preloadDataSection()
      .then((component) => { DataSection = component; })
      .catch(() => { dataSectionLoadFailed = true; });
  }

  if (getPreloadedDataSection() === null) loadDataSection();

  const BASIC_SECTION_COMPONENTS: Partial<Record<SectionId, Component>> = {
    appearance: AppearanceSection,
    profile: ProfileSection,
    calendars: CalendarsSection,
    projects: ProjectsSection,
    focus: FocusSection,
    music: MusicSection,
    updates: UpdatesSection,
    shortcuts: ShortcutsSection,
    about: AboutSection,
  };

  const activeBasicSection = $derived(BASIC_SECTION_COMPONENTS[activeSection]);
</script>

{#if activeSection === "notes"}
  <NotesSection onOpenTransferPanel={onOpenNotesTransferPanel} />
{:else if activeSection === "doomscrolling"}
  <DoomscrollingSection
    initialTab={initialDoomscrollingTab}
    onOpenLimitEditor={onOpenDoomscrollingLimitEditor}
  />
{:else if activeSection === "chat"}
  <ChatSection
    initialSubsection={activeChatSubsection}
    {initialChatTeammateId}
    {initialChatChannelId}
    {initialChatCreateTeammate}
    onOpenProviderSetup={onOpenChatProviderSetup}
    onSubsectionChange={onChatSubsectionChange}
    {onRequestNavigation}
    {onTeammateDraftStateChange}
  />
{:else if activeSection === "data"}
  {#if DataSection}
    <DataSection />
  {:else if dataSectionLoadFailed}
    <div class="flex min-h-36 flex-col items-center justify-center gap-3 text-sm text-destructive" role="alert">
      <span>{t("common.viewLoadFailed", t("settings.section.data"))}</span>
      <button type="button" class="rounded-md border border-border px-3 py-1.5 text-foreground" onclick={loadDataSection}>
        {t("common.retry")}
      </button>
    </div>
  {:else}
    <div class="flex min-h-36 items-center justify-center text-sm text-muted-foreground" aria-busy="true">
      {t("common.loading")}
    </div>
  {/if}
{:else if activeBasicSection}
  {@const SectionComponent = activeBasicSection}
  <SectionComponent />
{/if}

<script lang="ts">
  import type { Component } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import AppearanceSection from "$lib/components/settings/sections/AppearanceSection.svelte";
  import ProfileSection from "$lib/components/settings/sections/ProfileSection.svelte";
  import CalendarsSection from "$lib/components/settings/sections/CalendarsSection.svelte";
  import ProjectsSection from "$lib/components/settings/sections/ProjectsSection.svelte";
  import NotesSection from "$lib/components/settings/sections/NotesSection.svelte";
  import ChatSection from "$lib/components/settings/sections/ChatSection.svelte";
  import FocusSection from "$lib/components/settings/sections/FocusSection.svelte";
  import MusicSection from "$lib/components/settings/sections/MusicSection.svelte";
  import DistractionsSection from "$lib/components/settings/distractions/DistractionsSection.svelte";
  import UpdatesSection from "$lib/components/settings/sections/UpdatesSection.svelte";
  import ShortcutsSection from "$lib/components/settings/sections/ShortcutsSection.svelte";
  import AboutSection from "$lib/components/settings/sections/AboutSection.svelte";
  import {
    getPreloadedDataSection,
    preloadDataSection,
  } from "./section-catalog";
  import type { SectionId } from "$lib/settings/types";
  import type { SettingsSectionRendererProps } from "./section-renderer-contracts";

  let {
    activeSection,
    initialDistractionsTab,
    activeChatSubsection,
    initialChatTeammateId,
    initialChatChannelId,
    initialChatCreateTeammate,
    onOpenDistractionsLimitEditor,
    onOpenNotesTransferPanel,
    onOpenChatProviderSetup,
    onChatSubsectionChange,
    onRequestNavigation,
    onDraftStateChange,
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

{#if activeSection === "profile"}
  <ProfileSection {onDraftStateChange} />
{:else if activeSection === "notes"}
  <NotesSection onOpenTransferPanel={onOpenNotesTransferPanel} />
{:else if activeSection === "distractions"}
  <DistractionsSection
    initialTab={initialDistractionsTab}
    onOpenLimitEditor={onOpenDistractionsLimitEditor}
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
    onTeammateDraftStateChange={(open: boolean) => onDraftStateChange(open ? "teammate" : null)}
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

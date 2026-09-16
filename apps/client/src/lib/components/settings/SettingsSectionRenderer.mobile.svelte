<script lang="ts">
  import AppearanceSection from "./AppearanceSection.svelte";
  import ProfileSection from "./ProfileSection.svelte";
  import CalendarsSection from "./CalendarsSection.svelte";
  import ProjectsSection from "./ProjectsSection.svelte";
  import NotesSection from "./NotesSection.svelte";
  import AboutSection from "./AboutSection.svelte";
  import FocusSection from "./FocusSection.svelte";
  import DoomscrollingSection from "./DoomscrollingSection.svelte";
  import MobileDataSection from "./mobile/MobileDataSection.svelte";
  import type { SettingsSectionRendererProps } from "./settings-section-renderer-contract";

  let {
    activeSection,
    initialDoomscrollingTab,
    onOpenDoomscrollingLimitEditor,
  }: SettingsSectionRendererProps = $props();

</script>

{#if activeSection === "appearance"}
  <AppearanceSection />
{:else if activeSection === "profile"}
  <ProfileSection />
{:else if activeSection === "calendars"}
  <CalendarsSection fileTransfersAvailable={__GANBARU_AI_BUILD_PLATFORM__ === "android"} />
{:else if activeSection === "projects"}
  <ProjectsSection />
{:else if activeSection === "notes"}
  <NotesSection transfersAvailable={false} notificationsAvailable={false} />
{:else if activeSection === "chat"}
  {#await import("./mobile/MobileChatSection.svelte") then module}
    {@const MobileChatSection = module.default}
    <MobileChatSection />
  {/await}
{:else if activeSection === "focus"}
  <FocusSection>
    {#snippet backgroundExecutionSettings()}
      {#await import("./AndroidBackgroundExecutionSettings.svelte") then module}
        {@const AndroidBackgroundExecutionSettings = module.default}
        <AndroidBackgroundExecutionSettings />
      {/await}
    {/snippet}
  </FocusSection>
{:else if activeSection === "music"}
  {#await import("./MusicSection.svelte") then module}
    {@const MusicSettings = module.default}
    <MusicSettings />
  {/await}
{:else if activeSection === "doomscrolling"}
  <DoomscrollingSection
    initialTab={initialDoomscrollingTab}
    onOpenLimitEditor={onOpenDoomscrollingLimitEditor}
  />
{:else if activeSection === "data"}
  <MobileDataSection />
{:else if activeSection === "updates"}
  {#await import("./mobile/MobileUpdatesSection.svelte") then module}
    {@const MobileUpdatesSection = module.default}
    <MobileUpdatesSection />
  {/await}
{:else if activeSection === "about"}
  <AboutSection />
{/if}

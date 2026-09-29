import { ensureDbUrl } from "$lib/api/db";
import { getProjects } from "$lib/stores/projects.svelte";
import { getNotes } from "$lib/stores/notes.svelte";
import { getChat } from "$lib/stores/chat.svelte";

let preparation: Promise<void> | null = null;

/** Prepare the core workspace during onboarding, sharing concurrent startup requests. */
export function prepareDesktopWorkspace(): Promise<void> {
  if (preparation) return preparation;
  preparation = (async () => {
    await ensureDbUrl();
    const projects = getProjects();
    await projects.ensureLoaded();
    await Promise.all([
      getNotes().ensureLoaded(),
      getChat().prewarmForProject(projects.selectedProjectId),
    ]);
  })().finally(() => { preparation = null; });
  return preparation;
}

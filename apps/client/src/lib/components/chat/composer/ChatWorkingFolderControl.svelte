<script lang="ts">
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getChat } from "$lib/stores/chat.svelte";
  import ChatControlMenu from "./ChatControlMenu.svelte";

  const chat = getChat();
  const { t } = getLocalization();
  let saving = $state(false);
  let error = $state<string | null>(null);
  const channel = $derived(chat.selectedChannel);
  const folders = $derived(chat.workingFolders.filter((entry) => (
    entry.workingFolder.projectId === channel?.projectId
    && (
      entry.workingFolder.archivedAt === null
      || entry.workingFolder.id === chat.composer.workingFolderId
    )
  )));
  const folderOptions = $derived(folders.map((entry) => ({
    value: entry.workingFolder.id,
    label: entry.workingFolder.displayName,
    description: entry.canonicalPath ?? undefined,
    icon: "folder" as const,
    disabled: entry.workingFolder.archivedAt !== null,
  })));
  const busy = $derived([
    "pending", "dispatching", "active", "waiting_for_approval", "waiting_for_user_input",
  ].includes(chat.selectedThread?.latestTurnState ?? ""));

  async function selectFolder(workingFolderId: string): Promise<void> {
    if (!channel || saving || busy || workingFolderId === chat.composer.workingFolderId) return;
    if (chat.composer.attachmentIds.length > 0 || chat.composer.mentions.length > 0) {
      const confirmed = window.confirm(t("chat.channels.changeFolderDraftWarning"));
      if (!confirmed) return;
      chat.setComposerAttachments([]);
      chat.setComposerMentions([]);
    }
    saving = true;
    error = null;
    try {
      chat.newDraft(workingFolderId);
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }
</script>

<div class="folder-control">
  <ChatControlMenu
    value={chat.composer.workingFolderId ?? ""}
    options={folderOptions}
    ariaLabel={t("chat.channels.workingFolder")}
    onChange={(value) => void selectFolder(value)}
    disabled={!channel || busy || saving || folderOptions.length === 0}
    compact
    showTooltip={false}
  />
  {#if error}<p class="folder-error" role="alert">{error}</p>{/if}
</div>

<style>
  .folder-control { position: relative; min-width: 0; }
  .folder-control :global(.control-trigger) { max-width: 12rem; border: 1px solid color-mix(in srgb, var(--border) 75%, transparent); background: color-mix(in srgb, var(--card) 88%, transparent); }
  .folder-error { position: absolute; right: 0; bottom: calc(100% + 0.45rem); z-index: 60; width: min(18rem, calc(100vw - 1.5rem)); border: 1px solid color-mix(in srgb, var(--destructive) 45%, var(--border)); border-radius: 0.5rem; background: var(--popover); padding: 0.45rem 0.55rem; color: var(--destructive); font-size: calc(0.666667rem * var(--type-scale)); box-shadow: 0 10px 24px rgb(0 0 0 / 0.16); }
</style>

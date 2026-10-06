<script lang="ts">
  import { untrack } from "svelte";
  import Hash from "@lucide/svelte/icons/hash";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type { ChatChannelRead } from "$lib/chat/contracts";
  import type { ChatSidebarSection } from "$lib/chat/channel-sections";
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getChat } from "$lib/stores/chat.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";

  let {
    channel = null,
    sections,
    initialSectionId = null,
    onSaved,
    onCancel,
  }: {
    channel?: ChatChannelRead | null;
    sections: ChatSidebarSection[];
    initialSectionId?: string | null;
    onSaved: (channel: ChatChannelRead, sectionId: string | null) => void;
    onCancel: () => void;
  } = $props();

  const chat = getChat();
  const projects = getProjects();
  const { t } = getLocalization();
  let currentChannel = $state(untrack(() => channel));
  const projectId = $derived(currentChannel?.projectId ?? projects.selectedProjectId ?? "");
  const sectionOptions = $derived([
    { value: "", label: t("chat.channels.defaultSection") },
    ...sections.map((section) => ({ value: section.id, label: section.name })),
  ]);
  let name = $state(untrack(() => channel?.name ?? ""));
  let topic = $state(untrack(() => channel?.topic ?? ""));
  let sectionId = $state(untrack(() => initialSectionId ?? ""));
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function save(): Promise<void> {
    if (!projectId || saving) return;
    saving = true;
    error = null;
    try {
      let saved: ChatChannelRead;
      if (currentChannel) {
        saved = await chat.updateChannelDetails(currentChannel, name, topic);
        currentChannel = saved;
      } else {
        saved = await chat.createChannel({
          id: `channel:${crypto.randomUUID()}`,
          projectId,
          name,
          topic,
        });
      }
      onSaved(saved, sectionId || null);
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }
</script>

<div class="fixed inset-0 z-90 grid place-items-center surface-backdrop p-3">
  <button type="button" class="absolute inset-0" aria-label={t("chat.channels.cancel")} onclick={onCancel}></button>
  <form class="channel-dialog surface-dialog relative grid w-full max-w-lg gap-4 p-5" aria-labelledby="channel-dialog-title" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <header class="flex items-start gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-foreground"><Hash size={18} /></span>
      <div class="min-w-0">
        <h2 id="channel-dialog-title" class="font-semibold">{currentChannel ? t("chat.channels.editTitle") : t("chat.channels.createTitle")}</h2>
        <p class="mt-1 text-xs text-muted-foreground">{t("chat.channels.setupDescription")}</p>
      </div>
    </header>

    <div class="grid gap-3 sm:grid-cols-2">
      <label class="grid gap-1 text-xs font-medium sm:col-span-2">
        <span>{t("chat.channels.name")}</span>
        <div class="field flex h-9 items-center"><Hash size={14} class="text-muted-foreground" /><input class="field-bare px-1" bind:value={name} maxlength="80" required disabled={currentChannel?.isDefault} /></div>
        <small class="font-normal text-muted-foreground">{t("chat.channels.nameHint")}</small>
      </label>
      <label class="grid gap-1 text-xs font-medium sm:col-span-2">
        <span>{t("chat.channels.topic")}</span>
        <textarea class="field min-h-18 resize-y py-1.5 font-normal" bind:value={topic} maxlength="250"></textarea>
      </label>
      <div class="grid gap-1 text-xs font-medium sm:col-span-2">
        <span>{t("chat.channels.section")}</span>
        <Select inline class="w-full" value={sectionId} options={sectionOptions} ariaLabel={t("chat.channels.section")} onChange={(value) => { sectionId = value; }} />
      </div>
    </div>

    {#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
    <footer class="flex justify-end gap-2">
      <button type="button" class="chat-secondary-button" onclick={onCancel}>{t("chat.channels.cancel")}</button>
      <button type="submit" class="chat-primary-button" disabled={saving || !name.trim()}>{#if saving}<LoaderCircle size={14} class="animate-spin" />{/if}{currentChannel ? t("chat.channels.save") : t("chat.channels.create")}</button>
    </footer>
  </form>
</div>

<style>
  .channel-dialog { max-height: min(42rem, calc(100vh - 1.5rem)); overflow-y: auto; }
</style>

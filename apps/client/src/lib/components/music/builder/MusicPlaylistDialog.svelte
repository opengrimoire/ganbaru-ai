<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import IconPicker from "$lib/components/icon-picker/IconPicker.svelte";
  import MusicPlaylistIcon from "./MusicPlaylistIcon.svelte";
  import MusicBuilderDialog from "./MusicBuilderDialog.svelte";
  import type { MusicPlaylistController, MusicPlaylistDraft } from "$lib/music/music-playlist-controller.svelte";
  import type { MusicIntendedUse, MusicRepeatMode } from "$lib/music/library-contracts";
  import { isSystemMusicPlaylistId, systemMusicPlaylistName } from "$lib/music/music-system-playlists";

  let {
    controller,
    mode,
    onClose,
    onSaved,
    onDeleted = () => undefined,
    playlists = [],
    activeInPlayer = false,
  }: {
    controller: MusicPlaylistController;
    mode: "create" | "edit" | "duplicate" | "delete";
    onClose: () => void;
    onSaved: (playlistId: string) => void;
    onDeleted?: (replacementPlaylistId: string | null) => void;
    playlists?: import("$lib/music/library-contracts").MusicPlaylistSummary[];
    activeInPlayer?: boolean;
  } = $props();

  const { t } = getLocalization();
  let name = $state("");
  let icon = $state("lucide:list-music");
  let shuffleEnabled = $state(true);
  let repeatMode = $state<MusicRepeatMode>("all");
  let intendedUses = $state<MusicIntendedUse[]>([]);
  let replacementPlaylistId = $state("");
  const useOptions: MusicIntendedUse[] = ["general", "focus", "reading", "relaxation", "energizing"];
  const protectedIdentity = $derived(Boolean(controller.detail && isSystemMusicPlaylistId(controller.detail.id)));

  onMount(() => {
    const detail = controller.detail;
    if (detail) {
      const displayName = systemMusicPlaylistName(detail.id, detail.name, t);
      name = mode === "duplicate" ? t("music.builder.playlistCopyName", displayName) : displayName;
      icon = detail.icon;
      shuffleEnabled = detail.shuffleEnabled;
      repeatMode = detail.repeatMode;
      intendedUses = [...detail.intendedUses];
      if (mode === "delete" && !controller.deleteImpact) void controller.inspectDelete();
    }
  });

  function title(): string {
    if (mode === "create") return t("music.builder.createPlaylistTitle");
    if (mode === "edit") return t("music.builder.editPlaylistTitle");
    if (mode === "duplicate") return t("music.builder.duplicatePlaylistTitle");
    return t("music.builder.deletePlaylistTitle");
  }

  function toggleUse(use: MusicIntendedUse): void {
    intendedUses = intendedUses.includes(use)
      ? intendedUses.filter((entry) => entry !== use)
      : [...intendedUses, use];
  }

  function useLabel(use: MusicIntendedUse): string {
    return t(`music.builder.intendedUse.${use}`);
  }

  async function save(): Promise<void> {
    if (mode === "delete") {
      const replacement = replacementPlaylistId || null;
      if (await controller.remove(replacement)) onDeleted(replacement);
      return;
    }
    const draft: MusicPlaylistDraft = { name, icon, shuffleEnabled, repeatMode, intendedUses };
    if (mode === "create") {
      const playlistId = await controller.create(draft);
      if (playlistId) onSaved(playlistId);
      return;
    }
    if (mode === "duplicate") {
      const playlistId = await controller.duplicate(name);
      if (playlistId) onSaved(playlistId);
      return;
    }
    if (await controller.update(draft) && controller.detail) onSaved(controller.detail.id);
  }
</script>

<MusicBuilderDialog
  title={title()}
  titleId="music-playlist-dialog-title"
  size="small"
  role={mode === "delete" ? "alertdialog" : "dialog"}
  dismissDisabled={controller.saving}
  onDismiss={onClose}
>
    <div>
      {#if mode === "delete"}
        {#if controller.deleteImpact}
          <p class="text-xs leading-relaxed">{t("music.builder.deletePlaylistWarning", controller.detail?.name ?? "")}</p>
          <dl class="mt-3 grid grid-cols-2 border-y border-border py-2 text-xs sm:grid-cols-3">
            <div class="py-1"><dt class="text-muted-foreground">{t("music.builder.memberships")}</dt><dd class="font-semibold">{controller.deleteImpact.membershipCount}</dd></div>
            <div class="py-1"><dt class="text-muted-foreground">{t("music.builder.projectAssignments")}</dt><dd class="font-semibold">{controller.deleteImpact.projectFocusAssignmentCount + controller.deleteImpact.projectBreakAssignmentCount}</dd></div>
            <div class="py-1"><dt class="text-muted-foreground">{t("music.builder.eventAssignments")}</dt><dd class="font-semibold">{controller.deleteImpact.calendarAssignmentCount}</dd></div>
            <div class="py-1"><dt class="text-muted-foreground">{t("music.builder.contextAssignments")}</dt><dd class="font-semibold">{controller.deleteImpact.contextAssignmentCount}</dd></div>
            <div class="py-1"><dt class="text-muted-foreground">{t("music.builder.mediaFilesDeleted")}</dt><dd class="font-semibold">0</dd></div>
          </dl>
          <p class="mt-3 text-xs leading-relaxed text-warning">{t("music.builder.deleteAssignmentFallback")}</p>
          {#if activeInPlayer}<p class="mt-2 text-xs leading-relaxed text-muted-foreground">{t("music.builder.activePlaylistDeleteBehavior")}</p>{/if}
          {#if controller.deleteImpact.assignments.length > 0}
            <div class="mt-3 max-h-32 divide-y divide-border overflow-y-auto border-y border-border" data-music-scrollable="true">
              {#each controller.deleteImpact.assignments as assignment (`${assignment.kind}:${assignment.id}`)}
                <div class="flex min-w-0 items-center gap-2 py-2 text-xs"><span class="shrink-0 text-muted-foreground">{t(`music.builder.assignmentKind.${assignment.kind}`)}</span><span class="min-w-0 flex-1 truncate" title={assignment.label}>{assignment.label || assignment.id}</span></div>
              {/each}
            </div>
          {/if}
          {#if controller.deleteImpact.projectFocusAssignmentCount + controller.deleteImpact.projectBreakAssignmentCount + controller.deleteImpact.calendarAssignmentCount + controller.deleteImpact.contextAssignmentCount > 0}
            <label class="mt-3 block text-[0.7rem] font-medium" for="music-delete-replacement">{t("music.builder.replacementPlaylist")}</label>
            <select id="music-delete-replacement" bind:value={replacementPlaylistId} class="mt-1.5 h-9 w-full rounded-md border border-border/70 bg-background px-2 text-xs">
              <option value="">{t("music.builder.safeNoPlaylist")}</option>
              {#each playlists.filter((entry) => entry.id !== controller.detail?.id) as playlist}<option value={playlist.id}>{systemMusicPlaylistName(playlist.id, playlist.name, t)}</option>{/each}
            </select>
          {/if}
        {:else}
          <div class="h-28 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none"></div>
        {/if}
      {:else}
        <label class="block text-[0.7rem] font-medium" for="music-playlist-name">{t("music.builder.playlistName")}</label>
        <div class="mt-1.5 flex items-center gap-2">
          {#if mode !== "duplicate" && !protectedIdentity}
            <IconPicker value={icon} onChange={(value) => icon = value} ariaLabel={t("music.builder.selectPlaylistIcon")} showUpload={false}>
              {#snippet trigger({ open, toggle, panelId })}
                <button
                  type="button"
                  class={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground transition-colors hover:bg-accent ${open ? "bg-accent" : ""}`}
                  aria-label={t("music.builder.selectPlaylistIcon")}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onclick={toggle}
                >
                  <MusicPlaylistIcon {icon} size={18} strokeWidth={1.6} />
                </button>
              {/snippet}
            </IconPicker>
          {/if}
          <input data-dialog-autofocus id="music-playlist-name" bind:value={name} disabled={protectedIdentity && mode === "edit"} class="h-9 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-3 text-xs outline-none focus:border-primary disabled:opacity-60" />
        </div>
        {#if mode !== "duplicate"}
          <fieldset class="mt-4"><legend class="text-xs font-medium">{t("music.builder.intendedUses")}</legend><div class="mt-2 flex flex-wrap gap-x-4 gap-y-2">{#each useOptions as use}<label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={intendedUses.includes(use)} onchange={() => toggleUse(use)} class="accent-primary" />{useLabel(use)}</label>{/each}</div></fieldset>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={shuffleEnabled} class="accent-primary" />{t("music.builder.shuffleDefault")}</label>
            <label class="text-[0.68rem]"><span class="block font-medium">{t("music.builder.repeatDefault")}</span><select bind:value={repeatMode} class="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2"><option value="off">{t("music.builder.repeatOff")}</option><option value="all">{t("music.builder.repeatAll")}</option><option value="one">{t("music.builder.repeatOne")}</option></select></label>
          </div>
        {/if}
      {/if}
      {#if controller.error}<p class="mt-3 text-[0.68rem] text-destructive" role="alert">{controller.error}</p>{/if}
    </div>

    {#snippet footer()}
      <button type="button" onclick={onClose} disabled={controller.saving} class="min-h-10 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50">{t("music.builder.cancel")}</button>
      <button type="button" onclick={() => { void save(); }} disabled={controller.saving || (mode !== "delete" && !name.trim()) || (mode === "delete" && !controller.deleteImpact)} class={mode === "delete" ? "min-h-10 rounded-md border border-destructive bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50" : "min-h-10 rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"}>{mode === "delete" ? t("music.builder.deletePlaylist") : t("music.builder.savePlaylist")}</button>
    {/snippet}
</MusicBuilderDialog>

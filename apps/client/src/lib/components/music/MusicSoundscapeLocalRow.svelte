<script lang="ts">
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Minus from "@lucide/svelte/icons/minus";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import { onMount } from "svelte";
  import { revealLocalFile } from "$lib/api/music";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { MusicSoundscapeDefinition } from "$lib/music/soundscape-contracts";
  import { getSoundscapeStore } from "$lib/stores/soundscape.svelte";

  let { definition, onRepair, onRemove, onPlaybackStart }: {
    definition: MusicSoundscapeDefinition;
    onRepair: (definition: MusicSoundscapeDefinition) => void;
    onRemove: (definition: MusicSoundscapeDefinition) => void;
    onPlaybackStart: () => void;
  } = $props();
  const { t } = getLocalization();
  const soundscape = getSoundscapeStore();
  let root = $state<HTMLElement | null>(null);
  let menuOpen = $state(false);
  let renaming = $state(false);
  let nameDraft = $state("");
  const selected = $derived(soundscape.persisted?.activeIds.includes(definition.id) ?? false);
  const playing = $derived(selected && soundscape.snapshot.status === "playing");
  const layered = $derived(soundscape.persisted?.multipleEnabled ?? false);

  onMount(() => {
    const close = (event: PointerEvent) => { if (menuOpen && root && !root.contains(event.target as Node)) menuOpen = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { menuOpen = false; renaming = false; } };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", escape, true); };
  });

  async function saveName(): Promise<void> {
    const name = nameDraft.trim();
    if (!name) return;
    try {
      await soundscape.saveDefinition({
        id: definition.id,
        sourceKind: definition.sourceKind,
        generatedKind: definition.generatedKind,
        bundledIdentity: definition.bundledIdentity,
        name,
        groupId: definition.groupId,
        localPath: definition.localPath,
        expectedVersion: definition.version,
        updatedAt: Date.now(),
      });
      renaming = false;
    } catch (error) {
      console.error("Could not rename background sound", error);
    }
  }

  async function moveToGroup(groupId: string | null): Promise<void> {
    menuOpen = false;
    if (definition.groupId === groupId) return;
    try {
      await soundscape.saveDefinition({
        id: definition.id,
        sourceKind: definition.sourceKind,
        generatedKind: definition.generatedKind,
        bundledIdentity: definition.bundledIdentity,
        name: definition.name,
        groupId,
        localPath: definition.localPath,
        expectedVersion: definition.version,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error("Could not move background sound", error);
    }
  }
</script>

<div bind:this={root} class={selected ? "relative flex min-h-11 items-center gap-2 rounded-lg bg-primary/5 px-2 transition-colors hover:bg-accent/40" : "relative flex min-h-11 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-accent/40"}>
  {#if renaming}
    <form class="flex min-w-0 flex-1 gap-2" onsubmit={(event) => { event.preventDefault(); void saveName(); }}>
      <input class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none" bind:value={nameDraft} aria-label={t("music.soundscape.name")} maxlength="200" />
      <button type="submit" disabled={!nameDraft.trim() || soundscape.saving} class="rounded-md bg-secondary px-2 text-xs disabled:opacity-40">{t("music.soundscape.saveName")}</button>
    </form>
  {:else}
    <span class="min-w-0 flex-1 truncate text-xs">{definition.name}</span>
    {#if definition.availability !== "available"}<button type="button" class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" onclick={() => onRepair(definition)}>{t("music.soundscape.repair")}</button>
    {:else}<button type="button" disabled={soundscape.saving} class="grid h-8 w-8 place-items-center rounded-lg hover:bg-accent disabled:opacity-40" aria-label={selected && layered ? t("music.soundscape.stop", definition.name) : playing ? t("music.soundscape.pause") : t("music.soundscape.play", definition.name)} onclick={() => { if (!playing) onPlaybackStart(); void soundscape.toggleSelection(definition.id); }}>{#if selected && layered}<Minus size={15} />{:else if playing}<Pause size={15} />{:else}<Play size={15} />{/if}</button>{/if}
    <button type="button" aria-label={t("music.soundscape.soundActions", definition.name)} aria-expanded={menuOpen} class="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" onclick={() => menuOpen = !menuOpen}><Ellipsis size={16} /></button>
  {/if}
  {#if menuOpen}
    <div class="absolute right-1 top-9 z-10 min-w-36 rounded-lg border border-border bg-popover p-1 shadow-md">
      <button type="button" class="block h-8 w-full rounded-md px-2 text-left text-xs hover:bg-accent" onclick={() => { menuOpen = false; nameDraft = definition.name; renaming = true; }}>{t("music.soundscape.rename")}</button>
      {#if definition.localPath}<button type="button" class="block h-8 w-full rounded-md px-2 text-left text-xs hover:bg-accent" onclick={() => { menuOpen = false; if (definition.localPath) void revealLocalFile(definition.localPath); }}>{t("music.soundscape.showFile")}</button>{/if}
      {#if soundscape.groups.length > 0}
        <p class="px-2 pt-2 text-[0.65rem] text-muted-foreground">{t("music.soundscape.moveToGroup")}</p>
        <div class="max-h-32 overflow-y-auto" data-music-scrollable="true">
          <button type="button" class="block h-8 w-full truncate rounded-md px-2 text-left text-xs hover:bg-accent" aria-current={definition.groupId === null ? "true" : undefined} onclick={() => { void moveToGroup(null); }}>{t("music.soundscape.ungrouped")}</button>
          {#each soundscape.groups as group (group.id)}<button type="button" class="block h-8 w-full truncate rounded-md px-2 text-left text-xs hover:bg-accent" aria-current={definition.groupId === group.id ? "true" : undefined} onclick={() => { void moveToGroup(group.id); }}>{group.name}</button>{/each}
        </div>
      {/if}
      <button type="button" class="block h-8 w-full rounded-md px-2 text-left text-xs text-destructive hover:bg-accent" onclick={() => { menuOpen = false; onRemove(definition); }}>{t("music.soundscape.remove")}</button>
    </div>
  {/if}
</div>

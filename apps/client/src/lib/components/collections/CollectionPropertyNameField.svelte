<script lang="ts">
  import { untrack } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { COLLECTION_PROPERTY_ICONS, type CollectionPropertyKind } from "./property-icons";

  /**
   * Shows a property's type icon and name at the top of its column menu, renaming it on Enter, blur, or when the menu closes.
   * A pristine draft follows canonical renames; an active or rejected draft is kept until the property itself changes.
   */
  let { propertyId, name, kind, editable = true, maxLength, onRename }: {
    propertyId: string;
    name: string;
    kind: CollectionPropertyKind;
    editable?: boolean;
    maxLength?: number;
    /** Persist the trimmed, changed name; a rejection keeps the draft and shows its message. */
    onRename: (name: string) => Promise<void>;
  } = $props();

  const { t } = getLocalization();
  const Icon = $derived(COLLECTION_PROPERTY_ICONS[kind]);
  let draft = $state(untrack(() => name));
  let canonical = $state(untrack(() => name));
  let draftPropertyId = $state(untrack(() => propertyId));
  let editing = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let generation = 0;

  $effect(() => {
    const currentId = propertyId;
    const currentName = name;
    const active = editing || saving || error !== null;
    untrack(() => {
      if (currentId !== draftPropertyId) {
        generation += 1;
        draftPropertyId = currentId;
        canonical = currentName;
        draft = currentName;
        editing = false;
        saving = false;
        error = null;
      } else if (!active && draft === canonical) {
        draft = currentName;
        canonical = currentName;
      }
    });
  });

  // Menus can close without blurring the field first; a draft whose save was already rejected is not retried.
  $effect(() => () => untrack(() => { if (!saving && error === null) void commit(); }));

  /** Save a changed name, restoring the canonical name when the draft is blank or unchanged. */
  async function commit(): Promise<void> {
    if (!editable || saving) return;
    const next = draft.trim();
    if (!next || next === canonical) {
      draft = canonical;
      error = null;
      return;
    }
    const current = ++generation;
    saving = true;
    error = null;
    try {
      await onRename(next);
      if (current === generation) {
        draft = next;
        canonical = next;
      }
    } catch (caught: unknown) {
      if (current === generation) error = t("collections.property.renameFailed", caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (current === generation) saving = false;
    }
  }
</script>

<div class="grid gap-1 pb-1.5">
  <div class="flex min-w-0 items-center gap-1.5">
    <span class="inline-flex size-8 shrink-0 items-center justify-center rounded border border-border text-muted-foreground">
      <Icon class="size-4" strokeWidth={1.75} aria-hidden="true" />
    </span>
    <input class="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[length:inherit] outline-none read-only:text-muted-foreground" aria-label={t("collections.property.name")}
      readonly={!editable || saving} maxlength={maxLength} bind:value={draft}
      onfocus={() => { editing = true; }}
      onblur={() => { editing = false; void commit(); }}
      onkeydown={(event) => {
        event.stopPropagation();
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        void commit();
      }} />
  </div>
  {#if error}<p role="alert" class="px-1 text-destructive">{error}</p>{/if}
</div>

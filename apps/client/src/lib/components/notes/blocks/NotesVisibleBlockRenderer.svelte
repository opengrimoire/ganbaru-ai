<script lang="ts">
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type {
    NotesBlockTreeItem,
    NotesColumnBlockItems,
    NotesTabBlockItems,
    NotesTableRowBlock,
  } from "$lib/notes/types";
  import type { NotesMoveToPageTarget } from "$lib/notes/blocks/move";
  import type { NotesTemplateBlockStatus } from "$lib/notes/block-types/template";
  import type { NotesButtonBlockStatus } from "$lib/notes/block-types/button";
  import NotesBlockRow from "./NotesBlockRow.svelte";
  import type NotesColumnListBlock from "./NotesColumnListBlock.svelte";
  import type NotesTabBlock from "./NotesTabBlock.svelte";
  import type {
    NotesBlockDragBindings,
    NotesBlockRenderActions,
    NotesBlockRenderLookups,
    NotesBlockRenderState,
    NotesColumnRenderActions,
    NotesTabRenderActions,
  } from "./render-contracts";

  let {
    item, state, actions, drag, lookups, columnActions, tabActions,
    columnItems, tabItems, tableRows, previousBlockType, isOnlyBlock,
    moveTargets, templateStatus, buttonStatus, columnComponent, tabComponent,
    columnFailed, tabFailed, retryStructural,
  }: {
    item: NotesBlockTreeItem;
    state: NotesBlockRenderState;
    actions: NotesBlockRenderActions;
    drag: NotesBlockDragBindings;
    lookups: NotesBlockRenderLookups;
    columnActions: NotesColumnRenderActions;
    tabActions: NotesTabRenderActions;
    columnItems: NotesColumnBlockItems[];
    tabItems: NotesTabBlockItems[];
    tableRows: NotesTableRowBlock[];
    previousBlockType: ReturnType<NotesBlockRenderLookups["previousBlockTypeForBlock"]>;
    isOnlyBlock: boolean;
    moveTargets: NotesMoveToPageTarget[];
    templateStatus: NotesTemplateBlockStatus;
    buttonStatus: NotesButtonBlockStatus;
    columnComponent: typeof NotesColumnListBlock | null;
    tabComponent: typeof NotesTabBlock | null;
    columnFailed: boolean;
    tabFailed: boolean;
    retryStructural: (kind: "column-list" | "tab") => void;
  } = $props();
  const { t } = getLocalization();
</script>

{#if item.block.type === "column_list"}
  {#if columnComponent}
    {@const Component = columnComponent}
    <Component
      {item} {columnItems} {...state} {...actions} {...drag} {...lookups} {...columnActions}
      {previousBlockType} {isOnlyBlock} {moveTargets}
      isDragging={drag.draggingBlockId === item.block.id}
      dropPosition={drag.dropPositionForBlock(item.block.id)}
    />
  {:else if columnFailed}
    <div class="my-1 rounded-md border border-destructive/40 p-2 text-[0.8rem] text-destructive" role="alert">
      <p>{t("common.viewLoadFailed", t("notes.blockType.columns"))}</p>
      <button class="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-accent" type="button" onclick={() => retryStructural("column-list")}>{t("common.retry")}</button>
    </div>
  {:else}<div class="my-1 min-h-8 text-[0.8rem] text-muted-foreground" aria-busy="true">{t("common.loading")}</div>{/if}
{:else if item.block.type === "tab"}
  {#if tabComponent}
    {@const Component = tabComponent}
    <Component
      {item} {tabItems} {...state} {...actions} {...drag} {...lookups} {...tabActions}
      {previousBlockType} {isOnlyBlock} {moveTargets}
      isDragging={drag.draggingBlockId === item.block.id}
      dropPosition={drag.dropPositionForBlock(item.block.id)}
    />
  {:else if tabFailed}
    <div class="my-1 rounded-md border border-destructive/40 p-2 text-[0.8rem] text-destructive" role="alert">
      <p>{t("common.viewLoadFailed", t("notes.blockType.tab"))}</p>
      <button class="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-accent" type="button" onclick={() => retryStructural("tab")}>{t("common.retry")}</button>
    </div>
  {:else}<div class="my-1 min-h-8 text-[0.8rem] text-muted-foreground" aria-busy="true">{t("common.loading")}</div>{/if}
{:else}
  <NotesBlockRow
    {item} {...state} {...actions} {tableRows} {previousBlockType} {isOnlyBlock}
    {moveTargets} {templateStatus} {buttonStatus}
    isDragging={drag.draggingBlockId === item.block.id}
    dropPosition={drag.dropPositionForBlock(item.block.id)}
    onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd}
    onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop}
  />
{/if}

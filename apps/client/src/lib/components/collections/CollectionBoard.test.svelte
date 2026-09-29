<script lang="ts">
  import CollectionBoard from "./CollectionBoard.svelte";
  let { onmove, disabled = false }: { onmove: (item: { id: string }, group: { id: string }, target: { id: string } | null, position: "before" | "after") => Promise<void>; disabled?: boolean } = $props();
  const groups = [{ id: "Todo", rows: [{ id: "Task" }] }, { id: "Done", rows: [] }];
</script>

<CollectionBoard {groups} items={(group) => group.rows} label={(group) => group.id} emptyLabel="Empty" dragLabel={(item) => item.id} canMove={() => true} {disabled} {onmove}>
  {#snippet card(item, group, handle)}<div>{@render handle()}<span>{group.id}: {item.id}</span></div>{/snippet}
</CollectionBoard>

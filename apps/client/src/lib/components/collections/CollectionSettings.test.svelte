<script lang="ts">
  import CollectionSettings from "./CollectionSettings.svelte";
  import CollectionMenu from "./CollectionMenu.svelte";
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";

  let { onclose = () => {}, oncommit = () => {} }: { onclose?: () => void; oncommit?: (value: string) => void } = $props();
  let open = $state(false);
  let anchor: HTMLButtonElement | null = $state(null);
  let draft = $state("");
  let status = $state("todo");
  let saving = $state(false);
</script>

<button bind:this={anchor} type="button" aria-label="View settings" onclick={() => { open = true; }}>Settings</button>
{#if open}
  <CollectionSettings label="View settings" {anchor} onclose={() => { open = false; onclose(); }}>
    <fieldset disabled={saving}>
      <input aria-label="View name" bind:value={draft} onblur={() => oncommit(draft)} />
      <button type="button" onclick={() => { saving = true; }}>Save</button>
    </fieldset>
    <CollectionMenu label="Layout" summary="Table" fullWidth>
      <input aria-label="Layout value" />
      <CollectionMenu label="Advanced layout" fullWidth>
        <input aria-label="Advanced value" />
      </CollectionMenu>
    </CollectionMenu>
    <CollectionMenu label="Filter" summary="1 rule" kind="filter" fullWidth>
      <CustomSelect inline ariaLabel="Status" value={status} options={[{ value: "todo", label: "To do" }, { value: "done", label: "Done" }]} onChange={(value) => { status = value; }} />
    </CollectionMenu>
  </CollectionSettings>
{/if}

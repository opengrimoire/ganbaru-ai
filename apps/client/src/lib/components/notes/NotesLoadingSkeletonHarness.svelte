<script lang="ts">
  import { untrack } from "svelte";
  import NotesLoadingSkeleton from "./NotesLoadingSkeleton.svelte";

  let { initiallyReady = false, onAction = () => {} }: { initiallyReady?: boolean; onAction?: () => void } = $props();
  let ready = $state(untrack(() => initiallyReady));
</script>

<button type="button" data-toggle-loading onclick={() => { ready = !ready; }}>Toggle readiness</button>
<NotesLoadingSkeleton kind="database" {ready}>
  <button type="button" data-ready-content onclick={onAction}>Ready content</button>
</NotesLoadingSkeleton>

<script lang="ts">
  let { viewId, onReady = () => {} }: { viewId?: string | null; onReady?: () => void } = $props();
</script>

<div data-session-view={viewId}></div>
<button type="button" data-finish-view onclick={onReady}>Finish view loading</button>

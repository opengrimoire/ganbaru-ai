<script lang="ts">
  let { viewId }: { viewId?: string | null } = $props();
</script>

<div data-session-view={viewId}></div>

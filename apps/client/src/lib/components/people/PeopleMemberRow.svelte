<script lang="ts">
  import type { Snippet } from "svelte";

  /** One member of a space: avatar, name, an optional muted detail, and trailing role or action controls. */
  let {
    name,
    detail = null,
    avatar,
    trailing,
  }: {
    name: string;
    detail?: string | null;
    avatar: Snippet;
    trailing?: Snippet;
  } = $props();
</script>

<li class="people-member-row">
  {@render avatar()}
  <span class="people-member-name">{name}</span>
  {#if detail}<span class="people-member-detail">{detail}</span>{/if}
  {#if trailing}<span class="people-member-trailing">{@render trailing()}</span>{/if}
</li>

<style>
  .people-member-row { display: flex; min-height: 2.25rem; align-items: center; gap: 0.6rem; padding-inline: 0.375rem; }
  .people-member-name { min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .people-member-detail { min-width: 0; flex: 1; overflow: hidden; color: var(--muted-foreground); font-size: var(--panel-detail-font-size); text-overflow: ellipsis; white-space: nowrap; }
  .people-member-row:not(:has(.people-member-detail)) .people-member-name { flex: 1; }
  .people-member-trailing { display: flex; flex: 0 0 auto; align-items: center; gap: 0.125rem; margin-inline-start: auto; }
</style>

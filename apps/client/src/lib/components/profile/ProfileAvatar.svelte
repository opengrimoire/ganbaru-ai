<script lang="ts">
  import { profileImageAssetUrl } from "$lib/api/profile-image";
  import { profileInitials } from "$lib/profile/identity";

  let {
    displayName,
    imagePath = null,
    size = 36,
  }: {
    displayName: string;
    imagePath?: string | null;
    size?: number;
  } = $props();

  let imageUrl = $state<string | null>(null);
  let imageRequestId = 0;
  const initials = $derived(profileInitials(displayName));

  $effect(() => {
    const path = imagePath;
    const requestId = ++imageRequestId;
    imageUrl = null;
    if (!path) return;
    void profileImageAssetUrl(path)
      .then((url) => {
        if (requestId === imageRequestId) imageUrl = url;
      })
      .catch(() => {
        if (requestId === imageRequestId) imageUrl = null;
      });
  });
</script>

<span
  class="profile-avatar"
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:--profile-avatar-font-size={`${Math.max(10, Math.round(size * 0.34))}px`}
  role="img"
  aria-label={displayName}
>
  {#if imageUrl}
    <img src={imageUrl} alt="" />
  {:else}
    <span aria-hidden="true">{initials}</span>
  {/if}
</span>

<style>
  .profile-avatar {
    display: inline-grid;
    flex: 0 0 auto;
    place-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: var(--chat-participant-avatar-radius, 22%);
    background: color-mix(in srgb, var(--foreground) 10%, var(--card));
    color: var(--foreground);
    font-size: var(--profile-avatar-font-size);
    font-weight: 700;
    line-height: 1;
  }

  .profile-avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>

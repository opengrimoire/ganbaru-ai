<script lang="ts">
  import AudioLines from "@lucide/svelte/icons/audio-lines";
  import CloudRain from "@lucide/svelte/icons/cloud-rain";
  import Coffee from "@lucide/svelte/icons/coffee";
  import Trees from "@lucide/svelte/icons/trees";
  import Waves from "@lucide/svelte/icons/waves";
  import Wind from "@lucide/svelte/icons/wind";
  import type { MusicSoundscapeGroupIcon } from "$lib/music/soundscape-contracts";

  let { icon, size = 16 }: { icon: MusicSoundscapeGroupIcon; size?: number } = $props();
</script>

{#if icon === "cloud-rain"}<CloudRain {size} strokeWidth={1.5} />
{:else if icon === "waves"}<Waves {size} strokeWidth={1.5} />
{:else if icon === "wind"}<Wind {size} strokeWidth={1.5} />
{:else if icon === "trees"}<Trees {size} strokeWidth={1.5} />
{:else if icon === "coffee"}<Coffee {size} strokeWidth={1.5} />
{:else}<AudioLines {size} strokeWidth={1.5} />{/if}

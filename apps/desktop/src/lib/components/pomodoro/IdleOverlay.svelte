<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  let {
    idleSeconds,
    onResume,
    onStop,
  }: {
    idleSeconds: number;
    onResume: () => void;
    onStop: () => void;
  } = $props();

  let elapsed = $state(0);
  let alertIntervalId: ReturnType<typeof setInterval> | null = null;
  let tickIntervalId: ReturnType<typeof setInterval> | null = null;

  function formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function playAlert() {
    invoke("play_alert_sound").catch(() => {});
  }

  onMount(() => {
    elapsed = idleSeconds;

    // Play alert immediately on show
    playAlert();

    // Repeat alert every 15 seconds
    alertIntervalId = setInterval(playAlert, 15_000);

    // Tick elapsed counter every second
    tickIntervalId = setInterval(() => {
      elapsed += 1;
    }, 1000);

    function handleKeydown(e: KeyboardEvent) {
      if (e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        onResume();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onStop();
      }
    }
    window.addEventListener("keydown", handleKeydown, true);

    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      if (alertIntervalId !== null) clearInterval(alertIntervalId);
      if (tickIntervalId !== null) clearInterval(tickIntervalId);
    };
  });
</script>

<div class="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black select-none">
  <div class="flex flex-col items-center gap-8">
    <p class="text-[#9CA3AF] text-sm tracking-wide uppercase">Focus session paused</p>

    <p class="text-white text-7xl font-light tabular-nums">
      {formatDuration(elapsed)}
    </p>

    <p class="text-[#9CA3AF] text-base">
      idle
    </p>
  </div>

  <div class="mt-16 flex flex-col items-center gap-3">
    <p class="text-[#9CA3AF] text-sm">
      Press <span class="text-white">Space</span> to resume focus
    </p>
    <p class="text-[#9CA3AF] text-sm">
      Press <span class="text-white">Esc</span> to stop session
    </p>
  </div>
</div>

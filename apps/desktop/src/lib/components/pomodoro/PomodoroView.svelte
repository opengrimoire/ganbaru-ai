<script lang="ts">
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import Play from "@lucide/svelte/icons/play";
  import Pause from "@lucide/svelte/icons/pause";
  import SkipForward from "@lucide/svelte/icons/skip-forward";
  const pomodoro = getPomodoro();

  const phaseLabel = $derived(
    pomodoro.phase === "focus"
      ? "Focus"
      : pomodoro.phase === "short_break"
        ? "Short break"
        : "Long break",
  );

  const phaseColor = $derived(
    pomodoro.phase === "focus"
      ? "text-red-400"
      : "text-green-400",
  );

  const progressPercent = $derived(() => {
    const total = pomodoro.totalSecondsForPhase;
    return ((total - pomodoro.remainingSeconds) / total) * 100;
  });

  // Auto-dismiss XP notification after 3 seconds
  $effect(() => {
    if (pomodoro.lastXp !== null) {
      const t = setTimeout(() => pomodoro.clearLastXp(), 3000);
      return () => clearTimeout(t);
    }
  });
</script>

<div class="relative flex h-full flex-col items-center justify-center p-6">
  <div class="flex flex-col items-center gap-8">
    <Badge variant="outline" class={phaseColor}>
      {phaseLabel}
    </Badge>

    <div class="relative flex h-64 w-64 items-center justify-center">
      <svg class="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="text-muted"
        />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-dasharray={`${progressPercent() * 2.83} 283`}
          stroke-linecap="round"
          class={pomodoro.phase === "focus" ? "text-red-500" : "text-green-500"}
        />
      </svg>
      <span class="text-5xl font-mono font-bold">
        {pomodoro.formattedTime}
      </span>
    </div>

    <div class="text-sm text-muted-foreground">
      Cycle {pomodoro.currentCycle} of {pomodoro.totalCycles}
      {#if pomodoro.completedPomodoros > 0}
        &middot; {pomodoro.completedPomodoros} completed
      {/if}
    </div>

    <div class="flex gap-3">
      {#if pomodoro.isRunning}
        <Button variant="outline" size="lg" onclick={() => pomodoro.pause()}>
          <Pause size={20} />
          Pause
        </Button>
      {:else}
        <Button size="lg" onclick={() => pomodoro.start()}>
          <Play size={20} />
          {pomodoro.remainingSeconds === pomodoro.totalSecondsForPhase && pomodoro.currentCycle === 1 ? "Start" : "Resume"}
        </Button>
      {/if}

      <Button variant="ghost" size="lg" onclick={() => pomodoro.skip()} title="Skip to next phase">
        <SkipForward size={20} />
      </Button>

    </div>
  </div>

  <!-- XP earned notification -->
  {#if pomodoro.lastXp !== null}
    <div
      class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 rounded-lg border border-border bg-card px-5 py-3 text-center shadow-lg"
    >
      <p class="text-lg font-bold text-green-400">+{pomodoro.lastXp} XP</p>
      <p class="text-xs text-muted-foreground">Focus session complete</p>
    </div>
  {/if}
</div>

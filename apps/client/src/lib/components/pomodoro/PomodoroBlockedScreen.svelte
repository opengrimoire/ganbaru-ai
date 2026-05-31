<script lang="ts">
  import {
    formatBlockedScreenDuration,
    pomodoroBlockedScreenCopy,
    type PomodoroBlockedScreenState,
  } from "./blocked-screen";

  let {
    state,
    seconds,
    extensionMinutes = 0,
    maxExtensionMinutes = 3,
    escPresses = 0,
  }: {
    state: PomodoroBlockedScreenState;
    seconds: number;
    extensionMinutes?: number;
    maxExtensionMinutes?: number;
    escPresses?: number;
  } = $props();

  const copy = $derived(pomodoroBlockedScreenCopy(state));
  const timerLabel = $derived(formatBlockedScreenDuration(seconds));
  const isFailed = $derived(copy.tone === "danger");
  const showTimer = $derived(state !== "break_finished");
  const extensionHint = $derived.by(() => {
    if (state !== "break_countdown") return null;
    if (extensionMinutes <= 0) {
      return "Press Ctrl+Shift+Space to extend the break 1 minute";
    }
    if (extensionMinutes >= maxExtensionMinutes) {
      return `Break extended by ${maxExtensionMinutes} minutes (maximum reached)`;
    }
    return `Break extended by ${extensionMinutes} min, press Ctrl+Shift+Space to add more (${maxExtensionMinutes - extensionMinutes} left)`;
  });
  const skipHint = $derived.by(() => {
    if (state !== "break_countdown") return null;
    if (escPresses <= 0) return "Press 3x Esc to skip the break entirely";
    return `Press ${Math.max(0, 3 - escPresses)}x Esc to skip the break entirely`;
  });
</script>

<div class="fixed inset-0 flex h-screen w-screen select-none flex-col items-center justify-center bg-black text-white">
  <div class="flex flex-col items-center gap-8 px-6 text-center">
    {#if copy.title}
      <p
        class={isFailed
          ? "text-sm font-medium uppercase tracking-wide text-red-300"
          : "text-sm font-medium uppercase tracking-wide text-zinc-400"}
      >
        {copy.title}
      </p>
    {/if}

    {#if showTimer}
      <p class="font-mono text-7xl font-light tabular-nums text-white">
        {timerLabel}
      </p>
    {/if}

    {#if copy.status}
      <p
        class={isFailed ? "text-base text-red-300" : "text-base text-zinc-400"}
      >
        {copy.status}
      </p>
    {/if}

    {#if copy.subtitle}
      <p class="text-sm text-zinc-400">
        {copy.subtitle}
      </p>
    {/if}
  </div>

  {#if state !== "break_finished"}
    <div class="absolute inset-x-0 bottom-12 flex flex-col items-center gap-3 px-6 text-center text-sm text-zinc-400">
      {#if state === "break_countdown"}
        {#if extensionHint}
          <p>{extensionHint}</p>
        {/if}
        {#if skipHint}
          <p>{skipHint}</p>
        {/if}
      {:else}
        {#if copy.primaryHint}
          <p>
            Press <span class="text-white">{copy.primaryHint.key}</span> to {copy.primaryHint.label}
          </p>
        {/if}
        {#if copy.secondaryHint}
          <p>
            Press <span class="text-white">{copy.secondaryHint.key}</span> to {copy.secondaryHint.label}
          </p>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  :global(html),
  :global(body),
  :global(#app) {
    background: #000 !important;
  }
</style>

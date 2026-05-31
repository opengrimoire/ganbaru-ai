<script lang="ts">
  import { onMount } from "svelte";
  import {
    formatBreakExtensionHint,
    formatBlockedScreenDateTime,
    formatBlockedScreenDuration,
    pomodoroBlockedScreenPalette,
    pomodoroBlockedScreenCopy,
    shouldShowBlockedScreenDateTime,
    type PomodoroBlockedScreenState,
  } from "./blocked-screen";

  let {
    state: screenState,
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

  let now = $state(new Date());
  const copy = $derived(pomodoroBlockedScreenCopy(screenState));
  const colors = $derived(pomodoroBlockedScreenPalette(screenState));
  const timerLabel = $derived(formatBlockedScreenDuration(seconds));
  const showDateTime = $derived(shouldShowBlockedScreenDateTime(screenState));
  const dateTimeLabel = $derived(formatBlockedScreenDateTime(now));
  const showTimer = $derived(screenState !== "break_finished");
  const screenStyle = $derived(
    `--blocked-screen-bg: ${colors.background}; --blocked-main-text: ${colors.mainText}; --blocked-muted-text: ${colors.mutedText}; --blocked-subtle-text: ${colors.subtleText};`,
  );
  const extensionHint = $derived.by(() => {
    if (screenState !== "break_countdown") return null;
    return formatBreakExtensionHint(extensionMinutes, maxExtensionMinutes);
  });
  const skipHint = $derived.by(() => {
    if (screenState !== "break_countdown") return null;
    if (escPresses <= 0) return "Press 3x Esc to skip the break entirely";
    return `Press ${Math.max(0, 3 - escPresses)}x Esc to skip the break entirely`;
  });

  onMount(() => {
    const intervalId = setInterval(() => {
      now = new Date();
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  });

  $effect(() => {
    document.documentElement.style.backgroundColor = colors.background;
    document.body.style.backgroundColor = colors.background;
    document.getElementById("app")?.style.setProperty("background-color", colors.background);
  });
</script>

<div
  class="blocked-screen fixed inset-0 flex h-screen w-screen select-none flex-col items-center justify-center"
  style={screenStyle}
>
  {#if showDateTime}
    <p class="blocked-date-time blocked-muted absolute inset-x-0 top-8 mx-auto max-w-[calc(100vw-3rem)] px-6 text-center">
      {dateTimeLabel}
    </p>
  {/if}

  <div class="flex flex-col items-center gap-8 px-6 text-center">
    {#if copy.title}
      <p
        class={screenState === "break_finished"
          ? "blocked-finished-title blocked-main"
          : "blocked-kicker blocked-muted font-medium uppercase tracking-wide"}
      >
        {copy.title}
      </p>
    {/if}

    {#if showTimer}
      <p class="blocked-timer blocked-main tabular-nums">
        {timerLabel}
      </p>
    {/if}

    {#if copy.status}
      <p class="blocked-status blocked-muted">
        {copy.status}
      </p>
    {/if}

    {#if copy.subtitle}
      <p class="blocked-subtitle blocked-muted">
        {copy.subtitle}
      </p>
    {/if}
  </div>

  {#if screenState !== "break_finished"}
    <div class="blocked-hints blocked-subtle absolute inset-x-0 bottom-12 flex flex-col items-center gap-3 px-6 text-center">
      {#if screenState === "break_countdown"}
        {#if extensionHint}
          <p>{extensionHint}</p>
        {/if}
        {#if skipHint}
          <p>{skipHint}</p>
        {/if}
      {:else}
        {#if copy.primaryHint}
          <p>
            Press <span class="blocked-main">{copy.primaryHint.key}</span> to {copy.primaryHint.label}
          </p>
        {/if}
        {#if copy.secondaryHint}
          <p>
            Press <span class="blocked-main">{copy.secondaryHint.key}</span> to {copy.secondaryHint.label}
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
    background: var(--blocked-screen-bg, #000) !important;
  }

  .blocked-screen {
    background: var(--blocked-screen-bg);
    color: var(--blocked-main-text);
  }

  .blocked-main {
    color: var(--blocked-main-text);
  }

  .blocked-muted {
    color: var(--blocked-muted-text);
  }

  .blocked-subtle {
    color: var(--blocked-subtle-text);
  }

  .blocked-date-time,
  .blocked-kicker,
  .blocked-subtitle,
  .blocked-hints {
    font-size: 1.75rem;
    line-height: 1.25;
  }

  .blocked-status {
    font-size: 2rem;
    line-height: 1.2;
  }

  .blocked-timer {
    font-family: inherit;
    font-size: 13rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
    line-height: 0.85;
  }

  .blocked-finished-title {
    font-size: 5rem;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 0.95;
  }

  @media (max-width: 900px), (max-height: 620px) {
    .blocked-timer {
      font-size: 10rem;
    }

    .blocked-finished-title {
      font-size: 4rem;
    }

    .blocked-date-time,
    .blocked-kicker,
    .blocked-subtitle,
    .blocked-hints {
      font-size: 1.4rem;
    }

    .blocked-status {
      font-size: 1.6rem;
    }
  }

  @media (max-width: 640px), (max-height: 460px) {
    .blocked-timer {
      font-size: 7rem;
    }

    .blocked-finished-title {
      font-size: 3rem;
    }

    .blocked-date-time,
    .blocked-kicker,
    .blocked-subtitle,
    .blocked-hints {
      font-size: 1.1rem;
    }

    .blocked-status {
      font-size: 1.25rem;
    }
  }

  @media (max-width: 420px), (max-height: 320px) {
    .blocked-timer {
      font-size: 4.75rem;
    }

    .blocked-finished-title {
      font-size: 2rem;
    }

    .blocked-date-time,
    .blocked-kicker,
    .blocked-subtitle,
    .blocked-hints {
      font-size: 0.85rem;
    }

    .blocked-status {
      font-size: 0.95rem;
    }
  }

  @media (max-width: 300px), (max-height: 220px) {
    .blocked-timer {
      font-size: 3.25rem;
    }

    .blocked-finished-title {
      font-size: 1.5rem;
    }

    .blocked-date-time,
    .blocked-kicker,
    .blocked-subtitle,
    .blocked-hints {
      font-size: 0.7rem;
    }

    .blocked-status {
      font-size: 0.8rem;
    }
  }
</style>

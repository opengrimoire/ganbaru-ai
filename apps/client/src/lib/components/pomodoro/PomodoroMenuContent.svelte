<script lang="ts">
  import ClockPlus from "@lucide/svelte/icons/clock-plus";
  import Coffee from "@lucide/svelte/icons/coffee";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PlayIcon from "@lucide/svelte/icons/play";
  import SkipBack from "@lucide/svelte/icons/skip-back";
  import SkipForward from "@lucide/svelte/icons/skip-forward";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { PlaybackStatus } from "$lib/music/playback";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { cn } from "$lib/utils";

  let {
    includeMusic,
    touch = false,
    onDismiss,
    onOpenMusic,
  }: {
    includeMusic: boolean;
    touch?: boolean;
    onDismiss: () => void;
    onOpenMusic: () => void;
  } = $props();

  const pomodoro = getPomodoro();
  const musicPlayer = getMusicPlayer();
  const { t } = getLocalization();
  let starting = $state(false);
  let startMessage = $state("");
  const MENU_ICON_SIZE = 14;
  const MENU_ICON_STROKE_WIDTH = 1.8;
  const volumeStep = 0.05;

  const isActive = $derived(pomodoro.isActive);
  const pauseResumeLabel = $derived(
    isActive && !pomodoro.isRunning
      ? t("titleBar.pomodoro.resumeFocus")
      : t("titleBar.pomodoro.pauseFocus"),
  );
  const phaseAdvanceLabel = $derived(
    isActive
      ? pomodoro.phase === "focus"
        ? t("titleBar.pomodoro.goToBreakNow")
        : t("titleBar.pomodoro.startFocusNow")
      : t("titleBar.pomodoro.goToBreakNow"),
  );
  const musicStatusText = $derived.by(() => {
    const title = musicPlayer.currentSource ? musicPlayer.loadedTitle.trim() : "";
    if (title) return title;
    if (musicPlayer.currentSource || musicPlayer.snapshot.status !== "idle") {
      return musicStatusLabel(musicPlayer.snapshot.status);
    }
    return t("titleBar.music.noMusicLoaded");
  });
  const canPlayPauseMusic = $derived(Boolean(musicPlayer.currentSource) && !musicPlayer.isBusy);
  const musicPlayPauseLabel = $derived(
    musicPlayer.isPlaying ? t("titleBar.music.pause") : t("titleBar.music.play"),
  );
  const volumeProgress = $derived(musicPlayer.volumeMax > 0
    ? `${Math.min(100, Math.max(0, (musicPlayer.volumeControlValue / musicPlayer.volumeMax) * 100))}%`
    : "0%");

  function musicStatusLabel(status: PlaybackStatus): string {
    switch (status) {
      case "playing": return t("titleBar.music.status.playing");
      case "paused": return t("titleBar.music.status.paused");
      case "loading": return t("titleBar.music.status.loading");
      case "ready": return t("titleBar.music.status.ready");
      case "ended": return t("titleBar.music.status.ended");
      case "error": return t("titleBar.music.status.error");
      case "idle": return t("titleBar.music.status.idle");
    }
  }

  function itemClass(enabled: boolean): string {
    return cn(
      "flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 text-left text-sm transition-colors",
      touch ? "min-h-12 active:bg-accent" : "py-1.5 hover:bg-accent",
      enabled ? "text-foreground" : "cursor-not-allowed text-muted-foreground/50",
    );
  }

  function snappedVolume(value: number): number {
    if (!Number.isFinite(value)) return musicPlayer.volumeControlValue;
    return Number((Math.round(value / volumeStep) * volumeStep).toFixed(2));
  }

  function setVolume(value: number): void {
    void musicPlayer.setVolume(snappedVolume(value));
  }

  function openMusic(): void {
    onDismiss();
    onOpenMusic();
  }

  /** Start an eligible commitment only after native persistence acknowledges it. */
  async function startScheduledSession(): Promise<void> {
    if (starting) return;
    starting = true;
    startMessage = "";
    try {
      const [{ getCalendar }, { startScheduledPomodoro }] = await Promise.all([
        import("$lib/stores/calendar.svelte"),
        import("$lib/stores/pomodoro-calendar-scheduler"),
      ]);
      if (await startScheduledPomodoro(getCalendar(), pomodoro)) onDismiss();
      else startMessage = t("pomodoroNotification.noCommitmentDue");
    } catch (error) {
      console.warn("Failed to accept scheduled focus session:", error);
      startMessage = t("pomodoroNotification.startFailed");
    } finally {
      starting = false;
    }
  }
</script>

{#if isActive}
  <div class={cn("px-3 text-xs text-muted-foreground", touch ? "py-3" : "py-1.5")}>
    {pomodoro.phase !== "focus" && pomodoro.remainingSeconds === 0
      ? t("pomodoroNotification.breakCompleteTitle")
      : t("titleBar.pomodoro.left", pomodoro.formattedTime)}
  </div>
{:else}
  <div class={cn("px-3 text-xs text-muted-foreground", touch ? "py-3" : "py-1.5")}>
    {t("titleBar.pomodoro.noActiveSession")}
  </div>
  <button
    type="button"
    disabled={starting}
    onclick={() => { void startScheduledSession(); }}
    class={itemClass(!starting)}
  >
    <span>{t("pomodoroNotification.startScheduledSession")}</span>
    <PlayIcon class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  </button>
  {#if startMessage}
    <p class="px-3 py-2 text-xs text-muted-foreground" role="status">{startMessage}</p>
  {/if}
{/if}

<button
  type="button"
  onclick={() => {
    if (pomodoro.isRunning) pomodoro.pause();
    else pomodoro.start();
    onDismiss();
  }}
  disabled={!pomodoro.canPauseResume}
  class={itemClass(pomodoro.canPauseResume)}
>
  <span>{pauseResumeLabel}</span>
  {#if isActive && !pomodoro.isRunning}
    <PlayIcon class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  {:else}
    <PauseIcon class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  {/if}
</button>

<button
  type="button"
  onclick={() => { pomodoro.addFocusTime(); onDismiss(); }}
  disabled={!pomodoro.canAddFocusTime}
  class={itemClass(pomodoro.canAddFocusTime)}
>
  <span>{t("titleBar.pomodoro.extendFocusMinutes", 3)}</span>
  <ClockPlus class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
</button>

<button
  type="button"
  onclick={() => { pomodoro.skip(); onDismiss(); }}
  disabled={!isActive}
  class={itemClass(isActive)}
>
  <span>{phaseAdvanceLabel}</span>
  {#if pomodoro.phase === "focus" || !isActive}
    <Coffee class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  {:else}
    <PlayIcon class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  {/if}
</button>

{#if includeMusic}
  <div class="mx-3 my-1.5 border-t border-border"></div>
  {#if musicPlayer.contextPlayback && musicPlayer.contextPlayback.state !== "overridden"}
    <button
      type="button"
      onclick={() => { musicPlayer.inspectContextAssignment(); onDismiss(); }}
      class={cn(
        "mx-1 mb-1 flex w-[calc(100%-0.5rem)] items-start gap-2 rounded-md bg-primary/7 px-2 py-2 text-left",
        touch ? "min-h-12 active:bg-primary/12" : "hover:bg-primary/12",
      )}
    >
      <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></span>
      <span class="min-w-0">
        <span class="block truncate text-xs font-medium">{t("titleBar.music.contextual", t(`music.assignment.phase.${musicPlayer.contextPlayback.phase}`), musicPlayer.contextPlayback.eventTitle)}</span>
        <span class="block text-[0.65rem] text-muted-foreground">{t("titleBar.music.inspectAssignment")}</span>
      </span>
    </button>
  {/if}
  <div class="px-3 pb-1.5 pt-2 text-xs text-muted-foreground">
    <span class="block truncate">{musicStatusText}</span>
  </div>
  <button
    type="button"
    onclick={() => { void musicPlayer.togglePlay(); onDismiss(); }}
    disabled={!canPlayPauseMusic}
    class={itemClass(canPlayPauseMusic)}
  >
    <span>{musicPlayPauseLabel}</span>
    {#if musicPlayer.isPlaying}
      <PauseIcon class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
    {:else}
      <PlayIcon class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
    {/if}
  </button>
  <button
    type="button"
    onclick={() => { void musicPlayer.playPreviousTrack(); onDismiss(); }}
    disabled={!musicPlayer.canPlayPreviousTrack}
    class={itemClass(musicPlayer.canPlayPreviousTrack)}
  >
    <span>{t("titleBar.music.previous")}</span>
    <SkipBack class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  </button>
  <button
    type="button"
    onclick={() => { void musicPlayer.playNextTrack(); onDismiss(); }}
    disabled={!musicPlayer.canPlayNextTrack}
    class={itemClass(musicPlayer.canPlayNextTrack)}
  >
    <span>{t("titleBar.music.next")}</span>
    <SkipForward class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  </button>
  <div class={cn("flex items-center gap-3 px-3 text-sm text-foreground", touch ? "min-h-12" : "py-2")}>
    <span class="shrink-0">{t("titleBar.music.volume")}</span>
    <input
      type="range"
      min="0"
      max={musicPlayer.volumeMax}
      step={volumeStep}
      value={musicPlayer.volumeControlValue}
      class="pomodoro-menu-volume-slider min-w-0 flex-1"
      style={`--pomodoro-menu-volume-progress: ${volumeProgress};`}
      aria-label={t("titleBar.music.volumeLabel")}
      oninput={(event) => { setVolume(Number(event.currentTarget.value)); }}
    />
  </div>
  <button type="button" onclick={openMusic} class={itemClass(true)}>
    <span>{t("titleBar.music.open")}</span>
    <ExternalLink class="shrink-0 opacity-70" size={MENU_ICON_SIZE} strokeWidth={MENU_ICON_STROKE_WIDTH} />
  </button>
{/if}

<style>
  .pomodoro-menu-volume-slider {
    --pomodoro-menu-volume-thumb-size: 0.5rem;
    --pomodoro-menu-volume-track-height: 0.125rem;
    --pomodoro-menu-volume-track-color: color-mix(in srgb, var(--foreground) 18%, transparent);
    --pomodoro-menu-volume-fill-color: color-mix(in srgb, var(--foreground) 58%, transparent);
    height: var(--pomodoro-menu-volume-thumb-size);
    appearance: none;
    cursor: pointer;
    background: linear-gradient(
      to right,
      var(--pomodoro-menu-volume-fill-color) 0%,
      var(--pomodoro-menu-volume-fill-color) var(--pomodoro-menu-volume-progress),
      var(--pomodoro-menu-volume-track-color) var(--pomodoro-menu-volume-progress),
      var(--pomodoro-menu-volume-track-color) 100%
    ) center / calc(100% - var(--pomodoro-menu-volume-thumb-size)) var(--pomodoro-menu-volume-track-height) no-repeat;
  }

  .pomodoro-menu-volume-slider::-webkit-slider-runnable-track {
    height: var(--pomodoro-menu-volume-track-height);
    border-radius: 999px;
    background: transparent;
  }

  .pomodoro-menu-volume-slider::-webkit-slider-thumb {
    width: var(--pomodoro-menu-volume-thumb-size);
    height: var(--pomodoro-menu-volume-thumb-size);
    margin-top: calc((var(--pomodoro-menu-volume-track-height) - var(--pomodoro-menu-volume-thumb-size)) / 2);
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: var(--foreground);
  }

  .pomodoro-menu-volume-slider::-moz-range-track,
  .pomodoro-menu-volume-slider::-moz-range-progress {
    height: var(--pomodoro-menu-volume-track-height);
    border-radius: 999px;
    background: transparent;
  }

  .pomodoro-menu-volume-slider::-moz-range-thumb {
    width: var(--pomodoro-menu-volume-thumb-size);
    height: var(--pomodoro-menu-volume-thumb-size);
    border: 0;
    border-radius: 999px;
    background: var(--foreground);
  }
</style>

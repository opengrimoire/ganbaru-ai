<script lang="ts">
  import { onMount, tick } from "svelte";

  let {
    title,
    message,
    confirmLabel = "Yes (Enter)",
    cancelLabel = "No (Esc)",
    danger = true,
    extraConfirmShortcut,
    onConfirm,
    onCancel,
  }: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    extraConfirmShortcut?: (e: KeyboardEvent) => boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  let dialogEl: HTMLDivElement | undefined = $state();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onConfirm(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      (document.activeElement as HTMLElement)?.blur();
      onCancel();
      return;
    }
    if (extraConfirmShortcut?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      onConfirm();
      return;
    }
    // While the modal is open, prevent any other key from triggering
    // shortcuts in underlying components (e.g. the event panel's
    // Ctrl+Enter / Ctrl+D). Running in capture phase on window, this
    // stops propagation before any bubble-phase handler sees the event.
    e.stopPropagation();
  }

  onMount(() => {
    void tick().then(() => {
      dialogEl?.focus();
    });
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-60 flex items-center justify-center"
  onclick={(e) => { e.stopPropagation(); onCancel(); }}
>
  <div class="absolute inset-0 bg-black/50"></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={dialogEl}
    class="confirm-dialog relative z-10 rounded-md border border-black/20 bg-card text-card-foreground px-8 py-5 outline-none dark:border-white/10 dark:bg-sidebar dark:text-sidebar-foreground"
    style="--foreground: var(--card-foreground);"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <div class="mb-5 text-left">
      {#if title}
        <h2 class="mb-1 text-[15px] font-semibold text-foreground">{title}</h2>
        <p class="text-[13px] text-foreground whitespace-pre-line">{message}</p>
      {:else}
        <p class="text-[15px] font-semibold text-foreground whitespace-pre-line">{message}</p>
      {/if}
    </div>
    <div class="flex items-center justify-start gap-2">
      <button
        onclick={onCancel}
        class="rounded-md border border-border bg-card px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        {cancelLabel}
      </button>
      <button
        onclick={onConfirm}
        class="rounded-md border border-border bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>

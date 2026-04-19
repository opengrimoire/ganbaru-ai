<script lang="ts">
  import { untrack } from "svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import { invoke } from "@tauri-apps/api/core";
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { cn } from "$lib/utils";
  import { PALETTE_SIZE } from "$lib/components/calendar/types";
  import {
    APP_TOKEN_KEYS,
    CALENDAR_TOKEN_KEYS,
    type Theme,
  } from "$lib/stores/themes";
  import { getTheme } from "$lib/stores/theme.svelte";
  import ColorField from "$lib/components/ui/ColorField.svelte";

  let {
    theme,
    onDone,
  }: {
    theme: Theme;
    onDone: () => void;
  } = $props();

  const themeStore = getTheme();
  const THEME_FILE_FILTER = [{ name: "Theme JSON", extensions: ["json"] }];

  const isBuiltin = $derived(themeStore.isBuiltin(theme.id));

  // The JSON drawer mirrors the theme's serialized form. We only refresh it
  // from props while the user has not yet typed anything, otherwise their
  // pending edits would be wiped every time a form field updates the store.
  let jsonDraft = $state(untrack(() => themeStore.exportTheme(theme.id) ?? ""));
  let jsonDirty = $state(false);
  let jsonErrors = $state<string[]>([]);
  let jsonNotice = $state<string | undefined>(undefined);
  let jsonNoticeTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const next = themeStore.exportTheme(theme.id) ?? "";
    if (!jsonDirty) jsonDraft = next;
  });

  function flashJsonNotice(message: string) {
    jsonNotice = message;
    if (jsonNoticeTimer) clearTimeout(jsonNoticeTimer);
    jsonNoticeTimer = setTimeout(() => {
      jsonNotice = undefined;
    }, 1800);
  }

  function humanize(token: string): string {
    const stripped = token.replace(/^--/, "").replace(/^cal-/, "");
    const spaced = stripped.replace(/-/g, " ");
    if (spaced.length === 0) return spaced;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function setName(next: string) {
    themeStore.renameTheme(theme.id, next);
  }

  function setBase(next: "light" | "dark") {
    themeStore.updateTheme(theme.id, { base: next });
  }

  function setBlendCanvas(hex: string) {
    themeStore.updateTheme(theme.id, { blendCanvas: hex });
  }

  function setSlot(index: number, hex: string) {
    const next = [...theme.eventPalette];
    next[index] = hex;
    themeStore.updateTheme(theme.id, { eventPalette: next });
  }

  const paletteIndices = Array.from({ length: PALETTE_SIZE }, (_, i) => i);

  function setAppToken(key: string, hex: string) {
    const next = { ...(theme.appTokenOverrides ?? {}), [key]: hex };
    themeStore.updateTheme(theme.id, { appTokenOverrides: next });
  }

  function clearAppToken(key: string) {
    if (!theme.appTokenOverrides) return;
    const next = { ...theme.appTokenOverrides };
    delete next[key];
    themeStore.updateTheme(theme.id, { appTokenOverrides: next });
  }

  function setCalToken(key: string, hex: string) {
    const next = { ...(theme.calendarTokenOverrides ?? {}), [key]: hex };
    themeStore.updateTheme(theme.id, { calendarTokenOverrides: next });
  }

  function clearCalToken(key: string) {
    if (!theme.calendarTokenOverrides) return;
    const next = { ...theme.calendarTokenOverrides };
    delete next[key];
    themeStore.updateTheme(theme.id, { calendarTokenOverrides: next });
  }

  function readComputedToken(token: string): string {
    if (typeof document === "undefined") return "#000000";
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue(token)
      .trim();
    if (/^#[0-9a-fA-F]{6}$/.test(computed)) return computed;
    return "#000000";
  }

  async function copyJsonToClipboard() {
    try {
      await navigator.clipboard.writeText(jsonDraft);
      flashJsonNotice("JSON copied to clipboard");
    } catch (err) {
      console.error("clipboard write failed", err);
      flashJsonNotice("Could not copy JSON");
    }
  }

  async function saveJsonToFile() {
    try {
      const target = await saveDialog({
        defaultPath: `${theme.id}.json`,
        filters: THEME_FILE_FILTER,
      });
      if (!target) return;
      await invoke("vault_write_text", { path: target, contents: jsonDraft });
      flashJsonNotice("Saved to file");
    } catch (err) {
      console.error("save dialog failed", err);
      flashJsonNotice("Could not save file");
    }
  }

  function applyJsonChanges() {
    const result = themeStore.replaceTheme(theme.id, jsonDraft);
    if (!result.ok) {
      jsonErrors = result.errors;
      return;
    }
    jsonErrors = [];
    jsonDirty = false;
    flashJsonNotice("Theme updated from JSON");
  }

  function resetJsonDraft() {
    jsonDraft = themeStore.exportTheme(theme.id) ?? "";
    jsonDirty = false;
    jsonErrors = [];
  }

  function onJsonInput(e: Event) {
    jsonDraft = (e.currentTarget as HTMLTextAreaElement).value;
    jsonDirty = true;
    jsonErrors = [];
  }

  // Built-in detail view shows only overrides that the seed theme actually
  // ships with, otherwise the empty list of all 23 app tokens would dwarf
  // the meaningful content.
  const populatedAppTokens = $derived(
    theme.appTokenOverrides
      ? Object.keys(theme.appTokenOverrides).filter((k) =>
          (APP_TOKEN_KEYS as readonly string[]).includes(k),
        )
      : [],
  );
  const populatedCalTokens = $derived(
    theme.calendarTokenOverrides
      ? Object.keys(theme.calendarTokenOverrides).filter((k) =>
          (CALENDAR_TOKEN_KEYS as readonly string[]).includes(k),
        )
      : [],
  );
</script>

<div class="flex flex-col gap-6">
  <!-- Header -->
  <section class="flex flex-col gap-2">
    <button
      type="button"
      onclick={onDone}
      class="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
    >
      <ArrowLeft size={13} strokeWidth={2} />
      <span>Back to themes</span>
    </button>
    <div
      class="flex flex-col gap-3 overflow-hidden rounded-lg bg-card p-4 dark:bg-background"
    >
      <div class="flex items-center justify-between gap-3">
        {#if isBuiltin}
          {@const BaseIcon = theme.base === "dark" ? Moon : Sun}
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <BaseIcon
              size={15}
              strokeWidth={1.75}
              class="shrink-0 text-muted-foreground"
            />
            <span class="truncate text-[14px] font-semibold text-foreground">
              {theme.displayName}
            </span>
          </div>
        {:else}
          <input
            type="text"
            value={theme.displayName}
            oninput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            maxlength={60}
            aria-label="Theme name"
            class="flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-[14px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
          />
          <div class="flex h-8 items-center gap-0 rounded-md border border-border p-0.5">
            {#each ["light", "dark"] as const as base}
              <button
                type="button"
                onclick={() => setBase(base)}
                class={cn(
                  "rounded-sm px-3 py-1 text-[12px] font-medium transition-colors",
                  theme.base === base
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {base}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if !isBuiltin}
        <div class="flex items-center justify-between gap-3 text-[12px] text-foreground">
          <div class="flex flex-col">
            <span>Blend canvas</span>
            <span class="text-[11px] text-muted-foreground">
              Reference background dimmed event variants blend toward.
            </span>
          </div>
          <ColorField value={theme.blendCanvas} onChange={setBlendCanvas} />
        </div>
      {/if}
    </div>
  </section>

  <!-- Event palette -->
  <section class="flex flex-col gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-foreground">Event palette</h2>
    <div
      class="grid grid-cols-4 gap-x-3 gap-y-1.5 rounded-lg bg-card p-3 dark:bg-background"
    >
      {#each paletteIndices as index}
        {#if isBuiltin}
          <div class="flex w-full items-center gap-1.5">
            <span
              class="h-[26px] w-[26px] shrink-0 rounded-md border border-border shadow-sm"
              style="background-color: {theme.eventPalette[index]};"
              title={theme.eventPalette[index]}
            ></span>
            <span
              class="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
            >
              {theme.eventPalette[index]}
            </span>
          </div>
        {:else}
          <ColorField
            value={theme.eventPalette[index]}
            onChange={(hex) => setSlot(index, hex)}
            fluid
          />
        {/if}
      {/each}
    </div>
  </section>

  <!-- App shell tokens -->
  {#if !isBuiltin || populatedAppTokens.length > 0}
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <h2 class="text-[13px] font-semibold text-foreground">App shell</h2>
        <span class="text-[11px] text-muted-foreground">
          {isBuiltin
            ? "Tokens this theme overrides on the app shell."
            : "Override CSS variables used across the whole app."}
        </span>
      </div>
      <div
        class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
      >
        {#if isBuiltin}
          {#each populatedAppTokens as key}
            {@const value = theme.appTokenOverrides?.[key] ?? ""}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{humanize(key)}</div>
                <div class="text-[11px] font-mono text-muted-foreground">{key}</div>
              </div>
              <span
                class="h-[26px] w-[26px] shrink-0 rounded-md border border-border shadow-sm"
                style="background-color: {value};"
                title={value}
              ></span>
            </div>
          {/each}
        {:else}
          {#each APP_TOKEN_KEYS as key}
            {@const override = theme.appTokenOverrides?.[key]}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{humanize(key)}</div>
                <div class="text-[11px] font-mono text-muted-foreground">{key}</div>
              </div>
              {#if override}
                <ColorField value={override} onChange={(hex) => setAppToken(key, hex)} />
                <button
                  type="button"
                  onclick={() => clearAppToken(key)}
                  title="Clear override"
                  aria-label="Clear override"
                  class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:bg-transparent"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => setAppToken(key, readComputedToken(key))}
                  class="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus size={11} strokeWidth={2.25} />
                  <span>Add override</span>
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </section>
  {/if}

  <!-- Calendar tokens -->
  {#if !isBuiltin || populatedCalTokens.length > 0}
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <h2 class="text-[13px] font-semibold text-foreground">Calendar shell</h2>
        <span class="text-[11px] text-muted-foreground">
          {isBuiltin
            ? "Tokens this theme overrides on the calendar grid."
            : "Override CSS variables used inside the calendar grid."}
        </span>
      </div>
      <div
        class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
      >
        {#if isBuiltin}
          {#each populatedCalTokens as key}
            {@const value = theme.calendarTokenOverrides?.[key] ?? ""}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{humanize(key)}</div>
                <div class="text-[11px] font-mono text-muted-foreground">{key}</div>
              </div>
              <span
                class="h-[26px] w-[26px] shrink-0 rounded-md border border-border shadow-sm"
                style="background-color: {value};"
                title={value}
              ></span>
            </div>
          {/each}
        {:else}
          {#each CALENDAR_TOKEN_KEYS as key}
            {@const override = theme.calendarTokenOverrides?.[key]}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{humanize(key)}</div>
                <div class="text-[11px] font-mono text-muted-foreground">{key}</div>
              </div>
              {#if override}
                <ColorField value={override} onChange={(hex) => setCalToken(key, hex)} />
                <button
                  type="button"
                  onclick={() => clearCalToken(key)}
                  title="Clear override"
                  aria-label="Clear override"
                  class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:bg-transparent"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => setCalToken(key, readComputedToken(key))}
                  class="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus size={11} strokeWidth={2.25} />
                  <span>Add override</span>
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </section>
  {/if}

  <!-- JSON -->
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between px-1">
      <h2 class="text-[13px] font-semibold text-foreground">JSON</h2>
      <span class="text-[11px] text-muted-foreground">
        {isBuiltin
          ? "Read-only representation of the theme."
          : "Edit the theme directly. Apply to commit your changes."}
      </span>
    </div>
    <div
      class="flex flex-col gap-2 rounded-lg bg-card p-3 dark:bg-background"
    >
      <textarea
        value={jsonDraft}
        oninput={isBuiltin ? undefined : onJsonInput}
        readonly={isBuiltin}
        spellcheck={false}
        rows={12}
        class="w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      ></textarea>
      {#if jsonErrors.length > 0}
        <ul
          class="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
        >
          {#each jsonErrors as err}
            <li>{err}</li>
          {/each}
        </ul>
      {/if}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onclick={copyJsonToClipboard}
            class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            <Copy size={11} strokeWidth={2.25} />
            <span>Copy JSON</span>
          </button>
          <button
            type="button"
            onclick={saveJsonToFile}
            class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            <Download size={11} strokeWidth={2.25} />
            <span>Save to file</span>
          </button>
        </div>
        {#if !isBuiltin}
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onclick={resetJsonDraft}
              disabled={!jsonDirty}
              class={cn(
                "flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] transition-colors dark:bg-transparent",
                jsonDirty
                  ? "text-foreground hover:bg-accent"
                  : "cursor-not-allowed text-muted-foreground opacity-60",
              )}
            >
              <RotateCcw size={11} strokeWidth={2.25} />
              <span>Discard edits</span>
            </button>
            <button
              type="button"
              onclick={applyJsonChanges}
              disabled={!jsonDirty}
              class={cn(
                "rounded-md border border-border px-3 py-1 text-[11px] font-medium transition-colors",
                jsonDirty
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-card text-muted-foreground opacity-60 dark:bg-transparent",
              )}
            >
              Apply changes
            </button>
          </div>
        {/if}
      </div>
      {#if jsonNotice}
        <div class="text-[11px] text-muted-foreground">{jsonNotice}</div>
      {/if}
    </div>
  </section>
</div>

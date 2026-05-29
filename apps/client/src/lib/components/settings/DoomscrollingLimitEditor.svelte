<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Save from "@lucide/svelte/icons/save";
  import X from "@lucide/svelte/icons/x";
  import {
    isProtectedDoomscrollingDesktopAppName,
    normalizeDoomscrollingAppName,
    type DoomscrollingUsageLimit,
  } from "$lib/doomscrolling";
  import {
    getDoomscrolling,
    type DoomscrollingUsageLimitEntryDraft,
  } from "$lib/stores/doomscrolling.svelte";
  import { getDoomscrollingUsage } from "$lib/stores/doomscrolling-usage.svelte";
  import CustomSelect from "./CustomSelect.svelte";
  import type { DoomscrollingLimitEditorTarget } from "./types";

  type DurationOption = "15" | "30" | "45" | "60" | "90" | "120" | "180" | "240" | "custom";

  let {
    target,
    onDone,
    onCancel,
  }: {
    target: DoomscrollingLimitEditorTarget;
    onDone: () => void;
    onCancel: () => void;
  } = $props();

  const doomscrolling = getDoomscrolling();
  const usage = getDoomscrollingUsage();

  const durationOptions: readonly { value: DurationOption; label: string }[] = [
    { value: "15", label: "15 minutes" },
    { value: "30", label: "30 minutes" },
    { value: "45", label: "45 minutes" },
    { value: "60", label: "1 hour" },
    { value: "90", label: "1 hour 30 minutes" },
    { value: "120", label: "2 hours" },
    { value: "180", label: "3 hours" },
    { value: "240", label: "4 hours" },
    { value: "custom", label: "Custom" },
  ];
  const durationPresetValues = new Set(
    durationOptions
      .filter((option) => option.value !== "custom")
      .map((option) => option.value),
  );
  let draftName = $state("");
  let draftDurationMode = $state<DurationOption>("30");
  let draftCustomMinutes = $state("30");
  let draftEntries = $state<DoomscrollingUsageLimitEntryDraft[]>([]);
  let formError = $state("");
  let hydratedKey = "";

  const targetLimit = $derived.by<DoomscrollingUsageLimit | null>(() => {
    if (target.mode !== "edit") return null;
    return doomscrolling.usageLimits.find((limit) => limit.id === target.limitId) ?? null;
  });

  function durationModeForMinutes(minutes: number): DurationOption {
    const value = String(minutes) as DurationOption;
    return durationPresetValues.has(value) ? value : "custom";
  }

  function setDraftDurationMode(value: string): void {
    const next = durationOptions.find((option) => option.value === value)?.value ?? "custom";
    draftDurationMode = next;
    if (next !== "custom") {
      draftCustomMinutes = next;
      formError = "";
    }
  }

  function parseDraftMinutes(): number | null {
    const raw = draftDurationMode === "custom" ? draftCustomMinutes : draftDurationMode;
    if (!/^\d+$/.test(raw.trim())) return null;
    const minutes = Number.parseInt(raw, 10);
    return minutes >= 1 && minutes <= 1440 ? minutes : null;
  }

  function createEntryId(): string {
    const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `entry-${suffix}`;
  }

  function createEntryDraft(): DoomscrollingUsageLimitEntryDraft {
    return {
      id: createEntryId(),
      name: "",
      websiteHost: "",
      mobileAppName: "",
      desktopAppName: "",
    };
  }

  function entryHasAnySource(entry: DoomscrollingUsageLimitEntryDraft): boolean {
    return entry.websiteHost.trim() !== ""
      || entry.mobileAppName.trim() !== ""
      || entry.desktopAppName.trim() !== "";
  }

  function entryHasAnyField(entry: DoomscrollingUsageLimitEntryDraft): boolean {
    return entry.name.trim() !== "" || entryHasAnySource(entry);
  }

  function activeEntries(): DoomscrollingUsageLimitEntryDraft[] {
    return draftEntries.filter(entryHasAnyField);
  }

  function hydrateDraft(): void {
    formError = "";
    if (target.mode === "create") {
      draftName = "";
      draftDurationMode = "30";
      draftCustomMinutes = "30";
      draftEntries = [createEntryDraft()];
      return;
    }
    const limit = targetLimit;
    if (!limit) {
      draftName = "";
      draftDurationMode = "30";
      draftCustomMinutes = "30";
      draftEntries = [createEntryDraft()];
      formError = "Limit no longer exists";
      return;
    }
    draftName = limit.name;
    draftDurationMode = durationModeForMinutes(limit.minutesPerDay);
    draftCustomMinutes = String(limit.minutesPerDay);
    draftEntries = limit.entries.map((entry) => ({
      id: entry.id,
      name: entry.name ?? "",
      websiteHost: entry.websiteHost ?? "",
      mobileAppName: entry.mobileAppName ?? "",
      desktopAppName: entry.desktopAppName ?? "",
    }));
    if (draftEntries.length === 0) draftEntries = [createEntryDraft()];
  }

  $effect.pre(() => {
    const key = target.mode === "edit" ? `edit:${target.limitId}` : "create";
    if (key === hydratedKey) return;
    hydratedKey = key;
    hydrateDraft();
  });

  function addEntry(): void {
    draftEntries = [...draftEntries, createEntryDraft()];
    formError = "";
  }

  function updateEntry(
    id: string,
    field: keyof Omit<DoomscrollingUsageLimitEntryDraft, "id">,
    value: string,
  ): void {
    draftEntries = draftEntries.map((entry) =>
      entry.id === id ? { ...entry, [field]: value } : entry
    );
    formError = "";
  }

  function removeEntry(id: string): void {
    draftEntries = draftEntries.filter((entry) => entry.id !== id);
    if (draftEntries.length === 0) draftEntries = [createEntryDraft()];
    formError = "";
  }

  function validatedEntries(): DoomscrollingUsageLimitEntryDraft[] | null {
    const entries = activeEntries();
    if (entries.length === 0) {
      formError = "Add at least one website, mobile app, or desktop app";
      return null;
    }
    if (entries.some((entry) => !entryHasAnySource(entry))) {
      formError = "Each linked row needs a website, mobile app, or desktop app";
      return null;
    }
    for (const entry of entries) {
      const desktopName = entry.desktopAppName.trim()
        ? normalizeDoomscrollingAppName(entry.desktopAppName)
        : null;
      if (desktopName && isProtectedDoomscrollingDesktopAppName(desktopName)) {
        formError = "Protected desktop apps cannot be tracked";
        return null;
      }
    }
    return entries;
  }

  function saveLimit(): void {
    formError = "";
    const minutesPerDay = parseDraftMinutes();
    if (minutesPerDay === null) {
      formError = "Choose a duration from 1 minute to 24 hours";
      return;
    }
    const entries = validatedEntries();
    if (!entries) return;
    const draft = {
      name: draftName,
      minutesPerDay,
      entries,
    };
    const result = target.mode === "edit"
      ? doomscrolling.updateUsageLimit(target.limitId, draft)
      : doomscrolling.addUsageLimit(draft);
    if (result === "saved") {
      void usage.refresh();
      onDone();
      return;
    }
    const messages = {
      "invalid-name": "Enter a limit name",
      "invalid-minutes": "Choose a duration from 1 minute to 24 hours",
      "invalid-sources": "Each row needs a valid website, mobile app, or desktop app",
      "duplicate-source": "Remove duplicate website or app entries",
      "protected-source": "Protected desktop apps cannot be tracked",
      missing: "Limit no longer exists",
    } satisfies Record<Exclude<typeof result, "saved">, string>;
    formError = messages[result];
  }
</script>

<div class="flex flex-col gap-6">
  <header class="flex min-w-0 items-start justify-between gap-3 border-b border-border/70 pb-4">
    <div class="min-w-0">
      <h1 class="truncate text-[1rem] font-semibold text-foreground">
        {target.mode === "edit" ? "Edit usage limit" : "Add usage limit"}
      </h1>
      <p class="mt-1 max-w-2xl text-[0.866667rem] text-muted-foreground">
        Link every source that should share the same daily budget.
      </p>
    </div>
  </header>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Limit details</h2>

    <div class="flex items-center justify-between gap-4 px-1 py-1 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
      <div class="min-w-0 flex-1">
        <label for="doomscrolling-limit-name" class="text-[0.866667rem] text-foreground">Limit name</label>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">Optional. Empty names use the first linked row.</div>
      </div>
      <input
        id="doomscrolling-limit-name"
        bind:value={draftName}
        oninput={() => {
          formError = "";
        }}
        class="h-7 w-72 max-w-full rounded-md border border-border bg-card px-2.5 text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring max-[480px]:w-full dark:bg-transparent"
        placeholder="YouTube"
      />
    </div>

    <CustomSelect
      label="Daily budget"
      description="Presets cover common limits"
      value={draftDurationMode}
      options={durationOptions}
      onChange={setDraftDurationMode}
      class="w-72 max-[480px]:w-full"
    />

    {#if draftDurationMode === "custom"}
      <div class="flex items-center justify-between gap-4 px-1 py-1 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
        <div class="min-w-0 flex-1">
          <label for="doomscrolling-limit-custom-minutes" class="text-[0.866667rem] text-foreground">Custom minutes</label>
          <div class="mt-0.5 text-[0.8rem] text-muted-foreground">Use a whole number from 1 to 1440</div>
        </div>
        <input
          id="doomscrolling-limit-custom-minutes"
          bind:value={draftCustomMinutes}
          oninput={() => {
            formError = "";
          }}
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          class="h-7 w-28 max-w-full rounded-md border border-border bg-card px-2.5 text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring max-[480px]:w-full dark:bg-transparent"
          placeholder="75"
        />
      </div>
    {/if}
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <div class="min-w-0 px-1">
      <h2 class="text-[0.866667rem] font-semibold text-foreground">Linked sources</h2>
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
        Each row can connect the same product across browser, mobile, and desktop.
      </div>
    </div>

    <div class="overflow-x-auto px-1">
      <div class="min-w-full overflow-hidden rounded-md border border-border">
        <div class="grid grid-cols-[minmax(8rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_2.5rem] border-b border-border bg-muted/30 text-[0.733333rem] font-medium text-muted-foreground">
          <div class="px-2 py-1.5">Name</div>
          <div class="px-2 py-1.5">Website domain</div>
          <div class="px-2 py-1.5">Mobile app</div>
          <div class="px-2 py-1.5">Desktop app</div>
          <div aria-hidden="true"></div>
        </div>
        {#each draftEntries as entry (entry.id)}
          <div class="grid grid-cols-[minmax(8rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_2.5rem] items-center border-b border-border/70 last:border-b-0">
            <input
              value={entry.name}
              oninput={(event) => updateEntry(entry.id, "name", event.currentTarget.value)}
              class="h-9 min-w-0 border-0 border-r border-border/70 bg-transparent px-2 text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground focus:bg-accent/35"
              placeholder="Facebook"
            />
            <input
              value={entry.websiteHost}
              oninput={(event) => updateEntry(entry.id, "websiteHost", event.currentTarget.value)}
              class="h-9 min-w-0 border-0 border-r border-border/70 bg-transparent px-2 text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground focus:bg-accent/35"
              placeholder="facebook.com"
            />
            <input
              value={entry.mobileAppName}
              oninput={(event) => updateEntry(entry.id, "mobileAppName", event.currentTarget.value)}
              class="h-9 min-w-0 border-0 border-r border-border/70 bg-transparent px-2 text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground focus:bg-accent/35"
              placeholder="Facebook"
            />
            <input
              value={entry.desktopAppName}
              oninput={(event) => updateEntry(entry.id, "desktopAppName", event.currentTarget.value)}
              class="h-9 min-w-0 border-0 border-r border-border/70 bg-transparent px-2 text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground focus:bg-accent/35"
              placeholder="Facebook"
            />
            <button
              type="button"
              onclick={() => removeEntry(entry.id)}
              aria-label="Remove linked source row"
              class="flex h-9 w-full items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={13} strokeWidth={2.25} />
            </button>
          </div>
        {/each}
      </div>
    </div>

    <div class="flex justify-end px-1">
      <button
        type="button"
        onclick={addEntry}
        class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
      >
        <Plus size={13} strokeWidth={2.25} />
        <span>Add row</span>
      </button>
    </div>
  </section>

  {#if formError}
    <div class="text-[0.8rem] text-destructive">{formError}</div>
  {/if}

  <footer class="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-3">
    <button
      type="button"
      onclick={onCancel}
      class="flex h-8 items-center justify-center rounded-md border border-border bg-card px-3 text-[0.8rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
    >
      Cancel
    </button>
    <button
      type="button"
      onclick={saveLimit}
      class="flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      <Save size={13} strokeWidth={2.25} />
      <span>Save</span>
    </button>
  </footer>
</div>

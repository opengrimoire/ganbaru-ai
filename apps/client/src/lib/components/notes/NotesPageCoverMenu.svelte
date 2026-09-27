<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from "svelte";
  import Search from "@lucide/svelte/icons/search";
  import Shuffle from "@lucide/svelte/icons/shuffle";
  import { pickNotesPageCoverImageFile, saveNotesPageCoverImageDataUrl } from "$lib/api/notes-page-covers";
  import IconPickerColorControl from "$lib/components/icon-picker/IconPickerColorControl.svelte";
  import IconPickerColorChoicePanel from "$lib/components/icon-picker/IconPickerColorChoicePanel.svelte";
  import IconPickerUploadPanel from "$lib/components/icon-picker/IconPickerUploadPanel.svelte";
  import { contrastRatio } from "$lib/components/ui/colorMath";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    inspectManagedImageFile, MANAGED_IMAGE_FILE_ACCEPT, MANAGED_IMAGE_MAX_DIMENSION_PIXELS,
    MANAGED_IMAGE_MAX_MEGAPIXELS, NOTES_PAGE_COVER_IMAGE_MAX_BYTES,
    NOTES_PAGE_COVER_IMAGE_MAX_MEGABYTES, normalizeManagedImageDataUrl,
  } from "$lib/browser-file-policy";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import { getEventColor } from "$lib/components/calendar/utils";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { resolveAppTokens, resolveCalendarTokens } from "$lib/stores/themes";
  import {
    projectIconPickerPanelPlacement, projectIconPickerPointPlacement,
    readProjectIconDefaultColor, readProjectIconAskEveryTime,
    type ProjectIconPickerRect,
  } from "$lib/projects/project-icon-picker";
  import { ensureConfigLoaded, getConfigKey, setConfigKey } from "$lib/vault/config";
  import { createNotesDesignCover, createNotesLocalFilePageCover, NOTES_COVER_DESIGNS, NOTES_COVER_DEFAULT_FOCAL_POINT } from "$lib/notes/page-cover";
  import type { NotesCoverColor, NotesCoverDesign as CoverDesign, NotesCoverFocalPoint } from "$lib/notes/contracts/assets";
  import type { NotesPageCover } from "$lib/notes/types";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import { portal } from "$lib/utils/portal";
  import NotesCoverDesign from "./NotesCoverDesign.svelte";
  import NotesPageCoverImage from "./NotesPageCover.svelte";

  type CoverTab = "designs" | "upload";
  let { cover, trigger, onSelect, onClose }: {
    cover: NotesPageCover | null;
    trigger: HTMLElement | null;
    onSelect: (cover: NotesPageCover | null) => Promise<void>;
    onClose: () => void;
  } = $props();

  const { t } = getLocalization();
  const theme = getTheme();
  const mobileBackStack = getMobileBackStack();
  const initialCover = untrack(() => cover);
  const persist = untrack(() => onSelect);
  const pickerId = $props.id();
  const tabs: readonly CoverTab[] = ["designs", "upload"];
  const PANEL_WIDTH = 360;
  const PANEL_HEIGHT = 440;
  const UPLOAD_HEIGHT = 228;
  const CHOICE_WIDTH_REM = 8.25;
  const CHOICE_HEIGHT_REM = 18.05;
  const DEFAULT_COLOR_KEY = "notes.coverPicker.defaultColor";
  const ASK_COLOR_KEY = "notes.coverPicker.askEveryTime";
  const nativeFilePickerAvailable = platformHasCapability(BUILD_PLATFORM_PROFILE, "storage.native-file-picker");
  const groups = [
    { label: "notes.pageCoverIllustrations", designs: ["contours", "orbit", "botanical", "atlas", "studio"] },
    { label: "notes.pageCoverSimple", designs: ["solid", "gradient", "glow", "dots", "grid"] },
  ] as const;
  let activeTab = $state<CoverTab>(initialCover && initialCover.type !== "design" ? "upload" : "designs");
  let currentCover = $state(initialCover);
  let color = $state<NotesCoverColor>(initialCover?.type === "design" ? initialCover.design.color : "default");
  let askEveryTime = $state(false);
  let colorOpen = $state(false);
  let colorChoice = $state<{ pattern: CoverDesign; anchor: HTMLElement } | null>(null);
  let colorChoiceElement = $state<HTMLElement>();
  let choiceStyle = $state("");
  let panelElement = $state<HTMLDivElement | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let panelPlacement = $state({ left: 0, top: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT });
  let query = $state("");
  let uploadUrl = $state("");
  let repositioning = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let active = true;
  let interacted = false;
  let keyboardInteraction = false;
  let queuedPosition: Exclude<NotesPageCover, { type: "design" }> | null = null;
  let positioning = false;

  const calendarTokens = $derived(resolveCalendarTokens(theme.current));
  const pickerBg = $derived(calendarTokens["--cal-bg"]);
  const automaticColor = $derived(resolveAppTokens(theme.current)["--foreground"]);
  const surfaceStyle = $derived(`background-color:${pickerBg};color:${calendarTokens["--cal-time-label"]};--icon-picker-bg:${pickerBg};--icon-picker-text:${calendarTokens["--cal-time-label"]};--icon-picker-ring:${calendarTokens["--cal-gridline"]};`);
  const colorSelectionBorder = $derived(contrastRatio(pickerBg, "#000000") >= contrastRatio(pickerBg, "#ffffff") ? "#000000" : "#ffffff");
  const panelStyle = $derived(`left:${panelPlacement.left}px;top:${panelPlacement.top}px;width:${panelPlacement.width}px;${activeTab === "designs" ? "height" : "max-height"}:${panelPlacement.height}px;${surfaceStyle}`);
  const matchingDesigns = $derived(NOTES_COVER_DESIGNS.filter((pattern) => designLabel(pattern).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));

  onDestroy(() => { active = false; });
  $effect(() => mobileBackStack.activate({ handle: () => close() }));

  /** Resolve the same visual viewport boundary used to constrain floating pickers. */
  function viewport(): ProjectIconPickerRect {
    const view = window.visualViewport;
    const left = view?.offsetLeft ?? 0;
    const top = view?.offsetTop ?? 0;
    const width = view?.width ?? window.innerWidth;
    const height = view?.height ?? window.innerHeight;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  /** Position this panel and the optional per-design color panel like Add icon. */
  function placePanel(): void {
    if (!trigger) return;
    panelPlacement = projectIconPickerPanelPlacement({
      triggerRect: trigger.getBoundingClientRect(), boundaryRect: viewport(),
      preferredWidth: PANEL_WIDTH, preferredHeight: activeTab === "upload" && !repositioning ? UPLOAD_HEIGHT : PANEL_HEIGHT,
      align: "start",
    });
    if (colorChoice) {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = CHOICE_WIDTH_REM * rem;
      const position = projectIconPickerPointPlacement({
        anchorRect: colorChoice.anchor.getBoundingClientRect(), viewportRect: viewport(),
        panelWidth: width, panelHeight: CHOICE_HEIGHT_REM * rem,
      });
      choiceStyle = `left:${position.left}px;top:${position.top}px;width:${width}px;max-height:${viewport().height - 16}px;${surfaceStyle}`;
    }
  }

  onMount(() => {
    placePanel();
    const frame = requestAnimationFrame(() => panelElement?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }));
    void ensureConfigLoaded().then(() => {
      if (!active || interacted) return;
      askEveryTime = readProjectIconAskEveryTime(getConfigKey<unknown>(ASK_COLOR_KEY, false));
      if (initialCover?.type !== "design") color = readProjectIconDefaultColor(getConfigKey<unknown>(DEFAULT_COLOR_KEY, "default"));
    }).catch((cause: unknown) => { if (active) error = String(cause); });
    /** Dismiss outside both panels while allowing the originating trigger to toggle. */
    function outside(event: PointerEvent): void {
      keyboardInteraction = false;
      const target = event.target;
      if (!(target instanceof Node) || panelElement?.contains(target) || colorChoiceElement?.contains(target) || trigger?.contains(target)) return;
      close();
    }
    /** Match Add icon's Escape dismissal and keyboard focus restoration. */
    function keydown(event: KeyboardEvent): void {
      keyboardInteraction = true;
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    window.visualViewport?.addEventListener("resize", placePanel);
    window.visualViewport?.addEventListener("scroll", placePanel);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
      window.visualViewport?.removeEventListener("resize", placePanel);
      window.visualViewport?.removeEventListener("scroll", placePanel);
    };
  });

  /** Close without reverting already applied choices. */
  function close(): void {
    active = false;
    onClose();
    if (keyboardInteraction) trigger?.focus({ preventScroll: true });
  }

  /** Translate design labels shared by tiles, filtering, and color choices. */
  function designLabel(pattern: CoverDesign): string {
    const keys = {
      solid: "notes.pageCoverDesignSolid", gradient: "notes.pageCoverDesignGradient", glow: "notes.pageCoverDesignGlow",
      contours: "notes.pageCoverDesignContours", studio: "notes.pageCoverDesignStudio", botanical: "notes.pageCoverDesignBotanical",
      orbit: "notes.pageCoverDesignOrbit", atlas: "notes.pageCoverDesignAtlas", dots: "notes.pageCoverDesignDots", grid: "notes.pageCoverDesignGrid",
    } as const;
    return t(keys[pattern]);
  }

  /** Label Automatic and palette slots using the same vocabulary as Add icon. */
  function colorLabel(value: NotesCoverColor): string {
    return value === "default" ? t("projects.iconPicker.automaticColor") : t("notes.pageCoverColor", value + 1);
  }

  /** Persist a completed selection immediately, keeping errors in the picker for retry. */
  async function selectCover(selected: NotesPageCover | null, closeAfter = true): Promise<void> {
    if (busy || !active) return;
    busy = true;
    error = null;
    try {
      await persist(selected);
      if (!active) return;
      currentCover = selected;
      colorChoice = null;
      if (closeAfter) close();
    } catch (cause) {
      if (active) error = t("notes.pageCoverSaveFailed", cause instanceof Error ? cause.message : String(cause));
    } finally { if (active) busy = false; }
  }

  /** Apply the chosen color to an existing design and remember it for the next choice. */
  function selectColor(value: NotesCoverColor): void {
    interacted = true;
    color = value;
    setConfigKey(DEFAULT_COLOR_KEY, value === "default" ? undefined : value);
    if (currentCover?.type === "design") void selectCover(createNotesDesignCover(currentCover.design.pattern, value), false);
  }

  /** Optionally ask for a color beside the chosen tile, matching icon selection. */
  function chooseDesign(pattern: CoverDesign, target: EventTarget | null): void {
    if (busy) return;
    interacted = true;
    colorOpen = false;
    if (askEveryTime && target instanceof HTMLElement) {
      colorChoice = { pattern, anchor: target };
      placePanel();
      void tick().then(() => colorChoiceElement?.querySelector<HTMLButtonElement>("button")?.focus());
    } else void selectCover(createNotesDesignCover(pattern, color));
  }

  /** Move between source tabs using the same keyboard convention as Add icon. */
  function tabKeydown(event: KeyboardEvent, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + 1) % tabs.length;
    setTab(tabs[next]);
    panelElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  /** Reset transient menus when switching source. */
  function setTab(tab: CoverTab): void {
    activeTab = tab;
    colorOpen = false;
    colorChoice = null;
    error = null;
    placePanel();
  }
  /** Validate image bytes before storing an uploaded cover. */
  async function fileToDataUrl(file: File): Promise<string> {
    const inspection = await inspectManagedImageFile(file, NOTES_PAGE_COVER_IMAGE_MAX_BYTES);
    if (!inspection.ok) {
      const { issue } = inspection;
      if (issue === "unsupported-type") {
        return Promise.reject(new Error(t("notes.pageCoverUnsupportedType")));
      }
      if (issue === "too-large") {
        return Promise.reject(new Error(t(
          "notes.pageCoverTooLarge",
          NOTES_PAGE_COVER_IMAGE_MAX_MEGABYTES,
        )));
      }
      if (issue === "invalid-image") {
        return Promise.reject(new Error(t("notes.pageCoverInvalidImage")));
      }
      if (issue === "dimensions-too-large") {
        return Promise.reject(new Error(t(
          "notes.pageCoverDimensionsTooLarge",
          MANAGED_IMAGE_MAX_DIMENSION_PIXELS,
        )));
      }
      if (issue === "too-many-pixels") {
        return Promise.reject(new Error(t(
          "notes.pageCoverPixelCountTooLarge",
          MANAGED_IMAGE_MAX_MEGAPIXELS,
        )));
      }
      return Promise.reject(new Error(t("notes.pageCoverUploadFailed")));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(t("notes.pageCoverUploadFailed")));
      reader.onload = () => {
        if (typeof reader.result === "string") {
          const dataUrl = normalizeManagedImageDataUrl(
            reader.result,
            inspection.metadata.mimeType,
          );
          if (dataUrl) {
            resolve(dataUrl);
            return;
          }
          reject(new Error(t("notes.pageCoverUploadFailed")));
        } else {
          reject(new Error(t("notes.pageCoverUploadFailed")));
        }
      };
      reader.readAsDataURL(file);
    });
  }


  /** Validate and apply pasted or browser-selected images immediately. */
  async function uploadFile(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!active) return;
      const asset = await saveNotesPageCoverImageDataUrl(dataUrl, file.name);
      if (!active) return;
      busy = false;
      await selectCover(createNotesLocalFilePageCover(asset));
    } catch (cause) {
      if (active) error = cause instanceof Error ? cause.message : String(cause);
    } finally { if (active) busy = false; }
  }

  /** Use the same immediate file-selection flow as the Notes icon upload adapter. */
  async function chooseLocalFile(): Promise<void> {
    if (busy) return;
    if (!nativeFilePickerAvailable) { fileInput?.click(); return; }
    busy = true;
    error = null;
    try {
      const asset = await pickNotesPageCoverImageFile();
      if (!active || !asset) return;
      busy = false;
      await selectCover(createNotesLocalFilePageCover(asset));
    } catch (cause) {
      if (active) error = cause instanceof Error ? cause.message : String(cause);
    } finally { if (active) busy = false; }
  }

  /** Serialize focal edits, retaining the latest requested position during a save. */
  async function positionImage(point: NotesCoverFocalPoint): Promise<void> {
    if (!currentCover || currentCover.type === "design") return;
    const selected = { ...currentCover, focal_point: point };
    currentCover = selected;
    queuedPosition = selected;
    if (positioning) return;
    positioning = true;
    busy = true;
    error = null;
    try {
      while (queuedPosition) {
        const next = queuedPosition;
        queuedPosition = null;
        await persist(next);
      }
    } catch (cause) {
      queuedPosition = null;
      if (active) error = t("notes.pageCoverSaveFailed", cause instanceof Error ? cause.message : String(cause));
      else console.error("Could not save Notes cover position", cause);
    } finally { positioning = false; if (active) busy = false; }
  }
</script>

<div
  bind:this={panelElement}
  use:portal
  class="fixed z-90 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border shadow-xl"
  style={panelStyle}
  role="dialog"
  aria-label={t("notes.pageCover")}
  aria-busy={busy}
  tabindex="-1"
  data-app-floating-surface
  onpointerdown={(event) => {
    keyboardInteraction = false;
    if (event.target instanceof Element && !event.target.closest("[data-icon-picker-inline-panel]")) {
      colorOpen = false;
      colorChoice = null;
    }
  }}
  onpaste={activeTab === "upload" ? (event) => {
    const file = event.clipboardData?.files[0];
    if (file) { event.preventDefault(); void uploadFile(file); }
  } : undefined}
>
  <input bind:this={fileInput} class="sr-only" type="file" accept={MANAGED_IMAGE_FILE_ACCEPT} aria-hidden="true" tabindex="-1" onchange={(event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void uploadFile(file);
  }} />
  <div class="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-3">
    <div class="flex min-w-0 items-center gap-3" role="tablist" aria-label={t("notes.pageCover")}>
      {#each tabs as tab, index}
        <button type="button" id={`${pickerId}-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={`${pickerId}-panel`} tabindex={activeTab === tab ? 0 : -1} disabled={busy}
          class={`h-10 border-b-2 px-0.5 text-[0.866667rem] transition-colors ${activeTab === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onclick={() => setTab(tab)} onkeydown={(event) => tabKeydown(event, index)}>
          {tab === "designs" ? t("notes.pageCoverGenerated") : t("notes.pageCoverLocal")}
        </button>
      {/each}
    </div>
    <button type="button" class="h-9 px-1 text-[0.866667rem] text-muted-foreground hover:text-foreground" disabled={busy} onclick={() => { void selectCover(null); }}>{t("projects.iconPicker.remove")}</button>
  </div>

  <div id={`${pickerId}-panel`} role="tabpanel" aria-labelledby={`${pickerId}-tab-${activeTab}`} class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if activeTab === "designs"}
      <div class="flex shrink-0 items-center gap-2 px-3 pt-3">
        <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2">
          <Search size={14} strokeWidth={1.75} class="shrink-0 text-muted-foreground" />
          <input bind:value={query} class="h-8 min-w-0 flex-1 bg-transparent text-[0.866667rem] outline-none placeholder:text-muted-foreground" placeholder={t("projects.iconPicker.filter")} aria-label={t("projects.iconPicker.filter")} />
        </div>
        <button type="button" disabled={busy || matchingDesigns.length === 0} class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t("projects.iconPicker.random")} onclick={(event) => {
          const pattern = matchingDesigns[Math.floor(Math.random() * matchingDesigns.length)];
          if (pattern) chooseDesign(pattern, event.currentTarget);
        }}><Shuffle size={14} strokeWidth={1.75} /></button>
        <IconPickerColorControl bind:open={colorOpen} {color} label={t("notes.pageCoverPalette")} {askEveryTime} {colorSelectionBorder} {automaticColor} {colorLabel}
          colorSwatch={(slot) => getEventColor(slot, theme.current).bg} onSelect={selectColor} onOpen={() => { colorChoice = null; }} disabled={busy}
          onAskEveryTimeChange={(value) => { interacted = true; askEveryTime = value; setConfigKey(ASK_COLOR_KEY, value); if (!value) colorChoice = null; }} />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        {#each groups as group}
          {@const designs = group.designs.filter((pattern) => matchingDesigns.includes(pattern))}
          {#if designs.length}
            <section class="mb-3">
              <div class="mb-1 flex h-5 items-center gap-2 text-[0.733333rem] text-muted-foreground"><span>{t(group.label)}</span><span class="h-px flex-1 bg-border/70"></span></div>
              <div class="grid grid-cols-2 gap-2">
                {#each designs as pattern}
                  <button type="button" disabled={busy} class="group rounded-md p-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={designLabel(pattern)} onclick={(event) => chooseDesign(pattern, event.currentTarget)}>
                    <span class="block h-20 overflow-hidden rounded-md"><NotesCoverDesign {pattern} {color} /></span>
                    <span class="mt-1 block truncate px-0.5 text-[0.733333rem] text-muted-foreground group-hover:text-foreground">{designLabel(pattern)}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/if}
        {/each}
        {#if matchingDesigns.length === 0}<p class="py-6 text-center text-[0.8rem] text-muted-foreground">{t("notes.pageCoverNoDesigns")}</p>{/if}
      </div>
      {#if error}<p class="mx-3 mb-3 rounded-md bg-destructive/10 px-2 py-1 text-[0.8rem] text-destructive" role="alert">{error}</p>{/if}
    {:else}
      <IconPickerUploadPanel uploadDraft={null} uploadPreviewUrl={null} uploadError={error} uploading={busy}
        uploadBodyStyle={`max-height:${Math.max(0, panelPlacement.height - 48)}px;`} bind:uploadUrl
        onChooseFile={chooseLocalFile} onDiscardDraft={() => {}} onSelectDraft={() => {}} onDownloadUrl={() => {}} remoteUrlAvailable={false} />
      {#if currentCover && currentCover.type !== "design"}
        <div class="min-h-0 space-y-2 overflow-y-auto px-3 pb-3">
          <button type="button" disabled={busy} class="h-8 rounded-md px-2 text-[0.866667rem] text-muted-foreground hover:bg-accent hover:text-foreground" aria-expanded={repositioning} onclick={() => { repositioning = !repositioning; placePanel(); }}>{t("notes.pageCoverReposition")}</button>
          {#if repositioning}
            <p class="text-[0.733333rem] text-muted-foreground">{t("notes.pageCoverFocalHint")}</p>
            <div class="h-40 rounded-md bg-muted"><NotesPageCoverImage cover={currentCover} objectFit="contain" unavailableLabel={t("notes.pageCoverUnavailable")} focalLabel={t("notes.pageCoverFocalHint")} onFocalPoint={(point) => { void positionImage(point); }} /></div>
            <button class="h-8 rounded-md px-2 text-[0.8rem] text-muted-foreground hover:bg-accent" type="button" onclick={() => { void positionImage({ ...NOTES_COVER_DEFAULT_FOCAL_POINT }); }}>{t("notes.pageCoverResetPosition")}</button>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if colorChoice}
  <IconPickerColorChoicePanel bind:rootElement={colorChoiceElement} style={choiceStyle} label={designLabel(colorChoice.pattern)}
    iconColorLabel={colorLabel} iconColorStyle={(slot) => `color:${getEventColor(slot, theme.current).bg};`} automaticIconColor={automaticColor}
    automaticLabel={t("projects.iconPicker.automaticColor")} columns={4} disabled={busy}
    onSelect={(value) => { if (colorChoice) void selectCover(createNotesDesignCover(colorChoice.pattern, value)); }}>
    {#snippet preview(value: NotesCoverColor)}
      {#if colorChoice}<span class="block size-5.5 overflow-hidden rounded-sm"><NotesCoverDesign pattern={colorChoice.pattern} color={value} /></span>{/if}
    {/snippet}
  </IconPickerColorChoicePanel>
{/if}

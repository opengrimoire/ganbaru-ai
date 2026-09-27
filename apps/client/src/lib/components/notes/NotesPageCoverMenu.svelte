<script lang="ts">
  import { onMount } from "svelte";
  import {
    pickNotesPageCoverImageFile,
    saveNotesPageCoverImageDataUrl,
  } from "$lib/api/notes-page-covers";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    inspectManagedImageFile,
    MANAGED_IMAGE_FILE_ACCEPT,
    MANAGED_IMAGE_MAX_DIMENSION_PIXELS,
    MANAGED_IMAGE_MAX_MEGAPIXELS,
    NOTES_PAGE_COVER_IMAGE_MAX_BYTES,
    NOTES_PAGE_COVER_IMAGE_MAX_MEGABYTES,
    normalizeManagedImageDataUrl,
  } from "$lib/browser-file-policy";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import {
    createNotesExternalPageCover,
    createNotesLocalFilePageCover,
    notesPageCoverPresetBackground,
    notesPageCoverUrl,
    NOTES_PAGE_COVER_PRESETS,
    type NotesPageCoverPreset,
  } from "$lib/notes/page-cover";
  import type { NotesPageCover } from "$lib/notes/types";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import { dismissOnOutside } from "$lib/utils/dismiss-on-outside";
  import { portal } from "$lib/utils/portal";
  import ImageIcon from "@lucide/svelte/icons/image";
  import LinkIcon from "@lucide/svelte/icons/link";
  import Save from "@lucide/svelte/icons/save";
  import Upload from "@lucide/svelte/icons/upload";

  type CoverTab = "presets" | "upload" | "url";

  let {
    cover,
    trigger,
    style,
    onSelect,
    onClose,
  }: {
    cover: NotesPageCover | null;
    trigger: HTMLElement | null;
    style: string;
    onSelect: (cover: NotesPageCover | null) => void;
    onClose: () => void;
  } = $props();

  const { t } = getLocalization();
  const mobileBackStack = getMobileBackStack();
  const nativeFilePickerAvailable = platformHasCapability(
    BUILD_PLATFORM_PROFILE,
    "storage.native-file-picker",
  );
  const remoteImageUrlsAvailable = platformHasCapability(
    BUILD_PLATFORM_PROFILE,
    "notes.external-image-references",
  );
  const tabs = $derived.by((): CoverTab[] => remoteImageUrlsAvailable
    ? ["presets", "upload", "url"]
    : ["presets", "upload"]);
  let activeTab = $state<CoverTab>("presets");
  let panelElement: HTMLDivElement | null = $state(null);
  let fileInput = $state<HTMLInputElement>();
  let urlDraft = $state("");
  let error = $state<string | null>(null);
  let uploading = $state(false);
  let lastCoverUrl = "";

  $effect(() => mobileBackStack.activate({ handle: onClose }));

  onMount(() => {
    const frame = requestAnimationFrame(() => {
      panelElement?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    const nextUrl = notesPageCoverUrl(cover) ?? "";
    if (nextUrl === lastCoverUrl) return;
    lastCoverUrl = nextUrl;
    urlDraft = nextUrl;
    error = null;
  });

  function tabLabel(tab: CoverTab): string {
    if (tab === "presets") return t("notes.pageCoverGenerated");
    if (tab === "upload") return t("notes.pageCoverLocal");
    return t("notes.pageCoverExternal");
  }

  function handleTabKeydown(event: KeyboardEvent, index: number): void {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    activeTab = tabs[nextIndex];
    error = null;
    panelElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }

  function presetLabel(preset: NotesPageCoverPreset): string {
    if (preset.id === "calm-lines") return t("notes.pageCoverPresetCalmLines");
    if (preset.id === "focus-dawn") return t("notes.pageCoverPresetFocusDawn");
    if (preset.id === "deep-work") return t("notes.pageCoverPresetDeepWork");
    return t("notes.pageCoverPresetGreenhouse");
  }

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

  function generatedCoverDataUrl(preset: NotesPageCoverPreset): string {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("notes.pageCoverUploadFailed"));
    const [start, middle, end] = preset.colors;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, start);
    gradient.addColorStop(0.52, middle);
    gradient.addColorStop(1, end);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 0.16;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3;
    for (let index = -2; index < 10; index += 1) {
      context.beginPath();
      context.moveTo(index * 180, canvas.height + 20);
      context.bezierCurveTo(
        index * 180 + 120,
        260,
        index * 180 + 260,
        240,
        index * 180 + 420,
        -20,
      );
      context.stroke();
    }
    context.globalAlpha = 0.18;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(1320, 120, 160, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    return canvas.toDataURL("image/png");
  }

  function saveExternalCover(): void {
    error = null;
    try {
      onSelect(createNotesExternalPageCover(urlDraft));
    } catch {
      error = t("notes.pageCoverUrlInvalid");
    }
  }

  async function choosePreset(preset: NotesPageCoverPreset): Promise<void> {
    uploading = true;
    error = null;
    try {
      const asset = await saveNotesPageCoverImageDataUrl(generatedCoverDataUrl(preset), `${preset.id}.png`);
      onSelect(createNotesLocalFilePageCover(asset));
    } catch (selectError) {
      error = selectError instanceof Error ? selectError.message : String(selectError);
    } finally {
      uploading = false;
    }
  }

  async function chooseLocalFile(): Promise<void> {
    if (!nativeFilePickerAvailable) {
      fileInput?.click();
      return;
    }
    uploading = true;
    error = null;
    try {
      const asset = await pickNotesPageCoverImageFile();
      if (asset) onSelect(createNotesLocalFilePageCover(asset));
    } catch (selectError) {
      error = selectError instanceof Error ? selectError.message : String(selectError);
    } finally {
      uploading = false;
    }
  }

  async function saveLocalFile(file: File): Promise<void> {
    uploading = true;
    error = null;
    try {
      const dataUrl = await fileToDataUrl(file);
      const asset = await saveNotesPageCoverImageDataUrl(dataUrl, file.name);
      onSelect(createNotesLocalFilePageCover(asset));
    } catch (selectError) {
      error = selectError instanceof Error ? selectError.message : String(selectError);
    } finally {
      uploading = false;
    }
  }

  async function handleFileInput(event: Event): Promise<void> {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = "";
    if (file) await saveLocalFile(file);
  }

  async function handlePaste(event: ClipboardEvent): Promise<void> {
    const file = event.clipboardData?.files[0];
    if (!file) return;
    event.preventDefault();
    await saveLocalFile(file);
  }
</script>

<div
  bind:this={panelElement}
  use:portal
  use:dismissOnOutside={{ onDismiss: (reason, event) => {
    if (reason === "outside-pointer" && event.target instanceof Node && trigger?.contains(event.target)) return;
    if (reason === "escape") trigger?.focus({ preventScroll: true });
    onClose();
  } }}
  class="fixed z-90 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
  {style}
  role="dialog"
  aria-label={t("notes.pageCover")}
  data-app-floating-surface
  onpaste={(event) => { void handlePaste(event); }}
>
  <input
    bind:this={fileInput}
    class="sr-only"
    type="file"
    accept={MANAGED_IMAGE_FILE_ACCEPT}
    aria-hidden="true"
    tabindex="-1"
    onchange={(event) => { void handleFileInput(event); }}
  />
  <div class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
    <div class="flex min-w-0 items-center gap-3" role="tablist" aria-label={t("notes.pageCover")}>
    {#each tabs as tab, index}
      <button
        type="button"
        id={`notes-cover-tab-${tab}`}
        role="tab"
        aria-selected={activeTab === tab}
        aria-controls="notes-cover-tab-panel"
        tabindex={activeTab === tab ? 0 : -1}
        class={`h-12 border-b-2 px-0.5 text-[0.866667rem] transition-colors ${
          activeTab === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
        onclick={() => {
          activeTab = tab;
          error = null;
        }}
        onkeydown={(event) => handleTabKeydown(event, index)}
      >
        {tabLabel(tab)}
      </button>
    {/each}
    </div>
    {#if cover}
      <button
        class="h-9 shrink-0 px-1 text-[0.866667rem] text-muted-foreground hover:text-destructive"
        type="button"
        disabled={uploading}
        onclick={() => onSelect(null)}
      >
        {t("notes.removePageCover")}
      </button>
    {/if}
  </div>

  <div id="notes-cover-tab-panel" role="tabpanel" aria-labelledby={`notes-cover-tab-${activeTab}`} class="min-h-0 overflow-y-auto p-3">
  {#if activeTab === "presets"}
    <div class="grid grid-cols-2 gap-2">
      {#each NOTES_PAGE_COVER_PRESETS as preset}
        <button
          type="button"
          class="group flex h-24 w-full items-end overflow-hidden rounded-lg border border-border/70 p-2 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          style={`background: ${notesPageCoverPresetBackground(preset)}`}
          disabled={uploading}
          aria-label={t("notes.usePageCover", presetLabel(preset))}
          data-app-tooltip={t("notes.usePageCover", presetLabel(preset))}
          onclick={() => { void choosePreset(preset); }}
        >
          <span class="rounded-md bg-background/90 px-2 py-1 text-[0.733333rem] font-medium text-foreground shadow-sm">
            {presetLabel(preset)}
          </span>
        </button>
      {/each}
    </div>
  {:else if activeTab === "upload"}
    <div class="grid gap-3">
      <button
        type="button"
        class="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 text-[0.866667rem] text-foreground hover:border-foreground/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        disabled={uploading}
        onclick={() => { void chooseLocalFile(); }}
      >
        <Upload class="size-5 text-muted-foreground" />
        <span class="font-medium">{t("notes.uploadPageCover")}</span>
        <span class="text-[0.733333rem] text-muted-foreground">{t("notes.pageCoverPasteHint")}</span>
      </button>
      <div class="flex items-center justify-center gap-1 text-[0.733333rem] text-muted-foreground">
        <ImageIcon class="size-3.5" />
        <span>{t("notes.pageCoverImageTypes")}</span>
      </div>
    </div>
  {:else}
    <form
      class="grid gap-3"
      onsubmit={(event) => {
        event.preventDefault();
        saveExternalCover();
      }}
    >
      <label class="block text-[0.866667rem] font-medium text-foreground" for="notes-cover-url">
        {t("notes.pageCoverUrl")}
      </label>
      <div class="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <LinkIcon class="size-3.5 shrink-0 text-muted-foreground" />
        <input
          id="notes-cover-url"
          class="min-w-0 flex-1 bg-transparent text-[0.866667rem] text-foreground outline-none placeholder:text-muted-foreground"
          type="url"
          bind:value={urlDraft}
          placeholder={t("notes.pageCoverUrlPlaceholder")}
        />
      </div>
      <button
        class="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[0.866667rem] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={uploading || !urlDraft.trim()}
      >
        <Save class="size-3.5" />
        <span>{t("notes.savePageCover")}</span>
      </button>
    </form>
  {/if}

  {#if error}
    <div class="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[0.8rem] text-destructive" role="alert">{error}</div>
  {/if}
  </div>
</div>

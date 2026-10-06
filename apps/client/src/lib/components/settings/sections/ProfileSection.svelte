<script lang="ts">
  import Save from "@lucide/svelte/icons/save";
  import ImagePlus from "@lucide/svelte/icons/image-plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { deleteProfileImageFile } from "$lib/api/profile-image";
  import { pickProfileImageFile } from "$lib/api/profile-image-picker";
  import ProfileAvatar from "$lib/components/profile/ProfileAvatar.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { NotesLocalUser } from "$lib/notes/types";
  import {
    PROFILE_DISPLAY_NAME_FALLBACK,
    PROFILE_DISPLAY_NAME_MAX_CHARS,
    PROFILE_FULL_NAME_MAX_CHARS,
    normalizeProfileDisplayName,
    normalizeProfileFullName,
  } from "$lib/stores/preference-options";
  import { getNotes } from "$lib/stores/notes.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { cn } from "$lib/utils";
  import { moveTextInputCaretToPointer } from "$lib/utils/text-input-caret";

  const notes = getNotes();
  const preferences = getPreferences();
  const { t } = getLocalization();

  let draftDisplayName = $state(preferences.profileDisplayName);
  let draftFullName = $state(preferences.profileFullName);
  let initializedDisplayName = $state<string | null>(null);
  let initializedFullName = $state<string | null>(null);
  let saving = $state(false);
  let savingImage = $state(false);
  let saveError = $state<string | null>(null);
  let saved = $state(false);

  const normalizedDisplayName = $derived(normalizeProfileDisplayName(draftDisplayName));
  const normalizedFullName = $derived(normalizeProfileFullName(draftFullName));
  const validationMessage = $derived.by(() => {
    if (!normalizedDisplayName.ok && normalizedDisplayName.reason === "too_long") {
      return t("settings.profileIdentity.nameTooLong", PROFILE_DISPLAY_NAME_MAX_CHARS);
    }
    if (!normalizedDisplayName.ok) return t("settings.profileIdentity.invalidName");
    if (!normalizedFullName.ok && normalizedFullName.reason === "too_long") {
      return t("settings.profileIdentity.fullNameTooLong", PROFILE_FULL_NAME_MAX_CHARS);
    }
    if (!normalizedFullName.ok) return t("settings.profileIdentity.invalidFullName");
    return null;
  });
  const unchanged = $derived(
    normalizedDisplayName.ok
      && normalizedFullName.ok
      && normalizedDisplayName.value === preferences.profileDisplayName
      && normalizedFullName.value === preferences.profileFullName,
  );
  const hasSaveableChange = $derived(
    normalizedDisplayName.ok && normalizedFullName.ok && !unchanged,
  );
  const canSave = $derived(hasSaveableChange && !saving);

  $effect(() => {
    const current = preferences.profileDisplayName;
    if (initializedDisplayName === current) return;
    initializedDisplayName = current;
    draftDisplayName = current;
  });

  $effect(() => {
    const current = preferences.profileFullName;
    if (initializedFullName === current) return;
    initializedFullName = current;
    draftFullName = current;
  });

  async function saveIdentity(): Promise<void> {
    saveError = null;
    saved = false;
    const displayName = normalizeProfileDisplayName(draftDisplayName);
    if (!displayName.ok) {
      saveError = displayName.reason === "too_long"
        ? t("settings.profileIdentity.nameTooLong", PROFILE_DISPLAY_NAME_MAX_CHARS)
        : t("settings.profileIdentity.invalidName");
      return;
    }
    const fullName = normalizeProfileFullName(draftFullName);
    if (!fullName.ok) {
      saveError = fullName.reason === "too_long"
        ? t("settings.profileIdentity.fullNameTooLong", PROFILE_FULL_NAME_MAX_CHARS)
        : t("settings.profileIdentity.invalidFullName");
      return;
    }

    const shouldUpdateNotesName = displayName.value !== preferences.profileDisplayName;
    const notesDisplayName = displayName.value || PROFILE_DISPLAY_NAME_FALLBACK;
    saving = true;
    try {
      if (shouldUpdateNotesName) {
        const updated: NotesLocalUser | null = await notes.updateLocalUserDisplayName(notesDisplayName);
        if (!updated) {
          saveError = notes.localUserError ?? t("settings.profileIdentity.syncFailed");
          return;
        }
      }
      if (!preferences.setProfileDisplayName(displayName.value)) {
        saveError = t("settings.profileIdentity.invalidName");
        return;
      }
      if (!preferences.setProfileFullName(fullName.value)) {
        saveError = t("settings.profileIdentity.invalidFullName");
        return;
      }
      draftDisplayName = displayName.value;
      draftFullName = fullName.value;
      saved = true;
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  async function chooseProfileImage(): Promise<void> {
    saveError = null;
    saved = false;
    savingImage = true;
    try {
      const selected = await pickProfileImageFile(t("settings.profileIdentity.picturePickerTitle"));
      if (!selected || selected.relativePath === preferences.profileImagePath) return;
      const previous = preferences.profileImagePath;
      if (!preferences.setProfileImagePath(selected.relativePath)) {
        await deleteProfileImageFile(selected.relativePath);
        throw new Error(t("settings.profileIdentity.invalidPicture"));
      }
      if (previous) await deleteProfileImageFile(previous);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      saveError = t("settings.profileIdentity.pictureUpdateFailed", message);
    } finally {
      savingImage = false;
    }
  }

  async function removeProfileImage(): Promise<void> {
    const previous = preferences.profileImagePath;
    if (!previous || savingImage) return;
    saveError = null;
    saved = false;
    savingImage = true;
    try {
      if (!preferences.setProfileImagePath(null)) {
        throw new Error(t("settings.profileIdentity.invalidPicture"));
      }
      await deleteProfileImageFile(previous);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      saveError = t("settings.profileIdentity.pictureUpdateFailed", message);
    } finally {
      savingImage = false;
    }
  }

  function handleIdentityKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      if (canSave) void saveIdentity();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      draftDisplayName = preferences.profileDisplayName;
      draftFullName = preferences.profileFullName;
      saveError = null;
      saved = false;
    }
  }
</script>

<div class="flex min-h-full flex-col">
  <section class="flex flex-1 flex-col gap-4 pb-6">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("settings.profileIdentity.heading")}</h2>

    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-4 px-1 py-1 max-[520px]:flex-col max-[520px]:items-stretch max-[520px]:gap-3">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <ProfileAvatar
            displayName={draftDisplayName || PROFILE_DISPLAY_NAME_FALLBACK}
            imagePath={preferences.profileImagePath}
            size={56}
          />
          <div class="min-w-0">
            <div class="text-[0.866667rem] text-foreground">{t("settings.profileIdentity.picture")}</div>
            <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
              {t("settings.profileIdentity.pictureDescription")}
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2 max-[520px]:pl-17">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-55 dark:bg-transparent"
            disabled={savingImage}
            onclick={() => void chooseProfileImage()}
          >
            <ImagePlus size={13} />
            {t("settings.profileIdentity.uploadPicture")}
          </button>
          {#if preferences.profileImagePath}
            <button
              type="button"
              class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-55"
              disabled={savingImage}
              aria-label={t("settings.profileIdentity.removePicture")}
              title={t("settings.profileIdentity.removePicture")}
              onclick={() => void removeProfileImage()}
            >
              <Trash2 size={14} />
            </button>
          {/if}
        </div>
      </div>
      <div class="flex items-center justify-between gap-4 px-1 py-1 max-[520px]:flex-col max-[520px]:items-stretch max-[520px]:gap-2">
        <div class="min-w-0 flex-1">
          <label for="profile-display-name" class="text-[0.866667rem] text-foreground">
            {t("settings.profileIdentity.displayName")}
          </label>
          <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
            {t("settings.profileIdentity.description")}
          </div>
        </div>

        <input
          id="profile-display-name"
          class="field w-44 min-w-0 px-2.5 text-left text-[0.8rem] font-medium text-foreground max-[520px]:w-full"
          value={draftDisplayName}
          maxlength={PROFILE_DISPLAY_NAME_MAX_CHARS}
          disabled={saving}
          onpointerdown={moveTextInputCaretToPointer}
          onkeydown={handleIdentityKeydown}
          oninput={(event) => {
            draftDisplayName = event.currentTarget.value;
            saveError = null;
            saved = false;
          }}
        />
      </div>
      <div class="flex items-center justify-between gap-4 px-1 py-1 max-[520px]:flex-col max-[520px]:items-stretch max-[520px]:gap-2">
        <div class="min-w-0 flex-1">
          <label for="profile-full-name" class="text-[0.866667rem] text-foreground">
            {t("settings.profileIdentity.fullName")}
          </label>
          <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
            {t("settings.profileIdentity.fullNameDescription")}
          </div>
        </div>

        <input
          id="profile-full-name"
          class="field w-44 min-w-0 px-2.5 text-left text-[0.8rem] font-medium text-foreground max-[520px]:w-full"
          value={draftFullName}
          maxlength={PROFILE_FULL_NAME_MAX_CHARS}
          disabled={saving}
          onpointerdown={moveTextInputCaretToPointer}
          onkeydown={handleIdentityKeydown}
          oninput={(event) => {
            draftFullName = event.currentTarget.value;
            saveError = null;
            saved = false;
          }}
        />
      </div>
    </div>
  </section>

  <footer class="sticky bottom-0 shrink-0 pt-3">
    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
      <div class="min-w-0 flex-1 px-1 text-[0.8rem] leading-5">
        {#if saveError}
          <span role="alert" class="text-destructive">
            {t("settings.profileIdentity.saveFailed", saveError)}
          </span>
        {:else if validationMessage}
          <span role="alert" class="text-destructive">
            {validationMessage}
          </span>
        {/if}
      </div>
      <button
        type="button"
        onclick={() => void saveIdentity()}
        disabled={!hasSaveableChange || saving}
        class={cn(
          "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground transition-colors disabled:pointer-events-none",
          hasSaveableChange || saving ? "hover:bg-primary/90" : "opacity-55",
        )}
      >
        <Save size={13} strokeWidth={2.25} class="shrink-0" />
        <span>{t("settings.profileIdentity.save")}</span>
      </button>
    </div>
  </footer>
</div>

import { invoke } from "@tauri-apps/api/core";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { getConfigKey, setConfigKey } from "$lib/vault/config";
import { formatNumber } from "$lib/i18n/formatters";
import { getLocalization } from "$lib/i18n/translator.svelte";
import {
  DEFAULT_AUTO_UPDATE_NOTIFICATIONS,
  errorText,
  parseStoredUpdateCheckAt,
  releasePageUrl,
  shouldRunAutomaticUpdateCheck,
  updateCheckErrorMessage,
} from "./updates";
import { GITHUB_REPOSITORY } from "$lib/buildInfo";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installed"
  | "error";

const AUTO_UPDATE_NOTIFICATIONS_CONFIG_KEY = "updates.autoNotifications";
const LAST_AUTO_UPDATE_CHECK_AT_CONFIG_KEY = "updates.lastAutoCheckAt";

interface CheckForUpdatesOptions {
  automatic?: boolean;
}

function loadAutoUpdateNotifications(): boolean {
  const saved = getConfigKey<unknown>(
    AUTO_UPDATE_NOTIFICATIONS_CONFIG_KEY,
    undefined,
  );
  return typeof saved === "boolean" ? saved : DEFAULT_AUTO_UPDATE_NOTIFICATIONS;
}

function loadLastAutoCheckAt(): string | null {
  return parseStoredUpdateCheckAt(
    getConfigKey<unknown>(LAST_AUTO_UPDATE_CHECK_AT_CONFIG_KEY, undefined),
  );
}

class UpdateManagerStore {
  private localization = getLocalization();
  status = $state<UpdateStatus>("idle");
  pendingUpdate = $state<Update | null>(null);
  currentVersion = $state<string | null>(null);
  latestVersion = $state<string | null>(null);
  releaseNotes = $state<string | null>(null);
  errorMessage = $state<string | null>(null);
  downloadedBytes = $state(0);
  contentLength = $state<number | null>(null);
  autoNotifications = $state(loadAutoUpdateNotifications());
  lastAutoCheckAt = $state<string | null>(loadLastAutoCheckAt());
  promptDismissed = $state(false);
  private automaticCheckStarted = false;

  progressPercent = $derived(
    this.contentLength && this.contentLength > 0
      ? Math.min(100, Math.round((this.downloadedBytes / this.contentLength) * 100))
      : null,
  );

  statusCopy = $derived.by(() => {
    const { t } = this.localization;
    switch (this.status) {
      case "checking":
        return t("updates.checkingFeed");
      case "current":
        return t("updates.current");
      case "available":
        return t("updates.versionAvailable", this.latestVersion ?? "unknown");
      case "downloading":
        return this.progressPercent === null
          ? t("updates.downloadingBytes", this.formatBytes(this.downloadedBytes))
          : t("updates.downloadingPercent", this.progressPercent);
      case "installed":
        return t("updates.installedRestarting");
      case "error":
        return this.errorMessage ?? t("updates.checkFailed");
      default:
        return t("updates.notChecked");
    }
  });

  showPrompt = $derived(
    !this.promptDismissed
      && (this.status === "available"
        || this.status === "downloading"
        || this.status === "installed"),
  );

  releasePageUrl = $derived(releasePageUrl(GITHUB_REPOSITORY, this.latestVersion));

  setAutoNotifications(enabled: boolean): void {
    this.autoNotifications = enabled;
    setConfigKey(AUTO_UPDATE_NOTIFICATIONS_CONFIG_KEY, enabled);
    if (!enabled) {
      this.promptDismissed = true;
    }
  }

  dismissPrompt(): void {
    this.promptDismissed = true;
  }

  closePendingUpdate(): void {
    const update = this.pendingUpdate;
    if (!update) return;
    void update.close().catch((error: unknown) => {
      console.error("Failed to close pending update resource:", error);
    });
  }

  resetUpdateState(): void {
    this.closePendingUpdate();
    this.pendingUpdate = null;
    this.latestVersion = null;
    this.releaseNotes = null;
    this.errorMessage = null;
    this.downloadedBytes = 0;
    this.contentLength = null;
  }

  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"] as const;
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
    return `${formatNumber(this.localization.locale, value, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} ${units[unitIndex]}`;
  }

  async checkAutomatically(): Promise<void> {
    if (import.meta.env.DEV || this.automaticCheckStarted) return;
    if (!shouldRunAutomaticUpdateCheck(this.autoNotifications, this.lastAutoCheckAt)) {
      return;
    }

    this.automaticCheckStarted = true;
    await this.checkForUpdates({ automatic: true });
  }

  async checkForUpdates(options: CheckForUpdatesOptions = {}): Promise<void> {
    if (
      this.status === "checking"
      || this.status === "downloading"
      || this.status === "installed"
    ) {
      return;
    }

    const automatic = options.automatic === true;
    if (automatic && !this.autoNotifications) return;

    if (automatic) {
      const checkedAt = new Date().toISOString();
      this.lastAutoCheckAt = checkedAt;
      setConfigKey(LAST_AUTO_UPDATE_CHECK_AT_CONFIG_KEY, checkedAt);
    }

    this.resetUpdateState();
    this.status = "checking";
    if (!automatic) {
      this.promptDismissed = false;
    }

    try {
      const update = await check({ timeout: 30_000 });
      if (!update) {
        this.status = "current";
        return;
      }

      this.pendingUpdate = update;
      this.currentVersion = update.currentVersion;
      this.latestVersion = update.version;
      this.releaseNotes = update.body ?? null;
      this.promptDismissed = false;
      this.status = "available";
    } catch (error: unknown) {
      this.status = "error";
      this.errorMessage = updateCheckErrorMessage(error, this.localization.t);
      if (automatic) {
        this.promptDismissed = true;
      }
    }
  }

  async installUpdate(): Promise<void> {
    if (!this.pendingUpdate || this.status !== "available") return;
    this.status = "downloading";
    this.errorMessage = null;
    this.downloadedBytes = 0;
    this.contentLength = null;

    try {
      await this.pendingUpdate.downloadAndInstall((event) => {
        this.handleDownloadEvent(event);
      }, { timeout: 120_000 });
      this.status = "installed";
      void invoke("restart_app");
    } catch (error: unknown) {
      this.status = "error";
      this.errorMessage = errorText(error);
    }
  }

  private handleDownloadEvent(event: DownloadEvent): void {
    switch (event.event) {
      case "Started":
        this.contentLength = event.data.contentLength ?? null;
        this.downloadedBytes = 0;
        break;
      case "Progress":
        this.downloadedBytes += event.data.chunkLength;
        break;
      case "Finished":
        if (this.contentLength === null) {
          this.contentLength = this.downloadedBytes;
        }
        break;
    }
  }
}

let store: UpdateManagerStore | null = null;

export function getUpdateManager(): UpdateManagerStore {
  store ??= new UpdateManagerStore();
  return store;
}

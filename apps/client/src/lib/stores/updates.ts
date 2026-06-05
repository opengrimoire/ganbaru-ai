export const DEFAULT_AUTO_UPDATE_NOTIFICATIONS = true;
export const UPDATE_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

/**
 * Normalize a stored update check timestamp.
 *
 * @param value Stored config value.
 * @returns ISO timestamp, or null when the value is unusable.
 */
export function parseStoredUpdateCheckAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

/**
 * Decide whether the automatic update check can run.
 *
 * @param enabled User preference for automatic update notifications.
 * @param lastCheckAt Last attempted automatic check timestamp.
 * @param nowMs Current wall-clock timestamp.
 * @returns Whether the daily check should run now.
 */
export function shouldRunAutomaticUpdateCheck(
  enabled: boolean,
  lastCheckAt: string | null,
  nowMs = Date.now(),
): boolean {
  if (!enabled) return false;
  if (!lastCheckAt) return true;

  const lastCheckMs = Date.parse(lastCheckAt);
  if (!Number.isFinite(lastCheckMs)) return true;
  if (lastCheckMs > nowMs) return true;

  return nowMs - lastCheckMs >= UPDATE_AUTO_CHECK_INTERVAL_MS;
}

/**
 * Build the GitHub release page URL for an updater version.
 *
 * @param repository GitHub repository in owner/name form.
 * @param version Release version reported by the updater.
 * @returns GitHub release page URL, or null when inputs are invalid.
 */
export function releasePageUrl(repository: string, version: string | null): string | null {
  const normalizedRepository = repository.trim();
  const normalizedVersion = version?.trim();
  if (!GITHUB_REPOSITORY_PATTERN.test(normalizedRepository) || !normalizedVersion) {
    return null;
  }
  if (!RELEASE_VERSION_PATTERN.test(normalizedVersion)) return null;

  const tag = `app-v${normalizedVersion}`;
  return `https://github.com/${normalizedRepository}/releases/tag/${encodeURIComponent(tag)}`;
}

/**
 * Convert updater errors into user-facing copy.
 *
 * @param error Unknown thrown value.
 * @returns Short error message.
 */
export function updateCheckErrorMessage(
  error: unknown,
  t: Translate = translate,
): string {
  const message = errorText(error);
  if (/endpoint|pubkey|public key|configured|configuration/i.test(message)) {
    return t("updates.feedNotConfigured");
  }
  return message;
}

/**
 * Convert an unknown error value to text.
 *
 * @param error Unknown thrown value.
 * @returns Error text.
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
import { translate, type Translate } from "$lib/i18n/translator.svelte";

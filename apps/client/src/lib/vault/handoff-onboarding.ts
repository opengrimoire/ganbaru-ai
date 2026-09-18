const VAULT_HANDOFF_ONBOARDING_STORAGE_KEY = "ganbaru.vault-handoff-onboarding.v2";
const INDEPENDENT_VAULT_USED_STORAGE_KEY = "ganbaru.vault-handoff-independent-vault.v1";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** Return whether this installation has completed device-linking onboarding. */
export function vaultHandoffOnboardingCompleted(
  storage: ReadableStorage | undefined,
): boolean {
  return storage?.getItem(VAULT_HANDOFF_ONBOARDING_STORAGE_KEY) === "complete";
}

/** Persist completion of the current device-linking onboarding. */
export function completeVaultHandoffOnboarding(storage: WritableStorage): void {
  storage.setItem(VAULT_HANDOFF_ONBOARDING_STORAGE_KEY, "complete");
}

/** Return whether first-run linking may replace the untouched starter vault. */
export function canBootstrapUntouchedVault(
  storage: ReadableStorage | undefined,
): boolean {
  return storage?.getItem(INDEPENDENT_VAULT_USED_STORAGE_KEY) !== "used";
}

/** Remember that the user entered the app with its independent starter vault. */
export function markIndependentVaultUsed(storage: WritableStorage): void {
  storage.setItem(INDEPENDENT_VAULT_USED_STORAGE_KEY, "used");
}

/** Format a nonnegative invitation lifetime as minutes and zero-padded seconds. */
export function formatPairingCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

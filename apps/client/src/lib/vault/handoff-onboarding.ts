const VAULT_HANDOFF_ONBOARDING_STORAGE_KEY = "ganbaru.vault-handoff-onboarding.v2";

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

/** Format a nonnegative invitation lifetime as minutes and zero-padded seconds. */
export function formatPairingCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

import { getVaultOwnershipStatus, type VaultOwnershipStatus } from "./state";

/** Shell-level ownership state used to guard vault-writing interactions. */
class VaultOwnershipController {
  status = $state.raw<VaultOwnershipStatus | null>(null);
  loading = $state(false);

  get canWrite(): boolean {
    return this.status?.canWrite ?? false;
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.status = await getVaultOwnershipStatus();
    } finally {
      this.loading = false;
    }
  }

  clear(): void {
    this.status = null;
  }
}

const ownership = new VaultOwnershipController();

export function getVaultOwnership(): VaultOwnershipController {
  return ownership;
}

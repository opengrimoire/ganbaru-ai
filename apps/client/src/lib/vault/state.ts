import { invoke } from "@tauri-apps/api/core";

export interface VaultAppState {
  activeVaultPath: string | null;
  recentVaultPaths: string[];
}

export interface VaultInfo {
  path: string;
  configPath: string;
  databasePath: string;
  vaultId: string;
  displayName: string;
}

export type DataFolderInfo = VaultInfo;

export interface DataFolderDefaultLocation {
  path: string;
  parentPath: string;
  folderName: string;
  developmentBuild: boolean;
}

export type DataFolderErrorAction = "startup" | "default" | "change" | "import" | "general";

const DATA_FOLDER_ERROR_FALLBACKS: Record<DataFolderErrorAction, string> = {
  startup:
    "Ganbaru AI could not open the configured data folder. Choose another folder or import an existing Ganbaru AI folder.",
  default:
    "Ganbaru AI could not use the default folder. Choose another folder or check folder permissions.",
  change:
    "Ganbaru AI could not use this folder. Choose an empty folder or an existing Ganbaru AI folder.",
  import:
    "Ganbaru AI could not import this folder. Select the folder from your previous installation.",
  general: "Ganbaru AI could not use this folder.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function parseVaultAppState(value: unknown): VaultAppState {
  if (!isRecord(value)) {
    return { activeVaultPath: null, recentVaultPaths: [] };
  }
  return {
    activeVaultPath: readString(value.activeVaultPath),
    recentVaultPaths: readStringArray(value.recentVaultPaths),
  };
}

function parseVaultInfo(value: unknown): VaultInfo {
  if (!isRecord(value)) throw new Error("data folder response is not an object");
  const path = readString(value.path);
  const configPath = readString(value.configPath);
  const databasePath = readString(value.databasePath);
  const vaultId = readString(value.vaultId);
  const displayName = readString(value.displayName);
  if (!path || !configPath || !databasePath || !vaultId || !displayName) {
    throw new Error("data folder response is incomplete");
  }
  return { path, configPath, databasePath, vaultId, displayName };
}

function parseDataFolderDefaultLocation(value: unknown): DataFolderDefaultLocation {
  if (!isRecord(value)) throw new Error("default folder response is not an object");
  const path = readString(value.path);
  const parentPath = readString(value.parentPath);
  const folderName = readString(value.folderName);
  const developmentBuild = readBoolean(value.developmentBuild);
  if (!path || !parentPath || !folderName || developmentBuild === null) {
    throw new Error("default folder response is incomplete");
  }
  return { path, parentPath, folderName, developmentBuild };
}

function parseOptionalVaultInfo(value: unknown): VaultInfo | null {
  return value === null ? null : parseVaultInfo(value);
}

function errorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  const trimmed = message.trim();
  return trimmed === "" ? "Unknown error" : trimmed;
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function formatDataFolderError(
  error: unknown,
  action: DataFolderErrorAction = "general",
): string {
  const raw = errorMessage(error);
  const lower = raw.toLowerCase();

  if (
    containsAny(lower, [
      "permission denied",
      "access is denied",
      "operation not permitted",
      "os error 13",
    ])
  ) {
    return "Ganbaru AI cannot access this folder. Check folder permissions or choose another location.";
  }

  if (
    containsAny(lower, [
      "file is not a database",
      "database disk image is malformed",
      "run database migrations",
      "pragma foreign_keys",
      "pragma journal_mode",
      "pragma busy_timeout",
      "pragma synchronous",
      "pragma optimize",
    ])
  ) {
    return "The app found this Ganbaru AI folder, but ganbaru-ai.sqlite could not be opened. Restore a backup or choose another folder.";
  }

  if (lower.includes("selected folder is not empty and is not a ganbaru ai folder")) {
    if (action === "default") {
      return "The default Ganbaru AI folder already exists, but it is not a valid Ganbaru AI folder. Move those files somewhere else, choose another folder, or import an existing Ganbaru AI folder.";
    }
    return "This folder already contains other files. Choose an empty folder, an existing Ganbaru AI folder, or create a new folder.";
  }

  if (lower.includes("read ganbaru ai folder marker")) {
    return "This folder is missing the Ganbaru AI folder marker. Select the main Ganbaru AI folder, not one of its subfolders.";
  }

  if (lower.includes("parse ganbaru ai folder marker")) {
    return "This Ganbaru AI folder marker is damaged. The app cannot import this folder automatically.";
  }

  if (lower.includes("unsupported ganbaru ai folder schema version")) {
    return "This Ganbaru AI folder was created by a newer version of the app. Update Ganbaru AI before opening it.";
  }

  if (lower.includes("selected folder is not a ganbaru ai folder")) {
    return "This does not look like a Ganbaru AI folder. Select the folder from your previous installation.";
  }

  if (
    containsAny(lower, [
      "failed to inspect ganbaru ai folder path",
      "canonicalize ganbaru ai folder path",
      "no such file",
      "not found",
    ])
  ) {
    return "This Ganbaru AI folder could not be found. Choose another folder or import an existing Ganbaru AI folder.";
  }

  return `${DATA_FOLDER_ERROR_FALLBACKS[action]} Details: ${raw}`;
}

export async function readVaultAppState(): Promise<VaultAppState> {
  return parseVaultAppState(await invoke<unknown>("vault_read_app_state"));
}

export async function getActiveVaultInfo(): Promise<VaultInfo | null> {
  return parseOptionalVaultInfo(await invoke<unknown>("vault_active_info"));
}

export async function getDefaultDataFolderLocation(): Promise<DataFolderDefaultLocation> {
  return parseDataFolderDefaultLocation(await invoke<unknown>("vault_default_location"));
}

export async function useDefaultDataFolder(): Promise<DataFolderInfo> {
  return parseVaultInfo(await invoke<unknown>("vault_use_default_folder"));
}

export async function pickCreateVault(): Promise<VaultInfo | null> {
  return parseOptionalVaultInfo(await invoke<unknown>("vault_pick_create"));
}

export async function pickOpenVault(): Promise<VaultInfo | null> {
  return parseOptionalVaultInfo(await invoke<unknown>("vault_pick_open"));
}

export async function pickDataFolderLocation(): Promise<DataFolderInfo | null> {
  return pickCreateVault();
}

export async function importDataFolder(): Promise<DataFolderInfo | null> {
  return pickOpenVault();
}

export async function selectRecentVault(path: string): Promise<VaultInfo> {
  return parseVaultInfo(await invoke<unknown>("vault_select_recent", { path }));
}

export async function revealActiveVault(): Promise<void> {
  await invoke("vault_reveal_active");
}

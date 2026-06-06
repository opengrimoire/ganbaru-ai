import { invoke } from "@tauri-apps/api/core";
import { translate, type Translate } from "$lib/i18n/translator.svelte";

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

function errorMessage(value: unknown, t: Translate): string {
  const message = value instanceof Error ? value.message : String(value);
  const trimmed = message.trim();
  return trimmed === "" ? t("dataFolderError.unknown") : trimmed;
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function fallbackForAction(
  action: DataFolderErrorAction,
  t: Translate,
): string {
  switch (action) {
    case "startup":
      return t("dataFolderError.startup");
    case "default":
      return t("dataFolderError.default");
    case "change":
      return t("dataFolderError.change");
    case "import":
      return t("dataFolderError.import");
    case "general":
      return t("dataFolderError.general");
  }
}

export function formatDataFolderError(
  error: unknown,
  action: DataFolderErrorAction = "general",
  t: Translate = translate,
): string {
  const raw = errorMessage(error, t);
  const lower = raw.toLowerCase();

  if (
    containsAny(lower, [
      "permission denied",
      "access is denied",
      "operation not permitted",
      "os error 13",
    ])
  ) {
    return t("dataFolderError.permission");
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
    return t("dataFolderError.database");
  }

  if (lower.includes("selected folder is not empty and is not a ganbaru ai folder")) {
    if (action === "default") {
      return t("dataFolderError.defaultNotValid");
    }
    return t("dataFolderError.folderNotEmpty");
  }

  if (lower.includes("read ganbaru ai folder marker")) {
    return t("dataFolderError.missingMarker");
  }

  if (lower.includes("parse ganbaru ai folder marker")) {
    return t("dataFolderError.damagedMarker");
  }

  if (lower.includes("unsupported ganbaru ai folder schema version")) {
    return t("dataFolderError.newerSchema");
  }

  if (lower.includes("selected folder is not a ganbaru ai folder")) {
    return t("dataFolderError.notGanbaruFolder");
  }

  if (
    containsAny(lower, [
      "failed to inspect ganbaru ai folder path",
      "canonicalize ganbaru ai folder path",
      "no such file",
      "not found",
    ])
  ) {
    return t("dataFolderError.notFound");
  }

  return t("dataFolderError.withDetails", fallbackForAction(action, t), raw);
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

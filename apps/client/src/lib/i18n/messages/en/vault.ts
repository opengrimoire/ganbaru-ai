export const vaultSetup = {
  title: "Choose where to store your data",
  intro:
    "If you are coming from a previous installation, import your existing Ganbaru AI folder.",
  developmentBuildWarning: (folderName: string) =>
    `Development build: use the default ${folderName} folder, or choose a copy of your production folder. Do not point dev at your real production data.`,
  defaultLocation: "Default folder",
  useDefaultFolder: "Use the default folder",
  changeFolder: "Change folder",
  importFolder: "Import folder",
  languageSelectorLabel: "Choose language",
  languageSearchPlaceholder: "Search languages...",
  noLanguagesFound: "No languages found.",
} as const;

export const dataFolderError = {
  startup:
    "Ganbaru AI could not open the configured data folder. Choose another folder or import an existing Ganbaru AI folder.",
  default:
    "Ganbaru AI could not use the default folder. Choose another folder or check folder permissions.",
  change:
    "Ganbaru AI could not use this folder. Choose an empty folder or an existing Ganbaru AI folder.",
  import:
    "Ganbaru AI could not import this folder. Select the folder from your previous installation.",
  backup: "Ganbaru AI could not create the backup.",
  restore: "Ganbaru AI could not restore this backup.",
  general: "Ganbaru AI could not use this folder.",
  unknown: "Unknown error",
  permission:
    "Ganbaru AI cannot access this folder. Check folder permissions or choose another location.",
  database:
    "The app found this Ganbaru AI folder, but its local data file could not be opened. Restore a backup or choose another folder.",
  defaultNotValid:
    "The default Ganbaru AI folder already exists, but it is not a valid Ganbaru AI folder. Move those files somewhere else, choose another folder, or import an existing Ganbaru AI folder.",
  folderNotEmpty:
    "This folder already contains other files. Choose an empty folder, an existing Ganbaru AI folder, or create a new folder.",
  missingMarker:
    "This folder is missing the Ganbaru AI folder marker. Select the main Ganbaru AI folder, not one of its subfolders.",
  damagedMarker:
    "This Ganbaru AI folder marker is damaged. The app cannot import this folder automatically.",
  newerSchema:
    "This Ganbaru AI folder was created by a newer version of the app. Update Ganbaru AI before opening it.",
  notGanbaruFolder:
    "This does not look like a Ganbaru AI folder. Select the folder from your previous installation.",
  notFound:
    "This Ganbaru AI folder could not be found. Choose another folder or import an existing Ganbaru AI folder.",
  withDetails: (fallback: string, raw: string) => `${fallback} Details: ${raw}`,
} as const;

export const language = {
  preferenceLabel: "Language",
  preferenceDescription: "Choose the app language.",
  systemOption: "System language",
  englishOption: "English",
  spanishOption: "Spanish",
} as const;

export const vaultOwnership = {
  readOnly: "Read-only copy. Use the linked-device controls to move ownership here.",
  recovery: "This vault needs handoff recovery before it can be changed.",
} as const;

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

export const vaultHandoff = {
  heading: "Linked device",
  description:
    "Move one complete vault between this device and one Android phone on the same local network.",
  notLinked: "No device is linked.",
  linkedTo: (device: string) => `Linked to ${device}`,
  desktopDevice: "Desktop",
  androidDevice: "Android phone",
  thisDeviceOwns: "This device can make changes.",
  otherDeviceOwns: "This device has a read-only copy.",
  transferPending: "A vault transfer is waiting to finish.",
  linkPhone: "Link Android phone",
  linkToDesktop: "Link to desktop",
  createQr: "Show pairing QR code",
  qrInstructions: "On Android, open Data settings and scan this code. It expires in five minutes.",
  qrAlt: "Pairing QR code",
  scanQr: "Scan desktop QR code",
  scanning: "Point the camera at the QR code shown on the desktop.",
  cameraStarting: "Starting camera...",
  stopScanning: "Stop scanning",
  deviceLabel: "Android phone",
  useHere: "Use on this device",
  refreshCopy: "Refresh read-only copy",
  retry: "Retry",
  cancel: "Cancel transfer",
  unlink: "Unlink device",
  unlinkTitle: "Unlink this device?",
  unlinkMessage:
    "The current owner will not change. A read-only copy stays read-only until you explicitly recover it.",
  recover: "Recover this local copy",
  recoverTitle: "Use this copy as a separate vault?",
  recoverMessage:
    "Use this only if the owning device is permanently unavailable. Both copies are preserved, this device becomes writable, and the devices are unlinked. Later changes will not merge automatically.",
  workingOwnership: "Moving the complete vault...",
  workingRefresh: "Refreshing the complete read-only copy...",
  workingPairing: "Linking securely...",
  workingRequest: "Waiting for the other device...",
  linked: "Device linked.",
  refreshed: "Read-only copy refreshed.",
  requestSent: "The request was sent. Keep both apps open on the same network.",
  unlinked: "Device unlinked.",
  recovered: "This local copy is now a separate writable vault.",
  localBackup:
    "Before the first desktop vault replaces Android data, Ganbaru AI saves a recoverable backup to Downloads.",
  offlineNotice:
    "Already scheduled Android alarms and accepted Doomscrolling rules continue offline. New desktop Calendar changes reach Android only after a successful refresh.",
  sameNetwork: "Keep both apps open on the same local network.",
  failed: (details: string) => `The linked-device action failed: ${details}`,
  blockerChat: "Finish or stop active Chat work before moving the vault.",
  blockerFocus: "Finish or stop the active Pomodoro session before moving the vault.",
  blockerTransfer: "Finish or retry the current vault transfer first.",
  unreachable: "The desktop is unavailable. Keep both apps open on the same local network and retry.",
  unknownError: "Unknown error",
} as const;

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
  recovery: "This vault needs handoff recovery before it can be changed.",
} as const;

export const vaultOwnershipPrompt = {
  title: (device: string) => `${device} is the main device`,
  description: "Only the main device can make changes.",
  continueReadOnly: "Continue in read-only",
  switching: "Switching to this device...",
  replacementTitle: "Replace this device's current data?",
  replacementAndroid:
    "This phone has a separate Ganbaru AI vault. Its data cannot be merged with the linked vault. Ganbaru AI will save a complete backup to Downloads before replacing it.",
  replacementDesktop:
    "This computer has a separate Ganbaru AI vault. Its data cannot be merged with the linked vault. Ganbaru AI will preserve a recovery copy beside the current Ganbaru AI folder before replacing it.",
  replacementConfirm: "Replace with linked vault",
} as const;

export const vaultHandoff = {
  heading: "Linked devices",
  description: "Manage your connected devices",
  desktopOnboardingTitle: "Connect your phone",
  desktopOnboardingDescription:
    "Install Ganbaru AI on your phone and scan this QR code in the app to link your devices.",
  androidOnboardingTitle: "Connect to your computer",
  androidOnboardingDescription:
    "Use Ganbaru AI on this phone to scan the QR code shown on your computer.",
  stepOne: "Step 1",
  stepTwo: "Step 2",
  networkAccessDescription:
    "Allow Ganbaru AI to receive connections from your phone on this network.",
  allowNetworkAccess: "Allow phone connection",
  networkAccessConfirmTitle: "Allow phone connection?",
  networkAccessConfirmMessage:
    "Your Linux firewall protects your computer from unwanted connections. Ganbaru AI needs its permission to link your phone with this computer over your local network. Linux will ask for your password, which Ganbaru AI never sees or stores.",
  networkAccessRevokeTitle: "Remove local network access?",
  networkAccessRevokeMessage:
    "Your Linux firewall currently allows linked devices to connect to Ganbaru AI on this local network. Linux will ask for your password to remove that permission. Ganbaru AI never sees or stores your password.",
  networkAccessRevokeAction: "Remove access",
  networkAccessHeading: "Local network access",
  networkAccessAllowed: "Allow linked devices to connect to this computer",
  networkAccessNotRequired: "No firewall permission is required",
  networkAccessGranted: "Phone connections are allowed on this network.",
  networkAccessRevoked: "Phone connection access was removed.",
  networkAccessManual:
    "Ganbaru AI cannot request network access automatically on this Linux system.",
  notLinked: "No device is linked.",
  devicesHeading: "Devices",
  linkedTo: (device: string) => `Linked to ${device}`,
  desktopDevice: "Desktop",
  androidDevice: "Phone",
  anotherDevice: "Another device",
  transferPending: "A vault transfer is waiting to finish.",
  linkPhone: "Link phone",
  linkToDesktop: "Link to desktop",
  createQr: "Show pairing QR code",
  linkAnotherDevice: "Link another device",
  enterCode: "Enter pairing code",
  linkThisComputer: "Link this computer to another",
  codeDialogTitle: "Link this computer",
  codeInstructions: "Paste the pairing code shown on the coordinating computer.",
  codePlaceholder: "Pairing code",
  linkDevice: "Link device",
  copyCode: "Copy pairing code",
  codeCopied: "Pairing code copied",
  copyCodeFailed: "The pairing code could not be copied.",
  qrDialogTitle: "Connect another device",
  qrInstructions:
    "To connect a phone, scan this QR code in Settings > Data. To connect another computer, copy the pairing code and enter it in Settings > Data.",
  qrAlt: "Pairing QR code",
  refreshesIn: (time: string) => `Code refreshes in ${time}`,
  refreshingCode: "Refreshing code...",
  scanQr: "Scan desktop QR code",
  cameraStarting: "Starting camera...",
  notNow: "Not now",
  continue: "Continue",
  deviceLabel: "Phone",
  useHere: "Switch to this device",
  refreshCopy: "Get latest changes",
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
  workingOwnership: "Preparing this device...",
  workingRefresh: "Getting the latest changes...",
  workingPairing: "Linking securely...",
  workingRequest: "Waiting for the other device...",
  linked: "Device linked.",
  linkedSuccessfully: (device: string) => `${device} was successfully linked.`,
  linkedLabel: "linked",
  refreshed: "Latest changes received.",
  requestSent: "The request was sent. Keep both apps open on the same network.",
  unlinked: "Device unlinked.",
  revokedByCoordinator:
    "This device was unlinked by the coordinating computer. Its local copy remains read-only unless you recover it as a separate vault.",
  recovered: "This local copy is now a separate writable vault.",
  localBackup:
    "Before the first desktop vault replaces Android data, Ganbaru AI saves a recoverable backup to Downloads.",
  sameNetwork: "Keep both apps open on the same local network.",
  failed: (details: string) => `The linked-device action failed: ${details}`,
  blockerChat: "Finish or stop active Chat work before moving the vault.",
  blockerFocus: "Finish or stop the active Pomodoro session before moving the vault.",
  blockerTransfer: "Finish or retry the current vault transfer first.",
  incompatibleVersions:
    "Update Ganbaru AI on both devices before linking or transferring data. Their data formats are different.",
  differentCoordinator:
    "This device is linked to another computer. Unlink it before connecting to a different computer.",
  unreachable:
    "This device could not reach the coordinating computer. Keep both apps open on the same local network, then retry.",
  ownerUnreachable:
    "The main device is unavailable. Keep it open on the same local network, then retry.",
  unknownError: "Unknown error",
} as const;

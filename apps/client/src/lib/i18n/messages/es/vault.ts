import type {
  dataFolderError as enDataFolderError,
  language as enLanguage,
  vaultOwnership as enVaultOwnership,
  vaultOwnershipPrompt as enVaultOwnershipPrompt,
  vaultHandoff as enVaultHandoff,
  vaultSetup as enVaultSetup,
} from "../en/vault";
import type { MessageShape } from "../types";

export const vaultSetup = {
  title: "Elige dónde guardar tus datos",
  intro:
    "Si vienes de una instalación anterior, importa tu carpeta de Ganbaru AI existente.",
  developmentBuildWarning: (folderName: string) =>
    `Compilación de desarrollo: usa la carpeta ${folderName} predeterminada, o elige una copia de tu carpeta de producción. No apuntes dev a tus datos reales de producción.`,
  defaultLocation: "Carpeta predeterminada",
  useDefaultFolder: "Usar la carpeta predeterminada",
  changeFolder: "Cambiar carpeta",
  importFolder: "Importar carpeta",
  languageSelectorLabel: "Elegir idioma",
  languageSearchPlaceholder: "Buscar idiomas...",
  noLanguagesFound: "No se encontraron idiomas.",
} as const satisfies MessageShape<typeof enVaultSetup>;

export const dataFolderError = {
  startup:
    "Ganbaru AI no pudo abrir la carpeta de datos configurada. Elige otra carpeta o importa una carpeta de Ganbaru AI existente.",
  default:
    "Ganbaru AI no pudo usar la carpeta predeterminada. Elige otra carpeta o revisa los permisos.",
  change:
    "Ganbaru AI no pudo usar esta carpeta. Elige una carpeta vacía o una carpeta de Ganbaru AI existente.",
  import:
    "Ganbaru AI no pudo importar esta carpeta. Selecciona la carpeta de tu instalación anterior.",
  backup: "Ganbaru AI no pudo crear la copia de seguridad.",
  restore: "Ganbaru AI no pudo restaurar esta copia de seguridad.",
  general: "Ganbaru AI no pudo usar esta carpeta.",
  unknown: "Error desconocido",
  permission:
    "Ganbaru AI no puede acceder a esta carpeta. Revisa los permisos o elige otra ubicación.",
  database:
    "La app encontró esta carpeta de Ganbaru AI, pero no pudo abrir su archivo de datos local. Restaura una copia de seguridad o elige otra carpeta.",
  defaultNotValid:
    "La carpeta predeterminada de Ganbaru AI ya existe, pero no es una carpeta válida de Ganbaru AI. Mueve esos archivos a otro lugar, elige otra carpeta o importa una carpeta de Ganbaru AI existente.",
  folderNotEmpty:
    "Esta carpeta ya contiene otros archivos. Elige una carpeta vacía, una carpeta de Ganbaru AI existente o crea una carpeta nueva.",
  missingMarker:
    "A esta carpeta le falta el marcador de carpeta de Ganbaru AI. Selecciona la carpeta principal de Ganbaru AI, no una subcarpeta.",
  damagedMarker:
    "El marcador de esta carpeta de Ganbaru AI está dañado. La app no puede importar esta carpeta automáticamente.",
  newerSchema:
    "Esta carpeta de Ganbaru AI fue creada por una versión más nueva de la app. Actualiza Ganbaru AI antes de abrirla.",
  notGanbaruFolder:
    "Esto no parece una carpeta de Ganbaru AI. Selecciona la carpeta de tu instalación anterior.",
  notFound:
    "Esta carpeta de Ganbaru AI no se pudo encontrar. Elige otra carpeta o importa una carpeta de Ganbaru AI existente.",
  withDetails: (fallback: string, raw: string) => `${fallback} Detalles: ${raw}`,
} as const satisfies MessageShape<typeof enDataFolderError>;

export const language = {
  preferenceLabel: "Idioma",
  preferenceDescription: "Elige el idioma de la aplicación.",
  systemOption: "Idioma del sistema",
  englishOption: "Inglés",
  spanishOption: "Español",
} as const satisfies MessageShape<typeof enLanguage>;

export const vaultOwnership = {
  recovery: "Esta bóveda necesita recuperar la transferencia antes de poder modificarse.",
} as const satisfies MessageShape<typeof enVaultOwnership>;

export const vaultOwnershipPrompt = {
  title: (device: string) => `${device} es el dispositivo principal`,
  description: "Solo el dispositivo principal puede hacer cambios.",
  continueReadOnly: "Continuar en solo lectura",
  switching: "Cambiando a este dispositivo...",
  replacementTitle: "¿Reemplazar los datos actuales de este dispositivo?",
  replacementAndroid:
    "Este teléfono tiene una bóveda de Ganbaru AI separada. Sus datos no se pueden combinar con la bóveda vinculada. Ganbaru AI guardará una copia completa en Descargas antes de reemplazarla.",
  replacementDesktop:
    "Esta computadora tiene una bóveda de Ganbaru AI separada. Sus datos no se pueden combinar con la bóveda vinculada. Ganbaru AI conservará una copia de recuperación junto a la carpeta actual de Ganbaru AI antes de reemplazarla.",
  replacementConfirm: "Reemplazar con la bóveda vinculada",
} as const satisfies MessageShape<typeof enVaultOwnershipPrompt>;

export const vaultHandoff = {
  heading: "Dispositivos vinculados",
  description: "Administra tus dispositivos conectados",
  desktopOnboardingTitle: "Conecta tu teléfono",
  desktopOnboardingDescription:
    "Instala Ganbaru AI en tu teléfono y escanea este código QR en la aplicación para vincular tus dispositivos.",
  androidOnboardingTitle: "Conecta con tu computadora",
  androidOnboardingDescription:
    "Usa Ganbaru AI en este teléfono para escanear el código QR mostrado en tu computadora.",
  cameraDisclosure: "La cámara se usa solo mientras esta pantalla escanea el código.",
  stepOne: "Paso 1",
  stepTwo: "Paso 2",
  networkAccessDescription:
    "Permite que Ganbaru AI reciba conexiones de tu teléfono en esta red.",
  allowNetworkAccess: "Permitir conexión del teléfono",
  networkAccessConfirmTitle: "¿Permitir la conexión del teléfono?",
  networkAccessConfirmMessage:
    "El firewall de Linux protege tu computadora de conexiones no deseadas. Ganbaru AI necesita su permiso para vincular tu teléfono con esta computadora mediante tu red local. Linux te pedirá tu contraseña, que Ganbaru AI nunca ve ni guarda.",
  networkAccessRevokeTitle: "¿Quitar el acceso a la red local?",
  networkAccessRevokeMessage:
    "El firewall de Linux permite actualmente que los dispositivos vinculados se conecten con Ganbaru AI en esta red local. Linux te pedirá tu contraseña para quitar ese permiso. Ganbaru AI nunca ve ni guarda tu contraseña.",
  networkAccessRevokeAction: "Quitar acceso",
  networkAccessHeading: "Acceso a la red local",
  networkAccessAllowed: "Permite que los dispositivos vinculados se conecten a esta computadora",
  networkAccessNotRequired: "No se requiere permiso del firewall",
  networkAccessGranted: "Las conexiones del teléfono están permitidas en esta red.",
  networkAccessRevoked: "Se quitó el acceso para conectar el teléfono.",
  networkAccessManual:
    "Ganbaru AI no puede solicitar acceso a la red automáticamente en este sistema Linux.",
  notLinked: "No hay un dispositivo vinculado.",
  devicesHeading: "Dispositivos",
  linkedTo: (device: string) => `Vinculado con ${device}`,
  desktopDevice: "Computadora",
  androidDevice: "Teléfono",
  anotherDevice: "Otro dispositivo",
  transferPending: "Hay una transferencia de la bóveda pendiente de terminar.",
  linkPhone: "Vincular teléfono",
  linkToDesktop: "Vincular con computadora",
  createQr: "Mostrar código QR de vinculación",
  linkAnotherDevice: "Vincular otro dispositivo",
  enterCode: "Introducir código de vinculación",
  linkThisComputer: "Vincular esta computadora con otra",
  codeDialogTitle: "Vincular esta computadora",
  codeInstructions: "Pega el código mostrado en la computadora coordinadora.",
  codePlaceholder: "Código de vinculación",
  linkDevice: "Vincular dispositivo",
  copyCode: "Copiar código de vinculación",
  codeCopied: "Código de vinculación copiado",
  copyCodeFailed: "No se pudo copiar el código de vinculación.",
  qrDialogTitle: "Conectar otro dispositivo",
  qrInstructions:
    "Para conectar un teléfono, escanea este código QR en Ajustes > Datos. Para conectar otra computadora, copia el código de vinculación e introdúcelo en Ajustes > Datos.",
  qrAlt: "Código QR de vinculación",
  refreshesIn: (time: string) => `El código se renueva en ${time}`,
  refreshingCode: "Renovando código...",
  scanQr: "Escanear código QR de la computadora",
  scanning: "Coloca todo el código QR dentro del recuadro.",
  cameraStarting: "Iniciando cámara...",
  stopScanning: "Detener escaneo",
  notNow: "Ahora no",
  continue: "Continuar",
  deviceLabel: "Teléfono",
  useHere: "Cambiar a este dispositivo",
  refreshCopy: "Obtener los últimos cambios",
  retry: "Reintentar",
  cancel: "Cancelar transferencia",
  unlink: "Desvincular dispositivo",
  unlinkTitle: "¿Desvincular este dispositivo?",
  unlinkMessage:
    "El propietario actual no cambiará. Una copia de solo lectura seguirá así hasta que la recuperes explícitamente.",
  recover: "Recuperar esta copia local",
  recoverTitle: "¿Usar esta copia como una bóveda separada?",
  recoverMessage:
    "Usa esto solo si el dispositivo propietario ya no está disponible. Ambas copias se conservan, este dispositivo podrá escribir y los dispositivos se desvincularán. Los cambios posteriores no se combinarán automáticamente.",
  workingOwnership: "Preparando este dispositivo...",
  workingRefresh: "Obteniendo los últimos cambios...",
  workingPairing: "Vinculando de forma segura...",
  workingRequest: "Esperando al otro dispositivo...",
  linked: "Dispositivo vinculado.",
  linkedLabel: "vinculado",
  refreshed: "Se recibieron los últimos cambios.",
  requestSent: "Se envió la solicitud. Mantén ambas apps abiertas en la misma red.",
  unlinked: "Dispositivo desvinculado.",
  recovered: "Esta copia local ahora es una bóveda separada con escritura.",
  localBackup:
    "Antes de que la bóveda de la computadora reemplace datos de Android por primera vez, Ganbaru AI guarda una copia recuperable en Descargas.",
  sameNetwork: "Mantén ambas apps abiertas en la misma red local.",
  failed: (details: string) => `Falló la acción del dispositivo vinculado: ${details}`,
  blockerChat: "Termina o detén el trabajo activo de Chat antes de mover la bóveda.",
  blockerFocus: "Termina o detén la sesión activa de Pomodoro antes de mover la bóveda.",
  blockerTransfer: "Termina o reintenta primero la transferencia actual de la bóveda.",
  incompatibleVersions:
    "Actualiza Ganbaru AI en ambos dispositivos antes de vincular o transferir datos. Sus formatos de datos son diferentes.",
  differentCoordinator:
    "Este dispositivo está vinculado con otra computadora. Desvincúlalo antes de conectarlo con una computadora diferente.",
  unreachable:
    "Este dispositivo no pudo comunicarse con la computadora coordinadora. Mantén ambas aplicaciones abiertas en la misma red local y reintenta.",
  unknownError: "Error desconocido",
} as const satisfies MessageShape<typeof enVaultHandoff>;

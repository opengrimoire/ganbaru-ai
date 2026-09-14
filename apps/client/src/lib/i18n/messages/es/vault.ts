import type {
  dataFolderError as enDataFolderError,
  language as enLanguage,
  vaultOwnership as enVaultOwnership,
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
  readOnly:
    "Copia de solo lectura. Usa los controles del dispositivo vinculado para transferir la propiedad aquí.",
  recovery: "Esta bóveda necesita recuperar la transferencia antes de poder modificarse.",
} as const satisfies MessageShape<typeof enVaultOwnership>;

export const vaultHandoff = {
  heading: "Dispositivo vinculado",
  description:
    "Mueve una bóveda completa entre este dispositivo y un teléfono Android en la misma red local.",
  notLinked: "No hay un dispositivo vinculado.",
  linkedTo: (device: string) => `Vinculado con ${device}`,
  desktopDevice: "Computadora",
  androidDevice: "Teléfono Android",
  thisDeviceOwns: "Este dispositivo puede hacer cambios.",
  otherDeviceOwns: "Este dispositivo tiene una copia de solo lectura.",
  transferPending: "Hay una transferencia de la bóveda pendiente de terminar.",
  linkPhone: "Vincular teléfono Android",
  linkToDesktop: "Vincular con computadora",
  createQr: "Mostrar código QR de vinculación",
  qrInstructions:
    "En Android, abre los ajustes de Datos y escanea este código. Caduca en cinco minutos.",
  qrAlt: "Código QR de vinculación",
  scanQr: "Escanear código QR de la computadora",
  scanning: "Apunta la cámara al código QR mostrado en la computadora.",
  cameraStarting: "Iniciando cámara...",
  stopScanning: "Detener escaneo",
  deviceLabel: "Teléfono Android",
  useHere: "Usar en este dispositivo",
  refreshCopy: "Actualizar copia de solo lectura",
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
  workingOwnership: "Moviendo la bóveda completa...",
  workingRefresh: "Actualizando la copia completa de solo lectura...",
  workingPairing: "Vinculando de forma segura...",
  workingRequest: "Esperando al otro dispositivo...",
  linked: "Dispositivo vinculado.",
  refreshed: "Copia de solo lectura actualizada.",
  requestSent: "Se envió la solicitud. Mantén ambas apps abiertas en la misma red.",
  unlinked: "Dispositivo desvinculado.",
  recovered: "Esta copia local ahora es una bóveda separada con escritura.",
  localBackup:
    "Antes de que la bóveda de la computadora reemplace datos de Android por primera vez, Ganbaru AI guarda una copia recuperable en Descargas.",
  offlineNotice:
    "Las alarmas de Android ya programadas y las reglas de Doomscrolling aceptadas continúan sin conexión. Los nuevos cambios del Calendario en la computadora llegan a Android solo después de una actualización exitosa.",
  sameNetwork: "Mantén ambas apps abiertas en la misma red local.",
  failed: (details: string) => `Falló la acción del dispositivo vinculado: ${details}`,
  blockerChat: "Termina o detén el trabajo activo de Chat antes de mover la bóveda.",
  blockerFocus: "Termina o detén la sesión activa de Pomodoro antes de mover la bóveda.",
  blockerTransfer: "Termina o reintenta primero la transferencia actual de la bóveda.",
  unreachable:
    "La computadora no está disponible. Mantén ambas apps abiertas en la misma red local y reintenta.",
  unknownError: "Error desconocido",
} as const satisfies MessageShape<typeof enVaultHandoff>;

import type {
  dataFolderError as enDataFolderError,
  language as enLanguage,
  vaultOwnership as enVaultOwnership,
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

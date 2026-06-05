import type { MessageCatalog } from "./en";

type PartialMessageCatalog<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]?: PartialMessageCatalog<T[Key]> };

export const es = {
  common: {
    appName: "Ganbaru AI",
    cancel: "Cancelar",
    close: "Cerrar",
    confirm: "Confirmar",
    save: "Guardar",
    reset: "Restablecer",
    delete: "Eliminar",
    archive: "Archivar",
    edit: "Editar",
    done: "Listo",
    loading: "Cargando",
    none: "Ninguno",
    disabled: "Desactivado",
    enabled: "Activado",
    system: "Sistema",
    english: "Inglés",
    spanish: "Español",
    yesShortcut: "Sí (Enter)",
    noShortcut: "No (Esc)",
    cancelShortcut: "Cancelar (Esc)",
    minimize: "Minimizar",
    maximize: "Maximizar",
    restore: "Restaurar",
  },
  window: {
    close: "Cerrar",
    closeWindowWithShortcut: (shortcut: string) => `Cerrar ventana (${shortcut})`,
    closeAppWithShortcut: (shortcut: string) => `Cerrar app (${shortcut})`,
  },
  vaultSetup: {
    title: "Elige dónde guardar tus datos",
    intro:
      "Si vienes de una instalación anterior, importa tu carpeta de Ganbaru AI existente.",
    developmentBuildWarning: (folderName: string) =>
      `Compilación de desarrollo: usa la carpeta ${folderName} predeterminada, o elige una copia de tu carpeta de producción. No apuntes dev a tus datos reales de producción.`,
    defaultLocation: "Ubicación predeterminada",
    useDefaultFolder: "Usar la carpeta predeterminada",
    changeFolder: "Cambiar carpeta",
    importFolder: "Importar carpeta",
  },
  dataFolderError: {
    startup:
      "Ganbaru AI no pudo abrir la carpeta de datos configurada. Elige otra carpeta o importa una carpeta de Ganbaru AI existente.",
    default:
      "Ganbaru AI no pudo usar la carpeta predeterminada. Elige otra carpeta o revisa los permisos.",
    change:
      "Ganbaru AI no pudo usar esta carpeta. Elige una carpeta vacía o una carpeta de Ganbaru AI existente.",
    import:
      "Ganbaru AI no pudo importar esta carpeta. Selecciona la carpeta de tu instalación anterior.",
    general: "Ganbaru AI no pudo usar esta carpeta.",
    unknown: "Error desconocido",
    permission:
      "Ganbaru AI no puede acceder a esta carpeta. Revisa los permisos o elige otra ubicación.",
    database:
      "La app encontró esta carpeta de Ganbaru AI, pero ganbaru-ai.sqlite no se pudo abrir. Restaura una copia de seguridad o elige otra carpeta.",
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
  },
  language: {
    preferenceLabel: "Idioma",
    preferenceDescription: "Elige el idioma de la aplicación.",
    systemOption: "Idioma del sistema",
    englishOption: "Inglés",
    spanishOption: "Español",
  },
  settings: {
    title: "Ajustes",
    close: "Cerrar ajustes",
    section: {
      appearance: "Apariencia",
      calendars: "Calendario",
      focus: "Enfoque",
      music: "Música",
      doomscrolling: "Doomscrolling",
      data: "Datos",
      updates: "Actualizaciones",
      shortcuts: "Atajos",
      about: "Acerca de",
    },
    appearance: {
      zoomHeading: "Zoom",
      appZoom: "Zoom de la app",
      textHeading: "Texto",
      fontFamily: "Fuente",
      fontFamilyDescription: "Usa fuentes del sistema o instaladas",
      recommended: "recomendada",
      textSize: "Tamaño del texto",
      textSizeDescription: "Multiplica el tamaño base del texto en la app",
      languageHeading: "Idioma",
      calendarHeading: "Calendario",
      calendarZoom: "Zoom del calendario (5min / 10min / 15min / 30min)",
      timeFormat: "Formato de hora",
      timeFormatDescription: "Muestra horas en formato de 12h o 24h",
      timeFormat24h: "24 horas",
      timeFormat12h: "12 horas (a. m./p. m.)",
      dimPastEventColors: "Atenuar eventos pasados",
      dimPastEventColorsDescription: "Usa colores atenuados para eventos pasados",
      calendarZoomOption: (percent: number, gridMinutes: number) =>
        `${percent}% (${gridMinutes}min)`,
    },
  },
  updates: {
    checkingFeed: "Revisando el feed de versiones configurado",
    current: "Ganbaru AI está actualizado",
    versionAvailable: (version: string) => `La versión ${version} está disponible`,
    downloadingBytes: (bytes: string) => `Descargando ${bytes}`,
    downloadingPercent: (percent: number) => `Descargando ${percent}%`,
    installedRestarting: "Actualización instalada. Reiniciando Ganbaru AI",
    checkFailed: "Falló la revisión de actualizaciones",
    notChecked: "No se ha revisado si hay actualizaciones en esta ventana",
    promptAvailable: (version: string) => `Hay una actualización disponible: ${version}`,
    downloaded: (bytes: string) => `${bytes} descargados`,
    downloadedOfTotal: (downloaded: string, total: string) => `${downloaded} de ${total}`,
    installUpdate: "Instalar actualización",
    later: "Más tarde",
    releaseNotes: "Notas de la versión",
    dismissNotification: "Descartar notificación de actualización",
    feedNotConfigured: "Esta compilación no tiene configurado un feed de actualizaciones",
  },
  titleBar: {
    tab: {
      calendar: "Calendario",
      projects: "Proyectos",
      notes: "Notas",
      withShortcut: (label: string, shortcut: string) => `${label} (${shortcut})`,
    },
    control: {
      pomodoro: "Pomodoro",
      music: "Música",
      theme: "Cambio de tema",
      performance: "Diagnóstico",
      settings: "Ajustes",
      compactTabs: "Pestañas compactas",
      more: "Más controles",
    },
    pomodoro: {
      resumeFocus: "Reanudar enfoque",
      pauseFocus: "Pausar enfoque",
      goToBreakNow: "Ir al descanso ahora",
      startFocusNow: "Iniciar enfoque ahora",
      noActiveSession: "No hay sesión activa",
      left: (time: string) => `Quedan ${time}`,
      remaining: (time: string) => `Quedan ${time}`,
      extendFocusMinutes: (count: number) => `Extender enfoque ${count} minutos`,
    },
    music: {
      noMusicLoaded: "No hay música cargada",
      pause: "Pausar música",
      play: "Reproducir música",
      previous: "Música anterior",
      next: "Música siguiente",
      open: "Abrir música",
      volume: "Volumen",
      volumeLabel: "Volumen de música",
      volumeTooltip: (volume: string) => `Volumen: ${volume}`,
      status: {
        playing: "Reproduciendo",
        paused: "Pausado",
        loading: "Cargando",
        ready: "Listo",
        ended: "Terminado",
        error: "Error",
        idle: "Inactivo",
      },
    },
    theme: {
      disabledWhileEditing: "Desactivado mientras editas un tema",
      switchToLight: (shortcut: string) => `Cambiar a modo claro (${shortcut})`,
      switchToDark: (shortcut: string) => `Cambiar a modo oscuro (${shortcut})`,
    },
    diagnosticsWithShortcut: (shortcut: string) => `Diagnóstico (${shortcut})`,
    settingsWithShortcut: (shortcut: string) => `Ajustes (${shortcut})`,
    disabledBenchmark: "Desactivado mientras hay un benchmark activo",
    moveBackToMainWindow: "Mover de vuelta a la ventana principal",
    moveToNewWindow: "Mover a una ventana nueva",
    resetSequenceTitle: "¿Abrir confirmación de reinicio?",
    resetSequenceMessage:
      "Presionaste el atajo oculto de reinicio 10 veces. Continúa solo si querías borrar la base de datos estructurada",
    resetSequenceConfirm: "Continuar (Enter)",
    resetDatabaseTitle: "¿Reiniciar base de datos?",
    resetDatabaseMessage:
      "El archivo ganbaru-ai.sqlite de la carpeta activa de Ganbaru AI se eliminará permanentemente",
    resetDatabaseConfirm: "Reiniciar base de datos (Enter)",
    closeAppTitle: "¿Cerrar la app?",
    closeAppMessage: "Todas las funciones de productividad dejarán de funcionar",
    closeAnyway: "Cerrar de todos modos (Enter)",
    stay: "Quedarse (Esc)",
  },
  format: {
    relativeMinutesNow: "Ahora",
    relativeMinutesFuture: (count: number) => `en ${count} min`,
    relativeMinutesPast: (count: number) => `hace ${count} min`,
  },
  theme: {
    builtInName: {
      light: "Claro",
      dark: "Oscuro",
    },
  },
} as const satisfies PartialMessageCatalog<MessageCatalog>;

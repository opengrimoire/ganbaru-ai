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
  },
  language: {
    preferenceLabel: "Idioma",
    preferenceDescription: "Elige el idioma de la aplicación.",
    systemOption: "Idioma del sistema",
    englishOption: "Inglés",
    spanishOption: "Español",
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

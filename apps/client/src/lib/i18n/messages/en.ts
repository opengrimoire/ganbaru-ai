export const en = {
  common: {
    appName: "Ganbaru AI",
    cancel: "Cancel",
    close: "Close",
    confirm: "Confirm",
    save: "Save",
    reset: "Reset",
    delete: "Delete",
    archive: "Archive",
    edit: "Edit",
    done: "Done",
    loading: "Loading",
    none: "None",
    disabled: "Disabled",
    enabled: "Enabled",
    system: "System",
    english: "English",
    spanish: "Spanish",
  },
  language: {
    preferenceLabel: "Language",
    preferenceDescription: "Choose the app language.",
    systemOption: "System language",
    englishOption: "English",
    spanishOption: "Spanish",
  },
  format: {
    relativeMinutesNow: "Now",
    relativeMinutesFuture: (count: number) => `in ${count} min`,
    relativeMinutesPast: (count: number) => `${count} min ago`,
  },
  theme: {
    builtInName: {
      light: "Light",
      dark: "Dark",
    },
  },
} as const;

export type MessageCatalog = typeof en;

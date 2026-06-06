import { getConfigKey, setConfigKey } from "$lib/vault/config";
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  DEFAULT_LOCALE,
  LOCALE_METADATA,
  type AppLocale,
  type LanguagePreference,
  type LocaleDirection,
  parseLanguagePreference,
  resolveLanguagePreference,
} from "./locales";
import { en, type MessageCatalog } from "./messages/en";
import { es } from "./messages/es";

const LANGUAGE_CONFIG_KEY = "preferences.language";

type CatalogBranch = Readonly<Record<string, unknown>>;

type MessageKey<T> = {
  [Key in keyof T & string]: T[Key] extends string
    ? Key
    : T[Key] extends (...args: infer _Args) => string
      ? Key
      : T[Key] extends CatalogBranch
        ? `${Key}.${MessageKey<T[Key]>}`
        : never;
}[keyof T & string];

type MessageAtPath<T, Path extends string> =
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? MessageAtPath<T[Head], Tail>
      : never
    : Path extends keyof T
      ? T[Path]
      : never;

type MessageArgs<Value> = Value extends (...args: infer Args) => string ? Args : [];

export type TranslationKey = MessageKey<MessageCatalog>;

export type Translate = <Key extends TranslationKey>(
  key: Key,
  ...args: MessageArgs<MessageAtPath<MessageCatalog, Key>>
) => string;

interface LanguagePreferenceOptions {
  readonly persist?: boolean;
}

const MESSAGE_CATALOGS: Readonly<Record<AppLocale, unknown>> = Object.freeze({
  en,
  es,
});

let languagePreference = $state<LanguagePreference>(DEFAULT_LANGUAGE_PREFERENCE);
let resolvedLocale = $state<AppLocale>(DEFAULT_LOCALE);
let resolvedDirection = $state<LocaleDirection>(LOCALE_METADATA[DEFAULT_LOCALE].direction);

function browserLocaleCandidates(): string[] {
  if (typeof navigator === "undefined") return [];
  const candidates: string[] = [];
  if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  if (typeof navigator.language === "string") candidates.push(navigator.language);
  return candidates;
}

function readCatalogPath(catalog: unknown, path: string): unknown {
  let current: unknown = catalog;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    if (!Object.hasOwn(current, part)) return undefined;
    current = (current as CatalogBranch)[part];
  }
  return current;
}

function applyDocumentLocale(locale: AppLocale, direction: LocaleDirection): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.lang = locale;
  root.dir = direction;
}

function refreshResolvedLocale(): void {
  const nextLocale = resolveLanguagePreference(
    languagePreference,
    browserLocaleCandidates(),
  );
  const nextDirection = LOCALE_METADATA[nextLocale].direction;
  resolvedLocale = nextLocale;
  resolvedDirection = nextDirection;
  applyDocumentLocale(nextLocale, nextDirection);
}

export function initializeLocalizationFromConfig(): void {
  const stored = getConfigKey<unknown>(LANGUAGE_CONFIG_KEY, undefined);
  const parsed = parseLanguagePreference(stored);
  languagePreference = parsed;
  if (stored !== undefined && stored !== parsed) {
    setConfigKey(LANGUAGE_CONFIG_KEY, parsed);
  }
  refreshResolvedLocale();
}

export function setLanguagePreference(
  preference: LanguagePreference,
  options: LanguagePreferenceOptions = {},
): void {
  languagePreference = preference;
  refreshResolvedLocale();
  if (options.persist ?? true) {
    setConfigKey(LANGUAGE_CONFIG_KEY, preference);
  }
}

export const translateFromCatalog: Translate = ((
  key: TranslationKey,
  ...args: readonly unknown[]
) => {
  const preferred = readCatalogPath(MESSAGE_CATALOGS[resolvedLocale], key);
  return translateWithFallback(preferred, key, args);
}) as Translate;

function translateWithFallback(
  preferred: unknown,
  key: TranslationKey,
  args: readonly unknown[],
): string {
  const fallback = readCatalogPath(en, key);
  const value = preferred ?? fallback;

  if (typeof value === "function") {
    const message = value as (...messageArgs: readonly unknown[]) => string;
    return message(...args);
  }
  if (typeof value === "string") return value;
  return key;
}

export function translateFromPartialCatalog<Key extends TranslationKey>(
  catalog: unknown,
  key: Key,
  ...args: MessageArgs<MessageAtPath<MessageCatalog, Key>>
): string {
  const preferred = readCatalogPath(catalog, key);
  return translateWithFallback(preferred, key, args);
}

export const translate: Translate = translateFromCatalog;

export function getLocalization() {
  return {
    get languagePreference(): LanguagePreference {
      return languagePreference;
    },
    get locale(): AppLocale {
      return resolvedLocale;
    },
    get direction(): LocaleDirection {
      return resolvedDirection;
    },
    t: translate,
    setLanguagePreference,
  };
}

if (typeof window !== "undefined") {
  refreshResolvedLocale();
  window.addEventListener("languagechange", refreshResolvedLocale);
}

import { describe, expect, it } from "vitest";
import {
  PRE_VAULT_LANGUAGE_STORAGE_KEY,
  clearPreVaultLanguagePreference,
  languageMatchesQuery,
  languageOptionSearchText,
  readPreVaultLanguagePreference,
  resolvedSystemLanguageName,
  selectedLanguageName,
  writePreVaultLanguagePreference,
  type LanguageOption,
} from "./pre-vault-language";

function storageWith(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("pre-vault language preference", () => {
  it("reads, writes, and clears the pending setup language", () => {
    const storage = storageWith();

    expect(readPreVaultLanguagePreference(storage)).toBeNull();

    writePreVaultLanguagePreference(storage, "es");
    expect(readPreVaultLanguagePreference(storage)).toBe("es");

    clearPreVaultLanguagePreference(storage);
    expect(readPreVaultLanguagePreference(storage)).toBeNull();
  });

  it("normalizes invalid stored values to the system preference", () => {
    const storage = storageWith({
      [PRE_VAULT_LANGUAGE_STORAGE_KEY]: "fr",
    });

    expect(readPreVaultLanguagePreference(storage)).toBe("system");
  });

  it("uses the system locale with English fallback for the default label", () => {
    expect(resolvedSystemLanguageName(["es-MX"])).toBe("Español");
    expect(resolvedSystemLanguageName(["fr-CA"])).toBe("English");
  });

  it("shows the resolved locale name for system and explicit locale names otherwise", () => {
    expect(selectedLanguageName("system", "es")).toBe("Español");
    expect(selectedLanguageName("en", "es")).toBe("English");
  });

  it("matches search text across labels, details, and locale metadata", () => {
    const option: LanguageOption = {
      value: "es",
      label: "Español",
      searchText: languageOptionSearchText("es", "Español", "Spanish"),
    };

    expect(languageMatchesQuery(option, "span")).toBe(true);
    expect(languageMatchesQuery(option, "españ")).toBe(true);
    expect(languageMatchesQuery(option, "japanese")).toBe(false);
  });
});

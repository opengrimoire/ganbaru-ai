// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const getConfigKeyMock = vi.fn();
const setConfigKeyMock = vi.fn();

vi.mock("$lib/vault/config", () => ({
  getConfigKey: (...args: unknown[]) => getConfigKeyMock(...args),
  setConfigKey: (...args: unknown[]) => setConfigKeyMock(...args),
}));

function setBrowserLanguages(languages: readonly string[]): void {
  Object.defineProperty(window.navigator, "languages", {
    value: languages,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "language", {
    value: languages[0] ?? "en-US",
    configurable: true,
  });
}

async function loadTranslator() {
  return await import("./translator.svelte");
}

beforeEach(() => {
  vi.resetModules();
  getConfigKeyMock.mockReset();
  setConfigKeyMock.mockReset();
  getConfigKeyMock.mockReturnValue(undefined);
  document.documentElement.lang = "";
  document.documentElement.dir = "";
  setBrowserLanguages(["en-US"]);
});

describe("translator", () => {
  it("uses Spanish messages when Spanish is active", async () => {
    setBrowserLanguages(["es-MX"]);
    const { getLocalization } = await loadTranslator();
    const localization = getLocalization();
    localization.setLanguagePreference("system", { persist: false });

    expect(localization.locale).toBe("es");
    expect(localization.t("common.save")).toBe("Guardar");
    expect(localization.t("format.relativeMinutesFuture", 3)).toBe("en 3 min");
  });

  it("falls back to English for missing partial catalog messages", async () => {
    const { translateFromPartialCatalog } = await loadTranslator();

    expect(translateFromPartialCatalog({}, "common.save")).toBe("Save");
    expect(translateFromPartialCatalog({}, "format.relativeMinutesFuture", 2)).toBe(
      "in 2 min",
    );
  });

  it("persists the selected language preference", async () => {
    const { getLocalization } = await loadTranslator();
    const localization = getLocalization();
    localization.setLanguagePreference("es");

    expect(setConfigKeyMock).toHaveBeenCalledWith("preferences.language", "es");
  });

  it("loads the persisted language preference from config", async () => {
    getConfigKeyMock.mockReturnValue("es");
    const { getLocalization, initializeLocalizationFromConfig } = await loadTranslator();

    initializeLocalizationFromConfig();
    const localization = getLocalization();

    expect(localization.languagePreference).toBe("es");
    expect(localization.locale).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("normalizes invalid stored language preferences", async () => {
    getConfigKeyMock.mockReturnValue("fr");
    const { getLocalization, initializeLocalizationFromConfig } = await loadTranslator();

    initializeLocalizationFromConfig();

    expect(getLocalization().languagePreference).toBe("system");
    expect(setConfigKeyMock).toHaveBeenCalledWith("preferences.language", "system");
  });
});

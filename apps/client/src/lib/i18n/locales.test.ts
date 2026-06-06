import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  DEFAULT_LOCALE,
  localeDirection,
  parseLanguagePreference,
  resolveLanguagePreference,
  resolveLocaleFromCandidates,
} from "./locales";

describe("locale resolution", () => {
  it("uses exact supported locale matches before base language matches", () => {
    expect(resolveLocaleFromCandidates(["es"])).toBe("es");
    expect(resolveLocaleFromCandidates(["es-MX"])).toBe("es");
    expect(resolveLocaleFromCandidates(["fr-CA", "en-US"])).toBe("en");
  });

  it("falls back to English when no candidate matches", () => {
    expect(resolveLocaleFromCandidates(["fr-CA", "ja-JP"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocaleFromCandidates([])).toBe(DEFAULT_LOCALE);
  });

  it("resolves explicit preferences independently of system locales", () => {
    expect(resolveLanguagePreference("es", ["en-US"])).toBe("es");
    expect(resolveLanguagePreference("en", ["es-MX"])).toBe("en");
  });

  it("resolves system preference from the provided system locale list", () => {
    expect(resolveLanguagePreference("system", ["es-MX"])).toBe("es");
    expect(resolveLanguagePreference("system", ["fr-CA"])).toBe("en");
  });

  it("parses persisted language preferences safely", () => {
    expect(parseLanguagePreference("system")).toBe("system");
    expect(parseLanguagePreference("en")).toBe("en");
    expect(parseLanguagePreference("es")).toBe("es");
    expect(parseLanguagePreference("fr")).toBe(DEFAULT_LANGUAGE_PREFERENCE);
    expect(parseLanguagePreference(null)).toBe(DEFAULT_LANGUAGE_PREFERENCE);
  });

  it("stores locale direction metadata", () => {
    expect(localeDirection("en")).toBe("ltr");
    expect(localeDirection("es")).toBe("ltr");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatList,
  formatNumber,
  formatRelativeMinutes,
  pluralCategory,
} from "./formatters";
import { translateFromPartialCatalog, type Translate } from "./translator.svelte";

describe("locale-aware formatters", () => {
  it("formats dates with the requested locale", () => {
    const date = new Date(Date.UTC(2026, 5, 5, 15, 30));
    expect(
      formatDateTime("en", date, {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }),
    ).toBe("June 5");
    expect(
      formatDateTime("es", date, {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }),
    ).toBe("5 de junio");
  });

  it("formats numbers with the requested locale", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatNumber("es", 1234.5)).toBe("1234,5");
  });

  it("formats lists with Intl.ListFormat", () => {
    expect(formatList("en", ["Calendar", "Pomodoro", "Music"])).toBe(
      "Calendar, Pomodoro, and Music",
    );
    expect(formatList("es", ["Calendario", "Pomodoro", "Música"])).toBe(
      "Calendario, Pomodoro y Música",
    );
  });

  it("returns locale plural categories", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
    expect(pluralCategory("es", 1)).toBe("one");
  });

  it("formats relative minute labels through the translator", () => {
    const spanishCatalog = {
      format: {
        relativeMinutesFuture: (count: number) => `en ${count} min`,
      },
    };
    const t: Translate = ((key, ...args) =>
      translateFromPartialCatalog(spanishCatalog, key, ...args)) as Translate;

    expect(formatRelativeMinutes(t, 5)).toBe("en 5 min");
    expect(formatRelativeMinutes(t, 0)).toBe("Now");
    expect(formatRelativeMinutes(t, -3)).toBe("3 min ago");
  });
});

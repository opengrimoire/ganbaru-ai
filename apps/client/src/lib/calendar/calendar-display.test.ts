import { describe, expect, it } from "vitest";
import type { Calendar } from "$lib/components/calendar/types";
import {
  calendarDisplayName,
  calendarIdentityEmail,
  calendarImportDate,
} from "./calendar-display";

function makeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: "cal-1",
    name: "GanbaruAI",
    color: "",
    source: "local",
    visible: true,
    readOnly: false,
    ...overrides,
  };
}

describe("calendar display helpers", () => {
  it("uses the .ics source filename as the imported calendar label", () => {
    const calendar = makeCalendar({
      name: "Imported from old-label@example.com (2026-05-14)",
      source: "ics",
      sourceUrl: "victorgarcia322ac@gmail.com.ics",
    });

    expect(calendarDisplayName(calendar)).toBe("victorgarcia322ac@gmail.com");
  });

  it("falls back to legacy imported names when source_url is unavailable", () => {
    const calendar = makeCalendar({
      name: "Imported from old-label@example.com (2026-05-14)",
      source: "ics",
    });

    expect(calendarDisplayName(calendar)).toBe("old-label@example.com");
    expect(calendarImportDate(calendar)).toBe("2026-05-14");
  });

  it("derives an identity email from the source filename", () => {
    const calendar = makeCalendar({
      source: "ics",
      sourceUrl: "victorgarcia322ac@gmail.com.ics",
    });

    expect(calendarIdentityEmail(calendar)).toBe("victorgarcia322ac@gmail.com");
  });

  it("does not derive identities from non-email imported calendar names", () => {
    const calendar = makeCalendar({
      name: "work",
      source: "ics",
      sourceUrl: "work.ics",
    });

    expect(calendarIdentityEmail(calendar)).toBeUndefined();
  });
});
